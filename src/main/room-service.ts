// room-service.ts
import path from 'node:path';
import { Room, type DriverFactory, type RoomContinuation } from './room';
import type { RoomModels } from '../shared/cli-models';
import type { OutputSnapshot } from '../shared/output-buffer';
import { listRecords, readRecord, stopInterrupted, trashRoom, writeRecord, type TrashItem } from './room-archive';
import { dropSegmentStops, isRoomId, parseRoomTitle, resumeMatches, resumePoint, type RoomConfig, type RoomEvent, type RoomListItem } from '../shared/room-model';
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
  trash: TrashItem;
  driverFor: DriverFactory;
  emit(event: RoomEvent): void;
  terminal: RoomTerminals;
  paste(agentId: string, text: string): boolean;
  copy(text: string): void;
  models(): Promise<RoomModels>;
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

  async start(config: RoomConfig, continueId?: string, resume?: boolean): Promise<RoomStartResult> {
    try {
      const from = continueId === undefined ? undefined : await this.continuation(continueId, resume === true ? config : undefined);
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

  private async continuation(id: string, resumeWith?: RoomConfig): Promise<RoomContinuation> {
    if (this.snapshot.roomId !== id) throw new Error('only the opened room can be continued');
    const record = await readRecord(this.deps.roomsDir, id);
    if (record === null) throw new Error('the room cannot be read');
    const base = { roomId: id, entries: record.entries, nonce: record.nonce, createdAt: record.createdAt, ...(record.title === undefined ? {} : { title: record.title }) };
    if (resumeWith === undefined) return base;
    const point = resumePoint(record);
    if (point === null) throw new Error('there is nothing to resume in this room');
    if (!resumeMatches(point, record.config, resumeWith)) throw new Error('the prompt or the setup differs from the stopped run: continue with a new prompt instead');
    return { ...base, entries: dropSegmentStops(record.entries), done: point.done };
  }

  async rename(id: string, title: string): Promise<boolean> {
    const clean = parseRoomTitle(title);
    if (!isRoomId(id) || clean === null) return false;
    if (this.room.retitle(id, clean)) return true;
    const record = await readRecord(this.deps.roomsDir, id);
    if (record === null) return false;
    if (this.room.retitle(id, clean)) return true;
    try {
      await writeRecord(this.deps.roomsDir, { ...record, title: clean });
      return true;
    } catch {
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!isRoomId(id) || this.room.isRunning()) return false;
    try {
      await trashRoom(this.deps.roomsDir, id, this.deps.trash, this.deps.debugRoot);
    } catch {
      return false;
    }
    if (this.snapshot.roomId === id) this.snapshot = emptyRoomSnapshot();
    return true;
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

  models(): Promise<RoomModels> {
    return this.deps.models();
  }

  shutdown(): Promise<void> {
    return this.room.shutdown();
  }
}
