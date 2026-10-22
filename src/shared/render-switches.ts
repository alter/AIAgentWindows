// render-switches.ts
export const RENDER_SWITCHES = ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'] as const;

export interface CommandLineLike {
  appendSwitch(name: string): void;
}

export function applyRenderSwitches(commandLine: CommandLineLike): void {
  for (const name of RENDER_SWITCHES) commandLine.appendSwitch(name);
}
