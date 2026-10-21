// ipc.ts
import { AGENT_KINDS, type Agent, type AgentKind } from './agents';
import type { OutputSnapshot } from './output-buffer';
import { parseRoomConfig, type RoomConfig, type RoomEvent } from './room-model';
import { CARRY_KINDS, type CarryWhat, type RoomSnapshot, type RoomStartResult } from './room-view';

export const INVOKE_CHANNELS = {
  listAgents: 'agents:list',
  addAgent: 'agents:add',
  selectAgent: 'agents:select',
  closeAgent: 'agents:close',
  restartAgent: 'agents:restart',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyBacklog: 'pty:backlog',
  siteNav: 'site:nav',
  roomState: 'room:state',
  roomSelect: 'room:select',
  roomStart: 'room:start',
  roomStop: 'room:stop',
  roomCarry: 'room:carry',
} as const;

export const EVENT_CHANNELS = {
  agentsChanged: 'agents:changed',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  siteState: 'site:state',
  roomEvent: 'room:event',
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

export interface InvokeRequests {
  [INVOKE_CHANNELS.listAgents]: undefined;
  [INVOKE_CHANNELS.addAgent]: { kind: AgentKind };
  [INVOKE_CHANNELS.selectAgent]: { id: string };
  [INVOKE_CHANNELS.closeAgent]: { id: string };
  [INVOKE_CHANNELS.restartAgent]: { id: string };
  [INVOKE_CHANNELS.ptyWrite]: { id: string; data: string };
  [INVOKE_CHANNELS.ptyResize]: { id: string; cols: number; rows: number };
  [INVOKE_CHANNELS.ptyBacklog]: { id: string };
  [INVOKE_CHANNELS.siteNav]: { id: string; action: SiteAction };
  [INVOKE_CHANNELS.roomState]: undefined;
  [INVOKE_CHANNELS.roomSelect]: undefined;
  [INVOKE_CHANNELS.roomStart]: RoomConfig;
  [INVOKE_CHANNELS.roomStop]: undefined;
  [INVOKE_CHANNELS.roomCarry]: { id: string; what: CarryWhat };
}

export type InvokeChannel = keyof InvokeRequests;
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AppApi {
  listAgents(): Promise<AgentsSnapshot>;
  addAgent(kind: AgentKind): Promise<void>;
  selectAgent(id: string): Promise<void>;
  closeAgent(id: string): Promise<void>;
  restartAgent(id: string): Promise<boolean>;
  ptyWrite(id: string, data: string): Promise<void>;
  ptyResize(id: string, cols: number, rows: number): Promise<void>;
  ptyBacklog(id: string): Promise<PtyBacklog>;
  pathForFile(file: File): string;
  siteNav(id: string, action: SiteAction): Promise<void>;
  roomState(): Promise<RoomSnapshot>;
  roomSelect(): Promise<void>;
  roomStart(config: RoomConfig): Promise<RoomStartResult>;
  roomStop(): Promise<void>;
  roomCarry(id: string, what: CarryWhat): Promise<boolean>;
  onAgentsChanged(listener: (snapshot: AgentsSnapshot) => void): () => void;
  onPtyData(listener: (event: PtyDataEvent) => void): () => void;
  onPtyExit(listener: (event: PtyExitEvent) => void): () => void;
  onSiteState(listener: (event: SiteStateEvent) => void): () => void;
  onRoomEvent(listener: (event: RoomEvent) => void): () => void;
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

function noPayload(payload: unknown): undefined | null {
  return payload === undefined ? undefined : null;
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
  [INVOKE_CHANNELS.ptyWrite]: (payload) =>
    withId(payload, (record, id) => {
      const data = record['data'];
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_PTY_WRITE_BYTES) return null;
      return { id, data };
    }),
  [INVOKE_CHANNELS.ptyResize]: (payload) =>
    withId(payload, (record, id) => {
      const cols = parseDimension(record['cols']);
      const rows = parseDimension(record['rows']);
      return cols === null || rows === null ? null : { id, cols, rows };
    }),
  [INVOKE_CHANNELS.ptyBacklog]: (payload) => withId(payload, (_record, id) => ({ id })),
  [INVOKE_CHANNELS.siteNav]: (payload) =>
    withId(payload, (record, id) => {
      const action = record['action'];
      return (SITE_ACTIONS as readonly unknown[]).includes(action) ? { id, action: action as SiteAction } : null;
    }),
  [INVOKE_CHANNELS.roomState]: noPayload,
  [INVOKE_CHANNELS.roomSelect]: noPayload,
  [INVOKE_CHANNELS.roomStart]: (payload) => {
    const parsed = parseRoomConfig(payload);
    return parsed.ok ? parsed.config : null;
  },
  [INVOKE_CHANNELS.roomStop]: noPayload,
  [INVOKE_CHANNELS.roomCarry]: (payload) =>
    withId(payload, (record, id) => {
      const what = record['what'];
      return (CARRY_KINDS as readonly unknown[]).includes(what) ? { id, what: what as CarryWhat } : null;
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
