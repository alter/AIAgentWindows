// kind-capabilities.test.ts
import { describe, expect, it } from 'vitest';
import { ROOM_AGENT_KINDS, SITE_KINDS } from '../../src/shared/agents';
import { NO_CATALOG, capabilitiesOf, type ModelCatalog } from '../../src/shared/kinds/capabilities';
import type { RoomParticipant } from '../../src/shared/room-model';

const catalog: ModelCatalog = { contextLength: (model) => (model === 'vendor/big' ? 200000 : model === 'vendor/odd' ? 0 : null) };

function participant(kind: RoomParticipant['kind'], model?: string): RoomParticipant {
  return { id: kind, kind, label: kind, ...(model === undefined ? {} : { model }) };
}

describe('capabilitiesOf', () => {
  it('lets a site kind attach files and nothing else', () => {
    for (const kind of SITE_KINDS) expect(capabilitiesOf(kind, participant(kind), catalog)).toEqual({ attachesFiles: true, splitsSystem: false });
  });

  it('gives a CLI kind neither files nor a system split', () => {
    for (const kind of ROOM_AGENT_KINDS.filter((item) => !SITE_KINDS.includes(item as never))) {
      expect(capabilitiesOf(kind, participant(kind), catalog)).toEqual({ attachesFiles: false, splitsSystem: false });
    }
  });

  it('splits the system prompt for OpenRouter and takes its budget from the model context length', () => {
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/big'), catalog)).toEqual({
      attachesFiles: false,
      splitsSystem: true,
      tokenBudget: 200000,
    });
  });

  it('leaves the budget out when the catalog does not know the model or the participant has none', () => {
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/unknown'), catalog)).toEqual({ attachesFiles: false, splitsSystem: true });
    expect(capabilitiesOf('openrouter', participant('openrouter'), catalog)).toEqual({ attachesFiles: false, splitsSystem: true });
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/big'), NO_CATALOG)).toEqual({ attachesFiles: false, splitsSystem: true });
  });

  it('ignores a context length that is not a positive number', () => {
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/odd'), catalog)).toEqual({ attachesFiles: false, splitsSystem: true });
  });
});
