// copy-agents.ts
import type { Agent } from './agents';
import { isProjectId } from './projects';

export type CopyAgentsFrom = 'none' | { projectId: string | null };
export type CopySource = { projectId: string | null };
export type CopyAgentsResult = { ok: true; count: number } | { ok: false; error: string };

export interface CopyOption {
  value: string;
  label: string;
}

export const COPY_NO_PROJECT = 'no-project';
export const COPY_NONE = 'none';
const PROJECT_PREFIX = 'project:';

export function copyAgentsOptions(projects: readonly { id: string; name: string }[]): CopyOption[] {
  return [
    { value: COPY_NO_PROJECT, label: 'No project' },
    { value: COPY_NONE, label: 'Do not copy' },
    ...projects.map((project) => ({ value: `${PROJECT_PREFIX}${project.id}`, label: project.name })),
  ];
}

export function defaultCopyChoice(options: readonly CopyOption[]): string {
  return options[0]?.value ?? COPY_NONE;
}

export function sourceOfChoice(value: string): CopyAgentsFrom | null {
  if (value === COPY_NONE) return COPY_NONE;
  if (value === COPY_NO_PROJECT) return { projectId: null };
  if (!value.startsWith(PROJECT_PREFIX)) return null;
  const projectId = value.slice(PROJECT_PREFIX.length);
  return isProjectId(projectId) ? { projectId } : null;
}

export function parseCopyAgentsFrom(raw: unknown): CopyAgentsFrom | null {
  if (raw === COPY_NONE) return COPY_NONE;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'projectId') return null;
  const projectId = (raw as { projectId: unknown }).projectId;
  return projectId === null || isProjectId(projectId) ? { projectId } : null;
}

export function copySourceAgents(agents: readonly Agent[], source: CopySource): Agent[] {
  return agents.filter((agent) => (source.projectId === null ? agent.projectId === undefined : agent.projectId === source.projectId));
}
