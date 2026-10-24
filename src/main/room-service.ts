// room-service.ts
import path from 'node:path';
import { Room, type DriverFactory, type RoomContinuation } from './room';
import { noProjectContext, projectContext, type RoomRunContext } from './room-context';
import { RoomFolders } from './room-folders';
import type { RoomModels } from '../shared/cli-models';
import type { OutputSnapshot } from '../shared/output-buffer';
import { readRecord, trashRoom, writeRecord, type TrashItem } from './room-archive';
import { dropSegmentStops, isRoomId, parseRoomTitle, resumeMatches, resumePoint, type RoomConfig, type RoomEvent, type RoomListItem } from '../shared/room-model';
import type { OpenRouterModels } from '../shared/ipc';
import { OPENROUTER_KIND } from '../shared/room-model';
import type { OpenRouterStatus } from '../shared/openrouter';
import type { FolderLookup } from '../shared/projects';
import { openrouterProblem } from './openrouter/gate';
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

export interface OpenRouterGate {
  status(): OpenRouterStatus;
  models(refresh: boolean): Promise<OpenRouterModels>;
}

export interface RoomProjects {
  ids(): readonly string[];
  folderOf(id: string): Promise<FolderLookup>;
}

export interface RoomServiceDeps {
  roomsDir: string;
  userData: string;
  projects?: RoomProjects;
  debugRoot?: string;
  trash: TrashItem;
  driverFor: DriverFactory;
  emit(event: RoomEvent): void;
  terminal: RoomTerminals;
  paste(agentId: string, text: string): boolean;
  copy(text: string): void;
  models(): Promise<RoomModels>;
  openrouter?: OpenRouterGate;
  now?(): number;
  newId?(): string;
}

export class RoomService {
  private snapshot: RoomSnapshot = emptyRoomSnapshot();
  private readonly room: Room;
  private readonly folders: RoomFolders;

  constructor(private readonly deps: RoomServiceDeps) {
    this.folders = new RoomFolders(deps.roomsDir, deps.userData, () => deps.projects?.ids() ?? []);
    this.room = new Room({
      driverFor: deps.driverFor,
      now: deps.now,
      newId: deps.newId,
      emit: (event) => {
        this.snapshot = applyRoomEvent(this.snapshot, event);
        deps.emit(event);
      },
    });
  }

  isRunning(): boolean {
    return this.room.isRunning();
  }

  state(): RoomSnapshot {
    return this.snapshot;
  }

  async init(): Promise<void> {
    await this.folders.stopInterrupted();
    const listed = await this.list();
    const latest = listed.find((item) => !item.unreadable);
    if (latest !== undefined) await this.open(latest.id).catch(() => undefined);
  }

  async list(): Promise<RoomListItem[]> {
    try {
      return await this.folders.scan();
    } catch {
      return [];
    }
  }

  async open(id: string): Promise<RoomOpenResult> {
    if (this.room.isRunning()) return { ok: false, error: 'a room run is in progress' };
    if (!isRoomId(id)) return { ok: false, error: 'invalid room id' };
    if (!this.folders.has(id)) await this.list();
    const projectId = this.folders.projectOf(id);
    const record = await readRecord(this.folders.dirOf(projectId), id);
    if (record === null) return { ok: false, error: 'the room cannot be read' };
    if (this.room.isRunning()) return { ok: false, error: 'a room run is in progress' };
    this.snapshot = snapshotFromRecord(record, this.historyPath(id, projectId), projectId);
    return { ok: true, snapshot: this.snapshot, form: formFromRecord(record) };
  }

  newRoom(projectId: string | null): boolean {
    if (this.room.isRunning() || (projectId !== null && !this.folders.knows(projectId))) return false;
    this.snapshot = emptyRoomSnapshot(projectId);
    return true;
  }

  closeProject(projectId: string): void {
    this.folders.forgetProject(projectId);
    if (this.snapshot.projectId === projectId) this.snapshot = emptyRoomSnapshot();
  }

  private async context(projectId: string | null): Promise<{ ok: true; ctx: RoomRunContext } | { ok: false; error: string }> {
    if (projectId === null) return { ok: true, ctx: noProjectContext(this.deps.roomsDir) };
    const found = (await this.deps.projects?.folderOf(projectId)) ?? { ok: false as const, error: 'The project no longer exists.' };
    return found.ok ? { ok: true, ctx: projectContext(this.folders.dirOf(projectId), projectId, found.folder) } : found;
  }

  private async openrouterProblem(config: RoomConfig): Promise<string | null> {
    const gate = this.deps.openrouter;
    if (gate === undefined || !config.participants.some((participant) => participant.kind === OPENROUTER_KIND)) return null;
    return openrouterProblem(config.participants, gate.status(), (await gate.models(false)).models);
  }

  async start(config: RoomConfig, continueId?: string, resume?: boolean): Promise<RoomStartResult> {
    try {
      const problem = await this.openrouterProblem(config);
      if (problem !== null) return { ok: false, error: problem };
      const projectId = continueId === undefined ? this.snapshot.projectId : this.folders.projectOf(continueId);
      const made = await this.context(projectId);
      if (!made.ok) return made;
      const from = continueId === undefined ? undefined : await this.continuation(continueId, resume === true ? config : undefined);
      const run = this.room.start(config, from, made.ctx);
      this.folders.remember(run.roomId, projectId);
      void run.done.catch(() => undefined);
      const debugDir = config.debugSites && this.deps.debugRoot !== undefined ? path.join(this.deps.debugRoot, run.roomId) : null;
      return { ok: true, roomId: run.roomId, historyPath: run.historyPath, debugDir };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private historyPath(id: string, projectId: string | null): string {
    return path.join(this.folders.dirOf(projectId), `${id}.md`);
  }

  private async continuation(id: string, resumeWith?: RoomConfig): Promise<RoomContinuation> {
    if (this.snapshot.roomId !== id) throw new Error('only the opened room can be continued');
    const record = await readRecord(this.folders.dirOfRoom(id), id);
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
    const dir = this.folders.dirOfRoom(id);
    const record = await readRecord(dir, id);
    if (record === null) return false;
    if (this.room.retitle(id, clean)) return true;
    try {
      await writeRecord(dir, { ...record, title: clean });
      return true;
    } catch {
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!isRoomId(id) || this.room.isRunning()) return false;
    try {
      await trashRoom(this.folders.dirOfRoom(id), id, this.deps.trash, this.deps.debugRoot);
    } catch {
      return false;
    }
    this.folders.forget(id);
    if (this.snapshot.roomId === id) this.snapshot = emptyRoomSnapshot(this.snapshot.projectId);
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
