const { app, clipboard, ClipboardItem } = require('electron');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const OUT = process.env.SPIKE_OUT;
const CLI = process.env.SPIKE_CLI || 'claude';
const SUBMIT = process.env.SPIKE_SUBMIT === '1';
const log = [];
const note = (s) => { const l = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`; log.push(l); console.log(l); };
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('unhandledRejection', (e) => { console.error('FATAL', e); app.exit(2); });
app.whenReady().then(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-cwd-'));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-shared-'));
  const sid = crypto.randomUUID();
  const shell = process.env.SHELL || '/bin/zsh';
  const args = CLI === 'claude'
    ? `claude --session-id ${sid} --add-dir ${shared}${process.env.SPIKE_MODEL ? " --model " + process.env.SPIKE_MODEL : ""}`
    : `codex`;
  note(`electron ${process.versions.electron}, node ${process.versions.node}, node-pty loaded, shell ${shell}`);
  note(`PATH seen by the GUI process: ${process.env.PATH}`);
  const term = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
  const p = pty.spawn(shell, ['-l', '-i', '-c', args], { name: 'xterm-256color', cols: 120, rows: 40, cwd, env: { ...process.env, TERM: 'xterm-256color' } });
  let raw = '';
  p.onData((d) => { raw += d; term.write(d); });
  p.onExit(({ exitCode }) => note(`pty exit ${exitCode}`));
  const screen = () => { const b = term.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true)); return lines.join('\n').replace(/\n{3,}/g, '\n\n'); };
  const snap = (name) => { fs.writeFileSync(path.join(OUT, `${CLI}-${name}.screen.txt`), screen()); note(`snapshot ${name}; bracketedPasteMode=${term.modes.bracketedPasteMode}`); };
  const waitFor = async (re, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(screen())) return true; await sleep(250); } return false; };

  note(`cwd ${cwd}; shared ${shared}; session-id ${sid}; cmd: ${shell} -l -i -c "${args}"`);
  await sleep(6000); snap('01-start');
  if (/trust/i.test(screen())) { const keys = process.env.SPIKE_TRUST_KEYS === undefined ? '\x1b[B' : JSON.parse(`"${process.env.SPIKE_TRUST_KEYS}"`); note(`trust dialog present → ${JSON.stringify(keys)} + Enter`); if (process.env.SPIKE_TRUST_KEYS === 'stop') { snap('02-trust-only'); app.exit(0); return; } p.write(keys); await sleep(400); p.write('\r'); await sleep(5000); snap('02-after-trust'); }
  for (let i = 0; i < 3 && CLI === 'codex'; i++) {
    const s = screen();
    if (/Update available/.test(s)) { note('codex update dialog → Esc (skip)'); p.write('\x1b'); await sleep(2500); snap(`02-dialog-${i}`); continue; }
    if (/Trust this folder/.test(s)) { note('codex trust dialog → Enter (Trust and continue)'); p.write('\r'); await sleep(3000); snap(`02-dialog-${i}`); continue; }
    break;
  }
  const ready = await waitFor(/[>›❯]/, 15000); note(`prompt visible: ${ready}`);

  p.write('\x1b[200~line one of a forwarded text\nline two\x1b[201~'); await sleep(1500); snap('03-after-bracketed-paste');

  const { execFileSync } = require('child_process');
  const saved = execFileSync('/usr/bin/pbpaste', { env: { LANG: 'en_US.UTF-8' } }).toString();
  const pngFile = path.join(os.tmpdir(), 'spike-image.png');
  fs.writeFileSync(pngFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP8z8DAwMDAxMDAwMDAyMDA8J+BgQEAPvgEAQ8Zr6sAAAAASUVORK5CYII=', 'base64'));
  const fmt = process.env.SPIKE_IMAGE_FORMAT || 'PNGf';
  let imgFile = pngFile;
  if (fmt === 'text') execFileSync('/usr/bin/pbcopy', { input: 'spike clipboard text 42', env: { LANG: 'en_US.UTF-8' } });
  else if (fmt === 'NSImage') execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit'); const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; pb.writeObjects($([$.NSImage.alloc.initWithContentsOfFile('${pngFile}')]))`]);
  else execFileSync('/usr/bin/osascript', ['-e', `set the clipboard to (read (POSIX file "${imgFile}") as «class ${fmt}»)`]);
  note(`pasteboard types: ${execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); ObjC.deepUnwrap($.NSPasteboard.generalPasteboard.types).join(',')"]).toString().trim()}`);
  note(`clipboard image written as ${fmt}`);
  note(`clipboard.has(image/png)=${await clipboard.has('image/png')} has(text/plain)=${await clipboard.has('text/plain')}`);
  process.on('exit', () => execFileSync('/usr/bin/pbcopy', { input: saved, env: { LANG: 'en_US.UTF-8' } }));
  p.write(process.platform === 'win32' ? '\x1bv' : '\x16'); await sleep(2500); snap('04-after-ctrl-v-image');

  if (SUBMIT) {
    p.write('\x15'); await sleep(300);
    p.write('\x1b[200~Reply with the single word OK and nothing else.\x1b[201~'); await sleep(800); p.write('\r');
    await waitFor(/\bOK\b/, 60000); await sleep(3000); snap('05-after-submit');
  }
  if (SUBMIT) { p.write('\x03'); await sleep(500); }
  p.write('\x03'); await sleep(500); p.write('\x03'); await sleep(2000);
  fs.writeFileSync(path.join(OUT, `${CLI}-run.log`), log.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, `${CLI}-meta.json`), JSON.stringify({ sid, cwd, shared, t0: new Date(t0).toISOString() }, null, 2));
  try { p.kill(); } catch {}
  app.quit();
});
