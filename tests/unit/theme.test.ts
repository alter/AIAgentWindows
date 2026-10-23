// theme.test.ts
import { describe, expect, it } from 'vitest';
import { isThemeChoice, parseThemeChoice, THEME_CHOICES } from '../../src/shared/theme';

describe('theme choice', () => {
  it('lists system, light and dark', () => {
    expect([...THEME_CHOICES]).toEqual(['system', 'light', 'dark']);
  });

  it('keeps each known value', () => {
    for (const choice of THEME_CHOICES) {
      expect(parseThemeChoice(choice)).toBe(choice);
      expect(isThemeChoice(choice)).toBe(true);
    }
  });

  it('falls back to system for a missing or unknown value', () => {
    for (const value of [undefined, null, '', 'Dark', 'auto', 'neon', 0, 1, true, {}, [], ['dark']]) {
      expect(parseThemeChoice(value)).toBe('system');
      expect(isThemeChoice(value)).toBe(false);
    }
  });
});
