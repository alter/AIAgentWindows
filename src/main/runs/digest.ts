// digest.ts
import { createHash } from 'node:crypto';
import type { ContextDigest, DigestFile } from '../../shared/context-digest';
import type { RoomEntry } from '../../shared/room-model';
import type { PackBuild } from './project-pack';
import type { RunMap } from './project-map-provider';

const HASH_CHARS = 16;

export function hashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, HASH_CHARS);
}

export function runMap(text: string): RunMap {
  return { text, hash: hashOf(text) };
}

export interface DigestInput {
  all: readonly RoomEntry[];
  built: PackBuild;
  files: readonly DigestFile[];
  map?: string;
  inlined: boolean;
}

function contentOf(item: PackBuild['parts'][number]): string {
  const { system, text, files } = item.part;
  return [system ?? '', text ?? '', ...(files ?? []).map((file) => file.content)].join('\n');
}

export function digestOf(input: DigestInput): ContextDigest {
  const { all, built, files, map, inlined } = input;
  const { sent } = built;
  const first = sent[0];
  const last = sent[sent.length - 1];
  const history = first === undefined || last === undefined ? { first: 0, last: 0, count: 0 } : { first: all.indexOf(first), last: all.indexOf(last), count: sent.length };
  const cut = inlined && built.inline !== undefined ? { via: 'inline' as const, ...built.inline.cut } : built.cut;
  return {
    history,
    parts: built.parts.map((item) => ({ id: item.id, bytes: Buffer.byteLength(contentOf(item), 'utf8'), hash: hashOf(contentOf(item)) })),
    files: [...files],
    ...(map === undefined ? {} : { map }),
    ...(cut === undefined ? {} : { cut }),
    ...(built.collectionAllowed === true ? { collectionAllowed: true as const } : {}),
  };
}
