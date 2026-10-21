// capture-sites.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'fixtures', 'sites');
const auto = process.argv.includes('--auto');

if (process.env.AIAW_USER_DATA) {
  console.error('capture-sites uses your own profile: unset AIAW_USER_DATA first.');
  process.exit(2);
}

const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const require = createRequire(import.meta.url);
const env = { ...process.env };

if (auto) {
  const { defaultUserData, profileInUse, systemProfileLockDeps } = require(path.join(root, 'dist', 'scripts', 'profile-lock.js'));
  const userData = defaultUserData(process.platform, process.env, os.homedir());
  const reason = await profileInUse(userData, systemProfileLockDeps());
  if (reason !== null) {
    console.error(`capture-sites --auto refused: ${reason}. Quit the running app first.`);
    process.exit(3);
  }
  env.AIAW_CAPTURE_AUTO = outDir;
  console.log(`Unattended capture: hidden windows, no Dock icon, existing chats only. Nothing is typed, clicked or sent. Structure goes to ${outDir}.`);
} else {
  env.AIAW_CAPTURE_SITES = outDir;
  console.log(`Open each site agent (signed in, on a chat that already has a reply), then press Cmd/Ctrl+Shift+K or use the Capture menu.`);
  console.log(`Only tags, ids, classes, roles and aria/data attributes are saved to ${outDir}; all text is replaced and nothing is sent to the sites.`);
}

const child = spawn(require('electron'), [root], { cwd: root, stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
