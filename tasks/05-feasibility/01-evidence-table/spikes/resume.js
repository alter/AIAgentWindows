const pty = require('node-pty'); const { Terminal } = require('@xterm/headless');
const [cmd, cwd] = process.argv.slice(2);
const term = new Terminal({ cols: 120, rows: 30, allowProposedApi: true });
const p = pty.spawn(process.env.SHELL, ['-l', '-i', '-c', cmd], { name: 'xterm-256color', cols: 120, rows: 30, cwd, env: process.env });
p.onData((d) => term.write(d));
setTimeout(() => {
  const b = term.buffer.active; const out = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true));
  console.log(`--- ${cmd}  (cwd ${cwd})\n` + out.filter((l) => l.trim()).slice(-14).join('\n'));
  p.write('\x03'); setTimeout(() => { p.write('\x03'); setTimeout(() => { p.kill(); process.exit(0); }, 800); }, 500);
}, 9000);
