// build.mjs
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const at = (...parts) => path.join(root, ...parts);

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'renderer'), { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2023' };

await Promise.all([
  build({
    ...common,
    entryPoints: [at('src/main/index.ts')],
    outfile: at('dist/main/index.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node-pty'],
  }),
  build({
    ...common,
    entryPoints: [at('src/main/profile-lock.ts')],
    outfile: at('dist/scripts/profile-lock.js'),
    platform: 'node',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: [at('src/main/site-adapters/replay.ts')],
    outfile: at('dist/scripts/replay.js'),
    platform: 'node',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: [at('src/preload/index.ts')],
    outfile: at('dist/preload/index.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: [at('src/renderer/index.ts')],
    outfile: at('dist/renderer/index.js'),
    platform: 'browser',
    format: 'iife',
    loader: { '.css': 'css' },
  }),
]);

await cp(at('src/renderer/index.html'), at('dist/renderer/index.html'));
await cp(at('src/renderer/styles.css'), at('dist/renderer/styles.css'));
await cp(at('src/renderer/assets'), at('dist/renderer/assets'), { recursive: true });
await cp(at('node_modules/@xterm/xterm/css/xterm.css'), at('dist/renderer/xterm.css'));
