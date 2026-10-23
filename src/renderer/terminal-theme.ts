// terminal-theme.ts
import type { ITheme } from '@xterm/xterm';

export type Scheme = 'dark' | 'light';

export const TERMINAL_MINIMUM_CONTRAST = 4.5;
const SOLID_ALPHA = 'fe';
export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

const PALETTES: Record<Scheme, { contentBg: string; text: string; infoBg: string }> = {
  dark: { contentBg: '#1a1d21', text: '#ffffff', infoBg: '#0b4f82' },
  light: { contentBg: '#ffffff', text: '#000000', infoBg: '#c9e0f5' },
};

export function schemeOf(prefersLight: boolean): Scheme {
  return prefersLight ? 'light' : 'dark';
}

export function terminalTheme(scheme: Scheme): ITheme {
  const palette = PALETTES[scheme];
  return {
    background: palette.contentBg,
    foreground: palette.text,
    cursor: palette.text,
    cursorAccent: palette.contentBg,
    selectionBackground: `${palette.infoBg}${SOLID_ALPHA}`,
    selectionForeground: palette.text,
  };
}
