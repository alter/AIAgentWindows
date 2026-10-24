// simple-ignore.ts
export type IgnoreMatcher = (relPath: string, isDirectory: boolean) => boolean;

interface IgnoreRule {
  regex: RegExp;
  directoryOnly: boolean;
  anchored: boolean;
}

function globSource(glob: string): string {
  let out = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.startsWith('**/', index)) {
      out += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && glob.charAt(index + 1) === '*') {
      out += '.*';
      index += 1;
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

function ruleOf(line: string): IgnoreRule | null {
  const text = line.replace(/\s+$/, '');
  if (text === '' || text.startsWith('#') || text.startsWith('!')) return null;
  const directoryOnly = text.endsWith('/');
  const body = directoryOnly ? text.slice(0, -1) : text;
  const anchored = body.includes('/');
  const trimmed = body.startsWith('/') ? body.slice(1) : body;
  return { regex: new RegExp(`^${globSource(trimmed)}$`), directoryOnly, anchored };
}

export function simpleIgnore(gitignoreText: string): IgnoreMatcher {
  const rules = gitignoreText.split(/\r?\n/).flatMap((line) => {
    const rule = ruleOf(line);
    return rule === null ? [] : [rule];
  });
  return (relPath, isDirectory) => {
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    return rules.some((rule) => (isDirectory || !rule.directoryOnly) && rule.regex.test(rule.anchored ? relPath : name));
  };
}
