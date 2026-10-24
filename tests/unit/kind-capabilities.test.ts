// kind-capabilities.test.ts
import { describe, expect, it } from 'vitest';
import { ROOM_AGENT_KINDS, SITE_KINDS } from '../../src/shared/agents';
import { CHARS_PER_TOKEN, NO_CATALOG, answerReserveTokens, capabilitiesOf, inputCharBudget, modelCatalog, type ModelCatalog } from '../../src/shared/kinds/capabilities';
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

describe('completion ceiling and input budget', () => {
  const reporting: ModelCatalog = {
    contextLength: (model) => (model === 'vendor/small' ? 4000 : 200000),
    maxCompletionTokens: (model) => (model === 'vendor/reports' ? 2048 : null),
  };

  it('carries the reported ceiling and nothing when the model reports none', () => {
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/reports'), reporting)).toEqual({
      attachesFiles: false,
      splitsSystem: true,
      tokenBudget: 200000,
      maxCompletionTokens: 2048,
    });
    expect(capabilitiesOf('openrouter', participant('openrouter', 'vendor/small'), reporting)).not.toHaveProperty('maxCompletionTokens');
  });

  it('reserves a quarter of the context for the answer, at most 16384 tokens, or the reported ceiling when it is lower', () => {
    expect(answerReserveTokens({ attachesFiles: false, splitsSystem: true, tokenBudget: 4000 })).toBe(1000);
    expect(answerReserveTokens({ attachesFiles: false, splitsSystem: true, tokenBudget: 200000 })).toBe(16384);
    expect(answerReserveTokens({ attachesFiles: false, splitsSystem: true, tokenBudget: 200000, maxCompletionTokens: 2048 })).toBe(2048);
    expect(answerReserveTokens({ attachesFiles: false, splitsSystem: true, tokenBudget: 4000, maxCompletionTokens: 8000 })).toBe(1000);
    expect(answerReserveTokens({ attachesFiles: false, splitsSystem: true })).toBeNull();
  });

  it('turns the rest of the context into characters at three per token', () => {
    expect(CHARS_PER_TOKEN).toBe(3);
    expect(inputCharBudget({ attachesFiles: false, splitsSystem: true, tokenBudget: 4000 })).toBe(3000 * 3);
    expect(inputCharBudget({ attachesFiles: false, splitsSystem: true })).toBeNull();
  });
});

describe('modelCatalog', () => {
  const item = (id: string, contextLength: number | null, maxCompletionTokens?: number) => ({
    id,
    name: id,
    contextLength,
    promptUsdPerMillion: null,
    completionUsdPerMillion: null,
    free: false,
    efforts: [],
    ...(maxCompletionTokens === undefined ? {} : { maxCompletionTokens }),
  });
  const catalog = modelCatalog([item('a/one', 4000, 512), item('a/two', null)]);

  it('answers from the model list and says null for a model it does not know or that reports nothing', () => {
    expect(catalog.contextLength('a/one')).toBe(4000);
    expect(catalog.maxCompletionTokens?.('a/one')).toBe(512);
    expect(catalog.contextLength('a/two')).toBeNull();
    expect(catalog.maxCompletionTokens?.('a/two')).toBeNull();
    expect(catalog.contextLength('a/none')).toBeNull();
  });
});
