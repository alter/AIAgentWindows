#!/usr/bin/env node
// dialog-stub-cli.mjs
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const LOG = process.env.AIAW_STUB_STDIN_LOG;
const MODE = process.env.AIAW_STUB_MODE ?? 'between';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const TRUST = ' Quick safety check: Is this a project you created or one you trust?\r\n\r\n \u276f 1. No, exit\r\n   2. Yes, I trust this folder\r\n\r\n Enter to confirm \u00b7 Esc to cancel\r\n';
const UPDATE = '  Update available · 0.159.2 → 0.163.0\r\n\r\n› 1. Update now (runs `probe-installer`)\r\n  2. Skip\r\n  3. Skip until next version\r\n\r\n  enter continue · esc skip\r\n';
const DIALOG = process.env.AIAW_STUB_DIALOG_KIND === 'trust' ? TRUST : UPDATE;
const argv = process.argv.slice(2);
const sid = argv[argv.indexOf('--session-id') + 1];
let dialogOpen = false;
let inPaste = false;
let line = '';
let submits = 0;

function log(text) {
  if (LOG) appendFileSync(LOG, text + '\n');
}

function showDialog() {
  dialogOpen = true;
  process.stdout.write(DIALOG);
}

function transcript(prompt) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'stub');
  mkdirSync(dir, { recursive: true });
  const t = () => new Date().toISOString();
  const recs = [
    { type: 'user', timestamp: t(), message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: t(), message: { id: `m${submits}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: `reply ${submits}` }] } },
  ];
  appendFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('\x1b[?2004h');

if (MODE === 'flood') {
  for (let frame = 0; frame < 300; frame += 1) process.stdout.write(`\x1b[2J\x1b[H\x1b[38;5;${frame % 255}m Starting codex ${'.'.repeat(frame % 4)}\x1b[0m${' '.repeat(100)}\r\n`);
  setTimeout(showDialog, 50);
} else if (MODE === 'late') {
  process.stdout.write('› Ask Codex to do anything\r\n');
  setTimeout(showDialog, Number(process.env.AIAW_STUB_LATE_MS ?? '400'));
} else if (MODE === 'split') {
  const parts = ['  Update available\r\n› 1. Up', 'date', ' n', '\x1b[1mo', 'w\x1b[0m (runs probe)\r\n'];
  parts.forEach((part, index) => setTimeout(() => process.stdout.write(part), index * 30));
  dialogOpen = true;
} else if (MODE === 'reorder') {
  process.stdout.write('\x1b[2J\x1b[5;14Hnow (runs `probe-installer`)\x1b[5;1H› 1. Update\x1b[7;3H2. Skip\r\n');
  dialogOpen = true;
} else {
  process.stdout.write('› Ask Codex to do anything\r\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  log(JSON.stringify(chunk));
  let rest = chunk;
  while (rest.length > 0) {
    if (rest.startsWith(PASTE_START)) {
      inPaste = true;
      rest = rest.slice(PASTE_START.length);
      continue;
    }
    if (rest.startsWith(PASTE_END)) {
      inPaste = false;
      rest = rest.slice(PASTE_END.length);
      continue;
    }
    const char = rest[0];
    rest = rest.slice(1);
    if (char === '\r' && !inPaste) {
      if (dialogOpen) {
        log('DIALOG-ACCEPTED-DEFAULT');
        dialogOpen = false;
        line = '';
        continue;
      }
      submits += 1;
      const prompt = line;
      line = '';
      setTimeout(() => {
        transcript(prompt);
        if (MODE === 'between' && submits === 1) setTimeout(showDialog, 50);
      }, 30);
    } else if (!dialogOpen) {
      line += char;
    }
  }
});
setTimeout(() => process.exit(0), 20000);
