// main.js
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const fs = require('fs');
const path = require('path');
const VARIANT = process.env.VARIANT || 'A';
const URL_ = process.env.TARGET || 'https://demo.turnstile.workers.dev/';
const WAIT = Number(process.env.WAIT || 25000);
const OUT = process.env.OUT;
const probeSrc = fs.readFileSync(path.join(__dirname, 'probe.js'), 'utf8');

const OWNER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const SENSITIVE = new Set(['media','geolocation','notifications','clipboard-read','display-capture','midi','hid','serial','usb','idle-detection']);
const GRANTED = new Set(['media','persistent-storage']);
const originOf = (u) => { try { const o = new URL(u).origin; return o === 'null' ? null : o; } catch { return null; } };
const allowedP = (agent, perm, url) => GRANTED.has(perm) && originOf(agent) !== null && originOf(agent) === originOf(url);
const checkAllowed = (agent, perm, origin) => SENSITIVE.has(perm) ? allowedP(agent, perm, origin) : true;
function override(engine) {
  const major = /Chrome\/(\d+)/.exec(OWNER_USER_AGENT)[1];
  const named = ['Chromium', 'Google Chrome'];
  return { userAgent: OWNER_USER_AGENT, userAgentMetadata: {
    brands: [{ brand: 'Not?A_Brand', version: '24' }, ...named.map((brand) => ({ brand, version: major }))],
    fullVersionList: [{ brand: 'Not?A_Brand', version: '24.0.0.0' }, ...named.map((brand) => ({ brand, version: engine.chromeVersion }))],
    platform: 'macOS', platformVersion: engine.platformVersion, architecture: engine.arch === 'arm64' ? 'arm' : 'x86',
    model: '', mobile: false, bitness: '64', wow64: false } };
}
if (process.env.RENDER_SWITCHES !== '0') {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const result = { variant: VARIANT, target: URL_, electron: process.versions.electron, chrome: process.versions.chrome };
  const win = new BrowserWindow({ width: 1100, height: 800, show: false, focusable: false });
  const partition = `spike-${VARIANT}-${Date.now()}`;
  const ses = session.fromPartition(partition);
  const agentOrigin = originOf(URL_) || '';
  const permLog = [];
  const headers = [];
  const seen = new Set();
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://challenges.cloudflare.com/*'] }, (d, cb) => {
    const h = {};
    for (const [k, v] of Object.entries(d.requestHeaders)) { const l = k.toLowerCase(); if (l === 'cookie' || l === 'authorization') continue; if (l.startsWith('sec-') || l === 'user-agent' || l === 'accept-language' || l === 'referer') h[l] = v; }
    const key = d.resourceType + JSON.stringify(h);
    if (!seen.has(key) && headers.length < 12) { seen.add(key); headers.push({ type: d.resourceType, url: d.url.split('?')[0].slice(0, 90), headers: h }); }
    cb({ requestHeaders: d.requestHeaders });
  });
  if (VARIANT !== 'D') {
    ses.setUserAgent(OWNER_USER_AGENT);
    ses.setPermissionRequestHandler((_c, permission, callback, details) => {
      let ok = allowedP(agentOrigin, permission, details.requestingUrl);
      if (VARIANT === 'B' && (permission === 'notifications' || permission === 'media')) ok = true;
      permLog.push({ kind: 'request', permission, origin: originOf(details.requestingUrl), ok }); callback(ok);
    });
    ses.setPermissionCheckHandler((_c, permission, origin) => {
      let ok = checkAllowed(agentOrigin, permission, origin);
      if (VARIANT === 'B' && (permission === 'notifications' || permission === 'media')) ok = true;
      permLog.push({ kind: 'check', permission, origin: originOf(origin), ok }); return ok;
    });
  } else {
    ses.webRequest; // untouched
  }
  const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.contentView.addChildView(view);
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width: w, height: h });
  const contents = view.webContents;
  if (VARIANT === 'A' || VARIANT === 'B') {
    const ov = override({ chromeVersion: process.versions.chrome, platformVersion: process.getSystemVersion(), arch: process.arch });
    contents.debugger.attach('1.3');
    contents.debugger.sendCommand('Emulation.setUserAgentOverride', ov).then(()=>console.log('ua override ok'), (e)=>console.log('ua override fail', e.message));
  }
  result.debuggerAttached = contents.debugger.isAttached();
  const loaded = new Promise((r) => contents.once('did-finish-load', r));
  contents.loadURL(URL_).catch((e) => { result.loadError = String(e.message); });
  await Promise.race([loaded, sleep(30000)]);
  if (process.env.DRIVE === '1') {
    await sleep(6000);
    const clickText = (t) => contents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button,a,[role=button]')].find(e=>e.textContent.trim().toLowerCase()===${JSON.stringify(t)}); if(b){b.click();return true} return false })()`);
    result.drive = [];
    result.drive.push(['sign in', await clickText('sign in')]); await sleep(3000);
    await contents.executeJavaScript(`(()=>{const i=document.querySelector('input[type=email],input[placeholder*=email i]');i&&i.focus()})()`);
    contents.insertText('spike-check@example.invalid'); await sleep(1500);
    result.drive.push(['continue', await clickText('continue')]); await sleep(3000);
  }
  await sleep(WAIT);
  console.log('loaded'); const frames = contents.mainFrame.framesInSubtree; console.log(frames.length);
  result.frames = frames.map((f) => (f.url || '').split('?')[0].slice(0, 100));
  result.probes = {};
  for (const f of frames) {
    const u = f.url || '';
    const label = f === contents.mainFrame ? 'top' : u.includes('challenges.cloudflare.com') ? 'cf:' + (Object.keys(result.probes).filter((k) => k.startsWith('cf:')).length) : null;
    if (!label) continue;
    try { console.log('probing',label); result.probes[label] = await Promise.race([f.executeJavaScript(probeSrc), sleep(15000).then(()=>'TIMEOUT')]); } catch (e) { result.probes[label] = 'ERR ' + e.message; }
  }
  try {
    result.widget = await Promise.race([sleep(10000).then(()=>'TIMEOUT'), contents.mainFrame.executeJavaScript(`(() => [...document.querySelectorAll('input[name="cf-turnstile-response"]')].map(i => i.value.length))()`)]);
  } catch (e) { result.widget = 'ERR ' + e.message; }
  result.requestHeaders = headers;
  const counts = {};
  for (const p of permLog) { const k = `${p.kind}:${p.permission}:${p.origin}:${p.ok}`; counts[k] = (counts[k] || 0) + 1; }
  result.permLog = counts;
  try { const img = await contents.capturePage(); fs.writeFileSync(OUT.replace(/\.json$/, '.png'), img.toPNG()); } catch {}
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  app.exit(0);
});
