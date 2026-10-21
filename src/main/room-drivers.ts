// room-drivers.ts
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isCliKind, type CliKind } from '../shared/agents';
import { buildRoomSpawn } from '../shared/cli-args';
import { rolloutId } from '../shared/codex-claim';
import type { RoomParticipant } from '../shared/room-model';
import { OutputBuffer, type OutputSnapshot } from '../shared/output-buffer';
import { startScreenIssue } from '../shared/start-screen';
import { claudeTranscriptPath } from './claude-transcripts';
import { runCliTurn, CliTurnError } from './cli-turn';
import { codexRolloutLocator } from './codex-rollouts';
import { PtyManager } from './pty-manager';
import { OwnerPause, type DriverFactory, type ParticipantDriver, type TurnRequest } from './room';
import type { PageRunner, SiteAdapter } from './site-adapters/types';
import { DEFAULT_TURN_OPTIONS, runAdapterTurn } from './site-adapters/turn';

export interface RoomTiming {
  quietMs: number;
  startMaxMs: number;
  pollMs: number;
  settleMs: number;
  submitDelayMs: number;
  killWaitMs: number;
}

export const DEFAULT_ROOM_TIMING: RoomTiming = {
  quietMs: 2000,
  startMaxMs: 30000,
  pollMs: 250,
  settleMs: 1500,
  submitDelayMs: 150,
  killWaitMs: 5000,
};

export interface SiteSeat {
  adapter: SiteAdapter;
  runner: PageRunner;
}

export interface RoomDriverDeps {
  cwd: string;
  sharedDir: string;
  platform: string;
  envFor(participant: RoomParticipant): Readonly<Record<string, string | undefined>>;
  siteFor(participant: RoomParticipant): SiteSeat | null;
  onOutput?(sessionId: string, data: string, end: number): void;
  timing?: Partial<RoomTiming>;
}

const TRUST_NOTE = 'accept the folder once in the terminal below, then press Resume';

class FolderNames {
  private readonly names = new Map<string, string>();
  private readonly counts = new Map<string, number>();

  of(participant: RoomParticipant): string {
    const known = this.names.get(participant.id);
    if (known !== undefined) return known;
    const next = (this.counts.get(participant.kind) ?? 0) + 1;
    this.counts.set(participant.kind, next);
    const name = `${participant.kind}-${next}`;
    this.names.set(participant.id, name);
    return name;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const START_SCREEN_LIMIT = 32768;

class SessionHost {
  private readonly lastData = new Map<string, number>();
  private readonly startScreens = new Map<string, string>();
  private readonly buffers = new Map<string, OutputBuffer>();
  private readonly pty: PtyManager;

  constructor(onOutput: RoomDriverDeps['onOutput']) {
    this.pty = new PtyManager({
      onData: (id, data) => {
        this.lastData.set(id, Date.now());
        const seen = this.startScreens.get(id) ?? '';
        if (seen.length < START_SCREEN_LIMIT) this.startScreens.set(id, seen + data);
        const end = this.bufferOf(id).append(data);
        onOutput?.(id, data, end);
      },
      onExit: (id) => {
        this.lastData.delete(id);
      },
    });
  }

  private bufferOf(id: string): OutputBuffer {
    let buffer = this.buffers.get(id);
    if (buffer === undefined) {
      buffer = new OutputBuffer();
      this.buffers.set(id, buffer);
    }
    return buffer;
  }

  backlog(id: string): OutputSnapshot {
    return this.bufferOf(id).snapshot();
  }

  forget(id: string): void {
    this.buffers.delete(id);
  }

  resize(id: string, cols: number, rows: number): boolean {
    return this.pty.resize(id, { cols, rows });
  }

  startScreen(id: string): string {
    return this.startScreens.get(id) ?? '';
  }

  spawn(id: string, spec: Parameters<PtyManager['spawn']>[1]): void {
    this.startScreens.delete(id);
    this.pty.spawn(id, spec, { cols: 120, rows: 40 });
  }

  has(id: string): boolean {
    return this.pty.has(id);
  }

  write(id: string, data: string): boolean {
    return this.pty.write(id, data);
  }

  kill(id: string): void {
    this.pty.kill(id);
  }

  killAll(): void {
    this.pty.killAll();
  }

  quietFor(id: string): number | null {
    const last = this.lastData.get(id);
    return last === undefined ? null : Date.now() - last;
  }
}

class CliDriver implements ParticipantDriver {
  private ptyId: string | null = null;
  private locate: (() => Promise<string | null>) | null = null;
  private counter = 0;

  constructor(
    private readonly participant: RoomParticipant,
    private readonly kind: CliKind,
    private readonly host: SessionHost,
    private readonly deps: RoomDriverDeps,
    private readonly timing: RoomTiming,
    private readonly claimed: Set<string>,
    private readonly folder: string,
  ) {}

  async turn(request: TurnRequest): Promise<string | null> {
    const ptyId = await this.session(request.signal);
    const locate = this.locate;
    if (locate === null) throw new CliTurnError('unavailable', 'the session is not running');
    return runCliTurn({
      kind: this.kind,
      prompt: request.text,
      write: (data) => this.host.write(ptyId, data),
      locate,
      timeoutMs: request.timeoutMs,
      pollMs: this.timing.pollMs,
      settleMs: this.timing.settleMs,
      submitDelayMs: this.timing.submitDelayMs,
      signal: request.signal,
    });
  }

  async reset(): Promise<void> {
    const ptyId = this.ptyId;
    this.ptyId = null;
    this.locate = null;
    if (ptyId === null) return;
    this.host.kill(ptyId);
    const deadline = Date.now() + this.timing.killWaitMs;
    while (this.host.has(ptyId) && Date.now() < deadline) await sleep(20);
    this.host.forget(ptyId);
  }

  dispose(): void {
    if (this.ptyId !== null) this.host.kill(this.ptyId);
    this.ptyId = null;
  }

  private async session(signal: AbortSignal): Promise<string> {
    if (this.ptyId !== null && this.host.has(this.ptyId)) return this.ptyId;
    await this.reset();
    const env = this.deps.envFor(this.participant);
    this.counter += 1;
    const ptyId = `room-${this.participant.id}-${this.counter}`;
    const sessionId = randomUUID();
    const cwd = path.join(this.deps.cwd, this.folder);
    await mkdir(cwd, { recursive: true });
    const spawnedAtMs = Date.now();
    const spec = buildRoomSpawn(this.kind, {
      cwd,
      sessionId: this.kind === 'claude' ? sessionId : undefined,
      sharedDir: this.deps.sharedDir,
      resume: false,
      platform: this.deps.platform,
      env,
    });
    this.host.spawn(ptyId, spec);
    this.ptyId = ptyId;
    this.locate =
      this.kind === 'claude'
        ? async () => claudeTranscriptPath(env, sessionId)
        : this.claiming(codexRolloutLocator(env, { cwd, spawnedAtMs, claimed: this.claimed }));
    await this.untilReady(ptyId, signal);
    const issue = startScreenIssue(this.host.startScreen(ptyId));
    if (issue?.kind === 'trust') throw new OwnerPause(ptyId, `${this.participant.label}: ${TRUST_NOTE}`);
    if (issue !== null) {
      await this.reset();
      throw new CliTurnError('unavailable', `${this.participant.label} did not reach its prompt: ${issue.reason}`);
    }
    return ptyId;
  }

  private claiming(locate: () => Promise<string | null>): () => Promise<string | null> {
    return async () => {
      const file = await locate();
      const id = file === null ? null : rolloutId(path.basename(file));
      if (id !== null) this.claimed.add(id);
      return file;
    };
  }

  private async untilReady(ptyId: string, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.timing.startMaxMs;
    for (;;) {
      if (signal.aborted) throw new CliTurnError('aborted', 'the turn was stopped');
      if (!this.host.has(ptyId)) throw new CliTurnError('unavailable', 'the session ended while starting');
      const quiet = this.host.quietFor(ptyId);
      if (quiet !== null && quiet >= this.timing.quietMs) return;
      if (Date.now() >= deadline) {
        if (quiet === null) throw new CliTurnError('unavailable', 'the session printed nothing while starting');
        return;
      }
      await sleep(Math.min(50, this.timing.quietMs));
    }
  }
}

class SiteDriver implements ParticipantDriver {
  constructor(private readonly seat: SiteSeat) {}

  async turn(request: TurnRequest): Promise<string | null> {
    if (request.attachPath !== null) await this.seat.adapter.attachFile(this.seat.runner, request.attachPath);
    return runAdapterTurn(this.seat.adapter, this.seat.runner, request.text, {
      ...DEFAULT_TURN_OPTIONS,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    });
  }

  async reset(): Promise<void> {
    return undefined;
  }

  dispose(): void {
    return undefined;
  }
}

export interface RoomTerminals {
  backlog(sessionId: string): OutputSnapshot;
  write(sessionId: string, data: string): boolean;
  resize(sessionId: string, cols: number, rows: number): boolean;
}

export interface RoomDrivers {
  factory: DriverFactory;
  terminal: RoomTerminals;
  shutdown(): void;
}

export function createRoomDrivers(deps: RoomDriverDeps): RoomDrivers {
  const timing: RoomTiming = { ...DEFAULT_ROOM_TIMING, ...deps.timing };
  const host = new SessionHost(deps.onOutput);
  const claimed = new Set<string>();
  const folders = new FolderNames();
  const factory: DriverFactory = async (participant) => {
    if (isCliKind(participant.kind)) return new CliDriver(participant, participant.kind, host, deps, timing, claimed, folders.of(participant));
    const seat = deps.siteFor(participant);
    if (seat === null) throw new Error(`${participant.label} has no open chat page`);
    return new SiteDriver(seat);
  };
  const terminal: RoomTerminals = {
    backlog: (id) => host.backlog(id),
    write: (id, data) => host.write(id, data),
    resize: (id, cols, rows) => host.resize(id, cols, rows),
  };
  return { factory, terminal, shutdown: () => host.killAll() };
}
