// site-views.ts
import { session, WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { isSiteKind, type Agent, type SiteKind } from '../shared/agents';
import type { SiteAction, SiteStateEvent } from '../shared/ipc';
import { siteBounds } from '../shared/site-layout';
import { windowsVisible } from '../shared/window-visibility';
import {
  originOf,
  permissionAllowed,
  permissionCheckAllowed,
  popupAllowed,
  OWNER_USER_AGENT,
  siteStartUrl,
  userAgentOverride,
  type UserAgentOverride,
} from '../shared/site-policy';
import { SiteAdapterError } from './site-adapters/types';
import { applyOwnerUserAgent } from './site-user-agent';
import type { SiteLogger } from './site-log-file';

interface SiteEntry {
  kind: SiteKind;
  view: WebContentsView;
  loaded: Promise<void>;
}

export class SiteViews {
  private readonly entries = new Map<string, SiteEntry>();
  private visibleId: string | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (event: SiteStateEvent) => void,
    private readonly env: Readonly<Record<string, string | undefined>> = {},
    private readonly log: SiteLogger = () => undefined,
  ) {
    window.on('resize', () => this.layout());
  }

  show(agent: Agent | null): void {
    const site = agent !== null && isSiteKind(agent.kind) ? { id: agent.id, kind: agent.kind } : null;
    const entry = site === null ? null : this.ensure(site.id, site.kind);
    this.visibleId = site === null ? null : site.id;
    for (const [id, other] of this.entries) other.view.setVisible(id === this.visibleId);
    if (site === null || entry === null) return;
    this.layout();
    this.publish(site.id, entry.view);
    if (windowsVisible(this.env)) entry.view.webContents.focus();
  }

  navigate(id: string, action: SiteAction): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const contents = entry.view.webContents;
    if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    else if (action === 'home') void contents.loadURL(siteStartUrl(entry.kind, this.env));
    else if (action === 'reload') contents.reload();
  }

  pageFor(id: string, kind: SiteKind): WebContents {
    return this.ensure(id, kind).view.webContents;
  }

  async prepare(id: string, kind: SiteKind, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const entry = this.ensure(id, kind);
    this.layout();
    await this.within(entry.loaded, kind, timeoutMs, signal);
  }

  async newChat(id: string, kind: SiteKind, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const existed = this.entries.has(id);
    const entry = this.ensure(id, kind);
    this.layout();
    if (!existed) {
      await this.within(entry.loaded, kind, timeoutMs, signal);
      return;
    }
    const reload = entry.view.webContents.loadURL(siteStartUrl(kind, this.env)).catch(() => {
      throw new SiteAdapterError('not-ready', `${kind}: the start page did not load`);
    });
    await this.within(reload, kind, timeoutMs, signal);
  }

  private async within(work: Promise<void>, kind: SiteKind, timeoutMs: number, signal: AbortSignal): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const failure = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new SiteAdapterError('not-ready', `${kind}: page not ready`)), timeoutMs);
      onAbort = () => reject(new SiteAdapterError('aborted', 'the turn was stopped'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([work, failure]);
    } finally {
      clearTimeout(timer);
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
      failure.catch(() => undefined);
      work.catch(() => undefined);
    }
  }

  openPages(): Array<{ kind: SiteKind; contents: WebContents }> {
    return [...this.entries.values()].map((entry) => ({ kind: entry.kind, contents: entry.view.webContents }));
  }

  close(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.entries.delete(id);
    if (this.visibleId === id) this.visibleId = null;
    this.window.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  closeAll(): void {
    for (const entry of this.entries.values()) {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    }
    this.entries.clear();
    this.visibleId = null;
  }

  private ensure(id: string, kind: SiteKind): SiteEntry {
    const existing = this.entries.get(id);
    if (existing !== undefined) return existing;
    const partition = `persist:${id}`;
    this.configureSession(partition, kind);
    const view = new WebContentsView({
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (!popupAllowed(url)) {
        this.log(kind, 'popup-denied', { url });
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.window,
          show: windowsVisible(this.env),
          webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    });
    void applyOwnerUserAgent(contents, this.userAgent(), (message) => this.log(kind, 'user-agent-override-failed', { message }));
    const loaded = new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()));
    const refresh = (): void => {
      if (this.visibleId === id) this.publish(id, view);
    };
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      this.log(kind, 'load-failed', { code, description, url, mainFrame: isMainFrame });
    });
    contents.on('did-navigate', refresh);
    contents.on('did-navigate-in-page', refresh);
    contents.on('did-finish-load', refresh);
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const entry = { kind, view, loaded };
    this.entries.set(id, entry);
    this.layout();
    void contents.loadURL(siteStartUrl(kind, this.env));
    return entry;
  }

  private configureSession(partition: string, kind: SiteKind): void {
    const ses = session.fromPartition(partition);
    ses.setUserAgent(OWNER_USER_AGENT);
    const agentOrigin = originOf(siteStartUrl(kind, this.env)) ?? '';
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      const allowed = permissionAllowed(agentOrigin, permission, details.requestingUrl);
      this.log(kind, 'request', { permission, origin: details.requestingUrl, allowed });
      callback(allowed);
    });
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      const allowed = permissionCheckAllowed(agentOrigin, permission, requestingOrigin);
      this.log(kind, 'check', { permission, origin: requestingOrigin, allowed });
      return allowed;
    });
  }

  private userAgent(): UserAgentOverride {
    return userAgentOverride({
      chromeVersion: process.versions.chrome,
      platformVersion: process.getSystemVersion(),
      arch: process.arch,
    });
  }

  private layout(): void {
    const [width, height] = this.window.getContentSize();
    const bounds = siteBounds(width ?? 0, height ?? 0);
    for (const entry of this.entries.values()) entry.view.setBounds(bounds);
  }

  private publish(id: string, view: WebContentsView): void {
    const contents = view.webContents;
    this.emit({
      id,
      url: contents.getURL(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }
}
