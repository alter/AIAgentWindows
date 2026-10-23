// index.ts
import { app, BrowserWindow, clipboard, dialog, nativeTheme, safeStorage, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { windowTitle } from '../shared/app-info';
import { parseSidebarWidth } from '../shared/site-layout';
import { parseThemeChoice } from '../shared/theme';
import { applyRenderSwitches } from '../shared/render-switches';
import { roomLoginShell, roomSiteOptions, roomTimingOverride } from '../shared/room-test-mode';
import { dockHidden, windowsVisible } from '../shared/window-visibility';
import { EVENT_CHANNELS } from '../shared/ipc';
import { openrouterBase, openrouterTestMode } from '../shared/openrouter';
import { AgentController } from './agent-controller';
import { CAPTURE_AUTO_ENV } from './capture-auto';
import { runAutoCapture } from './capture-auto-main';
import { CAPTURE_ENV, captureSites, summarizeCapture } from './capture-sites';
import { codexHome, listRollouts } from './codex-rollouts';
import { registerIpc } from './ipc-handlers';
import { createRoomDrivers, type RoomDrivers } from './room-drivers';
import { moveToFolder } from './room-archive';
import { OpenRouterChats } from './openrouter/chats';
import { OpenRouterClient } from './openrouter/client';
import { ConversationStore } from './openrouter/conversation-store';
import { KeyStore } from './openrouter/key-store';
import { electronSecretBox } from './openrouter/secret-box';
import { OpenRouterService } from './openrouter/service';
import { fetchOpener, testSecretBox } from './openrouter/test-mode';
import { RoomService } from './room-service';
import { createModelCatalog } from './cli-models';
import { createSiteSeats } from './site-seats';
import { adapterFor } from './site-adapters/registry';
import { installMenu } from './menu';
import { createSiteLogger } from './site-log-file';
import { SiteViews } from './site-views';
import { createIsolatedRunner } from './site-adapters/isolated-runner';
import { loadState } from './state-file';

const userDataOverride = process.env['AIAW_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);
if (dockHidden(process.env, process.platform)) app.dock?.hide();
applyRenderSwitches(app.commandLine);

const smokeExit = process.argv.includes('--smoke-exit');
let mainWindow: BrowserWindow | null = null;
let controller: AgentController | null = null;
let sites: SiteViews | null = null;
let room: RoomService | null = null;
let roomDrivers: RoomDrivers | null = null;
let openrouter: OpenRouterService | null = null;
let chats: OpenRouterChats | null = null;

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
    show: windowsVisible(process.env),
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

async function captureStructure(siteViews: SiteViews, outDir: string): Promise<void> {
  const targets = siteViews.openPages().map((page) => ({ kind: page.kind, runner: createIsolatedRunner(page.contents) }));
  const results = await captureSites(targets, outDir);
  const options = { type: 'info' as const, message: 'Site structure capture', detail: summarizeCapture(results) };
  if (mainWindow) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const sharedDir = path.join(userData, 'shared');
  await mkdir(sharedDir, { recursive: true });
  const state = await loadState(path.join(userData, 'agents.json'));
  nativeTheme.themeSource = parseThemeChoice(state.theme);
  const window = createWindow();
  mainWindow = window;
  const siteLog = createSiteLogger(path.join(userData, 'logs', 'sites.log'));
  const siteViews = new SiteViews(window, (event) => {
    if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNELS.siteState, event);
  }, process.env, siteLog);
  sites = siteViews;
  siteViews.setSidebarWidth(parseSidebarWidth(state.sidebarWidth));
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
      layoutSidebar: (width) => siteViews.setSidebarWidth(width),
      closeSite: (id) => siteViews.close(id),
      closeChat: (id) => chats?.stop(id),
      listRollouts: (sinceMs) => listRollouts(codexHome(process.env), sinceMs),
    },
    state,
  );
  const active = controller;
  await active.restore();
  const testMode = openrouterTestMode(process.env);
  const base = openrouterBase(process.env);
  const openrouterService = new OpenRouterService({
    client: new OpenRouterClient({ base }),
    store: new KeyStore(testMode ? testSecretBox() : electronSecretBox(safeStorage, process.platform), {
      read: () => active.openrouterCipher(),
      write: (cipher) => active.setOpenrouterCipher(cipher),
    }),
    base,
    openExternal: testMode ? fetchOpener() : (url) => shell.openExternal(url),
    emit: (status) => {
      if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNELS.openrouterChanged, status);
    },
  });
  openrouter = openrouterService;
  const openrouterChats = new OpenRouterChats({
    service: openrouterService,
    store: new ConversationStore(path.join(sharedDir, 'openrouter')),
    settingsOf: (id) => active.openrouterSettings(id),
    emit: (delta) => {
      if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNELS.openrouterChatDelta, delta);
    },
    copy: (text) => clipboard.writeText(text),
  });
  chats = openrouterChats;
  await openrouterService.init();
  const roomsDir = path.join(sharedDir, 'rooms');
  const debugRoot = path.join(userData, 'debug', 'sites');
  const drivers = createRoomDrivers({
    cwd: roomsDir,
    sharedDir,
    platform: process.platform,
    envFor: () => process.env,
    loginShell: roomLoginShell(process.env),
    timing: roomTimingOverride(process.env),
    siteLog,
    debugRoot,
    openrouter: openrouterService,
    siteFor: createSiteSeats({
      agents: () => active.snapshot().agents,
      page: (agent) => siteViews.pageFor(agent.id, agent.kind),
      prepare: (agent, timeoutMs, signal) => siteViews.prepare(agent.id, agent.kind, timeoutMs, signal),
      newChat: (agent, timeoutMs, signal) => siteViews.newChat(agent.id, agent.kind, timeoutMs, signal),
      adapterFor: (kind) => adapterFor(kind, roomSiteOptions(process.env)),
    }),
  });
  roomDrivers = drivers;
  const roomService = new RoomService({
    roomsDir,
    debugRoot,
    trash: (process.env['AIAW_USER_DATA'] ?? '').length > 0 ? moveToFolder(path.join(userData, 'trash')) : (file) => shell.trashItem(file),
    driverFor: drivers.factory,
    terminal: drivers.terminal,
    emit: (event) => {
      if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNELS.roomEvent, event);
    },
    paste: (id, text) => active.paste(id, text),
    copy: (text) => clipboard.writeText(text),
    models: createModelCatalog({ cwd: roomsDir, platform: process.platform, loginShell: roomLoginShell(process.env), env: process.env }),
    openrouter: openrouterService,
  });
  room = roomService;
  await roomService.init();
  registerIpc(active, roomService, openrouterService, openrouterChats, () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null));
  const captureDir = process.env[CAPTURE_ENV];
  installMenu(
    process.platform === 'darwin',
    (action) => {
      const selected = active.selectedAgent();
      if (selected) active.siteNav(selected.id, action);
    },
    captureDir !== undefined && path.isAbsolute(captureDir) ? () => void captureStructure(siteViews, captureDir) : undefined,
  );
  if (smokeExit) window.webContents.once('did-finish-load', () => app.quit());
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  active.syncSelection();
}

const AUTO_LIMIT_MS = 6 * 60 * 1000;

async function startAuto(outDir: string): Promise<void> {
  const limit = setTimeout(() => app.exit(1), AUTO_LIMIT_MS);
  try {
    app.exit(await runAutoCapture(outDir, process.env));
  } catch (error) {
    console.error(`capture --auto failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    app.exit(1);
  } finally {
    clearTimeout(limit);
  }
}

const autoDir = process.env[CAPTURE_AUTO_ENV];
void app.whenReady().then(() => {
  if (autoDir === undefined || autoDir === '') return start();
  if (path.isAbsolute(autoDir)) return startAuto(autoDir);
  console.error(`${CAPTURE_AUTO_ENV} must be an absolute path`);
  app.exit(2);
  return undefined;
});
let quitting = false;
app.on('before-quit', (event) => {
  const active = controller;
  if (quitting || active === null) {
    active?.shutdown();
    roomDrivers?.shutdown();
    sites?.closeAll();
    chats?.shutdown();
    openrouter?.shutdown();
    return;
  }
  quitting = true;
  event.preventDefault();
  chats?.shutdown();
  void (room?.shutdown() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => active.flush())
    .catch(() => undefined)
    .finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
