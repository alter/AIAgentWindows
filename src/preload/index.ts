// index.ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type AddAgentResult,
  type AgentsSnapshot,
  type AppApi,
  type OpenRouterModels,
  type PtyBacklog,
  type PtyDataEvent,
  type PtyExitEvent,
  type SiteStateEvent,
} from '../shared/ipc';
import type { OpenRouterSettings, OpenRouterStatus } from '../shared/openrouter';
import type { ChatDelta, ChatLoad, ChatSend } from '../shared/openrouter-chat';
import type { ThemeChoice } from '../shared/theme';
import type { RoomModels } from '../shared/cli-models';
import type { SavePlanResult } from '../shared/plan-file';
import type { RoomConfig, RoomEvent, RoomListItem } from '../shared/room-model';
import type { PickParentResult, ProjectActionResult, ProjectResult, ProjectView } from '../shared/projects';
import type { RoomOpenResult, RoomSnapshot, RoomStartResult } from '../shared/room-view';

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AppApi = {
  listAgents: () => ipcRenderer.invoke(INVOKE_CHANNELS.listAgents) as Promise<AgentsSnapshot>,
  addAgent: (kind, projectId) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.addAgent, projectId === undefined ? { kind } : { kind, projectId }) as Promise<AddAgentResult>,
  selectAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.selectAgent, { id }) as Promise<void>,
  closeAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.closeAgent, { id }) as Promise<void>,
  restartAgent: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.restartAgent, { id }) as Promise<boolean>,
  renameAgent: (id, title) => ipcRenderer.invoke(INVOKE_CHANNELS.renameAgent, { id, title }) as Promise<boolean>,
  ptyWrite: (id, data) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyWrite, { id, data }) as Promise<void>,
  ptyResize: (id, cols, rows) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyResize, { id, cols, rows }) as Promise<void>,
  ptyBacklog: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.ptyBacklog, { id }) as Promise<PtyBacklog>,
  pathForFile: (file) => webUtils.getPathForFile(file),
  siteNav: (id, action) => ipcRenderer.invoke(INVOKE_CHANNELS.siteNav, { id, action }) as Promise<void>,
  roomState: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomState) as Promise<RoomSnapshot>,
  roomList: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomList) as Promise<RoomListItem[]>,
  roomOpen: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.roomOpen, { id }) as Promise<RoomOpenResult>,
  roomRename: (id, title) => ipcRenderer.invoke(INVOKE_CHANNELS.roomRename, { id, title }) as Promise<boolean>,
  roomDelete: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.roomDelete, { id }) as Promise<boolean>,
  roomNew: (projectId) => ipcRenderer.invoke(INVOKE_CHANNELS.roomNew, { projectId }) as Promise<boolean>,
  roomSelect: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomSelect) as Promise<void>,
  roomStart: (config: RoomConfig, continueId?: string, resume?: boolean) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.roomStart, {
      config,
      ...(continueId === undefined ? {} : { continueId }),
      ...(resume === true ? { resume } : {}),
    }) as Promise<RoomStartResult>,
  roomStop: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomStop) as Promise<void>,
  roomCarry: (id, what) => ipcRenderer.invoke(INVOKE_CHANNELS.roomCarry, { id, what }) as Promise<boolean>,
  roomCopyFinal: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomCopyFinal) as Promise<boolean>,
  roomSavePlan: (id, replace) => ipcRenderer.invoke(INVOKE_CHANNELS.roomSavePlan, { id, replace }) as Promise<SavePlanResult>,
  roomResume: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomResume) as Promise<void>,
  roomModels: () => ipcRenderer.invoke(INVOKE_CHANNELS.roomModels) as Promise<RoomModels>,
  roomTerminalBacklog: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.roomTerminalBacklog, { id }) as Promise<PtyBacklog>,
  roomTerminalWrite: (id, data) => ipcRenderer.invoke(INVOKE_CHANNELS.roomTerminalWrite, { id, data }) as Promise<void>,
  roomTerminalResize: (id, cols, rows) => ipcRenderer.invoke(INVOKE_CHANNELS.roomTerminalResize, { id, cols, rows }) as Promise<void>,
  themeGet: () => ipcRenderer.invoke(INVOKE_CHANNELS.themeGet) as Promise<ThemeChoice>,
  themeSet: (choice) => ipcRenderer.invoke(INVOKE_CHANNELS.themeSet, { choice }) as Promise<void>,
  layoutGet: () => ipcRenderer.invoke(INVOKE_CHANNELS.layoutGet) as Promise<number>,
  layoutSidebar: (width) => ipcRenderer.invoke(INVOKE_CHANNELS.layoutSidebar, { width }) as Promise<void>,
  openrouterStatus: () => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterStatus) as Promise<OpenRouterStatus>,
  openrouterConnect: (mode) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterConnect, { mode }) as Promise<OpenRouterStatus>,
  openrouterPaste: (text) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterPaste, { text }) as Promise<OpenRouterStatus>,
  openrouterCancel: () => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterCancel) as Promise<OpenRouterStatus>,
  openrouterDisconnect: () => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterDisconnect) as Promise<OpenRouterStatus>,
  openrouterRefresh: () => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterRefresh) as Promise<OpenRouterStatus>,
  openrouterModels: (refresh) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterModels, { refresh }) as Promise<OpenRouterModels>,
  openrouterChatLoad: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterChatLoad, { id }) as Promise<ChatLoad>,
  openrouterChatSend: (id, text) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterChatSend, { id, text }) as Promise<ChatSend>,
  openrouterChatStop: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterChatStop, { id }) as Promise<void>,
  openrouterChatRetry: (id, index) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterChatRetry, { id, index }) as Promise<ChatSend>,
  openrouterChatCopy: (id, index) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterChatCopy, { id, index }) as Promise<boolean>,
  openrouterSettings: (id, settings: OpenRouterSettings) => ipcRenderer.invoke(INVOKE_CHANNELS.openrouterSettings, { id, settings }) as Promise<boolean>,
  projectsList: () => ipcRenderer.invoke(INVOKE_CHANNELS.projectsList) as Promise<ProjectView[]>,
  projectsPickParent: () => ipcRenderer.invoke(INVOKE_CHANNELS.projectsPickParent) as Promise<PickParentResult>,
  projectsCreate: (token, name, copyAgentsFrom) => ipcRenderer.invoke(INVOKE_CHANNELS.projectsCreate, { token, name, copyAgentsFrom }) as Promise<ProjectResult>,
  projectsAddExisting: (copyAgentsFrom) => ipcRenderer.invoke(INVOKE_CHANNELS.projectsAddExisting, { copyAgentsFrom }) as Promise<ProjectResult>,
  projectsRename: (id, name) => ipcRenderer.invoke(INVOKE_CHANNELS.projectsRename, { id, name }) as Promise<ProjectActionResult>,
  projectsDelete: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.projectsDelete, { id }) as Promise<ProjectActionResult>,
  onAgentsChanged: (listener) => subscribe<AgentsSnapshot>(EVENT_CHANNELS.agentsChanged, listener),
  onPtyData: (listener) => subscribe<PtyDataEvent>(EVENT_CHANNELS.ptyData, listener),
  onPtyExit: (listener) => subscribe<PtyExitEvent>(EVENT_CHANNELS.ptyExit, listener),
  onSiteState: (listener) => subscribe<SiteStateEvent>(EVENT_CHANNELS.siteState, listener),
  onRoomEvent: (listener) => subscribe<RoomEvent>(EVENT_CHANNELS.roomEvent, listener),
  onRoomTerminalData: (listener) => subscribe<PtyDataEvent>(EVENT_CHANNELS.roomTerminalData, listener),
  onOpenRouterChanged: (listener) => subscribe<OpenRouterStatus>(EVENT_CHANNELS.openrouterChanged, listener),
  onOpenRouterChatDelta: (listener) => subscribe<ChatDelta>(EVENT_CHANNELS.openrouterChatDelta, listener),
};

contextBridge.exposeInMainWorld('aiaw', api);
