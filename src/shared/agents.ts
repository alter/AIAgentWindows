// agents.ts
import { parseSidebarWidth } from './site-layout';
import { parseThemeChoice, type ThemeChoice } from './theme';
export const AGENT_KINDS = ['claude', 'codex', 'chatgpt', 'grok', 'deepseek'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export type CliKind = 'claude' | 'codex';
export type SiteKind = 'chatgpt' | 'grok' | 'deepseek';

export const SITE_KINDS_WITH_ADAPTER: readonly SiteKind[] = ['chatgpt', 'grok', 'deepseek'];

export const AGENT_LABELS: Readonly<Record<AgentKind, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  deepseek: 'DeepSeek',
};

export const SITE_URLS: Readonly<Record<SiteKind, string>> = {
  chatgpt: 'https://chatgpt.com/',
  grok: 'https://grok.com/',
  deepseek: 'https://chat.deepseek.com/',
};

export interface Agent {
  id: string;
  kind: AgentKind;
  title: string;
  cwd?: string;
  sessionId?: string;
  createdAt: number;
}

export interface AppState {
  version: 1;
  agents: Agent[];
  theme?: ThemeChoice;
  sidebarWidth?: number;
  openrouterKey?: string;
}

export const MAX_AGENT_TITLE_CHARS = 80;
export const STATE_VERSION = 1;
export const MAX_STATE_BYTES = 1024 * 1024;
export const MAX_CWD_BYTES = 4096;
export const MAX_CIPHER_CHARS = 4096;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

export function parseAgentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  for (let index = 0; index < value.length; index += 1) if (isControlCode(value.charCodeAt(index))) return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= MAX_AGENT_TITLE_CHARS ? title : null;
}

export function isCliKind(kind: string): kind is CliKind {
  return kind === 'claude' || kind === 'codex';
}

export function isSiteKind(kind: string): kind is SiteKind {
  return kind === 'chatgpt' || kind === 'grok' || kind === 'deepseek';
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function emptyState(): AppState {
  return { version: STATE_VERSION, agents: [] };
}

export function removeAgent(
  agents: readonly Agent[],
  selectedId: string | null,
  id: string,
): { agents: Agent[]; selectedId: string | null } {
  const index = agents.findIndex((agent) => agent.id === id);
  if (index < 0) return { agents: [...agents], selectedId };
  const remaining = agents.filter((agent) => agent.id !== id);
  if (selectedId !== id) return { agents: remaining, selectedId };
  return { agents: remaining, selectedId: (remaining[index] ?? remaining[index - 1])?.id ?? null };
}

export function serializeState(state: AppState): string {
  return JSON.stringify(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

function validCwd(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_CWD_BYTES;
}

function parseAgent(raw: unknown): Agent | null {
  if (!isRecord(raw)) return null;
  const { id, kind, title, cwd, sessionId, createdAt } = raw;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!isAgentKind(kind)) return null;
  if (typeof title !== 'string') return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  const agent: Agent = { id, kind, title, createdAt };
  if (cwd !== undefined) {
    if (!isCliKind(kind) || !validCwd(cwd)) return null;
    agent.cwd = cwd;
  }
  if (sessionId !== undefined) {
    if (!isCliKind(kind) || !isUuid(sessionId)) return null;
    agent.sessionId = sessionId;
  }
  return agent;
}

export function parseState(text: string): AppState {
  if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) return emptyState();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (!isRecord(raw) || raw['version'] !== STATE_VERSION || !Array.isArray(raw['agents'])) {
    return emptyState();
  }
  const agents: Agent[] = [];
  const seen = new Set<string>();
  for (const item of raw['agents'] as unknown[]) {
    const agent = parseAgent(item);
    if (agent === null || seen.has(agent.id)) return emptyState();
    seen.add(agent.id);
    agents.push(agent);
  }
  const state: AppState = { version: STATE_VERSION, agents };
  if (raw['theme'] !== undefined) state.theme = parseThemeChoice(raw['theme']);
  if (raw['sidebarWidth'] !== undefined) state.sidebarWidth = parseSidebarWidth(raw['sidebarWidth']);
  const cipher = raw['openrouterKey'];
  if (typeof cipher === 'string' && cipher.length <= MAX_CIPHER_CHARS && BASE64_PATTERN.test(cipher)) state.openrouterKey = cipher;
  return state;
}
