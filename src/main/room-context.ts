// room-context.ts
import path from 'node:path';
import { isProjectId } from '../shared/projects';
import type { RoomParticipant } from '../shared/room-model';

export interface RoomCwd {
  path: string;
  create: boolean;
}

export interface RoomRunContext {
  roomsDir: string;
  projectId: string | null;
  cwdFor(participant: RoomParticipant): RoomCwd;
}

export class FolderNames {
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

export function projectRoomsDir(userData: string, projectId: string): string {
  if (!isProjectId(projectId)) throw new Error('invalid project id');
  return path.join(userData, 'projects', projectId, 'rooms');
}

export function noProjectContext(roomsDir: string): RoomRunContext {
  const names = new FolderNames();
  return { roomsDir, projectId: null, cwdFor: (participant) => ({ path: path.join(roomsDir, names.of(participant)), create: true }) };
}

export function projectContext(roomsDir: string, projectId: string, folder: string): RoomRunContext {
  return { roomsDir, projectId, cwdFor: () => ({ path: folder, create: false }) };
}
