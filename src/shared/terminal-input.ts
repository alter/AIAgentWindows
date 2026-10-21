// terminal-input.ts
export interface KeyLike {
  type: string;
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const CTRL_V = '\x16';
const ALT_V = '\x1bv';

function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function rawKeySequence(event: KeyLike): string | null {
  if (event.code !== 'KeyV' || event.shiftKey || event.metaKey) return null;
  if (event.ctrlKey && !event.altKey) return CTRL_V;
  if (event.altKey && !event.ctrlKey) return ALT_V;
  return null;
}

export function quotePathForShell(filePath: string): string | null {
  if (filePath.length === 0 || hasControlCharacter(filePath)) return null;
  return `'${filePath.replaceAll("'", `'\\''`)}'`;
}

export function dropPastePayload(paths: readonly string[]): string {
  return paths
    .map(quotePathForShell)
    .filter((quoted): quoted is string => quoted !== null)
    .join(' ');
}

function isEscapeOrC1(code: number): boolean {
  return code === 0x1b || (code >= 0x80 && code <= 0x9f);
}

export function sanitizePaste(text: string): string {
  return Array.from(text)
    .filter((char) => !isEscapeOrC1(char.charCodeAt(0)))
    .join('');
}
