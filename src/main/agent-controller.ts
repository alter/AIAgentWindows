// agent-controller.ts
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isCliKind, type Agent, type AgentKind, type AppState } from '../shared/agents';
import { buildSpawn } from '../shared/cli-args';
import { EVENT_CHANNELS, type AgentsSnapshot, type EventChannel, type SiteAction } from '../shared/ipc';
import { PtyManager } from './pty-manager';
import { saveState } from './state-file';

const KIND_LABELS: Readonly<Record<AgentKind, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  deepseek: 'DeepSeek',
};

export interface ControllerDeps {
  stateFile: string;
  sharedDir: string;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  pickFolder(): Promise<string | null>;
  emit(channel: EventChannel, payload: unknown): void;
  siteNav?(id: string, action: SiteAction): void;
}

export class AgentController {
  private agents: Agent[];
  private selectedId: string | null;
  private readonly pty: PtyManager;

  constructor(private readonly deps: ControllerDeps, initial: AppState) {
    this.agents = [...initial.agents];
    this.selectedId = this.agents[0]?.id ?? null;
    this.pty = new PtyManager({
      onData: (id, data) => this.deps.emit(EVENT_CHANNELS.ptyData, { id, data }),
      onExit: (id, exitCode) => this.deps.emit(EVENT_CHANNELS.ptyExit, { id, exitCode }),
    });
  }

  snapshot(): AgentsSnapshot {
    return { agents: [...this.agents], selectedId: this.selectedId };
  }

  agentById(id: string): Agent | undefined {
    return this.agents.find((agent) => agent.id === id);
  }

  selectedAgent(): Agent | undefined {
    return this.selectedId === null ? undefined : this.agentById(this.selectedId);
  }

  async add(kind: AgentKind): Promise<void> {
    const agent = isCliKind(kind) ? await this.createCliAgent(kind) : this.createSiteAgent(kind);
    if (agent === null) return;
    this.agents.push(agent);
    this.selectedId = agent.id;
    await this.persist();
    this.emitChanged();
  }

  async select(id: string): Promise<void> {
    if (this.agentById(id) === undefined) return;
    this.selectedId = id;
    this.emitChanged();
  }

  ptyWrite(id: string, data: string): void {
    this.pty.write(id, data);
  }

  ptyResize(id: string, cols: number, rows: number): void {
    this.pty.resize(id, { cols, rows });
  }

  siteNav(id: string, action: SiteAction): void {
    this.deps.siteNav?.(id, action);
  }

  shutdown(): void {
    this.pty.killAll();
  }

  private async createCliAgent(kind: 'claude' | 'codex'): Promise<Agent | null> {
    const cwd = await this.deps.pickFolder();
    if (cwd === null) return null;
    const id = randomUUID();
    const sessionId = kind === 'claude' ? randomUUID() : undefined;
    const spec = buildSpawn(kind, {
      cwd,
      sessionId,
      sharedDir: this.deps.sharedDir,
      resume: false,
      platform: this.deps.platform,
      env: this.deps.env,
    });
    this.pty.spawn(id, spec);
    const title = `${KIND_LABELS[kind]} · ${path.basename(cwd) || cwd}`;
    return sessionId === undefined
      ? { id, kind, title, cwd, createdAt: Date.now() }
      : { id, kind, title, cwd, sessionId, createdAt: Date.now() };
  }

  private createSiteAgent(kind: AgentKind): Agent {
    return { id: randomUUID(), kind, title: KIND_LABELS[kind], createdAt: Date.now() };
  }

  private persist(): Promise<void> {
    const state: AppState = { version: 1, agents: this.agents };
    return saveState(this.deps.stateFile, state);
  }

  private emitChanged(): void {
    this.deps.emit(EVENT_CHANNELS.agentsChanged, this.snapshot());
  }
}
