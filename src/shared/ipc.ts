// ipc.ts
import { AGENT_KINDS, isUuid, parseAgentTitle, type Agent, type AgentKind } from './agents';
import type { RoomModels } from './cli-models';
import type { OutputSnapshot } from './output-buffer';
import { isRoomId, parseRoomConfig, parseRoomTitle, type RoomConfig, type RoomEvent, type RoomListItem } from './room-model';
import { MAX_PASTE_CHARS, parseOpenRouterSettings, type ModelItem, type OpenRouterMode, type OpenRouterSettings, type OpenRouterStatus } from './openrouter';
import { MAX_ENTRIES, MAX_MESSAGE_CHARS, type ChatDelta, type ChatLoad, type ChatSend } from './openrouter-chat';
import { isSidebarWidth } from './site-layout';
import { isThemeChoice, type ThemeChoice } from './theme';
import { CARRY_KINDS, type CarryWhat, type RoomOpenResult, type RoomSnapshot, type RoomStartResult } from './room-view';

export const INVOKE_CHANNELS = {
  listAgents: 'agents:list',
  addAgent: 'agents:add',
  selectAgent: 'agents:select',
  closeAgent: 'agents:close',
  restartAgent: 'agents:restart',
  renameAgent: 'agent:rename',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyBacklog: 'pty:backlog',
  siteNav: 'site:nav',
  roomState: 'room:state',
  roomList: 'room:list',
  roomOpen: 'room:open',
  roomRename: 'room:rename',
  roomDelete: 'room:delete',
  roomNew: 'room:new',
  roomSelect: 'room:select',
  roomStart: 'room:start',
  roomStop: 'room:stop',
  roomCarry: 'room:carry',
  roomResume: 'room:resume',
  roomModels: 'room:models',
  roomCopyFinal: 'room:copy-final',
  roomTerminalBacklog: 'room:terminal-backlog',
  roomTerminalWrite: 'room:terminal-write',
  roomTerminalResize: 'room:terminal-resize',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  layoutGet: 'layout:get',
  layoutSidebar: 'layout:sidebar',
  openrouterStatus: 'openrouter:status',
  openrouterConnect: 'openrouter:connect',
  openrouterPaste: 'openrouter:paste',
  openrouterCancel: 'openrouter:cancel',
  openrouterDisconnect: 'openrouter:disconnect',
  openrouterRefresh: 'openrouter:refresh',
  openrouterModels: 'openrouter:models',
  openrouterChatLoad: 'openrouter:chat-load',
  openrouterChatSend: 'openrouter:chat-send',
  openrouterChatRetry: 'openrouter:chat-retry',
  openrouterChatStop: 'openrouter:chat-stop',
  openrouterChatCopy: 'openrouter:chat-copy',
  openrouterSettings: 'openrouter:settings',
} as const;

export const EVENT_CHANNELS = {
  agentsChanged: 'agents:changed',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  siteState: 'site:state',
  roomEvent: 'room:event',
  roomTerminalData: 'room:terminal-data',
  openrouterChanged: 'openrouter:changed',
  openrouterChatDelta: 'openrouter:chat-delta',
} as const;

export const MAX_PTY_WRITE_BYTES = 1024 * 1024;
export const MAX_ID_LENGTH = 200;
export const MAX_DIMENSION = 1000;
export const SITE_ACTIONS = ['back', 'forward', 'home', 'reload'] as const;

export type SiteAction = (typeof SITE_ACTIONS)[number];

export interface AgentsSnapshot {
  agents: Agent[];
  selectedId: string | null;
  roomOpen: boolean;
}

export type AddAgentResult = { ok: true } | { ok: false; error: string };

export interface PtyDataEvent {
  id: string;
  data: string;
  end: number;
}

export type PtyBacklog = OutputSnapshot;

export interface PtyExitEvent {
  id: string;
  exitCode: number;
}

export interface SiteStateEvent {
  id: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface RoomStartRequest {
  config: RoomConfig;
  continueId?: string;
  resume?: boolean;
}

export interface OpenRouterModels {
  ok: boolean;
  models: ModelItem[];
}

export interface InvokeRequests {
  [INVOKE_CHANNELS.listAgents]: undefined;
  [INVOKE_CHANNELS.addAgent]: { kind: AgentKind };
  [INVOKE_CHANNELS.selectAgent]: { id: string };
  [INVOKE_CHANNELS.closeAgent]: { id: string };
  [INVOKE_CHANNELS.restartAgent]: { id: string };
  [INVOKE_CHANNELS.renameAgent]: { id: string; title: string };
  [INVOKE_CHANNELS.ptyWrite]: { id: string; data: string };
  [INVOKE_CHANNELS.ptyResize]: { id: string; cols: number; rows: number };
  [INVOKE_CHANNELS.ptyBacklog]: { id: string };
  [INVOKE_CHANNELS.siteNav]: { id: string; action: SiteAction };
  [INVOKE_CHANNELS.roomState]: undefined;
  [INVOKE_CHANNELS.roomList]: undefined;
  [INVOKE_CHANNELS.roomOpen]: { id: string };
  [INVOKE_CHANNELS.roomRename]: { id: string; title: string };
  [INVOKE_CHANNELS.roomDelete]: { id: string };
  [INVOKE_CHANNELS.roomNew]: undefined;
  [INVOKE_CHANNELS.roomSelect]: undefined;
  [INVOKE_CHANNELS.roomStart]: RoomStartRequest;
  [INVOKE_CHANNELS.roomStop]: undefined;
  [INVOKE_CHANNELS.roomCarry]: { id: string; what: CarryWhat };
  [INVOKE_CHANNELS.roomResume]: undefined;
  [INVOKE_CHANNELS.roomModels]: undefined;
  [INVOKE_CHANNELS.roomCopyFinal]: undefined;
  [INVOKE_CHANNELS.roomTerminalBacklog]: { id: string };
  [INVOKE_CHANNELS.roomTerminalWrite]: { id: string; data: string };
  [INVOKE_CHANNELS.roomTerminalResize]: { id: string; cols: number; rows: number };
  [INVOKE_CHANNELS.themeGet]: undefined;
  [INVOKE_CHANNELS.themeSet]: { choice: ThemeChoice };
  [INVOKE_CHANNELS.layoutGet]: undefined;
  [INVOKE_CHANNELS.layoutSidebar]: { width: number };
  [INVOKE_CHANNELS.openrouterStatus]: undefined;
  [INVOKE_CHANNELS.openrouterConnect]: { mode: OpenRouterMode };
  [INVOKE_CHANNELS.openrouterPaste]: { text: string };
  [INVOKE_CHANNELS.openrouterCancel]: undefined;
  [INVOKE_CHANNELS.openrouterDisconnect]: undefined;
  [INVOKE_CHANNELS.openrouterRefresh]: undefined;
  [INVOKE_CHANNELS.openrouterModels]: { refresh: boolean };
  [INVOKE_CHANNELS.openrouterChatLoad]: { id: string };
  [INVOKE_CHANNELS.openrouterChatSend]: { id: string; text: string };
  [INVOKE_CHANNELS.openrouterChatRetry]: { id: string; index: number };
  [INVOKE_CHANNELS.openrouterChatStop]: { id: string };
  [INVOKE_CHANNELS.openrouterChatCopy]: { id: string; index: number };
  [INVOKE_CHANNELS.openrouterSettings]: { id: string; settings: OpenRouterSettings };
}

export type InvokeChannel = keyof InvokeRequests;
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AppApi {
  listAgents(): Promise<AgentsSnapshot>;
  addAgent(kind: AgentKind): Promise<AddAgentResult>;
  selectAgent(id: string): Promise<void>;
  closeAgent(id: string): Promise<void>;
  restartAgent(id: string): Promise<boolean>;
  renameAgent(id: string, title: string): Promise<boolean>;
  ptyWrite(id: string, data: string): Promise<void>;
  ptyResize(id: string, cols: number, rows: number): Promise<void>;
  ptyBacklog(id: string): Promise<PtyBacklog>;
  pathForFile(file: File): string;
  siteNav(id: string, action: SiteAction): Promise<void>;
  roomState(): Promise<RoomSnapshot>;
  roomList(): Promise<RoomListItem[]>;
  roomOpen(id: string): Promise<RoomOpenResult>;
  roomRename(id: string, title: string): Promise<boolean>;
  roomDelete(id: string): Promise<boolean>;
  roomNew(): Promise<boolean>;
  roomSelect(): Promise<void>;
  roomStart(config: RoomConfig, continueId?: string, resume?: boolean): Promise<RoomStartResult>;
  roomStop(): Promise<void>;
  roomCarry(id: string, what: CarryWhat): Promise<boolean>;
  roomResume(): Promise<void>;
  roomModels(): Promise<RoomModels>;
  roomCopyFinal(): Promise<boolean>;
  roomTerminalBacklog(id: string): Promise<PtyBacklog>;
  roomTerminalWrite(id: string, data: string): Promise<void>;
  roomTerminalResize(id: string, cols: number, rows: number): Promise<void>;
  themeGet(): Promise<ThemeChoice>;
  themeSet(choice: ThemeChoice): Promise<void>;
  layoutGet(): Promise<number>;
  layoutSidebar(width: number): Promise<void>;
  openrouterStatus(): Promise<OpenRouterStatus>;
  openrouterConnect(mode: OpenRouterMode): Promise<OpenRouterStatus>;
  openrouterPaste(text: string): Promise<OpenRouterStatus>;
  openrouterCancel(): Promise<OpenRouterStatus>;
  openrouterDisconnect(): Promise<OpenRouterStatus>;
  openrouterRefresh(): Promise<OpenRouterStatus>;
  openrouterModels(refresh: boolean): Promise<OpenRouterModels>;
  openrouterChatLoad(id: string): Promise<ChatLoad>;
  openrouterChatSend(id: string, text: string): Promise<ChatSend>;
  openrouterChatRetry(id: string, index: number): Promise<ChatSend>;
  openrouterChatStop(id: string): Promise<void>;
  openrouterChatCopy(id: string, index: number): Promise<boolean>;
  openrouterSettings(id: string, settings: OpenRouterSettings): Promise<boolean>;
  onAgentsChanged(listener: (snapshot: AgentsSnapshot) => void): () => void;
  onPtyData(listener: (event: PtyDataEvent) => void): () => void;
  onPtyExit(listener: (event: PtyExitEvent) => void): () => void;
  onSiteState(listener: (event: SiteStateEvent) => void): () => void;
  onRoomEvent(listener: (event: RoomEvent) => void): () => void;
  onRoomTerminalData(listener: (event: PtyDataEvent) => void): () => void;
  onOpenRouterChanged(listener: (status: OpenRouterStatus) => void): () => void;
  onOpenRouterChatDelta(listener: (delta: ChatDelta) => void): () => void;
}

type Parser<T> = (payload: unknown) => T | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

function parseDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION
    ? value
    : null;
}

function withId<T extends object>(payload: unknown, build: (record: Record<string, unknown>, id: string) => T | null): T | null {
  if (!isRecord(payload)) return null;
  const id = parseId(payload['id']);
  return id === null ? null : build(payload, id);
}

function parseRoomStart(payload: unknown): RoomStartRequest | null {
  if (!isRecord(payload)) return null;
  const parsed = parseRoomConfig(payload['config']);
  if (!parsed.ok) return null;
  if (!Object.hasOwn(payload, 'continueId')) return Object.hasOwn(payload, 'resume') ? null : { config: parsed.config };
  const continueId = payload['continueId'];
  if (!isRoomId(continueId)) return null;
  if (!Object.hasOwn(payload, 'resume')) return { config: parsed.config, continueId };
  const resume = payload['resume'];
  return typeof resume === 'boolean' ? { config: parsed.config, continueId, resume } : null;
}

function withUuid<T extends object>(payload: unknown, build: (record: Record<string, unknown>, id: string) => T | null): T | null {
  return withId(payload, (record, id) => (isUuid(id) ? build(record, id) : null));
}

function entryIndex(record: Record<string, unknown>, id: string): { id: string; index: number } | null {
  const index = record['index'];
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < MAX_ENTRIES ? { id, index } : null;
}

function noPayload(payload: unknown): undefined | null {
  return payload === undefined ? undefined : null;
}

function parseWrite(payload: unknown): { id: string; data: string } | null {
  return withId(payload, (record, id) => {
    const data = record['data'];
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_PTY_WRITE_BYTES) return null;
    return { id, data };
  });
}

function parseResize(payload: unknown): { id: string; cols: number; rows: number } | null {
  return withId(payload, (record, id) => {
    const cols = parseDimension(record['cols']);
    const rows = parseDimension(record['rows']);
    return cols === null || rows === null ? null : { id, cols, rows };
  });
}

const PARSERS: { [C in InvokeChannel]: Parser<InvokeRequests[C]> } = {
  [INVOKE_CHANNELS.listAgents]: noPayload,
  [INVOKE_CHANNELS.addAgent]: (payload) => {
    if (!isRecord(payload)) return null;
    const kind = payload['kind'];
    return (AGENT_KINDS as readonly unknown[]).includes(kind) ? { kind: kind as AgentKind } : null;
  },
  [INVOKE_CHANNELS.selectAgent]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.closeAgent]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.restartAgent]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.renameAgent]: (payload) =>
    withId(payload, (record, id) => {
      const title = parseAgentTitle(record['title']);
      return title === null ? null : { id, title };
    }),
  [INVOKE_CHANNELS.ptyWrite]: parseWrite,
  [INVOKE_CHANNELS.ptyResize]: parseResize,
  [INVOKE_CHANNELS.ptyBacklog]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.siteNav]: (payload) =>
    withId(payload, (record, id) => {
      const action = record['action'];
      return (SITE_ACTIONS as readonly unknown[]).includes(action) ? { id, action: action as SiteAction } : null;
    }),
  [INVOKE_CHANNELS.roomState]: noPayload,
  [INVOKE_CHANNELS.roomList]: noPayload,
  [INVOKE_CHANNELS.roomOpen]: (payload) =>
    isRecord(payload) && isRoomId(payload['id']) ? { id: payload['id'] } : null,
  [INVOKE_CHANNELS.roomRename]: (payload) => {
    if (!isRecord(payload) || !isRoomId(payload['id'])) return null;
    const title = parseRoomTitle(payload['title']);
    return title === null ? null : { id: payload['id'], title };
  },
  [INVOKE_CHANNELS.roomDelete]: (payload) =>
    isRecord(payload) && isRoomId(payload['id']) ? { id: payload['id'] } : null,
  [INVOKE_CHANNELS.roomNew]: noPayload,
  [INVOKE_CHANNELS.roomSelect]: noPayload,
  [INVOKE_CHANNELS.roomStart]: parseRoomStart,
  [INVOKE_CHANNELS.roomStop]: noPayload,
  [INVOKE_CHANNELS.roomCarry]: (payload) =>
    withId(payload, (record, id) => {
      const what = record['what'];
      return (CARRY_KINDS as readonly unknown[]).includes(what) ? { id, what: what as CarryWhat } : null;
    }),
  [INVOKE_CHANNELS.roomResume]: noPayload,
  [INVOKE_CHANNELS.roomModels]: noPayload,
  [INVOKE_CHANNELS.roomCopyFinal]: noPayload,
  [INVOKE_CHANNELS.roomTerminalBacklog]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.roomTerminalWrite]: parseWrite,
  [INVOKE_CHANNELS.roomTerminalResize]: parseResize,
  [INVOKE_CHANNELS.themeGet]: noPayload,
  [INVOKE_CHANNELS.themeSet]: (payload) => {
    if (!isRecord(payload)) return null;
    const choice = payload['choice'];
    return isThemeChoice(choice) ? { choice } : null;
  },
  [INVOKE_CHANNELS.layoutGet]: noPayload,
  [INVOKE_CHANNELS.layoutSidebar]: (payload) => {
    if (!isRecord(payload)) return null;
    const width = payload['width'];
    return isSidebarWidth(width) ? { width } : null;
  },
  [INVOKE_CHANNELS.openrouterStatus]: noPayload,
  [INVOKE_CHANNELS.openrouterConnect]: (payload) => {
    if (!isRecord(payload)) return null;
    const mode = payload['mode'];
    return mode === 'browser' || mode === 'code' ? { mode } : null;
  },
  [INVOKE_CHANNELS.openrouterPaste]: (payload) => {
    if (!isRecord(payload)) return null;
    const text = payload['text'];
    return typeof text === 'string' && text.length <= MAX_PASTE_CHARS ? { text } : null;
  },
  [INVOKE_CHANNELS.openrouterCancel]: noPayload,
  [INVOKE_CHANNELS.openrouterDisconnect]: noPayload,
  [INVOKE_CHANNELS.openrouterRefresh]: noPayload,
  [INVOKE_CHANNELS.openrouterModels]: (payload) => {
    if (!isRecord(payload)) return null;
    const refresh = payload['refresh'];
    return typeof refresh === 'boolean' ? { refresh } : null;
  },
  [INVOKE_CHANNELS.openrouterChatLoad]: (payload) => withUuid(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.openrouterChatSend]: (payload) =>
    withUuid(payload, (record, id) => {
      const text = record['text'];
      return typeof text === 'string' && text.length >= 1 && text.length <= MAX_MESSAGE_CHARS ? { id, text } : null;
    }),
  [INVOKE_CHANNELS.openrouterChatRetry]: (payload) => withUuid(payload, entryIndex),
  [INVOKE_CHANNELS.openrouterChatStop]: (payload) => withUuid(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.openrouterChatCopy]: (payload) => withUuid(payload, entryIndex),
  [INVOKE_CHANNELS.openrouterSettings]: (payload) =>
    withUuid(payload, (record, id) => {
      const settings = parseOpenRouterSettings(record['settings']);
      return settings === null ? null : { id, settings };
    }),
};

export function validateRequest(channel: string, payload: unknown): Validation<unknown> {
  if (!Object.hasOwn(PARSERS, channel)) return { ok: false, error: `unknown channel ${channel}` };
  const parser = PARSERS[channel as InvokeChannel] as Parser<unknown>;
  const value = parser(payload);
  return value === null ? { ok: false, error: `invalid payload for ${channel}` } : { ok: true, value };
}

export function isEventChannel(channel: string): channel is EventChannel {
  return (Object.values(EVENT_CHANNELS) as string[]).includes(channel);
}
