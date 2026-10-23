// cli-models.test.ts
import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTED_EFFORTS,
  MAX_SUGGESTED_MODELS,
  emptyRoomModels,
  parseClaudeHelpModels,
  parseCodexCatalog,
  parseCodexCatalogText,
} from '../../src/shared/cli-models';

const HELP = [
  'Usage: tool [options] [prompt]',
  '',
  'Options:',
  '  --debug                               Enable debug mode',
  '  --effort <level>                      Effort level for the current session',
  '                                        (low, medium, high, xhigh, max)',
  '  --fallback-model <model>              Fallback when the default is busy',
  '  --model <model>                       Model for the current session. Provide',
  "                                        an alias for the latest model (e.g.",
  "                                        'fable', 'opus', or 'sonnet') or a",
  "                                        model's full name.",
  '  -n, --name <name>                     Set a display name',
].join('\n');

function catalog(models: unknown[]): unknown {
  return { models };
}

function entry(slug: unknown, visibility: unknown, efforts: unknown[]): unknown {
  return { slug, visibility, supported_reasoning_levels: efforts.map((effort) => ({ effort, description: 'text' })) };
}

describe('parseClaudeHelpModels', () => {
  it('reads the aliases quoted in the model flag and the levels in the effort flag', () => {
    expect(parseClaudeHelpModels(HELP)).toEqual({
      models: ['fable', 'opus', 'sonnet'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('gives empty lists when the flags are absent or the text is empty', () => {
    expect(parseClaudeHelpModels('')).toEqual({ models: [], efforts: [] });
    expect(parseClaudeHelpModels('Usage: tool\n  --debug  on')).toEqual({ models: [], efforts: [] });
  });

  it('reads one list when the other flag is missing', () => {
    expect(parseClaudeHelpModels("  --model <model>  alias (e.g. 'opus')").models).toEqual(['opus']);
    expect(parseClaudeHelpModels('  --effort <level>  (low, high)').efforts).toEqual(['low', 'high']);
  });

  it('drops values outside the allowed shape and duplicates', () => {
    const text = [
      "  --model <model>  e.g. 'opus', 'two words', 'opus', \"x\", 'a;b'",
      '  --effort <level>  (low, HIGH, low, high-ish, medium)',
    ].join('\n');
    expect(parseClaudeHelpModels(text)).toEqual({ models: ['opus'], efforts: ['low', 'medium'] });
  });

  it('stops a flag description at the next flag and takes only the first parenthesis', () => {
    const text = [
      "  --model <model>  see 'opus'",
      "  --other <x>  e.g. 'not-a-model'",
      '  --effort <level>  (low, high) and (max)',
    ].join('\n');
    expect(parseClaudeHelpModels(text)).toEqual({ models: ['opus'], efforts: ['low', 'high'] });
  });

  it('stops a flag description at a blank line', () => {
    const text = ["  --model <model>  see 'opus'", '', "  trailing 'not-a-model'"].join('\n');
    expect(parseClaudeHelpModels(text).models).toEqual(['opus']);
  });

  it('is bounded in lines read and in items returned', () => {
    const many = Array.from({ length: 80 }, (_, i) => `'m${i}'`).join(', ');
    expect(parseClaudeHelpModels(`  --model <model>  ${many}`).models).toHaveLength(MAX_SUGGESTED_MODELS);
    const efforts = Array.from({ length: 40 }, (_, i) => `e${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(', ');
    expect(parseClaudeHelpModels(`  --effort <level>  (${efforts})`).efforts).toHaveLength(MAX_SUGGESTED_EFFORTS);
    const lines = ['  --model <model>  first', ...Array.from({ length: 30 }, () => '      filler'), "      'late'"];
    expect(parseClaudeHelpModels(lines.join('\n')).models).toEqual([]);
  });
});

describe('parseCodexCatalog', () => {
  it('offers only models with visibility list and their own levels', () => {
    const value = catalog([
      entry('gpt-a', 'list', ['low', 'medium', 'high']),
      entry('gpt-hidden', 'hide', ['low']),
      entry('gpt-b', 'list', ['low', 'ultra']),
    ]);
    expect(parseCodexCatalog(value)).toEqual({
      models: [
        { id: 'gpt-a', efforts: ['low', 'medium', 'high'] },
        { id: 'gpt-b', efforts: ['low', 'ultra'] },
      ],
    });
  });

  it('tolerates missing and malformed parts', () => {
    expect(parseCodexCatalog(null)).toEqual({ models: [] });
    expect(parseCodexCatalog([])).toEqual({ models: [] });
    expect(parseCodexCatalog({})).toEqual({ models: [] });
    expect(parseCodexCatalog({ models: 'x' })).toEqual({ models: [] });
    const value = catalog([
      null,
      'text',
      entry(7, 'list', ['low']),
      entry('bad name', 'list', ['low']),
      entry('gpt-a', 'list', ['low', 7, 'BAD', 'high', 'low']),
      { slug: 'gpt-b', visibility: 'list' },
      { slug: 'gpt-c', visibility: 'list', supported_reasoning_levels: [null, 'text', {}, { effort: 'max' }] },
      { slug: 'gpt-d', visibility: 'list', supported_reasoning_levels: 'low' },
      entry('gpt-a', 'list', ['medium']),
    ]);
    expect(parseCodexCatalog(value)).toEqual({
      models: [
        { id: 'gpt-a', efforts: ['low', 'high'] },
        { id: 'gpt-b', efforts: [] },
        { id: 'gpt-c', efforts: ['max'] },
        { id: 'gpt-d', efforts: [] },
      ],
    });
  });

  it('is bounded in models and levels', () => {
    const models = Array.from({ length: 120 }, (_, i) => entry(`m${i}`, 'list', ['low']));
    expect(parseCodexCatalog(catalog(models)).models).toHaveLength(MAX_SUGGESTED_MODELS);
    const levels = Array.from({ length: 40 }, (_, i) => `l${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
    expect(parseCodexCatalog(catalog([entry('m', 'list', levels)])).models[0]?.efforts).toHaveLength(MAX_SUGGESTED_EFFORTS);
  });
});

describe('parseCodexCatalogText', () => {
  const body = JSON.stringify(catalog([entry('gpt-a', 'list', ['low'])]));

  it('reads plain JSON and JSON after start-up noise', () => {
    expect(parseCodexCatalogText(body).models).toEqual([{ id: 'gpt-a', efforts: ['low'] }]);
    expect(parseCodexCatalogText(`shell banner\n${body}\n`).models).toEqual([{ id: 'gpt-a', efforts: ['low'] }]);
  });

  it('gives no models for null, text without JSON and broken JSON', () => {
    expect(parseCodexCatalogText(null).models).toEqual([]);
    expect(parseCodexCatalogText('no json here').models).toEqual([]);
    expect(parseCodexCatalogText('{"models": [').models).toEqual([]);
    expect(parseCodexCatalogText('{ not json }').models).toEqual([]);
  });
});

describe('emptyRoomModels', () => {
  it('has nothing to suggest for either CLI', () => {
    expect(emptyRoomModels()).toEqual({ claude: { models: [], efforts: [] }, codex: { models: [] } });
  });
});
