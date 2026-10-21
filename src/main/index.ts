// index.ts
import { app, BrowserWindow, dialog } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { windowTitle } from '../shared/app-info';
import { AgentController } from './agent-controller';
import { registerIpc } from './ipc-handlers';
import { installMenu } from './menu';
import { loadState } from './state-file';

const userDataOverride = process.env['AIAW_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

const smokeExit = process.argv.includes('--smoke-exit');
let mainWindow: BrowserWindow | null = null;
let controller: AgentController | null = null;

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
    },
    state,
  );
  const active = controller;
  registerIpc(active, () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));
  installMenu(process.platform === 'darwin', (action) => {
    const selected = active.selectedAgent();
    if (selected) active.siteNav(selected.id, action);
  });
  if (smokeExit) window.webContents.once('did-finish-load', () => app.quit());
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

void app.whenReady().then(start);
app.on('before-quit', () => controller?.shutdown());
app.on('window-all-closed', () => app.quit());
