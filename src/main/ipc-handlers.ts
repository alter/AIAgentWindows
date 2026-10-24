// ipc-handlers.ts
import { ipcMain, nativeTheme, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { AgentController } from './agent-controller';
import type { OpenRouterChats } from './openrouter/chats';
import type { OpenRouterService } from './openrouter/service';
import type { ProjectService } from './projects/service';
import type { RoomService } from './room-service';
import {
  INVOKE_CHANNELS,
  validateRequest,
  type AgentsSnapshot,
  type InvokeChannel,
  type InvokeRequests,
} from '../shared/ipc';

type Handlers = { [C in InvokeChannel]: (payload: InvokeRequests[C]) => Promise<unknown> | unknown };

function buildHandlers(controller: AgentController, room: RoomService, openrouter: OpenRouterService, chats: OpenRouterChats, projects: ProjectService): Handlers {
  return {
    [INVOKE_CHANNELS.listAgents]: (): AgentsSnapshot => controller.snapshot(),
    [INVOKE_CHANNELS.addAgent]: ({ kind, projectId }) => controller.add(kind, projectId),
    [INVOKE_CHANNELS.selectAgent]: ({ id }) => controller.select(id),
    [INVOKE_CHANNELS.closeAgent]: ({ id }) => controller.close(id),
    [INVOKE_CHANNELS.restartAgent]: ({ id }) => controller.restart(id),
    [INVOKE_CHANNELS.renameAgent]: ({ id, title }) => controller.rename(id, title),
    [INVOKE_CHANNELS.ptyWrite]: ({ id, data }) => controller.ptyWrite(id, data),
    [INVOKE_CHANNELS.ptyResize]: ({ id, cols, rows }) => controller.ptyResize(id, cols, rows),
    [INVOKE_CHANNELS.ptyBacklog]: ({ id }) => controller.ptyBacklog(id),
    [INVOKE_CHANNELS.siteNav]: ({ id, action }) => controller.siteNav(id, action),
    [INVOKE_CHANNELS.roomState]: () => room.state(),
    [INVOKE_CHANNELS.roomList]: () => room.list(),
    [INVOKE_CHANNELS.roomOpen]: ({ id }) => room.open(id),
    [INVOKE_CHANNELS.roomRename]: ({ id, title }) => room.rename(id, title),
    [INVOKE_CHANNELS.roomDelete]: ({ id }) => room.delete(id),
    [INVOKE_CHANNELS.roomNew]: ({ projectId }) => room.newRoom(projectId),
    [INVOKE_CHANNELS.roomSelect]: () => controller.selectRoom(),
    [INVOKE_CHANNELS.roomStart]: ({ config, continueId, resume }) => room.start(config, continueId, resume),
    [INVOKE_CHANNELS.roomStop]: () => room.stop(),
    [INVOKE_CHANNELS.roomCarry]: ({ id, what }) => room.carry(id, what),
    [INVOKE_CHANNELS.roomResume]: () => room.resume(),
    [INVOKE_CHANNELS.roomModels]: () => room.models(),
    [INVOKE_CHANNELS.roomCopyFinal]: () => room.copyFinal(),
    [INVOKE_CHANNELS.roomSavePlan]: ({ id, replace }) => room.savePlan(id, replace),
    [INVOKE_CHANNELS.roomTerminalBacklog]: ({ id }) => room.terminalBacklog(id),
    [INVOKE_CHANNELS.roomTerminalWrite]: ({ id, data }) => room.terminalWrite(id, data),
    [INVOKE_CHANNELS.roomTerminalResize]: ({ id, cols, rows }) => room.terminalResize(id, cols, rows),
    [INVOKE_CHANNELS.themeGet]: () => controller.theme(),
    [INVOKE_CHANNELS.themeSet]: async ({ choice }) => {
      nativeTheme.themeSource = choice;
      await controller.setTheme(choice);
    },
    [INVOKE_CHANNELS.layoutGet]: () => controller.sidebarWidth(),
    [INVOKE_CHANNELS.layoutSidebar]: ({ width }) => controller.setSidebarWidth(width),
    [INVOKE_CHANNELS.openrouterStatus]: () => openrouter.status(),
    [INVOKE_CHANNELS.openrouterConnect]: ({ mode }) => openrouter.connect(mode),
    [INVOKE_CHANNELS.openrouterPaste]: ({ text }) => openrouter.paste(text),
    [INVOKE_CHANNELS.openrouterCancel]: () => openrouter.cancel(),
    [INVOKE_CHANNELS.openrouterDisconnect]: () => openrouter.disconnect(),
    [INVOKE_CHANNELS.openrouterRefresh]: () => openrouter.refresh(),
    [INVOKE_CHANNELS.openrouterModels]: ({ refresh }) => openrouter.models(refresh),
    [INVOKE_CHANNELS.openrouterChatLoad]: ({ id }) => chats.load(id),
    [INVOKE_CHANNELS.openrouterChatSend]: ({ id, text }) => chats.send(id, text),
    [INVOKE_CHANNELS.openrouterChatRetry]: ({ id, index }) => chats.retry(id, index),
    [INVOKE_CHANNELS.openrouterChatStop]: ({ id }) => chats.stop(id),
    [INVOKE_CHANNELS.openrouterChatCopy]: ({ id, index }) => chats.copy(id, index),
    [INVOKE_CHANNELS.openrouterSettings]: async ({ id, settings }) => {
      const saved = await controller.setOpenrouterSettings(id, settings);
      if (saved) await chats.dismiss(id);
      return saved;
    },
    [INVOKE_CHANNELS.projectsList]: () => projects.list(),
    [INVOKE_CHANNELS.projectsPickParent]: () => projects.pickParent(),
    [INVOKE_CHANNELS.projectsCreate]: ({ token, name }) => projects.create(token, name),
    [INVOKE_CHANNELS.projectsAddExisting]: () => projects.addExisting(),
    [INVOKE_CHANNELS.projectsRename]: ({ id, name }) => projects.rename(id, name),
    [INVOKE_CHANNELS.projectsDelete]: ({ id }) => projects.delete(id),
  };
}

export function registerIpc(
  controller: AgentController,
  room: RoomService,
  openrouter: OpenRouterService,
  chats: OpenRouterChats,
  projects: ProjectService,
  appContents: () => WebContents | null,
): () => void {
  const handlers = buildHandlers(controller, room, openrouter, chats, projects);
  const channels = Object.keys(handlers) as InvokeChannel[];
  for (const channel of channels) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      if (event.sender !== appContents()) throw new Error(`rejected sender for ${channel}`);
      const checked = validateRequest(channel, payload);
      if (!checked.ok) throw new Error(checked.error);
      const handler = handlers[channel] as (value: unknown) => Promise<unknown> | unknown;
      return handler(checked.value);
    });
  }
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
