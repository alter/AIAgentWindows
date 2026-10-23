// terminal-theme.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemeOf, TERMINAL_MINIMUM_CONTRAST, terminalTheme } from '../../src/renderer/terminal-theme';

const css = readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles.css'), 'utf8');

function tokens(block: string): Map<string, string> {
  const pairs = [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match): [string, string] => [String(match[1]), String(match[2])]);
  return new Map(pairs);
}

function palette(scheme: 'dark' | 'light'): Map<string, string> {
  const dark = tokens(css.slice(css.indexOf(':root'), css.indexOf('@media')));
  if (scheme === 'dark') return dark;
  const light = tokens(css.slice(css.indexOf('@media (prefers-color-scheme: light)')));
  return new Map([...dark, ...light]);
}

describe('terminal theme', () => {
  it('terminal theme follows the scheme', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const tokenValues = palette(scheme);
      const theme = terminalTheme(scheme);
      expect(theme.background).toBe(tokenValues.get('--content-bg'));
      expect(theme.foreground).toBe(tokenValues.get('--text'));
      expect(theme.cursor).toBe(tokenValues.get('--text'));
      expect(theme.cursorAccent).toBe(tokenValues.get('--content-bg'));
      expect(theme.selectionBackground).toBe(`${tokenValues.get('--info-bg')}fe`);
      expect(theme.selectionForeground).toBe(tokenValues.get('--text'));
    }
    expect(terminalTheme('dark').background).not.toBe(terminalTheme('light').background);
  });

  it('returns a new object on every call so xterm recolours an open terminal', () => {
    expect(terminalTheme('dark')).not.toBe(terminalTheme('dark'));
  });

  it('keeps the minimum contrast ratio at the WCAG text level', () => {
    expect(TERMINAL_MINIMUM_CONTRAST).toBe(4.5);
  });

  it('maps the light media query result to a scheme', () => {
    expect(schemeOf(true)).toBe('light');
    expect(schemeOf(false)).toBe('dark');
  });
});
