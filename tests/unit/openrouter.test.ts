// openrouter.test.ts
import { describe, expect, it } from 'vitest';
import {
  MAX_KEY_CHARS,
  attributionHeaders,
  authUrl,
  filterModels,
  isFreeModel,
  noticeText,
  openrouterBase,
  openrouterTestMode,
  parseKeyInfo,
  parseModels,
  parsePastedKey,
  sortModels,
  type ModelItem,
} from '../../src/shared/openrouter';

const NOW = Date.parse('2026-10-23T12:00:00Z');

function entry(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Name of ${id}`,
    context_length: 8000,
    architecture: { output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    ...patch,
  };
}

function parse(entries: unknown[]): ModelItem[] {
  return parseModels({ data: entries }, NOW);
}

describe('pasted key', () => {
  it('a pasted key is trimmed and refused when empty, too long or with whitespace inside', () => {
    expect(parsePastedKey('  sk-or-v1-abc123\n')).toBe('sk-or-v1-abc123');
    expect(parsePastedKey('')).toBeNull();
    expect(parsePastedKey('   \n')).toBeNull();
    expect(parsePastedKey('sk-or v1')).toBeNull();
    expect(parsePastedKey('sk-or-v1\tabc')).toBeNull();
    expect(parsePastedKey('sk-or-v1\nabc')).toBeNull();
    expect(parsePastedKey('a'.repeat(MAX_KEY_CHARS))).toBe('a'.repeat(MAX_KEY_CHARS));
    expect(parsePastedKey('a'.repeat(MAX_KEY_CHARS + 1))).toBeNull();
    expect(parsePastedKey('sk-or-\u0000x')).toBeNull();
    expect(parsePastedKey(42)).toBeNull();
    expect(parsePastedKey(undefined)).toBeNull();
  });
});

describe('test mode', () => {
  it('replaces the base url only with a loopback origin and a user data override', () => {
    const base = { AIAW_USER_DATA: '/tmp/x', AIAW_OPENROUTER_BASE: 'http://127.0.0.1:4555' };
    expect(openrouterBase(base)).toBe('http://127.0.0.1:4555');
    expect(openrouterTestMode(base)).toBe(true);
    expect(openrouterBase({ ...base, AIAW_OPENROUTER_BASE: 'http://localhost:4555/' })).toBe('http://localhost:4555');
    expect(openrouterBase({ AIAW_OPENROUTER_BASE: 'http://127.0.0.1:4555' })).toBe('https://openrouter.ai');
    expect(openrouterBase({ AIAW_USER_DATA: '', AIAW_OPENROUTER_BASE: 'http://127.0.0.1:4555' })).toBe('https://openrouter.ai');
    expect(openrouterTestMode({ AIAW_OPENROUTER_BASE: 'http://127.0.0.1:4555' })).toBe(false);
    for (const bad of [
      'https://evil.example',
      'http://evil.example:80',
      'http://127.0.0.1',
      'http://127.0.0.1:4555/path',
      'http://127.0.0.1:4555/?x=1',
      'http://user@127.0.0.1:4555',
      'ftp://127.0.0.1:4555',
      'not a url',
      '',
    ]) {
      expect(openrouterBase({ ...base, AIAW_OPENROUTER_BASE: bad })).toBe('https://openrouter.ai');
      expect(openrouterTestMode({ ...base, AIAW_OPENROUTER_BASE: bad })).toBe(false);
    }
    expect(openrouterBase({})).toBe('https://openrouter.ai');
  });

  it('names the app on every request with the attribution headers of the study', () => {
    expect(attributionHeaders()).toEqual({
      'HTTP-Referer': 'http://localhost',
      'X-OpenRouter-Title': 'AI Agent Windows',
      'X-OpenRouter-App-Visibility': 'hidden',
    });
  });
});

describe('auth url', () => {
  it('carries the S256 challenge, the callback and the state, and in code mode neither callback nor state', () => {
    const url = new URL(authUrl('https://openrouter.ai', { challenge: 'CH', callbackUrl: 'http://localhost:5/callback', state: 'ST' }));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: 'http://localhost:5/callback',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      state: 'ST',
      key_label: 'AI Agent Windows',
    });
    const headless = new URL(authUrl('https://openrouter.ai', { challenge: 'CH' }));
    expect(Object.fromEntries(headless.searchParams)).toEqual({
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      key_label: 'AI Agent Windows',
    });
  });
});

describe('free rule', () => {
  it('is a :free suffix, the free router, or a zero prompt and completion price', () => {
    expect(isFreeModel('vendor/model:free', 1, 1)).toBe(true);
    expect(isFreeModel('openrouter/free', null, null)).toBe(true);
    expect(isFreeModel('google/lyria-3-preview', 0, 0)).toBe(true);
    expect(isFreeModel('vendor/model', 0, 0.000002)).toBe(false);
    expect(isFreeModel('vendor/model', 0.000001, 0)).toBe(false);
    expect(isFreeModel('vendor/model', null, 0)).toBe(false);
    expect(isFreeModel('vendor/model', 0, null)).toBe(false);
    expect(isFreeModel('vendor/model:free-ish', 1, 1)).toBe(false);
  });
});

describe('model list parse', () => {
  it('turns pricing strings into dollars per million tokens and flags the free ones', () => {
    const [paid, free, router] = parse([
      entry('vendor/paid'),
      entry('vendor/zero', { pricing: { prompt: '0', completion: '0' } }),
      entry('openrouter/auto', { pricing: { prompt: '-1', completion: '-1' } }),
    ]);
    expect(paid).toEqual({
      id: 'vendor/paid',
      name: 'Name of vendor/paid',
      contextLength: 8000,
      promptUsdPerMillion: 1,
      completionUsdPerMillion: 2,
      free: false,
    });
    expect(free?.free).toBe(true);
    expect(free?.promptUsdPerMillion).toBe(0);
    expect(router?.promptUsdPerMillion).toBeNull();
    expect(router?.completionUsdPerMillion).toBeNull();
    expect(router?.free).toBe(false);
  });

  it('keeps text-output models only, hides expired ones, drops duplicates and malformed entries', () => {
    const items = parse([
      entry('a/text'),
      entry('a/image', { architecture: { output_modalities: ['image'] } }),
      entry('a/no-architecture', { architecture: undefined }),
      entry('a/bad-architecture', { architecture: 'x' }),
      entry('a/no-modalities', { architecture: {} }),
      entry('a/expired', { expiration_date: '2026-10-01' }),
      entry('a/expiring', { expiration_date: '2026-10-31' }),
      entry('a/odd-date', { expiration_date: 'soon' }),
      entry('a/text'),
      entry(''),
      entry('x'.repeat(201)),
      { name: 'no id' },
      'not an object',
      null,
    ]);
    expect(items.map((item) => item.id)).toEqual(['a/text', 'a/no-architecture', 'a/no-modalities', 'a/expiring', 'a/odd-date']);
  });

  it('falls back to the id for a missing name, caps a long name and tolerates odd numbers', () => {
    const [noName, longName, odd] = parse([
      entry('a/no-name', { name: undefined }),
      entry('a/long', { name: 'n'.repeat(500) }),
      entry('a/odd', { context_length: 'big', pricing: { prompt: 'cheap', completion: 3 } }),
    ]);
    expect(noName?.name).toBe('a/no-name');
    expect(longName?.name).toHaveLength(200);
    expect(odd?.contextLength).toBeNull();
    expect(odd?.promptUsdPerMillion).toBeNull();
    expect(odd?.completionUsdPerMillion).toBeNull();
    expect(parse([entry('a/no-pricing', { pricing: undefined })])[0]?.promptUsdPerMillion).toBeNull();
    expect(parse([entry('a/neg-context', { context_length: -5 })])[0]?.contextLength).toBeNull();
  });

  it('returns nothing for a body that is not a model list', () => {
    expect(parseModels(null, NOW)).toEqual([]);
    expect(parseModels({}, NOW)).toEqual([]);
    expect(parseModels({ data: 'x' }, NOW)).toEqual([]);
    expect(parseModels([], NOW)).toEqual([]);
  });
});

describe('filter and sort', () => {
  const items = parse([
    entry('b/zeta', { name: 'Zeta Pro', context_length: 4000 }),
    entry('a/alpha:free', { name: 'Alpha', context_length: 128000, pricing: { prompt: '0', completion: '0' } }),
    entry('c/mid', { name: 'mid', context_length: 32000, pricing: { prompt: '0.0000005', completion: '0.000001' } }),
    entry('openrouter/auto', { name: 'Auto', context_length: null, pricing: { prompt: '-1', completion: '-1' } }),
  ]);

  it('filters by free, paid or all and by a text query on id and name', () => {
    expect(filterModels(items, 'all', '')).toHaveLength(4);
    expect(filterModels(items, 'free', '').map((item) => item.id)).toEqual(['a/alpha:free']);
    expect(filterModels(items, 'paid', '').map((item) => item.id)).toEqual(['b/zeta', 'c/mid', 'openrouter/auto']);
    expect(filterModels(items, 'all', '  ZETA ').map((item) => item.id)).toEqual(['b/zeta']);
    expect(filterModels(items, 'all', 'c/m').map((item) => item.id)).toEqual(['c/mid']);
    expect(filterModels(items, 'free', 'zeta')).toEqual([]);
  });

  it('sorts by name, by price (unknown last) or by context size (unknown last)', () => {
    expect(sortModels(items, 'name').map((item) => item.id)).toEqual(['a/alpha:free', 'openrouter/auto', 'c/mid', 'b/zeta']);
    expect(sortModels(items, 'price').map((item) => item.id)).toEqual(['a/alpha:free', 'c/mid', 'b/zeta', 'openrouter/auto']);
    expect(sortModels(items, 'context').map((item) => item.id)).toEqual(['a/alpha:free', 'c/mid', 'b/zeta', 'openrouter/auto']);
  });

  it('breaks ties by id and leaves the input untouched', () => {
    const same = parse([entry('b/two', { name: 'Same' }), entry('a/one', { name: 'Same' })]);
    expect(sortModels(same, 'name').map((item) => item.id)).toEqual(['a/one', 'b/two']);
    expect(sortModels(same, 'price').map((item) => item.id)).toEqual(['a/one', 'b/two']);
    expect(sortModels(same, 'context').map((item) => item.id)).toEqual(['a/one', 'b/two']);
    expect(same.map((item) => item.id)).toEqual(['b/two', 'a/one']);
    const unknown = parse([
      entry('b/two', { context_length: null, pricing: {} }),
      entry('a/one', { context_length: null, pricing: {} }),
    ]);
    expect(sortModels(unknown, 'price').map((item) => item.id)).toEqual(['a/one', 'b/two']);
    expect(sortModels(unknown, 'context').map((item) => item.id)).toEqual(['a/one', 'b/two']);
  });
});

describe('key info parse', () => {
  it('reads the free daily counter, the free-tier flag and the remaining credit limit', () => {
    expect(
      parseKeyInfo({
        data: {
          label: 'sk-or-v1-abc...xyz',
          is_free_tier: true,
          limit_remaining: 4.5,
          free_model_daily_requests: { used: 3, limit: 50, remaining: 47 },
        },
      }),
    ).toEqual({ isFreeTier: true, limitRemaining: 4.5, freeRequests: { used: 3, limit: 50, remaining: 47 } });
  });

  it('keeps unknown parts null and refuses a body without data', () => {
    expect(parseKeyInfo({ data: {} })).toEqual({ isFreeTier: null, limitRemaining: null, freeRequests: null });
    expect(parseKeyInfo({ data: { is_free_tier: 'yes', limit_remaining: null, free_model_daily_requests: null } })).toEqual({
      isFreeTier: null,
      limitRemaining: null,
      freeRequests: null,
    });
    expect(parseKeyInfo({ data: { free_model_daily_requests: { used: 1, limit: 2 } } })?.freeRequests).toBeNull();
    expect(parseKeyInfo({ data: { free_model_daily_requests: { used: -1, limit: 2, remaining: 1 } } })?.freeRequests).toBeNull();
    expect(parseKeyInfo({ data: { free_model_daily_requests: { used: 1.5, limit: 2, remaining: 1 } } })?.freeRequests).toBeNull();
    expect(parseKeyInfo({ data: { limit_remaining: 'lots' } })?.limitRemaining).toBeNull();
    expect(parseKeyInfo({})).toBeNull();
    expect(parseKeyInfo(null)).toBeNull();
    expect(parseKeyInfo({ data: [] })).toBeNull();
    expect(parseKeyInfo('x')).toBeNull();
  });
});

describe('notices', () => {
  it('has a sentence for every notice code and none for no notice', () => {
    for (const code of ['storage-unavailable', 'sign-in-failed', 'sign-in-timeout', 'key-rejected', 'invalid-key', 'network', 'open-failed'] as const) {
      expect(noticeText(code).length).toBeGreaterThan(10);
    }
    expect(noticeText(null)).toBe('');
  });
});
