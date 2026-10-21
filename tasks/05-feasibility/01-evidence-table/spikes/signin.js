// signin.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const SITES = { chatgpt: 'https://chatgpt.com/', grok: 'https://grok.com/', deepseek: 'https://chat.deepseek.com/' };
const PLAIN_UA = process.env.SPIKE_DEEPSEEK_ELECTRON_UA !== '1';

app.setPath('userData', path.join(__dirname, 'ud-signin'));

app.whenReady().then(() => {
  Object.entries(SITES).forEach(([name, url], i) => {
    const ses = session.fromPartition(`persist:${name}`);
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      const allowed = permission === 'media' && new URL(details.requestingUrl).origin === new URL(url).origin;
      console.log(`[${name}] permission ${permission} from ${details.requestingUrl} -> ${allowed ? 'granted' : 'denied'}`);
      cb(allowed);
    });
    const win = new BrowserWindow({ x: 40 + i * 60, y: 40 + i * 60, width: 1100, height: 800, title: name, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    if (name === 'deepseek' && PLAIN_UA) win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/\S+/, ''));
    win.webContents.on('page-title-updated', (e, title) => win.setTitle(`${name} — ${title}`));
    win.loadURL(url);
  });
});

app.on('window-all-closed', () => app.quit());
