// stub-print.mjs
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function printKindOf(argv) {
  if (argv.includes('-p') || argv.includes('--print')) return 'claude';
  if (argv[0] === 'exec') return 'codex';
  return null;
}

function emit(record) {
  process.stdout.write(JSON.stringify(record) + '\n');
}

function hang() {
  setInterval(() => undefined, 1000);
  return new Promise(() => undefined);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function markerFile(kind, id) {
  const home = kind === 'claude' ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
  return path.join(home ?? '.', 'stub-sessions', id);
}

function remember(kind, id) {
  const file = markerFile(kind, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
}

function logInvocation(argv, prompt) {
  const file = process.env.AIAW_STUB_ARGV_LOG;
  if (!file) return;
  const childSession = process.env.CLAUDE_CODE_CHILD_SESSION === undefined ? 'unset' : 'set';
  appendFileSync(file, JSON.stringify({ argv, stdin: prompt, cwd: process.cwd(), childSession, pid: process.pid }) + '\n');
}

function replyFor(prompt) {
  return process.env.AIAW_STUB_REPLY ?? `stub reply to: ${prompt}`;
}

const delayMs = () => Number(process.env.AIAW_STUB_REPLY_DELAY_MS ?? '50');

async function runClaude(argv, prompt) {
  const resumed = valueAfter(argv, '--resume');
  const sessionId = resumed ?? valueAfter(argv, '--session-id') ?? randomUUID();
  if (process.env.AIAW_STUB_NOISE) process.stdout.write('shell start-up noise, not json\n');
  if (resumed !== undefined && !existsSync(markerFile('claude', sessionId))) {
    emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: [`No conversation found with session ID: ${sessionId}`],
      session_id: sessionId,
    });
    return 1;
  }
  remember('claude', sessionId);
  emit({ type: 'system', subtype: 'init', session_id: sessionId, permissionMode: valueAfter(argv, '--permission-mode') });
  if (process.env.AIAW_STUB_HANG) await hang();
  await sleep(delayMs());
  if (process.env.AIAW_STUB_NO_RESULT) return 0;
  if (process.env.AIAW_STUB_CLAUDE_ERROR) {
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'stub claude failure', session_id: sessionId });
    return 1;
  }
  const reply = replyFor(prompt);
  emit({
    type: 'assistant',
    session_id: sessionId,
    message: { id: `msg_${randomUUID()}`, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] },
  });
  emit({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: sessionId, stop_reason: 'end_turn' });
  return 0;
}

function rejectedByRealCodex(argv) {
  const resumeAt = argv.indexOf('resume');
  const flags = ['-a', '--ask-for-approval', '--no-daemon'];
  const afterResume = resumeAt < 0 ? [] : argv.slice(resumeAt);
  const bad = argv.find((arg) => flags.includes(arg)) ?? afterResume.find((arg) => arg === '--sandbox' || arg === '-s');
  if (bad !== undefined) return `error: unexpected argument '${bad}' found`;
  if (!argv.includes('--skip-git-repo-check')) return 'Not inside a trusted directory and --skip-git-repo-check was not specified.';
  return null;
}

async function runCodex(argv, prompt) {
  const refusal = rejectedByRealCodex(argv);
  if (refusal !== null) {
    process.stderr.write(refusal + '\n');
    return 2;
  }
  const resumeAt = argv.indexOf('resume');
  const resumed = resumeAt < 0 ? undefined : argv[resumeAt + 1];
  const threadId = resumed ?? randomUUID();
  if (process.env.AIAW_STUB_NOISE) process.stdout.write('shell start-up noise, not json\n');
  if (resumed !== undefined && !existsSync(markerFile('codex', threadId))) {
    emit({ type: 'error', message: `no rollout found for thread id ${threadId}` });
    process.stderr.write(`Error: no rollout found for thread id ${threadId}\n`);
    return 1;
  }
  remember('codex', threadId);
  emit({ type: 'thread.started', thread_id: threadId });
  emit({ type: 'turn.started' });
  if (process.env.AIAW_STUB_HANG) await hang();
  await sleep(delayMs());
  if (process.env.AIAW_STUB_NO_RESULT) return 1;
  emit({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'working on it' } });
  if (process.env.AIAW_STUB_CODEX_ERROR) {
    emit({ type: 'error', message: 'stub failure' });
    emit({ type: 'turn.failed', error: { message: 'stub failure' } });
    return 1;
  }
  if (!process.env.AIAW_STUB_CODEX_NULL_REPLY) {
    emit({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: replyFor(prompt) } });
  }
  emit({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
  return 0;
}

export async function runPrint(kind, argv) {
  const prompt = await readStdin();
  logInvocation(argv, prompt);
  const code = await (kind === 'claude' ? runClaude(argv, prompt) : runCodex(argv, prompt));
  await new Promise((resolve) => process.stdout.write('', resolve));
  return code;
}
