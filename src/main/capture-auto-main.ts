// capture-auto-main.ts
import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { type Agent, type SiteKind } from '../shared/agents';
import { AUTO_SITES, autoExitCode, autoTiming, captureAuto, formatAutoReport, type AutoPage } from './capture-auto';
import { createIsolatedRunner } from './site-adapters/isolated-runner';
import { SiteViews } from './site-views';
import { loadState } from './state-file';

function firstAgent(agents: readonly Agent[], kind: SiteKind): Agent | null {
  return agents.find((agent) => agent.kind === kind) ?? null;
}

export async function runAutoCapture(outDir: string, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const userData = app.getPath('userData');
  const state = await loadState(path.join(userData, 'agents.json'));
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const views = new SiteViews(window, () => undefined, env);
  const open = (kind: SiteKind): AutoPage | null => {
    const agent = firstAgent(state.agents, kind);
    if (agent === null) return null;
    views.show(agent);
    const contents = views.pageFor(agent.id, kind);
    return {
      runner: createIsolatedRunner(contents),
      load: (url) => contents.loadURL(url),
    };
  };
  const reports = await captureAuto({ sites: AUTO_SITES, open, outDir, timing: autoTiming(env) });
  console.log(formatAutoReport(reports));
  await Promise.all(state.agents.filter((agent) => agent.kind !== 'claude' && agent.kind !== 'codex').map((agent) => session.fromPartition(`persist:${agent.id}`).cookies.flushStore()));
  views.closeAll();
  return autoExitCode(reports);
}
