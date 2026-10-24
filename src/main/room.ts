// room.ts
import { randomBytes } from 'node:crypto';
import { access, appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { roomPackPath, writeRecord } from './room-archive';
import type { RoomCwd, RoomRunContext } from './room-context';
import {
  buildParticipantPrompt,
  newNonce,
  renderEntryBlock,
  renderHistory,
  renderHistoryHeader,
  type PromptPhase,
} from '../shared/room-history';
import {
  MAX_ERROR_CHARS,
  MAX_HISTORY_CHARS,
  MAX_REPLY_CHARS,
  entriesBeforeRound,
  relaySchedule,
  roomPlan,
  roomTitle,
  OWNER_ID,
  ROOM_ID,
  truncateText,
  type DoneTurn,
  type RoomConfig,
  type RoomEntry,
  type RoomEntryKind,
  type RoomEntryState,
  type RoomEvent,
  type RoomParticipant,
  type RoomRecord,
  type RoomRecordStatus,
  type RoomStatus,
  type StepState,
} from '../shared/room-model';

export type { RoomEvent, RoomStatus, StepState } from '../shared/room-model';

export interface TurnRequest {
  runId: string;
  text: string;
  attachPath: string | null;
  historyText: string | null;
  roomName: string;
  timeoutMs: number;
  signal: AbortSignal;
  debugSites: boolean;
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

export type DriverFactory = (participant: RoomParticipant, runId: string, cwd: RoomCwd, projectId?: string | null) => Promise<ParticipantDriver>;

export interface RoomDeps {
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

export interface RoomContinuation {
  roomId: string;
  entries: RoomEntry[];
  nonce: string;
  createdAt: number;
  title?: string;
  done?: readonly DoneTurn[];
}

export interface RoomRun {
  roomId: string;
  historyPath: string;
  done: Promise<RoomRunResult>;
}

const OWNER_LABEL = 'Owner';
const ROOM_LABEL = 'Room';
const STOP_TEXT = 'Stopped by the owner.';
const FALLBACK_FINALIZER: RoomParticipant = { id: ROOM_ID, kind: 'claude', label: ROOM_LABEL };
const NO_REPLY_TEXT = 'The participant ended its turn without a reply.';

function defaultRoomId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return `room-${stamp}-${randomBytes(3).toString('hex')}`;
}

const NO_ERROR_TEXT = 'The turn failed without an error message.';

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateText(message.trim() === '' ? NO_ERROR_TEXT : message, MAX_ERROR_CHARS);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'timeout';
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

function fallbackFinalizers(run: RunState, lastRound: readonly RoomEntry[]): RoomParticipant[] {
  const answered = new Set(lastRound.filter((entry) => entry.kind === 'reply').map((entry) => entry.authorId));
  const candidates = run.config.participants.filter((participant) => participant.id !== run.finalizer.id && answered.has(participant.id));
  return [...candidates.filter((participant) => participant.kind === 'claude'), ...candidates.filter((participant) => participant.kind !== 'claude')];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

type HistoryState = 'create' | 'reopen' | 'append';

class RunState {
  readonly entries: RoomEntry[];
  readonly previous: RoomEntry[] | undefined;
  readonly resumed: readonly DoneTurn[] | undefined;
  readonly controller = new AbortController();
  completed = 0;
  chars: number;
  total: number;
  readonly waiting = new Set<() => void>();
  readonly drivers = new Map<string, Promise<ParticipantDriver>>();
  private readonly packCounts = new Map<string, number>();
  readonly finalizer: RoomParticipant;
  private readonly nonce: string;
  private readonly createdAt: number;
  private historyState: HistoryState;
  title: string | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly historyPath: string,
    readonly ctx: RoomRunContext,
    readonly config: RoomConfig,
    total: number,
    random: (() => string) | undefined,
    private readonly now: () => number,
    from: RoomContinuation | undefined,
  ) {
    this.total = total;
    this.finalizer = config.participants.find((participant) => participant.id === config.finalizerId) ?? config.participants[0] ?? FALLBACK_FINALIZER;
    this.entries = from === undefined ? [] : [...from.entries];
    this.previous = from === undefined ? undefined : [...from.entries];
    this.resumed = from?.done;
    this.chars = this.entries.reduce((sum, entry) => sum + entry.text.length, 0);
    this.nonce = from?.nonce ?? newNonce(random);
    this.createdAt = from?.createdAt ?? now();
    this.title = from?.title;
    this.historyState = from === undefined ? 'create' : 'reopen';
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  nextPackPath(participant: RoomParticipant): string {
    const count = (this.packCounts.get(participant.id) ?? 0) + 1;
    this.packCounts.set(participant.id, count);
    return roomPackPath(this.ctx.roomsDir, this.id, participant.id, count);
  }

  isDone(participant: RoomParticipant, round: number): boolean {
    return this.resumed?.some((turn) => turn.authorId === participant.id && turn.round === round) === true;
  }

  add(entry: RoomEntry): void {
    this.entries.push(entry);
    this.chars += entry.text.length;
    const block = renderEntryBlock(this.nonce, entry);
    const whole = this.historyState === 'append' ? '' : this.render(this.entries);
    const state = this.historyState;
    this.historyState = 'append';
    this.enqueue(async () => {
      if (state === 'create' || (state === 'reopen' && !(await exists(this.historyPath)))) await writeAtomic(this.historyPath, whole);
      else await appendFile(this.historyPath, block, 'utf8');
    });
    const record = this.recordOf('running');
    this.enqueue(() => writeRecord(this.ctx.roomsDir, record));
  }

  rewrite(): void {
    const whole = this.render(this.entries);
    this.historyState = 'append';
    this.enqueue(() => writeAtomic(this.historyPath, whole));
    const record = this.recordOf('running');
    this.enqueue(() => writeRecord(this.ctx.roomsDir, record));
  }

  render(entries: readonly RoomEntry[]): string {
    return renderHistoryHeader(this.id, this.nonce, this.finalizer.label) + entries.map((entry) => renderEntryBlock(this.nonce, entry)).join('');
  }

  flushed(): Promise<void> {
    return this.writing;
  }

  async finish(status: RoomRecordStatus): Promise<void> {
    await this.writing.catch(() => undefined);
    await writeRecord(this.ctx.roomsDir, this.recordOf(status)).catch(() => undefined);
  }

  private recordOf(status: RoomRecordStatus): RoomRecord {
    const { mode, rounds, participants, finalizerId, turnTimeoutMs, debugSites } = this.config;
    return {
      version: 1,
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.now(),
      status,
      config: { mode, rounds, participants, finalizerId, turnTimeoutMs, debugSites },
      entries: [...this.entries],
      nonce: this.nonce,
      ...(this.title === undefined ? {} : { title: this.title }),
    };
  }

  private enqueue(write: () => Promise<void>): void {
    this.writing = this.writing.then(write);
    this.writing.catch(() => undefined);
  }
}

export class Room {
  private current: RunState | null = null;

  constructor(private readonly deps: RoomDeps) {}

  isRunning(): boolean {
    return this.current !== null;
  }

  runningName(): string | null {
    return this.current === null ? null : roomTitle({ entries: this.current.entries, title: this.current.title });
  }

  start(config: RoomConfig, from: RoomContinuation | undefined, ctx: RoomRunContext): RoomRun {
    if (this.current !== null) throw new Error('a room run is already in progress');
    const now = this.now();
    const roomId = from?.roomId ?? this.deps.newId?.() ?? defaultRoomId(now);
    const historyPath = path.join(ctx.roomsDir, `${roomId}.md`);
    const turns = config.mode === 'relay' ? relaySchedule(config.participants, config.rounds).length : config.participants.length * config.rounds;
    const total = turns + 1;
    const run = new RunState(roomId, historyPath, ctx, config, total, this.deps.newNonce, () => this.now(), from);
    this.current = run;
    return { roomId, historyPath, done: this.execute(run) };
  }

  retitle(id: string, title: string): boolean {
    if (this.current === null || this.current.id !== id) return false;
    this.current.title = title;
    return true;
  }

  stop(): void {
    this.current?.controller.abort();
  }

  resume(): void {
    for (const release of [...(this.current?.waiting ?? [])]) release();
  }

  async shutdown(): Promise<void> {
    this.stop();
    if (this.current !== null) await this.disposeDrivers(this.current);
  }

  private async disposeDrivers(run: RunState): Promise<void> {
    const drivers = [...run.drivers.values()];
    run.drivers.clear();
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
      this.emit({
        type: 'started',
        roomId: run.id,
        historyPath: run.historyPath,
        total: run.total,
        plan: roomPlan(run.config),
        ...(run.previous === undefined ? {} : { previous: run.previous }),
      });
      if (run.resumed === undefined) this.append(run, OWNER_ID, OWNER_LABEL, 'prompt', run.config.prompt);
      else {
        run.rewrite();
        this.replayDone(run, run.resumed);
      }
      await run.flushed();
      if (run.config.mode === 'relay') await this.relay(run);
      else await this.broadcast(run);
      if (!run.signal.aborted) await this.finalize(run);
      if (run.signal.aborted) {
        status = 'stopped';
        this.append(run, ROOM_ID, ROOM_LABEL, 'error', STOP_TEXT, { state: 'stopped' });
      }
      await run.flushed();
    } catch {
      status = 'failed';
    } finally {
      await this.disposeDrivers(run).catch(() => undefined);
      await run.finish(status);
      this.current = null;
      this.emit({ type: 'finished', roomId: run.id, status });
    }
    return { roomId: run.id, historyPath: run.historyPath, status, entries: [...run.entries] };
  }

  private async finalize(run: RunState): Promise<void> {
    const lastRound = run.entries
      .filter((entry) => entry.authorId !== OWNER_ID && entry.authorId !== ROOM_ID)
      .slice(-run.config.participants.length);
    if (await this.step(run, run.finalizer, [...run.entries], 'final')) return;
    for (const candidate of fallbackFinalizers(run, lastRound)) {
      if (run.signal.aborted) return;
      this.append(run, ROOM_ID, ROOM_LABEL, 'error', `Final by ${candidate.label} (finalizer ${run.finalizer.label} failed)`);
      run.total += 1;
      if (await this.step(run, candidate, [...run.entries], 'final')) return;
    }
  }

  private replayDone(run: RunState, done: readonly DoneTurn[]): void {
    for (const turn of done) {
      for (const participant of run.config.participants.filter((item) => item.id === turn.authorId)) {
        this.progress(run, participant, 'running');
        this.progress(run, participant, turn.state);
      }
    }
  }

  private async relay(run: RunState): Promise<void> {
    const schedule = relaySchedule(run.config.participants, run.config.rounds);
    for (const [index, participant] of schedule.entries()) {
      if (run.signal.aborted) return;
      const round = Math.floor(index / run.config.participants.length) + 1;
      if (run.isDone(participant, round)) continue;
      await this.step(run, participant, [...run.entries], false, round);
    }
  }

  private async broadcast(run: RunState): Promise<void> {
    for (let index = 0; index < run.config.rounds; index += 1) {
      if (run.signal.aborted) return;
      const round = index + 1;
      const seen = entriesBeforeRound(run.entries, round);
      const missing = run.config.participants.filter((participant) => !run.isDone(participant, round));
      await Promise.all(missing.map((participant) => this.step(run, participant, seen, index > 0, round)));
    }
  }

  private append(run: RunState, authorId: string, label: string, kind: RoomEntryKind, text: string, mark: EntryMark = {}): void {
    const limit = Math.min(MAX_REPLY_CHARS, Math.max(0, (this.deps.maxHistoryChars ?? MAX_HISTORY_CHARS) - run.chars));
    const entry: RoomEntry = { authorId, label, time: this.now(), kind, text: truncateText(text, limit), ...mark };
    run.add(entry);
    this.emit({ type: 'entry', roomId: run.id, entry });
  }

  private progress(run: RunState, participant: RoomParticipant, state: StepState): void {
    if (state !== 'running') run.completed += 1;
    this.emit({ type: 'progress', roomId: run.id, participantId: participant.id, state, completed: run.completed, total: run.total });
  }

  private driver(run: RunState, participant: RoomParticipant): Promise<ParticipantDriver> {
    let driver = run.drivers.get(participant.id);
    if (driver === undefined) {
      driver = this.deps.driverFor(participant, run.id, run.ctx.cwdFor(participant), run.ctx.projectId);
      run.drivers.set(participant.id, driver);
      driver.catch(() => run.drivers.delete(participant.id));
    }
    return driver;
  }

  private async attachment(run: RunState, participant: RoomParticipant, seen: readonly RoomEntry[]): Promise<string> {
    const file = run.nextPackPath(participant);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, renderHistory(run.id, seen), 'utf8');
    return file;
  }

  private async step(run: RunState, participant: RoomParticipant, seen: readonly RoomEntry[], phase: PromptPhase, round?: number): Promise<boolean> {
    this.progress(run, participant, 'running');
    const outcome = await this.turn(run, participant, seen, phase);
    if (outcome.kind === 'aborted') return false;
    const kind: RoomEntryKind = outcome.kind === 'reply' ? (phase === 'final' ? 'final' : 'reply') : 'error';
    const mark: EntryMark = {};
    if (round !== undefined) mark.round = round;
    if (outcome.kind === 'error' && outcome.timedOut === true) mark.state = 'timeout';
    this.append(run, participant.id, participant.label, kind, outcome.text, mark);
    await run.flushed();
    this.progress(run, participant, outcome.kind === 'reply' ? 'replied' : outcome.timedOut === true ? 'timeout' : 'failed');
    return outcome.kind === 'reply';
  }

  private async turn(
    run: RunState,
    participant: RoomParticipant,
    seen: readonly RoomEntry[],
    phase: PromptPhase,
  ): Promise<TurnOutcome> {
    let driver: ParticipantDriver | null = null;
    try {
      driver = await this.driver(run, participant);
      const prompt = buildParticipantPrompt(participant, run.id, seen, phase);
      const request: TurnRequest = {
        runId: run.id,
        text: prompt.text,
        attachPath: prompt.attachHistory ? await this.attachment(run, participant, seen) : null,
        historyText: prompt.placeHistory ? run.render(seen) : null,
        roomName: run.title ?? run.id,
        timeoutMs: run.config.turnTimeoutMs,
        signal: run.signal,
        debugSites: run.config.debugSites,
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
      return run.signal.aborted ? { kind: 'aborted' } : { kind: 'error', text: errorText(error), timedOut: isTimeout(error) };
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

interface EntryMark {
  round?: number;
  state?: RoomEntryState;
}

type TurnOutcome = { kind: 'reply'; text: string } | { kind: 'error'; text: string; timedOut?: boolean } | { kind: 'aborted' };
