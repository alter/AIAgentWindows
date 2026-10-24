// test-room.ts
import { Room, type RoomContinuation, type RoomDeps, type RoomRun } from '../../../src/main/room';
import { noProjectContext, type RoomRunContext } from '../../../src/main/room-context';
import type { RoomConfig } from '../../../src/shared/room-model';

export class TestRoom extends Room {
  private readonly roomsDir: string;

  constructor(deps: RoomDeps & { roomsDir: string }) {
    super(deps);
    this.roomsDir = deps.roomsDir;
  }

  override start(config: RoomConfig, from?: RoomContinuation, ctx?: RoomRunContext): RoomRun {
    return super.start(config, from, ctx ?? noProjectContext(this.roomsDir));
  }
}
