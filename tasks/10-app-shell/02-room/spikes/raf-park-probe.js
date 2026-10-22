// park.js
const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'raf-park-')));
if (process.platform === 'darwin') app.dock?.hide();
if (process.env.NOOCC) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

const PAGE = `data:text/html,<body><div id=out></div><script>
window.c={raf:0,timer:0,ro:0,io:0,loads:(window.c&&window.c.loads||0)+1};
(function loop(){requestAnimationFrame(()=>{c.raf++;loop();});})();
setInterval(()=>c.timer++,100);
new ResizeObserver(()=>c.ro++).observe(document.body);
setInterval(()=>{document.getElementById('out').textContent+='x';},200);
new IntersectionObserver(()=>c.io++).observe(document.getElementById('out'));
</script></body>`;

const READ = `JSON.stringify({...window.c, vis: document.visibilityState, w: innerWidth, h: innerHeight})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const main = new BrowserWindow({ width: 600, height: 400, show: false, focusable: false, opacity: 0.02 });
  main.setPosition(area.x + area.width - 12, area.y + area.height - 12);
  main.showInactive();
  const parking = new BrowserWindow({ width: 600, height: 400, show: false, focusable: false });
  const view = new WebContentsView({ webPreferences: { backgroundThrottling: false, sandbox: true } });
  view.setBounds({ x: 0, y: 0, width: 300, height: 300 });
  main.contentView.addChildView(view);
  await view.webContents.loadURL(PAGE);
  await sleep(2000);
  const inMain = JSON.parse(await view.webContents.executeJavaScript(READ));
  main.contentView.removeChildView(view);
  parking.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 300, height: 300 });
  view.setVisible(true);
  await sleep(3000);
  const inParking = JSON.parse(await view.webContents.executeJavaScript(READ));
  parking.contentView.removeChildView(view);
  main.contentView.addChildView(view);
  await sleep(1000);
  const back = JSON.parse(await view.webContents.executeJavaScript(READ));
  console.log(JSON.stringify({ noocc: !!process.env.NOOCC, inMain, inParking, back }));
  app.quit();
});
