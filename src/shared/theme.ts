// theme.ts
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (THEME_CHOICES as readonly unknown[]).includes(value);
}

export function parseThemeChoice(value: unknown): ThemeChoice {
  return isThemeChoice(value) ? value : 'system';
}
