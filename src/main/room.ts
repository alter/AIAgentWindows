// room.ts
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildParticipantPrompt,
  newNonce,
  renderEntryBlock,
  renderHistory,
  renderHistoryHeader,
} from '../shared/room-history';
import {
  MAX_ERROR_CHARS,
  MAX_HISTORY_CHARS,
  MAX_REPLY_CHARS,
  relaySchedule,
  truncateText,
  type RoomConfig,
  type RoomEntry,
  type RoomEntryKind,
  type RoomEvent,
  type RoomParticipant,
  type RoomStatus,
  type StepState,
} from '../shared/room-model';

export type { RoomEvent, RoomStatus, StepState } from '../shared/room-model';

export interface TurnRequest {
  text: string;
  attachPath: string | null;
  historyText: string | null;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ParticipantDriver {
  turn(request: TurnRequest): Promise<string | null>;
  reset(): Promise<void>;
  dispose(): void;
}

export class OwnerPause extends Error {
  constructor(
    readonly sessionId: string,
    readonly note: string,
  ) {
    super(note);
    this.name = 'OwnerPause';
  }
}

export type DriverFactory = (participant: RoomParticipant) => Promise<ParticipantDriver>;

export interface RoomDeps {
  roomsDir: string;
  driverFor: DriverFactory;
  emit?(event: RoomEvent): void;
  now?(): number;
  newId?(): string;
  newNonce?(): string;
  maxHistoryChars?: number;
}

export interface RoomRunResult {
  roomId: string;
  historyPath: string;
  status: RoomStatus;
  entries: RoomEntry[];
}

export interface RoomRun {
  roomId: string;
  historyPath: string;
  done: Promise<RoomRunResult>;
}

const OWNER_ID = 'owner';
const OWNER_LABEL = 'Owner';
const ROOM_ID = 'room';
const ROOM_LABEL = 'Room';
const STOP_TEXT = 'Stopped by the owner.';
const NO_REPLY_TEXT = 'The participant ended its turn without a reply.';

function defaultRoomId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return `room-${stamp}-${randomBytes(3).toString('hex')}`;
}

function errorText(error: unknown): string {
  return truncateText(error instanceof Error ? error.message : String(error), MAX_ERROR_CHARS);
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, file);
}

function abortion(signal: AbortSignal): Promise<'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve('aborted');
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
}

class RunState {
  readonly entries: RoomEntry[] = [];
  readonly controller = new AbortController();
  completed = 0;
  chars = 0;
  readonly waiting = new Set<() => void>();
  private nonce: string | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly historyPath: string,
    readonly config: RoomConfig,
    readonly total: number,
    private readonly random: (() => string) | undefined,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  add(entry: RoomEntry): void {
    this.entries.push(entry);
    this.chars += entry.text.length;
    if (this.nonce !== null) {
      const block = renderEntryBlock(this.nonce, entry);
      this.enqueue(() => appendFile(this.historyPath, block, 'utf8'));
      return;
    }
    const fresh = newNonce(this.random);
    this.nonce = fresh;
    const text = renderHistory(this.id, this.entries, () => fresh);
    this.enqueue(() => writeAtomic(this.historyPath, text));
  }

  render(entries: readonly RoomEntry[]): string {
    const nonce = this.nonce;
    if (nonce === null) return renderHistory(this.id, entries);
    return renderHistoryHeader(this.id, nonce) + entries.map((entry) => renderEntryBlock(nonce, entry)).join('');
  }

  flushed(): Promise<void> {
    return this.writing;
  }

  private enqueue(write: () => Promise<void>): void {
    this.writing = this.writing.then(write);
    this.writing.catch(() => undefined);
  }
}

export class Room {
  private readonly drivers = new Map<string, Promise<ParticipantDriver>>();
  private current: RunState | null = null;

  constructor(private readonly deps: RoomDeps) {}

  isRunning(): boolean {
    return this.current !== null;
  }

  start(config: RoomConfig): RoomRun {
    if (this.current !== null) throw new Error('a room run is already in progress');
    const now = this.now();
    const roomId = this.deps.newId?.() ?? defaultRoomId(now);
    const historyPath = path.join(this.deps.roomsDir, `${roomId}.md`);
    const total = config.mode === 'relay' ? relaySchedule(config.participants, config.rounds).length : config.participants.length * config.rounds;
    const run = new RunState(roomId, historyPath, config, total, this.deps.newNonce);
    this.current = run;
    return { roomId, historyPath, done: this.execute(run) };
  }

  stop(): void {
    this.current?.controller.abort();
  }

  resume(): void {
    for (const release of [...(this.current?.waiting ?? [])]) release();
  }

  async shutdown(): Promise<void> {
    this.stop();
    const drivers = [...this.drivers.values()];
    this.drivers.clear();
    for (const pending of drivers) {
      const driver = await pending.catch(() => null);
      driver?.dispose();
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private emit(event: RoomEvent): void {
    this.deps.emit?.(event);
  }

  private async execute(run: RunState): Promise<RoomRunResult> {
    let status: RoomStatus = 'done';
    try {
      this.emit({ type: 'started', roomId: run.id, historyPath: run.historyPath, total: run.total });
      this.append(run, OWNER_ID, OWNER_LABEL, 'prompt', run.config.prompt);
      await run.flushed();
      if (run.config.mode === 'relay') await this.relay(run);
      else await this.broadcast(run);
      if (run.signal.aborted) {
        status = 'stopped';
        this.append(run, ROOM_ID, ROOM_LABEL, 'error', STOP_TEXT);
      }
      await run.flushed();
    } catch {
      status = 'failed';
    } finally {
      this.current = null;
      this.emit({ type: 'finished', roomId: run.id, status });
    }
    return { roomId: run.id, historyPath: run.historyPath, status, entries: [...run.entries] };
  }

  private async relay(run: RunState): Promise<void> {
    for (const participant of relaySchedule(run.config.participants, run.config.rounds)) {
      if (run.signal.aborted) return;
      await this.step(run, participant, [...run.entries], false);
    }
  }

  private async broadcast(run: RunState): Promise<void> {
    for (let round = 0; round < run.config.rounds; round += 1) {
      if (run.signal.aborted) return;
      const seen = [...run.entries];
      await Promise.all(run.config.participants.map((participant) => this.step(run, participant, seen, round > 0)));
    }
  }

  private append(run: RunState, authorId: string, label: string, kind: RoomEntryKind, text: string): void {
    const limit = Math.min(MAX_REPLY_CHARS, Math.max(0, (this.deps.maxHistoryChars ?? MAX_HISTORY_CHARS) - run.chars));
    const entry: RoomEntry = { authorId, label, time: this.now(), kind, text: truncateText(text, limit) };
    run.add(entry);
    this.emit({ type: 'entry', roomId: run.id, entry });
  }

  private progress(run: RunState, participant: RoomParticipant, state: StepState): void {
    if (state !== 'running') run.completed += 1;
    this.emit({ type: 'progress', roomId: run.id, participantId: participant.id, state, completed: run.completed, total: run.total });
  }

  private driver(participant: RoomParticipant): Promise<ParticipantDriver> {
    let driver = this.drivers.get(participant.id);
    if (driver === undefined) {
      driver = this.deps.driverFor(participant);
      this.drivers.set(participant.id, driver);
      driver.catch(() => this.drivers.delete(participant.id));
    }
    return driver;
  }

  private async step(run: RunState, participant: RoomParticipant, seen: readonly RoomEntry[], continuation: boolean): Promise<void> {
    this.progress(run, participant, 'running');
    const outcome = await this.turn(run, participant, seen, continuation);
    if (outcome.kind === 'aborted') return;
    const kind: RoomEntryKind = outcome.kind === 'reply' ? 'reply' : 'error';
    this.append(run, participant.id, participant.label, kind, outcome.text);
    await run.flushed();
    this.progress(run, participant, outcome.kind === 'reply' ? 'replied' : 'failed');
  }

  private async turn(
    run: RunState,
    participant: RoomParticipant,
    seen: readonly RoomEntry[],
    continuation: boolean,
  ): Promise<TurnOutcome> {
    let driver: ParticipantDriver | null = null;
    try {
      driver = await this.driver(participant);
      const prompt = buildParticipantPrompt(participant, run.id, seen, continuation);
      const request: TurnRequest = {
        text: prompt.text,
        attachPath: prompt.attachHistory ? run.historyPath : null,
        historyText: prompt.placeHistory ? run.render(seen) : null,
        timeoutMs: run.config.turnTimeoutMs,
        signal: run.signal,
      };
      for (;;) {
        const first = driver.turn(request);
        first.catch(() => undefined);
        try {
          const result = await Promise.race([first, abortion(run.signal)]);
          if (result === 'aborted') {
            await driver.reset().catch(() => undefined);
            return { kind: 'aborted' };
          }
          return result === null ? { kind: 'error', text: NO_REPLY_TEXT } : { kind: 'reply', text: result };
        } catch (error) {
          if (!(error instanceof OwnerPause) || run.signal.aborted) throw error;
          if (!(await this.waitForOwner(run, participant, error))) {
            await driver.reset().catch(() => undefined);
            return { kind: 'aborted' };
          }
          await driver.reset().catch(() => undefined);
        }
      }
    } catch (error) {
      await driver?.reset().catch(() => undefined);
      return run.signal.aborted ? { kind: 'aborted' } : { kind: 'error', text: errorText(error) };
    }
  }

  private async waitForOwner(run: RunState, participant: RoomParticipant, pause: OwnerPause): Promise<boolean> {
    this.emit({ type: 'paused', roomId: run.id, participantId: participant.id, sessionId: pause.sessionId, note: pause.note });
    const released = new Promise<'resumed'>((resolve) => {
      const release = (): void => {
        run.waiting.delete(release);
        resolve('resumed');
      };
      run.waiting.add(release);
    });
    const outcome = await Promise.race([released, abortion(run.signal)]);
    this.emit({ type: 'resumed', roomId: run.id, participantId: participant.id });
    return outcome === 'resumed';
  }
}

type TurnOutcome = { kind: 'reply'; text: string } | { kind: 'error'; text: string } | { kind: 'aborted' };
