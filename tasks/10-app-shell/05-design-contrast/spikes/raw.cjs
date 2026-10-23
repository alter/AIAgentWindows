const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const q = (win) => win.webContents.executeJavaScript(`({dark: matchMedia('(prefers-color-scheme: dark)').matches, light: matchMedia('(prefers-color-scheme: light)').matches, bodyBg: getComputedStyle(document.body).backgroundColor})`);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, 'page.html'));
  await win.webContents.executeJavaScript(`window.__changes=[]; matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => window.__changes.push('dark=' + e.matches))`);
  const out = {};
  const snap = async (label) => { out[label] = { themeSource: nativeTheme.themeSource, shouldUseDarkColors: nativeTheme.shouldUseDarkColors, ...(await q(win)) }; };
  await snap('A default');
  for (const src of ['light', 'dark', 'system', 'dark', 'light']) {
    nativeTheme.themeSource = src;
    await new Promise((r) => setTimeout(r, 300));
    await snap('themeSource=' + src + ' #' + Object.keys(out).length);
  }
  out.changeEvents = await win.webContents.executeJavaScript('window.__changes');
  out.versions = { electron: process.versions.electron, chrome: process.versions.chrome };
  console.log(JSON.stringify(out, null, 2));
  app.quit();
});
