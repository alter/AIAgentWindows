// capture-auto-main.ts
import { app, BrowserWindow, session } from 'electron';
import { partitionFor, SITE_KINDS, type Agent, type SiteKind } from '../shared/agents';
import { CAPTURE_WINDOW } from '../shared/site-layout';
import { AUTO_SITES, autoExitCode, autoTiming, captureAuto, formatAutoReport, type AutoPage } from './capture-auto';
import { createIsolatedRunner } from './site-adapters/isolated-runner';
import { SiteViews } from './site-views';
import { AppStateStore } from './store/app-state';

function captureAgent(kind: SiteKind): Agent {
  return { id: `capture-${kind}`, kind, title: kind, createdAt: 0 };
}

export async function runAutoCapture(outDir: string, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const userData = app.getPath('userData');
  const store = await AppStateStore.open(userData);
  const partitionOf = (kind: SiteKind): string => partitionFor(store.read().partitions, kind);
  const window = new BrowserWindow({
    width: CAPTURE_WINDOW.width,
    height: CAPTURE_WINDOW.height,
    useContentSize: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const views = new SiteViews(window, () => undefined, partitionOf, env);
  const open = (kind: SiteKind): AutoPage | null => {
    const agent = captureAgent(kind);
    views.show(agent);
    const contents = views.pageFor(agent.id, kind);
    return {
      runner: createIsolatedRunner(contents),
      load: (url) => contents.loadURL(url),
    };
  };
  const reports = await captureAuto({ sites: AUTO_SITES, open, outDir, timing: autoTiming(env) });
  console.log(formatAutoReport(reports));
  await Promise.all(SITE_KINDS.map((kind) => session.fromPartition(partitionOf(kind)).cookies.flushStore()));
  views.closeAll();
  return autoExitCode(reports);
}
