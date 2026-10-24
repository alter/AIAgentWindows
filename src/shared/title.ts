// title.ts
function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) if (isControlCode(value.charCodeAt(index))) return true;
  return false;
}

export function parseTitle(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string' || hasControlCharacter(value)) return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= maxChars ? title : null;
}
