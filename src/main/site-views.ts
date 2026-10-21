// site-views.ts
import { session, WebContentsView, type BrowserWindow } from 'electron';
import { isSiteKind, type Agent, type SiteKind } from '../shared/agents';
import type { SiteAction, SiteStateEvent } from '../shared/ipc';
import { siteBounds } from '../shared/site-layout';
import { originOf, permissionAllowed, popupAllowed, siteStartUrl, userAgentFor } from '../shared/site-policy';

interface SiteEntry {
  kind: SiteKind;
  view: WebContentsView;
}

export class SiteViews {
  private readonly entries = new Map<string, SiteEntry>();
  private visibleId: string | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (event: SiteStateEvent) => void,
    private readonly env: Readonly<Record<string, string | undefined>> = {},
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
    entry.view.webContents.focus();
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
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (!popupAllowed(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.window,
          webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    });
    const refresh = (): void => {
      if (this.visibleId === id) this.publish(id, view);
    };
    contents.on('did-navigate', refresh);
    contents.on('did-navigate-in-page', refresh);
    contents.on('did-finish-load', refresh);
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const entry = { kind, view };
    this.entries.set(id, entry);
    void contents.loadURL(siteStartUrl(kind, this.env));
    return entry;
  }

  private configureSession(partition: string, kind: SiteKind): void {
    const ses = session.fromPartition(partition);
    ses.setUserAgent(userAgentFor(kind, ses.getUserAgent()));
    const agentOrigin = originOf(siteStartUrl(kind, this.env)) ?? '';
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(permissionAllowed(agentOrigin, permission, details.requestingUrl));
    });
    ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      permissionAllowed(agentOrigin, permission, requestingOrigin),
    );
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
