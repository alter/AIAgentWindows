// agent-controller.ts
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AGENT_LABELS, OPENROUTER_KIND, isCliKind, isSiteKind, parseAgentTitle, removeAgent, type Agent, type AgentKind, type AppState } from '../shared/agents';
import { buildSpawn, type SpawnSpec } from '../shared/cli-args';
import type { Rollout } from '../shared/codex-claim';
import { emptyOpenRouterSettings, parseOpenRouterSettings, type OpenRouterSettings } from '../shared/openrouter';
import { openrouterTitle } from '../shared/openrouter-chat';
import type { FolderLookup } from '../shared/projects';
import { EVENT_CHANNELS, type AddAgentResult, type AgentsSnapshot, type EventChannel, type PtyBacklog, type SiteAction } from '../shared/ipc';
import { parseSidebarWidth } from '../shared/site-layout';
import { parseThemeChoice, type ThemeChoice } from '../shared/theme';
import { OutputBuffer } from '../shared/output-buffer';
import { claimForAgents, restoreSpawn } from '../shared/restore';
import { bracketedPaste } from '../shared/terminal-input';
import { claudeTranscriptExists } from './claude-transcripts';
import { PtyManager } from './pty-manager';
import { StateRefusedError, type AppStateStore } from './store/app-state';

export interface ControllerDeps {
  store: AppStateStore;
  sharedDir: string;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  pickFolder(): Promise<string | null>;
  emit(channel: EventChannel, payload: unknown): void;
  siteNav?(id: string, action: SiteAction): void;
  showSite?(agent: Agent | null): void;
  layoutSidebar?(width: number): void;
  closeSite?(id: string): void;
  closeChat?(id: string): void;
  listRollouts?(sinceMs: number): Promise<Rollout[]>;
  folderOf?(projectId: string): Promise<FolderLookup>;
}

const NO_PROJECTS: FolderLookup = { ok: false, error: 'Projects are not available.' };

type ControllerSlice = 'agents' | 'theme' | 'sidebarWidth' | 'openrouterKey';

export class AgentController {
  private agents: Agent[];
  private selectedId: string | null;
  private roomOpen = false;
  private themeChoice: ThemeChoice;
  private sidebar: number;
  private cipher: string | undefined;
  private readonly pty: PtyManager;
  private readonly backlogs = new Map<string, OutputBuffer>();
  private readonly spawnedAt = new Map<string, number>();
  private readonly closed = new Set<string>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ControllerDeps) {
    const initial: AppState = deps.store.read();
    this.agents = [...initial.agents];
    this.selectedId = this.agents[0]?.id ?? null;
    this.themeChoice = parseThemeChoice(initial.theme);
    this.sidebar = parseSidebarWidth(initial.sidebarWidth);
    this.cipher = initial.openrouterKey;
    this.pty = new PtyManager({
      onData: (id, data) => {
        if (!this.closed.has(id)) this.deps.emit(EVENT_CHANNELS.ptyData, { id, data, end: this.backlogOf(id).append(data) });
      },
      onExit: (id, exitCode) => this.deps.emit(EVENT_CHANNELS.ptyExit, { id, exitCode }),
    });
  }

  snapshot(): AgentsSnapshot {
    return { agents: [...this.agents], selectedId: this.selectedId, roomOpen: this.roomOpen };
  }

  theme(): ThemeChoice {
    return this.themeChoice;
  }

  async setTheme(choice: ThemeChoice): Promise<void> {
    this.themeChoice = choice;
    await this.persist('theme');
  }

  sidebarWidth(): number {
    return this.sidebar;
  }

  async setSidebarWidth(width: number): Promise<void> {
    this.sidebar = width;
    this.deps.layoutSidebar?.(width);
    await this.persist('sidebarWidth');
  }

  openrouterCipher(): string | null {
    return this.cipher ?? null;
  }

  async setOpenrouterCipher(cipher: string | null): Promise<void> {
    if ((cipher ?? undefined) === this.cipher) return;
    this.refuseWhileFailClosed();
    this.cipher = cipher ?? undefined;
    await this.persist('openrouterKey');
  }

  agentById(id: string): Agent | undefined {
    return this.agents.find((agent) => agent.id === id);
  }

  selectedAgent(): Agent | undefined {
    return this.selectedId === null ? undefined : this.agentById(this.selectedId);
  }

  async add(kind: AgentKind, projectId?: string): Promise<AddAgentResult> {
    const refused = this.deps.store.failure();
    if (refused !== null) return { ok: false, error: refused };
    const found = projectId === undefined ? undefined : await this.projectFolder(projectId);
    if (found !== undefined && !found.ok) return { ok: false, error: found.error };
    const folder = found?.folder;
    const created = isCliKind(kind) ? await this.createCliAgent(kind, folder) : kind === OPENROUTER_KIND ? this.createOpenRouterAgent() : this.createSiteAgent(kind);
    if (created === null) return { ok: true };
    const agent = projectId === undefined ? created : { ...created, projectId };
    this.agents.push(agent);
    this.selectedId = agent.id;
    this.roomOpen = false;
    await this.persist('agents');
    this.emitChanged();
    return { ok: true };
  }

  async select(id: string): Promise<void> {
    if (this.agentById(id) === undefined) return;
    this.selectedId = id;
    this.roomOpen = false;
    this.emitChanged();
  }

  selectRoom(): void {
    this.roomOpen = true;
    this.emitChanged();
  }

  paste(id: string, text: string): boolean {
    const agent = this.agentById(id);
    if (agent === undefined || !isCliKind(agent.kind)) return false;
    return this.pty.write(id, bracketedPaste(text));
  }

  async close(id: string): Promise<void> {
    if (this.agentById(id) === undefined) return;
    await this.claimSessions();
    const next = removeAgent(this.agents, this.selectedId, id);
    this.closed.add(id);
    this.pty.kill(id);
    this.deps.closeSite?.(id);
    this.deps.closeChat?.(id);
    this.backlogs.delete(id);
    this.spawnedAt.delete(id);
    this.agents = next.agents;
    this.selectedId = next.selectedId;
    await this.persist('agents');
    this.emitChanged();
  }

  canClose(): string | null {
    return null;
  }

  async closeProject(projectId: string): Promise<void> {
    for (const agent of this.agents.filter((item) => item.projectId === projectId)) await this.close(agent.id);
  }

  async rename(id: string, title: string): Promise<boolean> {
    const clean = parseAgentTitle(title);
    if (clean === null || this.agentById(id) === undefined) return false;
    this.agents = this.agents.map((agent) => (agent.id === id ? { ...agent, title: clean } : agent));
    await this.persist('agents');
    this.emitChanged();
    return true;
  }

  async setOpenrouterSettings(id: string, settings: unknown): Promise<boolean> {
    const clean = parseOpenRouterSettings(settings);
    const known = this.agentById(id);
    if (clean === null || known === undefined || known.kind !== OPENROUTER_KIND) return false;
    const before = known.openrouter ?? emptyOpenRouterSettings();
    const renamed = known.title !== openrouterTitle(before);
    const title = renamed ? known.title : openrouterTitle(clean);
    this.agents = this.agents.map((agent) => (agent.id === id ? { ...agent, title, openrouter: clean } : agent));
    await this.persist('agents');
    this.emitChanged();
    return true;
  }

  openrouterSettings(id: string): OpenRouterSettings | undefined {
    const agent = this.agentById(id);
    return agent?.kind === OPENROUTER_KIND ? (agent.openrouter ?? emptyOpenRouterSettings()) : undefined;
  }

  async restart(id: string): Promise<boolean> {
    const known = this.agentById(id);
    if (known === undefined || !isCliKind(known.kind) || this.pty.has(id)) return false;
    if (await this.claimSessions()) await this.persist('agents');
    const agent = this.agentById(id);
    if (agent === undefined || this.pty.has(id)) return false;
    await this.respawn(agent);
    return this.pty.has(id);
  }

  ptyWrite(id: string, data: string): void {
    this.pty.write(id, data);
  }

  ptyResize(id: string, cols: number, rows: number): void {
    this.pty.resize(id, { cols, rows });
  }

  ptyBacklog(id: string): PtyBacklog {
    return this.backlogs.get(id)?.snapshot() ?? { data: '', end: 0 };
  }

  syncSelection(): void {
    this.deps.showSite?.(this.roomOpen ? null : this.selectedSiteAgent());
  }

  siteNav(id: string, action: SiteAction): void {
    this.deps.siteNav?.(id, action);
  }

  async restore(): Promise<void> {
    const claimed = await this.claimSessions();
    await Promise.all(this.agents.map((agent) => this.respawn(agent)));
    if (claimed) await this.persist('agents');
  }

  flush(): Promise<void> {
    return this.persist('agents');
  }

  shutdown(): void {
    this.pty.killAll();
  }

  private async createCliAgent(kind: 'claude' | 'codex', folder: string | undefined): Promise<Agent | null> {
    const cwd = folder ?? (await this.deps.pickFolder());
    if (cwd === null) return null;
    const id = randomUUID();
    const sessionId = kind === 'claude' ? randomUUID() : undefined;
    this.startPty(id, () =>
      buildSpawn(kind, {
        cwd,
        sessionId,
        sharedDir: this.deps.sharedDir,
        resume: false,
        platform: this.deps.platform,
        env: this.deps.env,
      }),
    );
    const title = `${AGENT_LABELS[kind]} · ${path.basename(cwd) || cwd}`;
    return sessionId === undefined
      ? { id, kind, title, cwd, createdAt: Date.now() }
      : { id, kind, title, cwd, sessionId, createdAt: Date.now() };
  }

  private createOpenRouterAgent(): Agent {
    const settings = emptyOpenRouterSettings();
    return { id: randomUUID(), kind: OPENROUTER_KIND, title: openrouterTitle(settings), openrouter: settings, createdAt: Date.now() };
  }

  private createSiteAgent(kind: AgentKind): Agent {
    return { id: randomUUID(), kind, title: AGENT_LABELS[kind], createdAt: Date.now() };
  }

  private backlogOf(id: string): OutputBuffer {
    let buffer = this.backlogs.get(id);
    if (buffer === undefined) {
      buffer = new OutputBuffer();
      this.backlogs.set(id, buffer);
    }
    return buffer;
  }

  private async projectFolder(projectId: string): Promise<FolderLookup> {
    return this.deps.folderOf === undefined ? NO_PROJECTS : this.deps.folderOf(projectId);
  }

  private async respawn(agent: Agent): Promise<void> {
    const project = agent.projectId !== undefined && isCliKind(agent.kind) ? await this.projectFolder(agent.projectId) : undefined;
    if (this.pty.has(agent.id) || this.agentById(agent.id) === undefined) return;
    this.startPty(agent.id, () =>
      restoreSpawn(agent, {
        sharedDir: this.deps.sharedDir,
        platform: this.deps.platform,
        env: this.deps.env,
        claudeTranscriptExists: (sessionId) => claudeTranscriptExists(this.deps.env, sessionId),
        ...(project === undefined ? {} : { project }),
      }),
    );
  }

  private startPty(id: string, build: () => SpawnSpec | null): void {
    try {
      const spec = build();
      if (spec === null) return;
      this.pty.spawn(id, spec);
      this.spawnedAt.set(id, Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const data = `${message}\r\n`;
      this.deps.emit(EVENT_CHANNELS.ptyData, { id, data, end: this.backlogOf(id).append(data) });
    }
  }

  private async claimSessions(): Promise<boolean> {
    const open = this.agents.filter((agent) => agent.kind === 'codex' && agent.sessionId === undefined && agent.cwd !== undefined);
    if (open.length === 0 || this.deps.listRollouts === undefined) return false;
    const bound = (agent: Agent): number => this.spawnedAt.get(agent.id) ?? agent.createdAt;
    const rollouts = await this.deps.listRollouts(Math.min(...open.map(bound)));
    const claims = claimForAgents(this.agents, rollouts, bound);
    if (claims.size === 0) return false;
    this.agents = this.agents.map((agent) => {
      const sessionId = claims.get(agent.id);
      return sessionId === undefined ? agent : { ...agent, sessionId };
    });
    return true;
  }

  private refuseWhileFailClosed(): void {
    const refused = this.deps.store.failure();
    if (refused !== null) throw new StateRefusedError(refused);
  }

  private slice(slice: ControllerSlice): Promise<void> {
    const { store } = this.deps;
    switch (slice) {
      case 'agents':
        return store.update('agents', () => [...this.agents]);
      case 'theme':
        return store.update('theme', () => this.themeChoice);
      case 'sidebarWidth':
        return store.update('sidebarWidth', () => this.sidebar);
      case 'openrouterKey':
        return store.update('openrouterKey', () => this.cipher);
    }
  }

  private persist(slice: ControllerSlice): Promise<void> {
    const run = async (): Promise<void> => {
      const claimed = await this.claimSessions();
      try {
        await this.slice(slice);
        if (claimed && slice !== 'agents') await this.slice('agents');
      } catch (error) {
        if (!(error instanceof StateRefusedError)) throw error;
      }
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  private selectedSiteAgent(): Agent | null {
    const selected = this.selectedAgent();
    return selected !== undefined && isSiteKind(selected.kind) ? selected : null;
  }

  private emitChanged(): void {
    this.syncSelection();
    this.deps.emit(EVENT_CHANNELS.agentsChanged, this.snapshot());
  }
}
