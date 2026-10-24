// turn-profile.ts
import { denyReadRules } from './deny-list';

export type TurnIsolation = 'none' | 'project';

export interface TurnProfile {
  mode: 'plan';
  isolation: TurnIsolation;
  denyRead: readonly string[];
  tools: readonly string[];
  extraDirs: readonly string[];
  name?: string;
}

export const WEB_TOOLS: readonly string[] = ['WebSearch', 'WebFetch'];
const FILE_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];
const NAME_LIMIT = 80;

function cleanName(name: string): string {
  const flat = [...name].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('');
  return flat.replace(/^[-\s]+/, '').trim().slice(0, NAME_LIMIT);
}

export function freeRoomProfile(sharedDir: string): TurnProfile {
  return { mode: 'plan', isolation: 'none', denyRead: [], tools: [...FILE_TOOLS, ...WEB_TOOLS], extraDirs: [sharedDir] };
}

export function projectRoomProfile(roomName: string): TurnProfile {
  const name = cleanName(roomName);
  return {
    mode: 'plan',
    isolation: 'project',
    denyRead: denyReadRules(),
    tools: FILE_TOOLS,
    extraDirs: [],
    ...(name === '' ? {} : { name }),
  };
}

export function roomProfile(isolated: boolean, sharedDir: string, roomName: string): TurnProfile {
  return isolated ? projectRoomProfile(roomName) : freeRoomProfile(sharedDir);
}
