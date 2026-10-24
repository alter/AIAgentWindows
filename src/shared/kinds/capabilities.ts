// capabilities.ts
import { OPENROUTER_KIND, isSiteKind } from '../agents';
import type { ModelItem } from '../openrouter';
import type { RoomKind, RoomParticipant } from '../room-model';

export const CHARS_PER_TOKEN = 3;
export const MAX_ANSWER_RESERVE_TOKENS = 16384;
const ANSWER_RESERVE_SHARE = 4;

export interface ModelCatalog {
  contextLength(model: string): number | null;
  maxCompletionTokens?(model: string): number | null;
}

export const NO_CATALOG: ModelCatalog = { contextLength: () => null };

export function modelCatalog(models: readonly ModelItem[]): ModelCatalog {
  const byId = new Map(models.map((model) => [model.id, model]));
  return {
    contextLength: (id) => byId.get(id)?.contextLength ?? null,
    maxCompletionTokens: (id) => byId.get(id)?.maxCompletionTokens ?? null,
  };
}

export interface Capabilities {
  attachesFiles: boolean;
  splitsSystem: boolean;
  tokenBudget?: number;
  maxCompletionTokens?: number;
}

function positive(value: number | null | undefined): number | undefined {
  return value !== null && value !== undefined && value > 0 ? value : undefined;
}

function budgetOf(participant: RoomParticipant, catalog: ModelCatalog): { tokenBudget?: number; maxCompletionTokens?: number } {
  const model = participant.model;
  if (model === undefined) return {};
  const tokenBudget = positive(catalog.contextLength(model));
  const maxCompletionTokens = positive(catalog.maxCompletionTokens?.(model));
  return { ...(tokenBudget === undefined ? {} : { tokenBudget }), ...(maxCompletionTokens === undefined ? {} : { maxCompletionTokens }) };
}

export function capabilitiesOf(kind: RoomKind, participant: RoomParticipant, catalog: ModelCatalog): Capabilities {
  if (kind === OPENROUTER_KIND) return { attachesFiles: false, splitsSystem: true, ...budgetOf(participant, catalog) };
  return { attachesFiles: isSiteKind(kind), splitsSystem: false };
}

function reserveOf(tokenBudget: number, ceiling: number | undefined): number {
  const share = Math.min(MAX_ANSWER_RESERVE_TOKENS, Math.floor(tokenBudget / ANSWER_RESERVE_SHARE));
  return ceiling === undefined ? share : Math.min(ceiling, share);
}

export function answerReserveTokens(capabilities: Capabilities): number | null {
  const { tokenBudget, maxCompletionTokens } = capabilities;
  return tokenBudget === undefined ? null : reserveOf(tokenBudget, maxCompletionTokens);
}

export function inputCharBudget(capabilities: Capabilities): number | null {
  const { tokenBudget, maxCompletionTokens } = capabilities;
  return tokenBudget === undefined ? null : (tokenBudget - reserveOf(tokenBudget, maxCompletionTokens)) * CHARS_PER_TOKEN;
}
