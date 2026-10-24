// deny-list.ts
export const DENY_NAME_PATTERNS: readonly string[] = [
  '.env*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_*',
  '*credentials*',
  '*secret*',
  '*.tfstate',
  '*.sqlite*',
  'settings.local.json',
  '.npmrc',
  '.netrc',
  '.pypirc',
];
export const DENY_DIRECTORY_NAMES: readonly string[] = ['.aws', '.ssh'];
const PATH_SUFFIXES: readonly (readonly string[])[] = [['.docker', 'config.json']];
export const DENY_PATH_SUFFIXES: readonly string[] = PATH_SUFFIXES.map((parts) => parts.join('/'));

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const NAME_MATCHERS: readonly RegExp[] = DENY_NAME_PATTERNS.map(
  (pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i'),
);

function componentsOf(relPath: string): string[] {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
}

function endsWithParts(parts: readonly string[], suffix: readonly string[]): boolean {
  if (parts.length < suffix.length) return false;
  const tail = parts.slice(parts.length - suffix.length);
  return suffix.every((part, index) => part.toLowerCase() === tail[index]?.toLowerCase());
}

export function isDenied(relPath: string): boolean {
  const parts = componentsOf(relPath);
  if (parts.some((part) => NAME_MATCHERS.some((matcher) => matcher.test(part)))) return true;
  if (parts.some((part) => DENY_DIRECTORY_NAMES.includes(part.toLowerCase()))) return true;
  return PATH_SUFFIXES.some((suffix) => endsWithParts(parts, suffix));
}

function readRule(glob: string): string {
  return `Read(${glob})`;
}

export function denyReadRules(): string[] {
  const rules: string[] = [];
  for (const pattern of DENY_NAME_PATTERNS) rules.push(readRule(`**/${pattern}`), readRule(`**/${pattern}/**`));
  for (const name of DENY_DIRECTORY_NAMES) rules.push(readRule(`**/${name}`), readRule(`**/${name}/**`));
  for (const suffix of DENY_PATH_SUFFIXES) rules.push(readRule(`**/${suffix}`));
  return rules;
}
