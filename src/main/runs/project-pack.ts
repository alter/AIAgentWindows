// project-pack.ts
import { isSiteKind, OPENROUTER_KIND } from '../../shared/agents';
import { answerReserveTokens, capabilitiesOf, inputCharBudget, type Capabilities, type ModelCatalog } from '../../shared/kinds/capabilities';
import { DEFAULT_MAP_LIMITS, type MapLimits } from '../../shared/project-map';
import { fitPack } from '../../shared/pack-fit';
import { WEB_INLINE_LIMIT, introFor, renderHistory, type PromptPhase } from '../../shared/room-history';
import type { RoomEntry, RoomParticipant } from '../../shared/room-model';
import { assemblePack, historyProvider, providePack, type ContextPack, type ContextProvider, type PackFile, type ProvidedPart } from './context-pack';
import type { DigestCut } from '../../shared/context-digest';
import { mapSection, projectMapProvider, type RunMap } from './project-map-provider';

export interface PackBuildInput {
  participant: RoomParticipant;
  roomId: string;
  seen: readonly RoomEntry[];
  phase: PromptPhase;
  renderRun(entries: readonly RoomEntry[]): string;
  capabilities: Capabilities;
  map: RunMap | null;
  project: boolean;
}

export interface InlineFallback {
  text: string;
  cut: { entries: number; mapChars: number };
}

export interface PackBuild {
  pack: ContextPack;
  parts: ProvidedPart[];
  sent: RoomEntry[];
  inline?: InlineFallback;
  cut?: DigestCut;
  maxCompletionTokens?: number;
  denyDataCollection?: boolean;
}

const FILE_SEPARATOR = '\n\n';

function mergedFiles(files: readonly PackFile[]): PackFile[] {
  return files.length < 2 ? [...files] : [{ content: files.map((file) => file.content).join(FILE_SEPARATOR) }];
}

function sizing(render: (entries: readonly RoomEntry[]) => string): { base: number; blockSize(entry: RoomEntry): number } {
  const base = render([]).length;
  return { base, blockSize: (entry) => render([entry]).length - base };
}

function build(input: PackBuildInput, sent: readonly RoomEntry[], mapText: string, projectMap: boolean): { parts: ProvidedPart[]; pack: ContextPack } {
  const providers: ContextProvider[] = [
    historyProvider({
      participant: input.participant,
      roomId: input.roomId,
      seen: sent,
      phase: input.phase,
      renderRun: input.renderRun,
      ...(projectMap ? { projectMap: true } : {}),
    }),
    ...(mapText === '' ? [] : [projectMapProvider(mapText)]),
  ];
  const parts = providePack(providers, input.capabilities);
  const pack = assemblePack(parts);
  return { parts, pack: { ...pack, files: mergedFiles(pack.files) } };
}

function openRouterBuild(input: PackBuildInput): PackBuild {
  const mapText = input.map?.text ?? '';
  const budget = inputCharBudget(input.capabilities);
  let sent = [...input.seen];
  let text = mapText;
  let cut: DigestCut | undefined;
  if (budget !== null) {
    const system = introFor(input.participant, input.phase).length + (mapText === '' ? 0 : mapSection('').length);
    const fitted = fitPack({ budget: budget - system, map: mapText, entries: input.seen, ...sizing(input.renderRun) });
    sent = fitted.entries;
    text = fitted.map;
    if (fitted.cutEntries > 0 || fitted.cutMapChars > 0) cut = { via: 'budget', entries: fitted.cutEntries, mapChars: fitted.cutMapChars };
  }
  const made = build(input, sent, text, false);
  const reserve = input.capabilities.maxCompletionTokens === undefined ? null : answerReserveTokens(input.capabilities);
  return {
    ...made,
    sent,
    ...(cut === undefined ? {} : { cut }),
    ...(reserve === null ? {} : { maxCompletionTokens: reserve }),
    denyDataCollection: true,
  };
}

function inlineFallback(input: PackBuildInput, map: RunMap): InlineFallback {
  const render = (entries: readonly RoomEntry[]): string => renderHistory(input.roomId, entries);
  const fitted = fitPack({ budget: WEB_INLINE_LIMIT, map: map.text, entries: input.seen, ...sizing(render) });
  const shown = fitted.map === '' ? '' : `${mapSection(fitted.map)}\n\n`;
  return {
    text: `${introFor(input.participant, input.phase)}\n\n${shown}${render(fitted.entries)}`,
    cut: { entries: fitted.cutEntries, mapChars: fitted.cutMapChars },
  };
}

function webBuild(input: PackBuildInput, map: RunMap): PackBuild {
  const made = build(input, input.seen, map.text, true);
  return { ...made, sent: [...input.seen], inline: inlineFallback(input, map) };
}

function plainBuild(input: PackBuildInput): PackBuild {
  const made = build(input, input.seen, '', false);
  return { ...made, sent: [...input.seen] };
}

export function buildPack(input: PackBuildInput): PackBuild {
  if (!input.project) return plainBuild(input);
  if (input.capabilities.splitsSystem) return openRouterBuild(input);
  if (input.capabilities.attachesFiles && input.map !== null) return webBuild(input, input.map);
  return plainBuild(input);
}

const MAP_BUDGET_SHARE = 4;
const MIN_MAP_BYTES = 1024;

export function receivesMap(participants: readonly RoomParticipant[]): boolean {
  return participants.some((participant) => isSiteKind(participant.kind) || participant.kind === OPENROUTER_KIND);
}

export function mapLimitsFor(participants: readonly RoomParticipant[], catalog: ModelCatalog): MapLimits {
  const budgets = participants.flatMap((participant) => {
    const budget = participant.kind === OPENROUTER_KIND ? inputCharBudget(capabilitiesOf(participant.kind, participant, catalog)) : null;
    return budget === null ? [] : [budget];
  });
  if (budgets.length === 0) return DEFAULT_MAP_LIMITS;
  const maxBytes = Math.max(MIN_MAP_BYTES, Math.min(DEFAULT_MAP_LIMITS.maxBytes, Math.floor(Math.min(...budgets) / MAP_BUDGET_SHARE)));
  return { maxBytes, maxPaths: DEFAULT_MAP_LIMITS.maxPaths, maxDocumentBytes: Math.min(DEFAULT_MAP_LIMITS.maxDocumentBytes, Math.floor(maxBytes / MAP_BUDGET_SHARE)) };
}
