// capture-sites.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'fixtures', 'sites');

if (process.env.AIAW_USER_DATA) {
  console.error('capture-sites uses your own profile: unset AIAW_USER_DATA first.');
  process.exit(2);
}

const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

console.log(`Open each site agent (signed in, on a chat that already has a reply), then press Cmd/Ctrl+Shift+K or use the Capture menu.`);
console.log(`Only tags, ids, classes, roles and aria/data attributes are saved to ${outDir}; all text is replaced and nothing is sent to the sites.`);

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [root], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, AIAW_CAPTURE_SITES: outDir },
});
child.on('exit', (code) => process.exit(code ?? 0));
