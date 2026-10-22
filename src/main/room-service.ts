// room-service.ts
import path from 'node:path';
import { Room, type DriverFactory, type RoomContinuation } from './room';
import type { OutputSnapshot } from '../shared/output-buffer';
import { listRecords, readRecord, stopInterrupted } from './room-archive';
import { isRoomId, type RoomConfig, type RoomEvent, type RoomListItem } from '../shared/room-model';
import type { RoomTerminals } from './room-drivers';
import {
  applyRoomEvent,
  carryText,
  emptyRoomSnapshot,
  finalText,
  formFromRecord,
  snapshotFromRecord,
  type CarryWhat,
  type RoomOpenResult,
  type RoomSnapshot,
  type RoomStartResult,
} from '../shared/room-view';

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

  async init(): Promise<void> {
    await stopInterrupted(this.deps.roomsDir).catch(() => []);
    const listed = await this.list();
    const latest = listed.find((item) => !item.unreadable);
    if (latest !== undefined) await this.open(latest.id).catch(() => undefined);
  }

  async list(): Promise<RoomListItem[]> {
    try {
      return await listRecords(this.deps.roomsDir);
    } catch {
      return [];
    }
  }

  async open(id: string): Promise<RoomOpenResult> {
    if (this.room.isRunning()) return { ok: false, error: 'a room run is in progress' };
    if (!isRoomId(id)) return { ok: false, error: 'invalid room id' };
    const record = await readRecord(this.deps.roomsDir, id);
    if (record === null) return { ok: false, error: 'the room cannot be read' };
    if (this.room.isRunning()) return { ok: false, error: 'a room run is in progress' };
    this.snapshot = snapshotFromRecord(record, this.historyPath(id));
    return { ok: true, snapshot: this.snapshot, form: formFromRecord(record) };
  }

  newRoom(): boolean {
    if (this.room.isRunning()) return false;
    this.snapshot = emptyRoomSnapshot();
    return true;
  }

  async start(config: RoomConfig, continueId?: string): Promise<RoomStartResult> {
    try {
      const from = continueId === undefined ? undefined : await this.continuation(continueId);
      const run = this.room.start(config, from);
      void run.done.catch(() => undefined);
      const debugDir = config.debugSites && this.deps.debugRoot !== undefined ? path.join(this.deps.debugRoot, run.roomId) : null;
      return { ok: true, roomId: run.roomId, historyPath: run.historyPath, debugDir };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private historyPath(id: string): string {
    return path.join(this.deps.roomsDir, `${id}.md`);
  }

  private async continuation(id: string): Promise<RoomContinuation> {
    if (this.snapshot.roomId !== id) throw new Error('only the opened room can be continued');
    const record = await readRecord(this.deps.roomsDir, id);
    if (record === null) throw new Error('the room cannot be read');
    return { roomId: id, entries: record.entries, nonce: record.nonce, createdAt: record.createdAt };
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
