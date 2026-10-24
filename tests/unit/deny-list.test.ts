// deny-list.test.ts
import { describe, expect, it } from 'vitest';
import { DENY_DIRECTORY_NAMES, DENY_NAME_PATTERNS, DENY_PATH_SUFFIXES, denyReadRules, isDenied } from '../../src/shared/deny-list';

describe('isDenied', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'server.pem',
    'tls/server.key',
    'store.p12',
    'store.pfx',
    'release.keystore',
    'id_rsa',
    'id_ed25519.pub',
    'aws-credentials.json',
    'config/Credentials',
    'my-secret.txt',
    'secrets.yaml',
    'infra/terraform.tfstate',
    'db.sqlite',
    'data/app.sqlite3',
    '.claude/settings.local.json',
    '.npmrc',
    'web/.netrc',
    '.pypirc',
    '.aws/config',
    'deep/.aws/credentials',
    '.ssh/known_hosts',
    '.docker/config.json',
    'home/.docker/config.json',
  ])('denies %s', (file) => {
    expect(isDenied(file)).toBe(true);
  });

  it.each([
    'README.md',
    'src/index.ts',
    'src/environment.ts',
    'docs/keys.md',
    'package.json',
    '.docker/daemon.json',
    'docker/config.json',
    'settings.json',
    '.claude/settings.json',
    'identity.ts',
    'src/id.ts',
    '.gitignore',
  ])('allows %s', (file) => {
    expect(isDenied(file)).toBe(false);
  });

  it('denies everything below a directory whose name matches', () => {
    expect(isDenied('.env.d/readme.txt')).toBe(true);
    expect(isDenied('secret-stuff/notes.txt')).toBe(true);
    expect(isDenied('.ssh')).toBe(true);
    expect(isDenied('a/.aws')).toBe(true);
  });

  it('reads a path the way the filesystem does: separators, dot segments and case', () => {
    expect(isDenied('./.env')).toBe(true);
    expect(isDenied('config\\.env.local')).toBe(true);
    expect(isDenied('.ENV')).toBe(true);
    expect(isDenied('Keys/Server.PEM')).toBe(true);
    expect(isDenied('.SSH/id')).toBe(true);
    expect(isDenied('.Docker/Config.json')).toBe(true);
    expect(isDenied('')).toBe(false);
  });

  it('treats a glob character in a path as plain text', () => {
    expect(isDenied('a+b.txt')).toBe(false);
    expect(isDenied('x[1].md')).toBe(false);
    expect(isDenied('.env(1)')).toBe(true);
  });
});

describe('denyReadRules', () => {
  const rules = denyReadRules();

  it('gives a Read rule for every pattern, directory and path of the list, recursive from any depth', () => {
    for (const pattern of DENY_NAME_PATTERNS) {
      expect(rules).toContain(`Read(**/${pattern})`);
      expect(rules).toContain(`Read(**/${pattern}/**)`);
    }
    for (const name of DENY_DIRECTORY_NAMES) {
      expect(rules).toContain(`Read(**/${name})`);
      expect(rules).toContain(`Read(**/${name}/**)`);
    }
    for (const suffix of DENY_PATH_SUFFIXES) expect(rules).toContain(`Read(**/${suffix})`);
  });

  it('holds only Read rules and no duplicate', () => {
    expect(rules.every((rule) => /^Read\(\*\*\/.+\)$/.test(rule))).toBe(true);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it('names the owner-listed secrets', () => {
    for (const rule of ['Read(**/.env*)', 'Read(**/*.pem)', 'Read(**/id_*)', 'Read(**/*secret*)', 'Read(**/.aws/**)', 'Read(**/.ssh/**)', 'Read(**/.docker/config.json)']) {
      expect(rules).toContain(rule);
    }
  });
});
