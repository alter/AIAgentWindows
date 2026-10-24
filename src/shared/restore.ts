// restore.ts
import { isCliKind, type Agent } from './agents';
import { buildSpawn, type SpawnSpec } from './cli-args';
import { claimRollout, type Rollout } from './codex-claim';
import type { FolderLookup } from './projects';

export interface RestoreContext {
  sharedDir: string;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  claudeTranscriptExists(sessionId: string): boolean;
  project?: FolderLookup;
}

function workingFolder(agent: Agent, context: RestoreContext): string | undefined {
  if (agent.projectId === undefined) return agent.cwd;
  if (context.project === undefined) throw new Error('The project of this agent could not be checked, so the agent was not started.');
  if (!context.project.ok) throw new Error(context.project.error);
  return context.project.folder;
}

export function restoreSpawn(agent: Agent, context: RestoreContext): SpawnSpec | null {
  if (!isCliKind(agent.kind)) return null;
  const cwd = workingFolder(agent, context);
  if (cwd === undefined) return null;
  const sessionId = agent.sessionId;
  if (agent.kind === 'claude' && sessionId === undefined) return null;
  return buildSpawn(agent.kind, {
    cwd,
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
    const id = claimRollout({ spawnedAtMs: lowerBound(agent), cwd: agent.cwd ?? '', claimed, rollouts, skipExec: true });
    if (id === null) continue;
    claimed.add(id);
    claims.set(agent.id, id);
  }
  return claims;
}
