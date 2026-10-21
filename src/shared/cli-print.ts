// cli-print.ts
import type { CliKind } from './agents';
import { MAX_ERROR_CHARS, truncateText } from './room-model';

export type PrintOutcome = { state: 'running' } | { state: 'done'; reply: string | null } | { state: 'failed'; reason: string };

type JsonRecord = Record<string, unknown>;

const MAX_LINE_CHARS = 8 * 1024 * 1024;
const DEFAULT_FAILURE = 'the turn failed';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): JsonRecord | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function failed(reason: string | null): PrintOutcome {
  return { state: 'failed', reason: truncateText(reason ?? DEFAULT_FAILURE, MAX_ERROR_CHARS) };
}

function claudeFailure(record: JsonRecord): string | null {
  const errors = Array.isArray(record['errors']) ? record['errors'].filter((item): item is string => typeof item === 'string') : [];
  return textOf(record['result']) ?? textOf(errors.join('; ')) ?? textOf(record['subtype']);
}

export class PrintReader {
  private pending = '';
  private skipping = false;
  private result: PrintOutcome = { state: 'running' };
  private lastAgentText: string | null = null;
  private session: string | null = null;
  private error: string | null = null;

  constructor(private readonly kind: CliKind) {}

  get outcome(): PrintOutcome {
    return this.result;
  }

  get sessionId(): string | null {
    return this.session;
  }

  get lastError(): string | null {
    return this.error;
  }

  feed(chunk: string): void {
    const parts = (this.pending + chunk).split('\n');
    this.pending = parts.pop() ?? '';
    for (const part of parts) {
      if (this.skipping) this.skipping = false;
      else this.handle(part);
    }
    if (this.pending.length > MAX_LINE_CHARS) {
      this.pending = '';
      this.skipping = true;
    }
  }

  finish(): void {
    if (!this.skipping) this.handle(this.pending);
    this.pending = '';
    this.skipping = false;
  }

  private handle(line: string): void {
    const record = parseLine(line);
    if (record === null) return;
    if (this.kind === 'claude') this.handleClaude(record);
    else this.handleCodex(record);
  }

  private settle(outcome: PrintOutcome): void {
    if (this.result.state === 'running') this.result = outcome;
  }

  private handleClaude(record: JsonRecord): void {
    if (record['type'] === 'system' && record['subtype'] === 'init') this.session = textOf(record['session_id']) ?? this.session;
    if (record['type'] !== 'result') return;
    const succeeded = record['subtype'] === 'success' && record['is_error'] !== true;
    this.settle(succeeded ? { state: 'done', reply: textOf(record['result']) } : failed(claudeFailure(record)));
  }

  private handleCodex(record: JsonRecord): void {
    const type = record['type'];
    if (type === 'thread.started') this.session = textOf(record['thread_id']) ?? this.session;
    else if (type === 'item.completed') this.lastAgentText = this.agentText(record['item']) ?? this.lastAgentText;
    else if (type === 'error') this.error = textOf(record['message']) ?? this.error;
    else if (type === 'turn.completed') this.settle({ state: 'done', reply: this.lastAgentText });
    else if (type === 'turn.failed') this.settle(failed(isRecord(record['error']) ? textOf(record['error']['message']) : null));
  }

  private agentText(item: unknown): string | null {
    return isRecord(item) && item['type'] === 'agent_message' ? textOf(item['text']) : null;
  }
}
