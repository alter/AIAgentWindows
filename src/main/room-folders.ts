// room-folders.ts
import { listRecords, stopInterrupted } from './room-archive';
import { projectRoomsDir } from './room-context';
import type { RoomListItem } from '../shared/room-model';

type Readable = Extract<RoomListItem, { unreadable: false }>;

interface RoomFolder {
  projectId: string | null;
  dir: string;
}

export class RoomFolders {
  private readonly owners = new Map<string, string | null>();

  constructor(
    private readonly roomsDir: string,
    private readonly userData: string,
    private readonly projectIds: () => readonly string[],
  ) {}

  dirOf(projectId: string | null): string {
    return projectId === null ? this.roomsDir : projectRoomsDir(this.userData, projectId);
  }

  has(roomId: string): boolean {
    return this.owners.has(roomId);
  }

  projectOf(roomId: string): string | null {
    return this.owners.get(roomId) ?? null;
  }

  dirOfRoom(roomId: string): string {
    return this.dirOf(this.projectOf(roomId));
  }

  remember(roomId: string, projectId: string | null): void {
    this.owners.set(roomId, projectId);
  }

  forget(roomId: string): void {
    this.owners.delete(roomId);
  }

  forgetProject(projectId: string): void {
    for (const [roomId, owner] of this.owners) if (owner === projectId) this.owners.delete(roomId);
  }

  knows(projectId: string): boolean {
    return this.projectIds().includes(projectId);
  }

  private folders(): RoomFolder[] {
    return [{ projectId: null, dir: this.roomsDir }, ...this.projectIds().map((projectId) => ({ projectId, dir: this.dirOf(projectId) }))];
  }

  async stopInterrupted(): Promise<void> {
    for (const folder of this.folders()) await stopInterrupted(folder.dir).catch(() => []);
  }

  async scan(): Promise<RoomListItem[]> {
    const items: RoomListItem[] = [];
    for (const folder of this.folders()) {
      for (const item of await listRecords(folder.dir, folder.projectId).catch(() => [])) {
        this.owners.set(item.id, folder.projectId);
        items.push(item);
      }
    }
    const readable = items.filter((item): item is Readable => !item.unreadable).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const unreadable = items.filter((item) => item.unreadable).sort((a, b) => a.id.localeCompare(b.id));
    return [...readable, ...unreadable];
  }
}
