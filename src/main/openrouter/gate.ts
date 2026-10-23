// gate.ts
import { effortSupported, type ModelItem, type OpenRouterStatus } from '../../shared/openrouter';
import { OPENROUTER_KIND, type RoomParticipant } from '../../shared/room-model';

export const SIGNED_OUT_PROBLEM = 'OpenRouter is not signed in: sign in before a run with an OpenRouter participant';

export function openrouterProblem(participants: readonly RoomParticipant[], status: OpenRouterStatus, models: readonly ModelItem[]): string | null {
  const rows = participants.filter((participant) => participant.kind === OPENROUTER_KIND);
  if (rows.length === 0) return null;
  if (status.state !== 'connected') return SIGNED_OUT_PROBLEM;
  for (const row of rows) {
    const model = models.find((item) => item.id === row.model);
    if (!effortSupported(model, row.effort ?? '')) return `${row.label}: the model does not offer the effort "${row.effort}"`;
  }
  return null;
}
