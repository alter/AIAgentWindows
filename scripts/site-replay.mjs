// site-replay.mjs
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];

if (!target) {
  console.error('usage: npm run site-replay -- <turn dir>   (a <userData>/debug/sites/<runId>/<site>-<turn> directory)');
  process.exit(2);
}

const bundle = path.join(root, 'dist', 'scripts', 'replay.js');
if (!existsSync(bundle)) {
  console.error('dist/scripts/replay.js is missing: run npm run build first.');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { runReplay } = require(bundle);

try {
  for (const line of await runReplay(path.resolve(target))) console.log(line);
} catch (error) {
  console.error(`site-replay failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
