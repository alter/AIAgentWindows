// context-pack.ts
import type { Capabilities } from '../../shared/kinds/capabilities';
import { buildParticipantPrompt, renderHistory, type PromptPhase } from '../../shared/room-history';
import type { RoomEntry, RoomParticipant } from '../../shared/room-model';

export interface PackFile {
  content: string;
}

export interface PackPart {
  system?: string;
  text?: string;
  files?: readonly PackFile[];
}

export interface ContextProvider {
  id: string;
  priority: number;
  provide(capabilities: Capabilities): PackPart;
}

export interface ContextPack {
  system?: string;
  text: string;
  files: PackFile[];
}

const PART_SEPARATOR = '\n\n';

export interface ProvidedPart {
  id: string;
  part: PackPart;
}

export function providePack(providers: readonly ContextProvider[], capabilities: Capabilities): ProvidedPart[] {
  return [...providers].sort((a, b) => a.priority - b.priority).map((provider) => ({ id: provider.id, part: provider.provide(capabilities) }));
}

export function assemblePack(provided: readonly ProvidedPart[]): ContextPack {
  const parts = provided.map((item) => item.part);
  const system = parts.flatMap((part) => (part.system === undefined ? [] : [part.system]));
  const text = parts.flatMap((part) => (part.text === undefined ? [] : [part.text]));
  return {
    ...(system.length === 0 ? {} : { system: system.join(PART_SEPARATOR) }),
    text: text.join(PART_SEPARATOR),
    files: parts.flatMap((part) => [...(part.files ?? [])]),
  };
}

export function composePack(providers: readonly ContextProvider[], capabilities: Capabilities): ContextPack {
  return assemblePack(providePack(providers, capabilities));
}

export interface HistoryInput {
  participant: RoomParticipant;
  roomId: string;
  seen: readonly RoomEntry[];
  phase: PromptPhase;
  projectMap?: boolean;
  renderRun(entries: readonly RoomEntry[]): string;
}

export function historyProvider(input: HistoryInput): ContextProvider {
  const { participant, roomId, seen, phase } = input;
  return {
    id: 'history',
    priority: 0,
    provide(capabilities) {
      const prompt = buildParticipantPrompt(participant, roomId, seen, phase, input.projectMap === true ? { projectMap: true } : {});
      if (capabilities.splitsSystem) return { system: prompt.text, text: input.renderRun(seen) };
      if (capabilities.attachesFiles && prompt.attachHistory) return { text: prompt.text, files: [{ content: renderHistory(roomId, seen) }] };
      return { text: prompt.text };
    },
  };
}
