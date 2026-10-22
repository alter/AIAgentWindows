// room-view.ts
import { SITE_KINDS_WITH_ADAPTER, isSiteKind, type SiteKind } from './agents';
import { renderCarryHistory } from './room-history';
import {
  OWNER_ID,
  ROOM_ID,
  ROOM_PARTICIPANTS,
  defaultFinalizerId,
  roomPlan,
  parseRoomConfig,
  type RoomConfigResult,
  type RoomEntry,
  type RoomEntryState,
  type RoomEvent,
  type PausedSession,
  type RoomMode,
  type RoomParticipant,
  type RoomPlan,
  type RoomRecord,
  type RoomStatus,
  type StepState,
} from './room-model';

export type RoomPhase = 'idle' | 'running' | RoomStatus;
export type CarryWhat = 'final' | 'history';
export const CARRY_KINDS: readonly CarryWhat[] = ['final', 'history'];

export type ChipState = 'waiting' | 'running' | 'answered' | 'error' | 'timeout' | 'stopped';

export interface RoomSnapshot {
  phase: RoomPhase;
  roomId: string | null;
  historyPath: string | null;
  entries: RoomEntry[];
  running: string[];
  paused: PausedSession[];
  completed: number;
  total: number;
  plan: RoomPlan | null;
  round: number;
  chips: Record<string, ChipState>;
}

export type RoomStartResult = { ok: true; roomId: string; historyPath: string; debugDir: string | null } | { ok: false; error: string };

export interface RoomFormValues {
  prompt: string;
  mode: RoomMode;
  rounds: string;
  timeoutMinutes: string;
  checked: readonly string[];
  finalizerId?: string;
  debugSites?: boolean;
}

const MS_PER_MINUTE = 60_000;

export interface ParticipantAvailability {
  available: boolean;
  note: string;
}

export function missingAdapterNote(label: string): string {
  return `${label} has no site adapter`;
}

export function participantAvailability(
  participant: RoomParticipant,
  withAdapter: readonly SiteKind[] = SITE_KINDS_WITH_ADAPTER,
): ParticipantAvailability {
  const kind = participant.kind;
  if (!isSiteKind(kind) || withAdapter.includes(kind)) return { available: true, note: '' };
  return { available: false, note: missingAdapterNote(participant.label) };
}

export function emptyRoomSnapshot(): RoomSnapshot {
  return { phase: 'idle', roomId: null, historyPath: null, entries: [], running: [], paused: [], completed: 0, total: 0, plan: null, round: 0, chips: {} };
}

const CHIP_OF_STEP: Record<StepState, ChipState> = { running: 'running', replied: 'answered', failed: 'error', timeout: 'timeout' };
const SETTLED_CHIPS: readonly ChipState[] = ['answered', 'error', 'timeout'];

function waitingChips(plan: RoomPlan): Record<string, ChipState> {
  return Object.fromEntries(plan.participants.map((participant) => [participant.id, 'waiting' as const]));
}

function stepChips(snapshot: RoomSnapshot, participantId: string, state: StepState): Pick<RoomSnapshot, 'round' | 'chips'> {
  const previous = snapshot.chips[participantId];
  const nextRound = state === 'running' && previous !== undefined && SETTLED_CHIPS.includes(previous);
  const base = nextRound && snapshot.plan !== null ? waitingChips(snapshot.plan) : snapshot.chips;
  return { round: nextRound ? snapshot.round + 1 : snapshot.round, chips: { ...base, [participantId]: CHIP_OF_STEP[state] } };
}

function stoppedChips(chips: Record<string, ChipState>): Record<string, ChipState> {
  return Object.fromEntries(Object.entries(chips).map(([id, state]) => [id, state === 'running' ? ('stopped' as const) : state]));
}

export function applyRoomEvent(snapshot: RoomSnapshot, event: RoomEvent): RoomSnapshot {
  if (event.type === 'started') {
    return { phase: 'running', roomId: event.roomId, historyPath: event.historyPath, entries: event.previous ?? [], running: [], paused: [], completed: 0, total: event.total, plan: event.plan, round: 1, chips: waitingChips(event.plan) };
  }
  if (event.roomId !== snapshot.roomId) return snapshot;
  if (event.type === 'entry') return { ...snapshot, entries: [...snapshot.entries, event.entry] };
  if (event.type === 'finished') return { ...snapshot, phase: event.status, running: [], paused: [], chips: stoppedChips(snapshot.chips) };
  if (event.type === 'paused') {
    const { participantId, sessionId, note } = event;
    return { ...snapshot, paused: [...snapshot.paused.filter((item) => item.participantId !== participantId), { participantId, sessionId, note }] };
  }
  if (event.type === 'resumed') return { ...snapshot, paused: snapshot.paused.filter((item) => item.participantId !== event.participantId) };
  const others = snapshot.running.filter((id) => id !== event.participantId);
  const running = event.state === 'running' ? [...others, event.participantId] : others;
  return { ...snapshot, ...stepChips(snapshot, event.participantId, event.state), running, completed: event.completed, total: event.total };
}

export function carryText(snapshot: RoomSnapshot, what: CarryWhat): string | null {
  if (snapshot.phase === 'running' || snapshot.roomId === null) return null;
  if (what === 'history') return renderCarryHistory(snapshot.roomId, snapshot.entries);
  const newest = [...snapshot.entries].reverse();
  const last = newest.find((entry) => entry.kind === 'final') ?? newest.find((entry) => entry.kind === 'reply');
  return last === undefined || last.text.length === 0 ? null : last.text;
}

export function resolveFinalizer(checked: readonly string[], previous: string): string {
  const ticked = ROOM_PARTICIPANTS.filter((item) => checked.includes(item.id));
  return ticked.some((item) => item.id === previous) ? previous : defaultFinalizerId(ticked);
}

export function formToConfig(form: RoomFormValues, withAdapter: readonly SiteKind[] = SITE_KINDS_WITH_ADAPTER): RoomConfigResult {
  const participants = ROOM_PARTICIPANTS.filter((item) => form.checked.includes(item.id));
  const unavailable = participants.find((item) => !participantAvailability(item, withAdapter).available);
  if (unavailable !== undefined) return { ok: false, error: participantAvailability(unavailable, withAdapter).note };
  const rounds = Number(form.rounds);
  const minutes = form.timeoutMinutes.trim() === '' ? Number.NaN : Number(form.timeoutMinutes);
  return parseRoomConfig({
    prompt: form.prompt,
    mode: form.mode,
    rounds,
    participants,
    finalizerId: resolveFinalizer(form.checked, form.finalizerId ?? ''),
    turnTimeoutMs: Math.round(minutes * MS_PER_MINUTE),
    debugSites: form.debugSites ?? false,
  });
}

export interface RoomChip {
  id: string;
  label: string;
  state: ChipState;
}

export type BannerTone = 'done' | 'warn' | 'stopped' | 'failed';

export interface RoomBanner {
  tone: BannerTone;
  text: string;
}

export interface RoomProgress {
  headline: string;
  remaining: number;
  remainingText: string;
  chips: RoomChip[];
  banner: RoomBanner | null;
}

function turnsText(count: number): string {
  return `${count} ${count === 1 ? 'turn' : 'turns'} left`;
}

function finishedBanner(snapshot: RoomSnapshot, plan: RoomPlan, finalizerLabel: string): RoomBanner | null {
  if (snapshot.phase === 'stopped') return { tone: 'stopped', text: 'Stopped' };
  if (snapshot.phase === 'failed') return { tone: 'failed', text: 'Failed' };
  if (snapshot.phase !== 'done') return null;
  const current = snapshot.entries.slice(snapshot.entries.map((entry) => entry.kind).lastIndexOf('prompt') + 1);
  const final = current.find((entry) => entry.kind === 'final');
  if (final !== undefined && final.authorId !== plan.finalizerId) {
    return { tone: 'warn', text: `Done \u2014 final by ${final.label} (finalizer ${finalizerLabel} failed)` };
  }
  if (final !== undefined) return { tone: 'done', text: `Done \u2014 final answer from ${final.label}` };
  return { tone: 'warn', text: `Done \u2014 no final answer (${finalizerLabel} failed)` };
}

export function roomProgress(snapshot: RoomSnapshot): RoomProgress | null {
  const { plan } = snapshot;
  if (plan === null || snapshot.phase === 'idle') return null;
  const finalizer = plan.participants.find((participant) => participant.id === plan.finalizerId);
  const finalizerLabel = finalizer?.label ?? plan.finalizerId;
  const inFinal = snapshot.round > plan.rounds;
  const remaining = Math.max(0, snapshot.total - snapshot.completed);
  const active = plan.participants.filter((participant) => (snapshot.chips[participant.id] ?? 'waiting') !== 'waiting');
  const shown = inFinal ? (active.length > 0 ? active : plan.participants.filter((participant) => participant.id === plan.finalizerId)) : plan.participants;
  const handedOver = inFinal ? shown.find((participant) => participant.id !== plan.finalizerId && snapshot.chips[participant.id] === 'running') : undefined;
  const finalHeadline = handedOver === undefined ? `Final: ${finalizerLabel}` : `Final: ${handedOver.label} (finalizer ${finalizerLabel} failed)`;
  return {
    headline: inFinal ? finalHeadline : `Round ${snapshot.round} of ${plan.rounds}`,
    remaining,
    remainingText: turnsText(remaining),
    chips: shown.map((participant) => ({ id: participant.id, label: participant.label, state: snapshot.chips[participant.id] ?? 'waiting' })),
    banner: finishedBanner(snapshot, plan, finalizerLabel),
  };
}

export type EntryState = 'prompt' | 'replied' | 'final' | 'error' | RoomEntryState;

export interface FeedItem {
  index: number;
  entry: RoomEntry;
}

export interface FeedSection {
  key: string;
  title: string | null;
  entries: FeedItem[];
}

export function entryState(entry: RoomEntry): EntryState {
  if (entry.kind === 'reply') return 'replied';
  if (entry.kind === 'error') return entry.state ?? 'error';
  return entry.kind;
}

export function finalText(snapshot: RoomSnapshot): string | null {
  const last = [...snapshot.entries].reverse().find((entry) => entry.kind === 'final');
  return last === undefined || last.text.length === 0 ? null : last.text;
}

function sectionOf(entry: RoomEntry, plan: RoomPlan | null): Pick<FeedSection, 'key' | 'title'> {
  if (entry.kind === 'prompt') return { key: 'prompt', title: 'Prompt' };
  if (entry.kind === 'final') return { key: 'final', title: 'Final result' };
  if (entry.round === undefined) return { key: 'rest', title: null };
  return { key: `round-${entry.round}`, title: plan === null ? `Round ${entry.round}` : `Round ${entry.round}/${plan.rounds}` };
}

function runKey(run: number, key: string): string {
  return run === 1 ? key : `run${run}-${key}`;
}

export function feedSections(entries: readonly RoomEntry[], plan: RoomPlan | null): FeedSection[] {
  const runs: Array<Map<string, FeedSection>> = [];
  let run = 1;
  entries.forEach((entry, index) => {
    if (entry.kind === 'prompt' && runs[run - 1]?.has('prompt') === true) run += 1;
    const { key, title } = sectionOf(entry, plan);
    const sections = (runs[run - 1] ??= new Map<string, FeedSection>());
    const section = sections.get(key) ?? { key: runKey(run, key), title, entries: [] };
    section.entries.push({ index, entry });
    sections.set(key, section);
  });
  return runs.flatMap((sections) => {
    const all = [...sections.values()];
    const isFinal = (section: FeedSection): boolean => section.key.endsWith('final');
    return [...all.filter((section) => !isFinal(section)), ...all.filter(isFinal)];
  });
}

function settledState(entry: RoomEntry): StepState {
  if (entry.kind !== 'error') return 'replied';
  return entry.state === 'timeout' ? 'timeout' : 'failed';
}

function recordEvents(record: RoomRecord, historyPath: string): RoomEvent[] {
  const lastPrompt = record.entries.map((entry) => entry.kind).lastIndexOf('prompt');
  const previous = record.entries.slice(0, Math.max(0, lastPrompt));
  const current = record.entries.slice(Math.max(0, lastPrompt));
  const plan = roomPlan({ ...record.config, prompt: '' });
  const base = plan.participants.length * plan.rounds + 1;
  const events: RoomEvent[] = [{ type: 'started', roomId: record.id, historyPath, total: base, plan, previous }];
  let completed = 0;
  let total = base;
  for (const entry of current) {
    events.push({ type: 'entry', roomId: record.id, entry });
    if (entry.authorId === ROOM_ID && entry.state !== 'stopped') total += 1;
    if (entry.authorId === OWNER_ID || entry.authorId === ROOM_ID) continue;
    completed += 1;
    events.push({ type: 'progress', roomId: record.id, participantId: entry.authorId, state: 'running', completed: completed - 1, total });
    events.push({ type: 'progress', roomId: record.id, participantId: entry.authorId, state: settledState(entry), completed, total });
  }
  events.push({ type: 'finished', roomId: record.id, status: record.status === 'running' ? 'stopped' : record.status });
  return events;
}

export function snapshotFromRecord(record: RoomRecord, historyPath: string): RoomSnapshot {
  return recordEvents(record, historyPath).reduce(applyRoomEvent, emptyRoomSnapshot());
}

export function formFromRecord(record: RoomRecord): RoomFormValues {
  const { config } = record;
  return {
    prompt: '',
    mode: config.mode,
    rounds: String(config.rounds),
    timeoutMinutes: String(config.turnTimeoutMs / MS_PER_MINUTE),
    checked: config.participants.map((participant) => participant.id),
    finalizerId: config.finalizerId,
    debugSites: config.debugSites,
  };
}
