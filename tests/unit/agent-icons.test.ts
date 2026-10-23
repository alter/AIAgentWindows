// agent-icons.test.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_KINDS } from '../../src/shared/agents';
import { AGENT_ICON_FILES, ICON_DIR, MONO_ICON_FILES } from '../../src/renderer/icons';

const ICONS = path.resolve(__dirname, '..', '..', 'src', 'renderer', 'assets', 'icons');

const PINNED_SHA256: Readonly<Record<string, string>> = {
  'claudecode-color.svg': '670b3d8d749d0815ad8f7e62a59d51cb5e2053cb19403f3541a8aed7036a877f',
  'codex-color.svg': '4a2f43ce46b5b6e3722c95088f88d26ef91e6a8c2e598e70642a1c54367386e4',
  'openai.svg': 'a595df6b423920c67a7f8f73c063e4bfb72d415948097b6cac063a2366bb5186',
  'grok.svg': '9175fc90c22655160231976c849f25a03b888d7cc0e04c5f1b987b659bb07c95',
  'deepseek-color.svg': 'deba5f98a5c1796e20fcac3149bcd7eb8a32f0bdd04d048819400b1f28bd1439',
  'openrouter-color.svg': '17bede1b89166f824ee06753dc526a3f5e18b769706deaab09d04a3a98de1a78',
};

describe('agent icon map', () => {
  it('names a vendored file for every agent kind', () => {
    expect(Object.keys(AGENT_ICON_FILES).sort()).toEqual([...AGENT_KINDS].sort());
    for (const kind of AGENT_KINDS) {
      const file = AGENT_ICON_FILES[kind];
      expect(file).toMatch(/^[a-z-]+\.svg$/);
      expect(existsSync(path.join(ICONS, file))).toBe(true);
    }
    expect(ICON_DIR).toBe('assets/icons');
  });

  it('vendors each file byte for byte as the pinned lobe-icons 1.95.1 release has it', () => {
    for (const [file, sha] of Object.entries(PINNED_SHA256)) {
      expect(createHash('sha256').update(readFileSync(path.join(ICONS, file))).digest('hex')).toBe(sha);
    }
  });

  it('ships the licence and the source of every file', () => {
    expect(readFileSync(path.join(ICONS, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2023 LobeHub');
    const sources = readFileSync(path.join(ICONS, 'SOURCES.md'), 'utf8');
    for (const file of Object.keys(PINNED_SHA256)) {
      expect(sources).toContain(`https://unpkg.com/@lobehub/icons-static-svg@1.95.1/icons/${file}`);
    }
  });

  it('marks only the single-colour logos, which follow the palette', () => {
    expect([...MONO_ICON_FILES].sort()).toEqual(['grok.svg', 'openai.svg']);
    for (const file of MONO_ICON_FILES) expect(readFileSync(path.join(ICONS, file), 'utf8')).toContain('fill="currentColor"');
    for (const kind of AGENT_KINDS) {
      const file = AGENT_ICON_FILES[kind];
      if (!MONO_ICON_FILES.includes(file)) expect(readFileSync(path.join(ICONS, file), 'utf8')).not.toContain('currentColor');
    }
  });
});
