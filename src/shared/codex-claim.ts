// codex-claim.ts
import { isUuid } from './agents';

export interface Rollout {
  fileName: string;
  firstLine: string;
  createdAtMs: number;
}

export interface ClaimRequest {
  spawnedAtMs: number;
  cwd: string;
  claimed: ReadonlySet<string>;
  rollouts: readonly Rollout[];
}

const ROLLOUT_NAME = /^rollout-.+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

export function rolloutId(fileName: string): string | null {
  const id = ROLLOUT_NAME.exec(fileName)?.[1];
  return isUuid(id) ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metaPayload(firstLine: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.type !== 'session_meta' || !isRecord(parsed.payload)) return null;
  return parsed.payload;
}

function claimableId(rollout: Rollout, request: ClaimRequest): string | null {
  if (rollout.createdAtMs < request.spawnedAtMs) return null;
  const id = rolloutId(rollout.fileName);
  if (id === null || request.claimed.has(id)) return null;
  const payload = metaPayload(rollout.firstLine);
  if (payload === null || payload.cwd !== request.cwd) return null;
  if (payload.id !== undefined && payload.id !== id) return null;
  return id;
}

export function claimRollout(request: ClaimRequest): string | null {
  const ordered = [...request.rollouts].sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const rollout of ordered) {
    const id = claimableId(rollout, request);
    if (id !== null) return id;
  }
  return null;
}
