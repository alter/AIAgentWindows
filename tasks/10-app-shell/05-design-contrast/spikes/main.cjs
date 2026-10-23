const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'page.html'));
});
app.on('window-all-closed', () => app.quit());
