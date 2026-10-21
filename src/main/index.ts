// index.ts
import { app, BrowserWindow, dialog } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { windowTitle } from '../shared/app-info';
import { EVENT_CHANNELS } from '../shared/ipc';
import { AgentController } from './agent-controller';
import { codexHome, listRollouts } from './codex-rollouts';
import { registerIpc } from './ipc-handlers';
import { installMenu } from './menu';
import { createSiteLogger } from './site-log-file';
import { SiteViews } from './site-views';
import { loadState } from './state-file';

const userDataOverride = process.env['AIAW_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

const smokeExit = process.argv.includes('--smoke-exit');
let mainWindow: BrowserWindow | null = null;
let controller: AgentController | null = null;
let sites: SiteViews | null = null;

async function pickFolder(): Promise<string | null> {
  const preset = process.env['AIAW_TEST_FOLDER'];
  if (preset) return preset;
  const options = { properties: ['openDirectory' as const] };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: windowTitle(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('closed', () => {
    mainWindow = null;
  });
  return window;
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const sharedDir = path.join(userData, 'shared');
  await mkdir(sharedDir, { recursive: true });
  const state = await loadState(path.join(userData, 'agents.json'));
  const window = createWindow();
  mainWindow = window;
  const siteViews = new SiteViews(window, (event) => {
    if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNELS.siteState, event);
  }, process.env, createSiteLogger(path.join(userData, 'logs', 'sites.log')));
  sites = siteViews;
  controller = new AgentController(
    {
      stateFile: path.join(userData, 'agents.json'),
      sharedDir,
      platform: process.platform,
      env: process.env,
      pickFolder,
      emit: (channel, payload) => {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
      },
      siteNav: (id, action) => siteViews.navigate(id, action),
      showSite: (agent) => siteViews.show(agent),
      closeSite: (id) => siteViews.close(id),
      listRollouts: (sinceMs) => listRollouts(codexHome(process.env), sinceMs),
    },
    state,
  );
  const active = controller;
  await active.restore();
  registerIpc(active, () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));
  installMenu(process.platform === 'darwin', (action) => {
    const selected = active.selectedAgent();
    if (selected) active.siteNav(selected.id, action);
  });
  if (smokeExit) window.webContents.once('did-finish-load', () => app.quit());
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  active.syncSelection();
}

void app.whenReady().then(start);
let quitting = false;
app.on('before-quit', (event) => {
  const active = controller;
  if (quitting || active === null) {
    active?.shutdown();
    sites?.closeAll();
    return;
  }
  quitting = true;
  event.preventDefault();
  void active
    .flush()
    .catch(() => undefined)
    .finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
