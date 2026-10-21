// restore.ts
import { isSiteKind, type Agent } from './agents';
import { buildSpawn, type SpawnSpec } from './cli-args';
import { claimRollout, type Rollout } from './codex-claim';

export interface RestoreContext {
  sharedDir: string;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  claudeTranscriptExists(sessionId: string): boolean;
}

export function restoreSpawn(agent: Agent, context: RestoreContext): SpawnSpec | null {
  if (isSiteKind(agent.kind) || agent.cwd === undefined) return null;
  const sessionId = agent.sessionId;
  if (agent.kind === 'claude' && sessionId === undefined) return null;
  return buildSpawn(agent.kind, {
    cwd: agent.cwd,
    sessionId,
    sharedDir: context.sharedDir,
    resume: sessionId !== undefined && (agent.kind !== 'claude' || context.claudeTranscriptExists(sessionId)),
    platform: context.platform,
    env: context.env,
  });
}

export function claimForAgents(
  agents: readonly Agent[],
  rollouts: readonly Rollout[],
  lowerBound: (agent: Agent) => number,
): Map<string, string> {
  const claimed = new Set<string>();
  for (const agent of agents) {
    if (agent.kind === 'codex' && agent.sessionId !== undefined) claimed.add(agent.sessionId);
  }
  const claims = new Map<string, string>();
  const open = agents
    .filter((agent) => agent.kind === 'codex' && agent.sessionId === undefined && agent.cwd !== undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const agent of open) {
    const id = claimRollout({ spawnedAtMs: lowerBound(agent), cwd: agent.cwd ?? '', claimed, rollouts });
    if (id === null) continue;
    claimed.add(id);
    claims.set(agent.id, id);
  }
  return claims;
}
