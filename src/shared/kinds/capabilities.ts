// capabilities.ts
import { OPENROUTER_KIND, isSiteKind } from '../agents';
import type { RoomKind, RoomParticipant } from '../room-model';

export interface ModelCatalog {
  contextLength(model: string): number | null;
}

export const NO_CATALOG: ModelCatalog = { contextLength: () => null };

export interface Capabilities {
  attachesFiles: boolean;
  splitsSystem: boolean;
  tokenBudget?: number;
}

function budgetOf(participant: RoomParticipant, catalog: ModelCatalog): { tokenBudget?: number } {
  const length = participant.model === undefined ? null : catalog.contextLength(participant.model);
  return length !== null && length > 0 ? { tokenBudget: length } : {};
}

export function capabilitiesOf(kind: RoomKind, participant: RoomParticipant, catalog: ModelCatalog): Capabilities {
  if (kind === OPENROUTER_KIND) return { attachesFiles: false, splitsSystem: true, ...budgetOf(participant, catalog) };
  return { attachesFiles: isSiteKind(kind), splitsSystem: false };
}
