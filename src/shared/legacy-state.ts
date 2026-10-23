// legacy-state.ts
import {
  defaultPartition,
  isUuid,
  parseAgent,
  parseSettings,
  SITE_KINDS,
  STATE_VERSION,
  type Agent,
  type AppState,
  type SitePartitions,
} from './agents';

export const LEGACY_VERSION = 1;

export interface LegacyState {
  agents: Agent[];
  settings: ReturnType<typeof parseSettings>;
}

export function parseLegacyState(raw: unknown): LegacyState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not an object');
  const record = raw as Record<string, unknown>;
  if (record['version'] !== LEGACY_VERSION) throw new Error(`version ${String(record['version'])} is not ${LEGACY_VERSION}`);
  if (!Array.isArray(record['agents'])) throw new Error('agents is not a list');
  const agents: Agent[] = [];
  for (const item of record['agents'] as unknown[]) {
    const agent = parseAgent(item);
    if (agent !== null) agents.push(agent);
  }
  return { agents, settings: parseSettings(record) };
}

export function legacyPartitions(agents: readonly Agent[]): SitePartitions {
  const partitions: SitePartitions = {};
  for (const kind of SITE_KINDS) {
    const owner = agents.find((agent) => agent.kind === kind && isUuid(agent.id));
    partitions[kind] = owner === undefined ? defaultPartition(kind) : `persist:${owner.id}`;
  }
  return partitions;
}

export function migrateLegacyState(legacy: LegacyState): AppState {
  return { version: STATE_VERSION, agents: [], ...legacy.settings, partitions: legacyPartitions(legacy.agents) };
}
