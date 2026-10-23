// openrouter-room.test.ts
import { describe, expect, it } from 'vitest';
import { failedStatus, readAnswer } from '../../src/main/openrouter/chat';
import { rateLimitText } from '../../src/shared/openrouter-chat';
import {
  GATEWAY_EFFORTS,
  effortSupported,
  modelPick,
  modelPriceText,
  parseModels,
  pickableModels,
  type ModelItem,
} from '../../src/shared/openrouter';
import { parseRoomRecord } from '../../src/shared/room-model';
import { buildParticipantPrompt, WEB_INLINE_LIMIT } from '../../src/shared/room-history';
import {
  addMenuOptions,
  addRow,
  formFromRecord,
  formToConfig,
  openrouterEffortChoices,
  rowLabel,
  type RoomFormValues,
} from '../../src/shared/room-view';

const NOW = Date.parse('2026-10-23T12:00:00Z');

function entry(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: `Name of ${id}`, context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, ...patch };
}

function item(patch: Partial<ModelItem> = {}): ModelItem {
  return { id: 'acme/paid-model', name: 'Acme Paid', contextLength: 32000, promptUsdPerMillion: 3, completionUsdPerMillion: 15, free: false, efforts: [], ...patch };
}

describe('model efforts', () => {
  const efforts = (reasoning: unknown): string[] | undefined =>
    parseModels({ data: [entry('a/b', reasoning === undefined ? {} : { reasoning })] }, NOW)[0]?.efforts;

  it('are the supported_efforts of the model, in the listed order', () => {
    expect(efforts({ supported_efforts: ['high', 'medium', 'low'] })).toEqual(['high', 'medium', 'low']);
  });

  it('are empty when the model has no reasoning field, no efforts, or something that is not a list', () => {
    expect(efforts(undefined)).toEqual([]);
    expect(efforts('yes')).toEqual([]);
    expect(efforts({ default_enabled: false })).toEqual([]);
    expect(efforts({ supported_efforts: 'high' })).toEqual([]);
    expect(efforts({ supported_efforts: [] })).toEqual([]);
  });

  it('are every gateway value when supported_efforts is null', () => {
    expect(efforts({ supported_efforts: null })).toEqual([...GATEWAY_EFFORTS]);
  });

  it('drop none when the model is mandatory, and values of a wrong shape and duplicates', () => {
    expect(efforts({ supported_efforts: ['high', 'none'], mandatory: true })).toEqual(['high']);
    expect(efforts({ supported_efforts: null, mandatory: true })).not.toContain('none');
    expect(efforts({ supported_efforts: ['high', 'High', 3, 'x-high', 'high', 'none'], mandatory: false })).toEqual(['high', 'none']);
  });

  it('are offered by the room only from the model, and a saved value only while the model is unknown', () => {
    expect(openrouterEffortChoices(item({ efforts: ['high', 'low'] }), 'medium')).toEqual(['high', 'low']);
    expect(openrouterEffortChoices(item(), 'high')).toEqual([]);
    expect(openrouterEffortChoices(undefined, 'high')).toEqual(['high']);
    expect(openrouterEffortChoices(undefined, '')).toEqual([]);
  });

  it('are accepted when empty, when the model is unknown, or when listed', () => {
    expect(effortSupported(item({ efforts: ['high'] }), '')).toBe(true);
    expect(effortSupported(undefined, 'high')).toBe(true);
    expect(effortSupported(item({ efforts: ['high'] }), 'high')).toBe(true);
    expect(effortSupported(item({ efforts: ['high'] }), 'low')).toBe(false);
    expect(effortSupported(item(), 'low')).toBe(false);
  });
});

describe('model choice for a room row', () => {
  it('web search starts on for a paid model and off for a free one, and the name is kept', () => {
    expect(modelPick(item())).toEqual({ model: 'acme/paid-model', modelName: 'Acme Paid', web: true });
    expect(modelPick(item({ id: 'acme/f:free', name: 'F', free: true }))).toEqual({ model: 'acme/f:free', modelName: 'F', web: false });
  });

  it('only models whose id has the allowed shape can be picked', () => {
    const list = [item(), item({ id: 'Acme/Upper' }), item({ id: '~acme/alias' }), item({ id: 'acme/free:free', free: true })];
    expect(pickableModels(list).map((model) => model.id)).toEqual(['acme/paid-model', 'acme/free:free']);
  });

  it('the price is shown per million tokens, or as free', () => {
    expect(modelPriceText(item())).toBe('$3 in / $15 out per 1M tokens');
    expect(modelPriceText(item({ free: true }))).toBe('free');
    expect(modelPriceText(item({ promptUsdPerMillion: null, completionUsdPerMillion: 0.25 }))).toBe('? in / $0.25 out per 1M tokens');
  });
});

describe('add participant menu', () => {
  it('lists OpenRouter last, usable when signed in and disabled with its reason when signed out', () => {
    const signedIn = addMenuOptions([], undefined, true).at(-1);
    expect(signedIn).toMatchObject({ kind: 'openrouter', available: true, note: '' });
    const signedOut = addMenuOptions([], undefined, false).at(-1);
    expect(signedOut).toMatchObject({ kind: 'openrouter', available: false });
    expect(signedOut?.note).not.toBe('');
  });

  it('is usable by default and as often as the owner wants, with numbered ids', () => {
    expect(addMenuOptions([]).at(-1)?.available).toBe(true);
    const once = addRow([], 'openrouter');
    const twice = addRow(once, 'openrouter');
    expect(twice.map((row) => row.id)).toEqual(['openrouter', 'openrouter-2']);
    expect(addMenuOptions(twice).at(-1)?.available).toBe(true);
  });
});

describe('form rows of kind openrouter', () => {
  const form: RoomFormValues = {
    prompt: 'q',
    mode: 'relay',
    rounds: '1',
    timeoutMinutes: '1',
    checked: ['openrouter', 'openrouter-2'],
    rows: [
      { id: 'openrouter', kind: 'openrouter', model: 'acme/paid-model', modelName: 'Acme Paid', effort: 'high', web: true },
      { id: 'openrouter-2', kind: 'openrouter', model: 'acme/free-model:free', modelName: 'Acme Free', web: false },
    ],
  };

  it('become participants with their model, effort, web flag and label', () => {
    const result = formToConfig(form);
    expect(result.ok && result.config.participants).toEqual([
      { id: 'openrouter', kind: 'openrouter', model: 'acme/paid-model', modelName: 'Acme Paid', effort: 'high', web: true, label: 'OpenRouter · Acme Paid · high' },
      { id: 'openrouter-2', kind: 'openrouter', model: 'acme/free-model:free', modelName: 'Acme Free', web: false, label: 'OpenRouter · Acme Free' },
    ]);
    expect(rowLabel(form.rows?.[0] as never)).toBe('OpenRouter · Acme Paid · high');
  });

  it('are refused while no model is chosen', () => {
    expect(formToConfig({ ...form, checked: ['openrouter'], rows: [{ id: 'openrouter', kind: 'openrouter' }] }).ok).toBe(false);
  });

  it('come back from a saved record with their settings', () => {
    const config = formToConfig(form);
    if (!config.ok) throw new Error('config');
    const record = parseRoomRecord({
      version: 1,
      id: 'r1',
      createdAt: 1,
      updatedAt: 2,
      status: 'done',
      config: { ...config.config, prompt: undefined },
      entries: [],
      nonce: 'abcd1234abcd1234',
    });
    expect(record).not.toBeNull();
    expect(formFromRecord(record as never).rows).toEqual(form.rows);
  });
});

describe('label of a long name', () => {
  it('is cut before a surrogate pair is split', () => {
    const name = `${'x'.repeat(78)}\u{1F600}tail`;
    const result = formToConfig({
      prompt: 'q',
      mode: 'relay',
      rounds: '1',
      timeoutMinutes: '1',
      checked: ['openrouter'],
      rows: [{ id: 'openrouter', kind: 'openrouter', model: 'a/b', modelName: name }],
    });
    const label = result.ok ? (result.config.participants[0]?.label ?? '') : '';
    expect(label).toBe(`OpenRouter \u00b7 ${'x'.repeat(78)}\u2026`);
  });
});

describe('prompt for an openrouter participant', () => {
  const participant = { id: 'openrouter', kind: 'openrouter' as const, label: 'OpenRouter · a/b', model: 'a/b' };
  const entries = [{ authorId: 'owner', label: 'Owner', time: 1, kind: 'prompt' as const, text: 'x'.repeat(WEB_INLINE_LIMIT * 2) }];

  it('carries only the instructions and leaves the whole history to the driver, however long it is', () => {
    const prompt = buildParticipantPrompt(participant, 'room-1', entries, false);
    expect(prompt.placeHistory).toBe(true);
    expect(prompt.attachHistory).toBe(false);
    expect(prompt.text).toContain(participant.label);
    expect(prompt.text).not.toContain('xxxxx');
    expect(prompt.text).not.toContain('attached file');
  });
});

describe('429 text of a room turn and of a chat reply', () => {
  const RESET_NOW = Date.parse('2026-10-23T12:00:00Z');
  const reset = String(RESET_NOW + 30 * 60_000);
  const providerError = { code: 429, message: 'Upstream busy', metadata: { provider_name: 'Acme Cloud', provider_code: 429 } };
  const platformError = { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } };
  const thrown = (error: unknown, header: string | null): string => {
    try {
      readAnswer(429, JSON.stringify({ error }), header, RESET_NOW);
    } catch (caught) {
      return (caught as Error).message;
    }
    return '';
  };

  it('is the one text of the shared function, with the reset header of the answer', () => {
    expect(thrown(providerError, reset)).toBe(rateLimitText(providerError, reset, RESET_NOW));
    expect(thrown(platformError, reset)).toBe(rateLimitText(platformError, reset, RESET_NOW));
    expect(thrown(platformError, null)).toBe(rateLimitText(platformError, null, RESET_NOW));
    expect(thrown(platformError, reset)).not.toBe(thrown(platformError, null));
    expect(thrown(providerError, null)).not.toBe(thrown(platformError, null));
  });

  it('a status answer reads the same text from an already parsed body', () => {
    expect(failedStatus(429, { error: providerError }, reset, RESET_NOW).message).toBe(rateLimitText(providerError, reset, RESET_NOW));
    expect(failedStatus(429, undefined, null, RESET_NOW).code).toBe('failed');
    expect(failedStatus(429, { error: platformError }).message).toBeTruthy();
  });
});
