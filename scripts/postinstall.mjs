// postinstall.mjs
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let packageDir;
try {
  packageDir = path.dirname(require.resolve('node-pty/package.json'));
} catch {
  process.exit(0);
}

const prebuilds = path.join(packageDir, 'prebuilds');
if (existsSync(prebuilds)) {
  for (const entry of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, entry, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
