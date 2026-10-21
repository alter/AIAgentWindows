// room-history.ts
import type { RoomEntry, RoomParticipant } from './room-model';

export const WEB_INLINE_LIMIT = 12000;

export interface ParticipantPrompt {
  text: string;
  attachHistory: boolean;
}

function entryHeading(entry: RoomEntry): string {
  const when = new Date(entry.time).toISOString();
  return `## ${when} | ${entry.label} | ${entry.kind}`;
}

export function renderHistory(roomId: string, entries: readonly RoomEntry[]): string {
  const blocks = entries.map((entry) => `${entryHeading(entry)}\n\n${entry.text}\n`);
  return [`# Room ${roomId}\n`, ...blocks].join('\n');
}

function introFor(participant: RoomParticipant): string {
  return [
    `You are ${participant.label} in a room where several AI agents and the owner take turns.`,
    'Read the whole history, in order, then answer the latest request.',
    'Reply with your answer only. Do not run commands or edit files.',
  ].join(' ');
}

function cliPrompt(participant: RoomParticipant, historyPath: string): ParticipantPrompt {
  const text = `${introFor(participant)}\nThe history is in the file: ${historyPath}`;
  return { text, attachHistory: false };
}

function webPrompt(participant: RoomParticipant, roomId: string, entries: readonly RoomEntry[]): ParticipantPrompt {
  const history = renderHistory(roomId, entries);
  if (history.length > WEB_INLINE_LIMIT) {
    return { text: `${introFor(participant)}\nThe history is in the attached file.`, attachHistory: true };
  }
  return { text: `${introFor(participant)}\n\n${history}`, attachHistory: false };
}

export function buildParticipantPrompt(
  participant: RoomParticipant,
  roomId: string,
  entries: readonly RoomEntry[],
  historyPath: string,
): ParticipantPrompt {
  if (participant.kind === 'claude' || participant.kind === 'codex') return cliPrompt(participant, historyPath);
  return webPrompt(participant, roomId, entries);
}
