// room-service.ts
import path from 'node:path';
import { Room, type DriverFactory } from './room';
import type { OutputSnapshot } from '../shared/output-buffer';
import type { RoomConfig, RoomEvent } from '../shared/room-model';
import type { RoomTerminals } from './room-drivers';
import { applyRoomEvent, carryText, emptyRoomSnapshot, finalText, type CarryWhat, type RoomSnapshot, type RoomStartResult } from '../shared/room-view';

export interface RoomServiceDeps {
  roomsDir: string;
  debugRoot?: string;
  driverFor: DriverFactory;
  emit(event: RoomEvent): void;
  terminal: RoomTerminals;
  paste(agentId: string, text: string): boolean;
  copy(text: string): void;
  now?(): number;
  newId?(): string;
}

export class RoomService {
  private snapshot: RoomSnapshot = emptyRoomSnapshot();
  private readonly room: Room;

  constructor(private readonly deps: RoomServiceDeps) {
    this.room = new Room({
      roomsDir: deps.roomsDir,
      driverFor: deps.driverFor,
      now: deps.now,
      newId: deps.newId,
      emit: (event) => {
        this.snapshot = applyRoomEvent(this.snapshot, event);
        deps.emit(event);
      },
    });
  }

  state(): RoomSnapshot {
    return this.snapshot;
  }

  start(config: RoomConfig): RoomStartResult {
    try {
      const run = this.room.start(config);
      void run.done.catch(() => undefined);
      const debugDir = config.debugSites && this.deps.debugRoot !== undefined ? path.join(this.deps.debugRoot, run.roomId) : null;
      return { ok: true, roomId: run.roomId, historyPath: run.historyPath, debugDir };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    this.room.stop();
  }

  resume(): void {
    this.room.resume();
  }

  terminalBacklog(sessionId: string): OutputSnapshot {
    return this.isPaused(sessionId) ? this.deps.terminal.backlog(sessionId) : { data: '', end: 0 };
  }

  terminalWrite(sessionId: string, data: string): boolean {
    return this.isPaused(sessionId) && this.deps.terminal.write(sessionId, data);
  }

  terminalResize(sessionId: string, cols: number, rows: number): boolean {
    return this.isPaused(sessionId) && this.deps.terminal.resize(sessionId, cols, rows);
  }

  private isPaused(sessionId: string): boolean {
    return this.snapshot.paused.some((item) => item.sessionId === sessionId);
  }

  carry(agentId: string, what: CarryWhat): boolean {
    const text = carryText(this.snapshot, what);
    return text === null ? false : this.deps.paste(agentId, text);
  }

  copyFinal(): boolean {
    const text = finalText(this.snapshot);
    if (text === null) return false;
    this.deps.copy(text);
    return true;
  }

  shutdown(): Promise<void> {
    return this.room.shutdown();
  }
}
