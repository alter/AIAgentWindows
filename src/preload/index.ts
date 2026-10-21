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
  ptyWrite: (id, data) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyWrite, { id, data }) as Promise<void>,
  ptyResize: (id, cols, rows) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyResize, { id, cols, rows }) as Promise<void>,
  ptyBacklog: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyBacklog, { id }) as Promise<PtyBacklog>,
  pathForFile: (file) => webUtils.getPathForFile(file),
  siteNav: (id, action) => ipcRenderer.invoke(INVOKE_CHANNELS.siteNav, { id, action }) as Promise<void>,
  onAgentsChanged: (listener) => subscribe<AgentsSnapshot>(EVENT_CHANNELS.agentsChanged, listener),
  onPtyData: (listener) => subscribe<PtyDataEvent>(EVENT_CHANNELS.ptyData, listener),
  onPtyExit: (listener) => subscribe<PtyExitEvent>(EVENT_CHANNELS.ptyExit, listener),
  onSiteState: (listener) => subscribe<SiteStateEvent>(EVENT_CHANNELS.siteState, listener),
};

contextBridge.exposeInMainWorld('aiaw', api);
