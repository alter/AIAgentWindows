// signin.js
const { app, BrowserWindow, Menu, session } = require('electron');
const path = require('path');

const SITES = { chatgpt: 'https://chatgpt.com/', grok: 'https://grok.com/', deepseek: 'https://chat.deepseek.com/' };
const PLAIN_UA = process.env.SPIKE_DEEPSEEK_ELECTRON_UA !== '1';

app.setPath('userData', process.env.SPIKE_USERDATA || path.join(__dirname, 'ud-signin'));

const HOME = new Map();
const focused = () => BrowserWindow.getFocusedWindow();

function buildMenu() {
  const nav = (fn) => (item, win) => { const w = win || focused(); if (w) fn(w.webContents, w); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Go', submenu: [
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: nav((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()) },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: nav((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()) },
      { label: 'Home (site start page)', accelerator: 'CmdOrCtrl+Shift+H', click: nav((wc, w) => wc.loadURL(HOME.get(w.id))) },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: nav((wc) => wc.reload()) },
    ] },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  buildMenu();
  Object.entries(SITES).forEach(([name, url], i) => {
    const ses = session.fromPartition(`persist:${name}`);
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      const allowed = permission === 'media' && new URL(details.requestingUrl).origin === new URL(url).origin;
      console.log(`[${name}] permission ${permission} from ${details.requestingUrl} -> ${allowed ? 'granted' : 'denied'}`);
      cb(allowed);
    });
    const win = new BrowserWindow({ x: 40 + i * 60, y: 40 + i * 60, width: 1100, height: 800, title: name, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    if (name === 'deepseek' && PLAIN_UA) win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/\S+/, ''));
    HOME.set(win.id, url);
    win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } } }));
    win.webContents.on('page-title-updated', (e, title) => win.setTitle(`${name} — ${title}`));
    win.loadURL(url);
  });
});

app.on('window-all-closed', () => app.quit());
