const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/\S+/, ''));
  await win.loadURL('https://example.com/');
  const r = await win.webContents.executeJavaScript(`(async () => ({ ua: navigator.userAgent, brands: navigator.userAgentData && navigator.userAgentData.brands, high: navigator.userAgentData && await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platform']), webdriver: navigator.webdriver, electronGlobals: ['process','require','module'].filter(k => k in window) }))()`);
  console.log(JSON.stringify(r, null, 1)); app.quit();
});
