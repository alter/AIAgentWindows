const { app, BrowserWindow, session } = require('electron'); const os = require('os'), path = require('path'), fs = require('fs');
const http = require('https'); const KEY=fs.readFileSync(__dirname+'/k.pem'), CERT=fs.readFileSync(__dirname+'/c.pem'); app.commandLine.appendSwitch('ignore-certificate-errors');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ua-probe-')));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const META = { brands: [{brand:'Not?A_Brand',version:'24'},{brand:'Chromium',version:'155'},{brand:'Google Chrome',version:'155'}],
  fullVersionList: [{brand:'Not?A_Brand',version:'24.0.0.0'},{brand:'Chromium',version:'155.0.0.0'},{brand:'Google Chrome',version:'155.0.0.0'}],
  platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false, bitness: '64', wow64: false };
const seen = [];
const server = http.createServer({key:KEY,cert:CERT},(req, res) => {
  seen.push({ url: req.url, h: Object.keys(req.headers).filter(k=>k.startsWith('sec-ch')).map(k=>k+'='+req.headers[k]) });
  res.setHeader('content-type', 'text/html'); res.setHeader('accept-ch', 'sec-ch-ua-full-version-list, sec-ch-ua-platform-version');
  if (req.url.startsWith('/sub')) { res.end('<h1>sub</h1>'); return; }
  res.end('<!doctype html><h1>x</h1><iframe src="/sub"></iframe><a id=l target=_blank href="/pop">p</a>');
});
const JS = `(async()=>({ua:navigator.userAgent,brands:navigator.userAgentData&&navigator.userAgentData.brands,full:navigator.userAgentData&&(await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion'])).fullVersionList,
  worker: await new Promise(r=>{const b=new Blob(['postMessage([navigator.userAgent, navigator.userAgentData&&navigator.userAgentData.brands.map(x=>x.brand)])']);const w=new Worker(URL.createObjectURL(b));w.onmessage=e=>r(e.data);}),
  frame: await new Promise(r=>{const f=document.querySelector('iframe');r(f?[f.contentWindow.navigator.userAgent,f.contentWindow.navigator.userAgentData.brands.map(x=>x.brand)]:null)})}))()`;
async function run(name, setup) {
  seen.length = 0;
  const ses = session.fromPartition('probe-' + name);
  if (name.startsWith('ses')) ses.setUserAgent(UA);
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'probe-' + name, sandbox: true, contextIsolation: true } });
  console.log('window made', name);
  if (!name.startsWith('ses')) await setup(win, ses);
  console.log('setup done', name);
  const port = server.address().port;
  await win.loadURL(`https://localhost:${port}/`);
  console.log('loaded 1'); await win.loadURL(`https://localhost:${port}/?again`); console.log('loaded 2');
  const r = await win.webContents.executeJavaScript(JS);
  console.log('==', name, JSON.stringify({ page: r, headers: seen }, null, 0));
  win.destroy();
}
app.whenReady().then(() => server.listen(0, '127.0.0.1', async () => {
  const mode = process.argv[2];
  if (mode === 'ses') await run('ses.setUserAgent', (w, s) => s.setUserAgent(UA));
  if (mode === 'wc') await run('wc.setUserAgent', (w) => w.webContents.setUserAgent(UA));
  if (mode === 'cdp') await run('cdp', async (w) => { const t=(p,ms)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),ms))]); const d=w.webContents.debugger; d.attach('1.3'); console.log('attached', d.isAttached()); if (process.argv[3]==='blank') { await w.loadURL('about:blank'); console.log('blank loaded'); } try { console.log('r', JSON.stringify(await t(d.sendCommand('Emulation.setUserAgentOverride', { userAgent: UA, userAgentMetadata: META }), 8000))); } catch(e){ console.log('ERR', e.message); } });
  process.exit(0);
}));
