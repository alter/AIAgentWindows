#!/usr/bin/env node
// stub-cli.mjs
import { appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const childSession = process.env.CLAUDE_CODE_CHILD_SESSION === undefined ? 'unset' : 'set';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write('\x1b[?2004h');
process.stdout.write(`STUB-CLI BANNER argv=${JSON.stringify(process.argv.slice(2))} CLAUDE_CODE_CHILD_SESSION=${childSession}\r\n`);

const TRANSCRIPT = process.env.AIAW_STUB_TRANSCRIPT;
const REPLY_DELAY_MS = Number(process.env.AIAW_STUB_REPLY_DELAY_MS ?? '50');
const argv = process.argv.slice(2);
const sessionFlag = argv.findIndex((arg) => arg === '--session-id' || arg === '--resume');
const claudeSessionId = sessionFlag === -1 ? randomUUID() : argv[sessionFlag + 1];
const codexSessionId = randomUUID();
let codexFile = null;

function stamp() {
  return new Date().toISOString();
}

function appendRecords(file, records) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function claudeRecords(reply) {
  const message = (id, stop, content) => ({ type: 'assistant', timestamp: stamp(), message: { id, role: 'assistant', stop_reason: stop, content } });
  const id = `msg_${randomUUID()}`;
  if (process.env.AIAW_STUB_HANG) return [message(id, 'tool_use', [{ type: 'tool_use', name: 'Read', input: {} }])];
  const records = [];
  if (process.env.AIAW_STUB_THINKING_FIRST) records.push(message(id, 'end_turn', [{ type: 'thinking', thinking: 'hmm' }]));
  records.push(message(id, 'end_turn', [{ type: 'text', text: reply }]));
  return records;
}

function writeClaudeTranscript(prompt) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR ?? '.', 'projects', 'stub');
  const user = { type: 'user', timestamp: stamp(), message: { role: 'user', content: prompt } };
  appendRecords(path.join(dir, `${claudeSessionId}.jsonl`), [user, ...claudeRecords(`stub reply to: ${prompt}`)]);
}

function codexEvent(payload) {
  return { timestamp: stamp(), type: 'event_msg', payload };
}

function codexItem(phase, text) {
  return codexEvent({ type: 'item_completed', item: { type: 'AgentMessage', phase, content: [{ type: 'Text', text }] } });
}

function codexFile_() {
  if (codexFile !== null) return codexFile;
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const dir = path.join(process.env.CODEX_HOME ?? '.', 'sessions', String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate()));
  codexFile = path.join(dir, `rollout-${now.toISOString().replace(/[:.]/g, '-')}-${codexSessionId}.jsonl`);
  appendRecords(codexFile, [{ timestamp: stamp(), type: 'session_meta', payload: { id: codexSessionId, cwd: process.cwd() } }]);
  return codexFile;
}

function writeCodexTranscript(prompt) {
  const reply = `stub reply to: ${prompt}`;
  const file = codexFile_();
  const records = [codexEvent({ type: 'task_started' }), codexItem('commentary', 'working'), codexItem('final_answer', reply)];
  const complete = { type: 'task_complete', last_agent_message: process.env.AIAW_STUB_CODEX_NULL_REPLY ? null : reply };
  if (process.env.AIAW_STUB_CODEX_ERROR) complete.error = { message: 'stub failure' };
  if (!process.env.AIAW_STUB_HANG) records.push(codexEvent(complete));
  appendRecords(file, records);
}

function writeTranscript(prompt) {
  if (TRANSCRIPT === 'claude') writeClaudeTranscript(prompt);
  else if (TRANSCRIPT === 'codex') writeCodexTranscript(prompt);
}

let line = '';
let inPaste = false;

function feed(chunk) {
  let rest = chunk;
  while (rest.length > 0) {
    if (rest.startsWith(PASTE_START)) {
      inPaste = true;
      rest = rest.slice(PASTE_START.length);
    } else if (rest.startsWith(PASTE_END)) {
      inPaste = false;
      rest = rest.slice(PASTE_END.length);
    } else {
      const char = rest[0];
      rest = rest.slice(1);
      if (char === '\r' && !inPaste) {
        process.stdout.write(`\r\nSUBMITTED:${line}\r\n`);
        if (line === '/exit') process.exit(0);
        const submitted = line;
        setTimeout(() => writeTranscript(submitted), REPLY_DELAY_MS);
        line = '';
      } else {
        line += char;
        process.stdout.write(char);
      }
    }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', feed);
process.stdin.resume();
