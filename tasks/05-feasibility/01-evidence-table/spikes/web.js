const { app, BrowserWindow, session } = require('electron');
const fs = require('fs'), path = require('path');
const OUT = process.env.SPIKE_OUT;
const ALL = { chatgpt: 'https://chatgpt.com/', grok: 'https://grok.com/', deepseek: 'https://chat.deepseek.com/' };
const SITES = Object.fromEntries(Object.entries(ALL).filter(([k]) => !process.env.SPIKE_ONLY || k === process.env.SPIKE_ONLY));
const TAG = process.env.SPIKE_TAG || '';
const INPUT = { chatgpt: '#prompt-textarea', grok: 'textarea, [contenteditable="true"]', deepseek: 'textarea' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.error('FATAL', e); app.exit(2); });
app.whenReady().then(async () => {
  const report = { electron: process.versions.electron, chrome: process.versions.chrome, sites: {} };
  await Promise.all(Object.entries(SITES).map(async ([name, url]) => {
    const ses = session.fromPartition(`spike-${name}`);
    const asked = [];
    ses.setPermissionRequestHandler((wc, permission, cb, details) => { asked.push({ permission, origin: details.requestingUrl }); cb(false); });
    const win = new BrowserWindow({ width: 1100, height: 800, title: name, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const wc = win.webContents;
    if (process.env.SPIKE_PLAIN_UA) wc.setUserAgent(wc.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ spike\/\S+/, ''));
    const statuses = [];
    wc.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => { if (d.resourceType === 'mainFrame' || d.statusCode >= 400) statuses.push(`${d.statusCode} ${d.resourceType} ${d.url.slice(0, 90)}`); });
    try { await win.loadURL(url); } catch (e) { statuses.push(`load error ${e.message}`); }
    await sleep(20000);
    const probe = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: `({ title: document.title, url: location.href, input: !!document.querySelector(${JSON.stringify(INPUT[name])}), challenge: /just a moment|verify you are human|cf-chl|challenges\\.cloudflare/i.test(document.documentElement.outerHTML.slice(0, 200000)), loginWall: /log in|sign in|sign up|войти/i.test(document.body ? document.body.innerText.slice(0, 3000) : '') })` }]);
    try { const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, `web-${name}${TAG}.png`), img.resize({ width: 800 }).toPNG()); } catch (e) { statuses.push(`capture error ${e.message}`); }
    report.sites[name] = { ...probe, ua: wc.getUserAgent(), mainFrameAndErrors: statuses.slice(0, 15), permissionRequests: asked };
  }));
  fs.writeFileSync(path.join(OUT, `web-report${TAG}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
