// raf-hidden-probe.js
const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'raf-probe-')));
if (process.platform === 'darwin') app.dock?.hide();
if (process.env.NOOCC) { app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); app.commandLine.appendSwitch('disable-renderer-backgrounding'); }

const PAGE = `data:text/html,<body><div id=out></div><script>
window.c={raf:0,timer:0,mc:0,io:0};
(function loop(){requestAnimationFrame(()=>{c.raf++;loop();});})();
setInterval(()=>c.timer++,100);
const ch=new MessageChannel();ch.port1.onmessage=()=>{c.mc++;setTimeout(()=>ch.port2.postMessage(0),100);};ch.port2.postMessage(0);
</script></body>`;

const READ = `JSON.stringify({...window.c, vis: document.visibilityState, hidden: document.hidden, focus: document.hasFocus()})`;

function makeView(win, bounds, visible, index) {
  const view = new WebContentsView({ webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true } });
  view.setBounds(bounds);
  view.setVisible(visible);
  if (index === undefined) win.contentView.addChildView(view); else win.contentView.addChildView(view, index);
  void view.webContents.loadURL(PAGE);
  return view;
}

app.whenReady().then(async () => {
  const mode = process.argv[2] || 'shown';
  const win = new BrowserWindow({ width: 600, height: 400, show: false, focusable: false, opacity: Number(process.env.OP || 0.02), webPreferences: { backgroundThrottling: false } });
  void win.webContents.loadURL('data:text/html,<body style="background:#123"></body>');
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - Number(process.env.EDGE || 12), area.y + area.height - Number(process.env.EDGE || 12));
  if (mode === 'shown') win.showInactive();
  const views = {
    visible: makeView(win, { x: 0, y: 0, width: 300, height: 300 }, true),
    setVisibleFalse: makeView(win, { x: 300, y: 0, width: 300, height: 300 }, false),
    outsideBounds: makeView(win, { x: 5000, y: 5000, width: 300, height: 300 }, true),
    zeroSize: makeView(win, { x: 0, y: 0, width: 0, height: 0 }, true),
    underMain: makeView(win, { x: 0, y: 0, width: 300, height: 300 }, true, 0),
  };
  await new Promise((r) => setTimeout(r, 3000));
  const out = { mode, electron: process.versions.electron };
  out.children = win.contentView.children.map((v) => v === views.underMain ? 'underMain' : v.webContents === win.webContents ? 'main' : 'other');
  for (const [name, view] of Object.entries(views)) out[name] = JSON.parse(await view.webContents.executeJavaScript(READ));
  console.log(JSON.stringify(out, null, 1));
  app.quit();
});
