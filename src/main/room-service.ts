// room-service.ts
import { Room, type DriverFactory } from './room';
import type { RoomConfig, RoomEvent } from '../shared/room-model';
import { applyRoomEvent, carryText, emptyRoomSnapshot, type CarryWhat, type RoomSnapshot, type RoomStartResult } from '../shared/room-view';

export interface RoomServiceDeps {
  roomsDir: string;
  driverFor: DriverFactory;
  emit(event: RoomEvent): void;
  paste(agentId: string, text: string): boolean;
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
      return { ok: true, roomId: run.roomId, historyPath: run.historyPath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    this.room.stop();
  }

  carry(agentId: string, what: CarryWhat): boolean {
    const text = carryText(this.snapshot, what);
    return text === null ? false : this.deps.paste(agentId, text);
  }

  shutdown(): Promise<void> {
    return this.room.shutdown();
  }
}
