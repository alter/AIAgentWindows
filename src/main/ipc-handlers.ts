// ipc-handlers.ts
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { AgentController } from './agent-controller';
import {
  INVOKE_CHANNELS,
  validateRequest,
  type AgentsSnapshot,
  type InvokeChannel,
  type InvokeRequests,
} from '../shared/ipc';

type Handlers = { [C in InvokeChannel]: (payload: InvokeRequests[C]) => Promise<unknown> | unknown };

function buildHandlers(controller: AgentController): Handlers {
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
  };
}

export function registerIpc(controller: AgentController, appContents: () => WebContents | null): () => void {
  const handlers = buildHandlers(controller);
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
