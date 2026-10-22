// room-drivers.ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isCliKind, type CliKind } from '../shared/agents';
import { buildRoomTurnSpawn } from '../shared/cli-args';
import { PARTICIPANT_HISTORY_FILE, stripEntryMarkerLines } from '../shared/room-history';
import type { RoomParticipant } from '../shared/room-model';
import type { OutputSnapshot } from '../shared/output-buffer';
import { runCliTurn } from './cli-turn';
import type { DriverFactory, ParticipantDriver, TurnRequest } from './room';
import type { SiteLogger } from './site-log-file';
import { SiteAdapterError, type PageRunner, type SiteAdapter } from './site-adapters/types';
import { waitUntilReady } from './site-adapters/ready';
import { DEFAULT_TURN_OPTIONS, runAdapterTurn } from './site-adapters/turn';

export interface RoomTiming {
  killGraceMs: number;
  pollMs: number;
  settleMs: number;
  readyMs: number;
  readyPollMs: number;
}

export const DEFAULT_ROOM_TIMING: RoomTiming = {
  killGraceMs: 3000,
  pollMs: DEFAULT_TURN_OPTIONS.pollMs,
  settleMs: DEFAULT_TURN_OPTIONS.settleMs,
  readyMs: 30000,
  readyPollMs: 250,
};

export interface SiteSeat {
  adapter: SiteAdapter;
  runner: PageRunner;
  prepare?(timeoutMs: number, signal: AbortSignal): Promise<void>;
  newChat?(timeoutMs: number, signal: AbortSignal): Promise<void>;
}

export interface RoomDriverDeps {
  cwd: string;
  sharedDir: string;
  platform: string;
  loginShell?: boolean;
  envFor(participant: RoomParticipant): Readonly<Record<string, string | undefined>>;
  siteFor(participant: RoomParticipant): SiteSeat | null;
  timing?: Partial<RoomTiming>;
  siteLog?: SiteLogger;
}

function withoutMarkers(reply: string | null): string | null {
  if (reply === null) return null;
  const shown = stripEntryMarkerLines(reply).trim();
  return shown === '' ? null : shown;
}

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

interface CliSession {
  id: string | null;
  started: boolean;
}

class CliDriver implements ParticipantDriver {
  private session: CliSession | null = null;

  constructor(
    private readonly participant: RoomParticipant,
    private readonly kind: CliKind,
    private readonly deps: RoomDriverDeps,
    private readonly timing: RoomTiming,
    private readonly running: Set<AbortController>,
    private readonly folder: string,
  ) {}

  async turn(request: TurnRequest): Promise<string | null> {
    const cwd = path.join(this.deps.cwd, this.folder);
    await mkdir(cwd, { recursive: true });
    if (request.historyText !== null) await writeFile(path.join(cwd, PARTICIPANT_HISTORY_FILE), request.historyText, 'utf8');
    const session = this.session ?? { id: this.kind === 'claude' ? randomUUID() : null, started: false };
    const own = new AbortController();
    this.running.add(own);
    try {
      const spec = buildRoomTurnSpawn(this.kind, {
        cwd,
        sessionId: session.id ?? undefined,
        sharedDir: this.deps.sharedDir,
        resume: session.started,
        platform: this.deps.platform,
        loginShell: this.deps.loginShell,
        env: this.deps.envFor(this.participant),
      });
      const result = await runCliTurn({
        kind: this.kind,
        spec,
        prompt: request.text,
        timeoutMs: request.timeoutMs,
        killGraceMs: this.timing.killGraceMs,
        signal: AbortSignal.any([request.signal, own.signal]),
      });
      const id = session.id ?? result.sessionId;
      this.session = id === null ? null : { id, started: true };
      return withoutMarkers(result.reply);
    } catch (error) {
      this.session = null;
      throw error;
    } finally {
      this.running.delete(own);
    }
  }

  async reset(): Promise<void> {
    this.session = null;
  }

  dispose(): void {
    this.session = null;
  }
}

class SiteDriver implements ParticipantDriver {
  private chatRunId: string | null = null;

  constructor(
    private readonly seat: SiteSeat,
    private readonly timing: RoomTiming,
    private readonly log: SiteLogger,
  ) {}

  private async ready(request: TurnRequest): Promise<void> {
    try {
      if (this.chatRunId !== request.runId) {
        await this.seat.newChat?.(this.timing.readyMs, request.signal);
        this.chatRunId = request.runId;
      }
      await this.seat.prepare?.(this.timing.readyMs, request.signal);
      await waitUntilReady(this.seat.adapter, this.seat.runner, {
        timeoutMs: this.timing.readyMs,
        pollMs: this.timing.readyPollMs,
        signal: request.signal,
      });
    } catch (error) {
      const code = error instanceof SiteAdapterError ? error.code : 'error';
      this.log(this.seat.adapter.site, 'turn', { outcome: 'failed', phase: 'ready', code });
      throw error;
    }
  }

  async turn(request: TurnRequest): Promise<string | null> {
    await this.ready(request);
    if (request.attachPath !== null) await this.seat.adapter.attachFile(this.seat.runner, request.attachPath);
    const reply = await runAdapterTurn(this.seat.adapter, this.seat.runner, request.text, {
      ...DEFAULT_TURN_OPTIONS,
      pollMs: this.timing.pollMs,
      settleMs: this.timing.settleMs,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      trace: (fields) => this.log(this.seat.adapter.site, 'turn', fields),
      diagnose: (fields) => this.log(this.seat.adapter.site, 'turn-lines', fields),
    });
    return withoutMarkers(reply);
  }

  async reset(): Promise<void> {
    return undefined;
  }

  dispose(): void {
    return undefined;
  }
}

const NO_TERMINAL: RoomTerminals = {
  backlog: () => ({ data: '', end: 0 }),
  write: () => false,
  resize: () => false,
};

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
  const running = new Set<AbortController>();
  const folders = new FolderNames();
  const factory: DriverFactory = async (participant) => {
    if (isCliKind(participant.kind)) return new CliDriver(participant, participant.kind, deps, timing, running, folders.of(participant));
    const seat = deps.siteFor(participant);
    if (seat === null) throw new Error(`${participant.label} has no open chat page`);
    return new SiteDriver(seat, timing, deps.siteLog ?? (() => undefined));
  };
  return {
    factory,
    terminal: NO_TERMINAL,
    shutdown: () => {
      for (const turn of running) turn.abort();
    },
  };
}
