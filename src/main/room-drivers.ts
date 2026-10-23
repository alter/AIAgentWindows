// room-drivers.ts
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isCliKind, type CliKind } from '../shared/agents';
import { buildRoomTurnSpawn } from '../shared/cli-args';
import { PARTICIPANT_HISTORY_FILE, stripEntryMarkerLines } from '../shared/room-history';
import type { RoomParticipant } from '../shared/room-model';
import type { SiteLogValue } from '../shared/site-log';
import type { OutputSnapshot } from '../shared/output-buffer';
import { runCliTurn } from './cli-turn';
import type { ChatInput, ChatOptions } from './openrouter/chat';
import type { DriverFactory, ParticipantDriver, TurnRequest } from './room';
import type { SiteLogger } from './site-log-file';
import { SiteAdapterError, type NetWatch, type PageRunner, type SiteAdapter } from './site-adapters/types';
import { waitUntilReady } from './site-adapters/ready';
import { createTurnRecorder, type TurnRecorder } from './site-adapters/recorder';
import { createStreamTracker, tappedSink, type StreamTracker } from './site-adapters/stream-state';
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

export interface OpenRouterTurns {
  chat(input: ChatInput, options: ChatOptions): Promise<string | null>;
}

export interface RoomDriverDeps {
  cwd: string;
  sharedDir: string;
  platform: string;
  loginShell?: boolean;
  envFor(participant: RoomParticipant): Readonly<Record<string, string | undefined>>;
  siteFor(participant: RoomParticipant): SiteSeat | null;
  openrouter?: OpenRouterTurns;
  timing?: Partial<RoomTiming>;
  siteLog?: SiteLogger;
  debugRoot?: string;
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
        model: this.participant.model,
        effort: this.participant.effort,
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

class OpenRouterDriver implements ParticipantDriver {
  constructor(
    private readonly participant: RoomParticipant,
    private readonly turns: OpenRouterTurns | undefined,
    private readonly running: Set<AbortController>,
  ) {}

  async turn(request: TurnRequest): Promise<string | null> {
    if (this.turns === undefined) throw new Error('OpenRouter is not available');
    const own = new AbortController();
    this.running.add(own);
    try {
      const reply = await this.turns.chat(
        {
          model: this.participant.model ?? '',
          system: request.text,
          user: request.historyText ?? '',
          effort: this.participant.effort ?? null,
          web: this.participant.web === true,
        },
        { timeoutMs: request.timeoutMs, signal: AbortSignal.any([request.signal, own.signal]) },
      );
      return withoutMarkers(reply);
    } finally {
      this.running.delete(own);
    }
  }

  async reset(): Promise<void> {
    return undefined;
  }

  dispose(): void {
    return undefined;
  }
}

class SiteDriver implements ParticipantDriver {
  private chatRunId: string | null = null;

  constructor(
    private readonly seat: SiteSeat,
    private readonly timing: RoomTiming,
    private readonly log: SiteLogger,
    private readonly debugRoot: string | null,
  ) {}

  private async phase(rec: TurnRecorder | null, name: string, work: () => Promise<void>): Promise<void> {
    const begun = Date.now();
    try {
      await work();
    } finally {
      rec?.event('ready', { phase: name, ms: Date.now() - begun });
    }
  }

  private async ready(request: TurnRequest, rec: TurnRecorder | null): Promise<void> {
    try {
      if (this.chatRunId !== request.runId) {
        const { newChat } = this.seat;
        if (newChat !== undefined) await this.phase(rec, 'new-chat', () => newChat(this.timing.readyMs, request.signal));
        this.chatRunId = request.runId;
      }
      const { prepare } = this.seat;
      if (prepare !== undefined) await this.phase(rec, 'prepare', () => prepare(this.timing.readyMs, request.signal));
      await this.phase(rec, 'composer', () =>
        waitUntilReady(this.seat.adapter, this.seat.runner, {
          timeoutMs: this.timing.readyMs,
          pollMs: this.timing.readyPollMs,
          signal: request.signal,
        }),
      );
    } catch (error) {
      const code = error instanceof SiteAdapterError ? error.code : 'error';
      this.log(this.seat.adapter.site, 'turn', { outcome: 'failed', phase: 'ready', code });
      throw error;
    }
  }

  private open(request: TurnRequest, turn: string): TurnRecorder | null {
    if (!request.debugSites || this.debugRoot === null) return null;
    const { adapter } = this.seat;
    return createTurnRecorder({
      root: this.debugRoot,
      runId: request.runId,
      site: adapter.site,
      turn,
      prompt: request.text,
      timing: {
        pollMs: this.timing.pollMs,
        settleMs: this.timing.settleMs,
        startGraceMs: DEFAULT_TURN_OPTIONS.startGraceMs,
        timeoutMs: request.timeoutMs,
        ...adapter.settings?.(),
      },
      onFail: (code) => this.log(adapter.site, 'recorder-failed', { code }),
    });
  }

  private async watch(rec: TurnRecorder | null, stream: StreamTracker): Promise<NetWatch | null> {
    if (this.seat.runner.watchNetwork === undefined) return null;
    try {
      return await this.seat.runner.watchNetwork(tappedSink(stream, rec));
    } catch (error) {
      rec?.event('net-failed', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async unwatch(rec: TurnRecorder | null, watch: NetWatch | null): Promise<void> {
    try {
      await watch?.stop();
    } catch (error) {
      rec?.event('net-failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async close(rec: TurnRecorder, outcome: string, code: string, trace: Readonly<Record<string, SiteLogValue>>): Promise<void> {
    let dom: string | null = null;
    try {
      dom = (await this.seat.adapter.domDump?.(this.seat.runner)) ?? null;
    } catch (error) {
      rec.event('dom-failed', { code: error instanceof SiteAdapterError ? error.code : 'error' });
    }
    await rec.finish({ outcome, code, trace, dom });
  }

  async turn(request: TurnRequest): Promise<string | null> {
    const turn = randomBytes(3).toString('hex');
    const rec = this.open(request, turn);
    const stream = createStreamTracker();
    let watch: NetWatch | null = null;
    let outcome = 'failed';
    let code = 'error';
    let trace: Readonly<Record<string, SiteLogValue>> = {};
    try {
      await this.ready(request, rec);
      if (request.attachPath !== null) await this.seat.adapter.attachFile(this.seat.runner, request.attachPath);
      watch = await this.watch(rec, stream);
      const reply = await runAdapterTurn(this.seat.adapter, this.seat.runner, request.text, {
        ...DEFAULT_TURN_OPTIONS,
        pollMs: this.timing.pollMs,
        settleMs: this.timing.settleMs,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        turnId: turn,
        stream,
        tap: rec ?? undefined,
        trace: (fields) => {
          trace = fields;
          this.log(this.seat.adapter.site, 'turn', rec === null ? fields : { ...fields, debugDir: rec.dir });
        },
        diagnose: (fields) => this.log(this.seat.adapter.site, 'turn-lines', fields),
      });
      outcome = 'reply';
      code = '';
      return withoutMarkers(reply);
    } catch (error) {
      code = error instanceof SiteAdapterError ? error.code : 'error';
      throw error;
    } finally {
      await this.unwatch(rec, watch);
      if (rec !== null) await this.close(rec, outcome, code, trace);
    }
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
    if (participant.kind === 'openrouter') return new OpenRouterDriver(participant, deps.openrouter, running);
    const seat = deps.siteFor(participant);
    if (seat === null) throw new Error(`${participant.label} has no open chat page`);
    return new SiteDriver(seat, timing, deps.siteLog ?? (() => undefined), deps.debugRoot ?? null);
  };
  return {
    factory,
    terminal: NO_TERMINAL,
    shutdown: () => {
      for (const turn of running) turn.abort();
    },
  };
}
