// ipc-handlers.ts
import { ipcMain, nativeTheme, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { AgentController } from './agent-controller';
import type { RoomService } from './room-service';
import {
  INVOKE_CHANNELS,
  validateRequest,
  type AgentsSnapshot,
  type InvokeChannel,
  type InvokeRequests,
} from '../shared/ipc';

type Handlers = { [C in InvokeChannel]: (payload: InvokeRequests[C]) => Promise<unknown> | unknown };

function buildHandlers(controller: AgentController, room: RoomService): Handlers {
  return {
    [INVOKE_CHANNELS.listAgents]: (): AgentsSnapshot => controller.snapshot(),
    [INVOKE_CHANNELS.addAgent]: ({ kind }) => controller.add(kind),
    [INVOKE_CHANNELS.selectAgent]: ({ id }) => controller.select(id),
    [INVOKE_CHANNELS.closeAgent]: ({ id }) => controller.close(id),
    [INVOKE_CHANNELS.restartAgent]: ({ id }) => controller.restart(id),
    [INVOKE_CHANNELS.ptyWrite]: ({ id, data }) => controller.ptyWrite(id, data),
    [INVOKE_CHANNELS.ptyResize]: ({ id, cols, rows }) => controller.ptyResize(id, cols, rows),
    [INVOKE_CHANNELS.ptyBacklog]: ({ id }) => controller.ptyBacklog(id),
    [INVOKE_CHANNELS.siteNav]: ({ id, action }) => controller.siteNav(id, action),
    [INVOKE_CHANNELS.roomState]: () => room.state(),
    [INVOKE_CHANNELS.roomList]: () => room.list(),
    [INVOKE_CHANNELS.roomOpen]: ({ id }) => room.open(id),
    [INVOKE_CHANNELS.roomRename]: ({ id, title }) => room.rename(id, title),
    [INVOKE_CHANNELS.roomNew]: () => room.newRoom(),
    [INVOKE_CHANNELS.roomSelect]: () => controller.selectRoom(),
    [INVOKE_CHANNELS.roomStart]: ({ config, continueId, resume }) => room.start(config, continueId, resume),
    [INVOKE_CHANNELS.roomStop]: () => room.stop(),
    [INVOKE_CHANNELS.roomCarry]: ({ id, what }) => room.carry(id, what),
    [INVOKE_CHANNELS.roomResume]: () => room.resume(),
    [INVOKE_CHANNELS.roomModels]: () => room.models(),
    [INVOKE_CHANNELS.roomCopyFinal]: () => room.copyFinal(),
    [INVOKE_CHANNELS.roomTerminalBacklog]: ({ id }) => room.terminalBacklog(id),
    [INVOKE_CHANNELS.roomTerminalWrite]: ({ id, data }) => room.terminalWrite(id, data),
    [INVOKE_CHANNELS.roomTerminalResize]: ({ id, cols, rows }) => room.terminalResize(id, cols, rows),
    [INVOKE_CHANNELS.themeGet]: () => controller.theme(),
    [INVOKE_CHANNELS.themeSet]: async ({ choice }) => {
      nativeTheme.themeSource = choice;
      await controller.setTheme(choice);
    },
  };
}

export function registerIpc(controller: AgentController, room: RoomService, appContents: () => WebContents | null): () => void {
  const handlers = buildHandlers(controller, room);
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
