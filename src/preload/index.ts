// index.ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type AgentsSnapshot,
  type AppApi,
  type PtyBacklog,
  type PtyDataEvent,
  type PtyExitEvent,
  type SiteStateEvent,
} from '../shared/ipc';
import type { RoomConfig, RoomEvent } from '../shared/room-model';
import type { RoomSnapshot, RoomStartResult } from '../shared/room-view';

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AppApi = {
  listAgents: () => ipcRenderer.invoke(INVOKE_CHANNELS.listAgents) as Promise<AgentsSnapshot>,
  addAgent: (kind) => ipcRenderer.invoke(INVOKE_CHANNELS.addAgent, { kind }) as Promise<void>,
  selectAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.selectAgent, { id }) as Promise<void>,
  closeAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.closeAgent, { id }) as Promise<void>,
  restartAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.restartAgent, { id }) as Promise<boolean>,
  ptyWrite: (id, data) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyWrite, { id, data }) as Promise<void>,
  ptyResize: (id, cols, rows) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyResize, { id, cols, rows }) as Promise<void>,
  ptyBacklog: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyBacklog, { id }) as Promise<PtyBacklog>,
  pathForFile: (file) => webUtils.getPathForFile(file),
  siteNav: (id, action) => ipcRenderer.invoke(INVOKE_CHANNELS.siteNav, { id, action }) as Promise<void>,
  roomState: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomState) as Promise<RoomSnapshot>,
  roomSelect: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomSelect) as Promise<void>,
  roomStart: (config: RoomConfig) => ipcRenderer.invoke(INVOKE_CHANNELS.roomStart, config) as Promise<RoomStartResult>,
  roomStop: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomStop) as Promise<void>,
  roomCarry: (id, what) => ipcRenderer.invoke(INVOKE_CHANNELS.roomCarry, { id, what }) as Promise<boolean>,
  onAgentsChanged: (listener) => subscribe<AgentsSnapshot>(EVENT_CHANNELS.agentsChanged, listener),
  onPtyData: (listener) => subscribe<PtyDataEvent>(EVENT_CHANNELS.ptyData, listener),
  onPtyExit: (listener) => subscribe<PtyExitEvent>(EVENT_CHANNELS.ptyExit, listener),
  onSiteState: (listener) => subscribe<SiteStateEvent>(EVENT_CHANNELS.siteState, listener),
  onRoomEvent: (listener) => subscribe<RoomEvent>(EVENT_CHANNELS.roomEvent, listener),
};

contextBridge.exposeInMainWorld('aiaw', api);
