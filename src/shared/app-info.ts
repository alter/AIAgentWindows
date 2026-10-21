// app-info.ts
export const APP_NAME = 'AI Agent Windows';

export function windowTitle(agentTitle?: string): string {
  return agentTitle ? `${agentTitle} - ${APP_NAME}` : APP_NAME;
}
