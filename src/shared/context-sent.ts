// context-sent.ts
import { isCliKind, isSiteKind, OPENROUTER_KIND } from './agents';
import type { ContextDigest } from './context-digest';
import { instanceLabel, type RoomKind } from './room-model';

export const CONTEXT_SENT_TITLE = 'Context sent';

export interface ContextSentView {
  title: typeof CONTEXT_SENT_TITLE;
  lines: string[];
  collectionAllowed: boolean;
}

export interface RecipientRow {
  kind: RoomKind;
  model?: string;
  modelName?: string;
  allowCollection?: boolean;
}

const COLLECTION_LINE = 'Data collection by the provider was allowed for this participant: no data_collection: deny was sent';
const CUT_ROUTE = { budget: 'to fit the model budget', inline: 'by the inline fallback' } as const;

export function contextSentView(digest: ContextDigest): ContextSentView {
  const { history, parts, files, map, cut, collectionAllowed } = digest;
  const lines = [`History: ${history.count} entries, from entry ${history.first + 1} to entry ${history.last + 1}`];
  for (const part of parts) lines.push(`${part.id}: ${part.bytes} bytes, hash ${part.hash}`);
  for (const file of files) lines.push(`File ${file.name}: ${file.bytes} bytes`);
  if (map !== undefined) lines.push(`Project map of this run: hash ${map}`);
  if (cut !== undefined) lines.push(`Cut ${CUT_ROUTE[cut.via]}: ${cut.entries} oldest history entries and ${cut.mapChars} characters of the project map`);
  if (collectionAllowed === true) lines.push(COLLECTION_LINE);
  return { title: CONTEXT_SENT_TITLE, lines, collectionAllowed: collectionAllowed === true };
}

function rowName(row: RecipientRow): string {
  return instanceLabel({ kind: row.kind, ...(row.model === undefined || row.model === '' ? {} : { model: row.model }), ...(row.modelName === undefined || row.modelName === '' ? {} : { modelName: row.modelName }) });
}

export function collectionRecipients(rows: readonly RecipientRow[], projectId: string | null): string[] {
  if (projectId === null) return [];
  return rows.filter((row) => row.kind === OPENROUTER_KIND && row.allowCollection === true).map(rowName);
}

export function recipientsLine(rows: readonly RecipientRow[], projectId: string | null): string | null {
  if (projectId === null) return null;
  const names = rows.filter((row) => isSiteKind(row.kind) || row.kind === OPENROUTER_KIND).map(rowName);
  if (names.length === 0) return null;
  const quoted = rows.some((row) => isCliKind(row.kind)) ? ' The history may quote files that the CLI participants read.' : '';
  const collected = collectionRecipients(rows, projectId);
  const collection = collected.length === 0 ? '' : ` Data collection by the provider is allowed for ${collected.join(', ')}.`;
  return `${names.join(', ')} receive the project map and the room history.${quoted}${collection}`;
}
