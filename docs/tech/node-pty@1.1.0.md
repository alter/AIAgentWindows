# node-pty@1.1.0

Pinned 2026-10-21 (published 2025-12-22).

- Uses node-addon-api (N-API); the darwin-arm64 prebuild loaded under Electron 44.6.0 without a rebuild (win32 not run, EVIDENCE P4 open) (spike log `tasks/05-feasibility/01-evidence-table/spikes/claude-run.out`) — https://github.com/microsoft/node-pty/blob/v1.1.0/package.json
- The npm package ships prebuilds for darwin-arm64, darwin-x64, win32-arm64, win32-x64 only; Linux always builds from source with node-gyp (`node scripts/prebuild.js || node-gyp rebuild`), so Ubuntu needs a compiler toolchain and Python — https://github.com/microsoft/node-pty/blob/v1.1.0/package.json
- The prebuilt `spawn-helper` arrives without the execute bit (mode 644), and every spawn then fails with `posix_spawnp failed` unless the install does `chmod +x prebuilds/*/spawn-helper` (done by `scripts/postinstall.mjs`, run as the npm `postinstall` script) (evidence `tasks/05-feasibility/01-evidence-table/spikes/node-pty-spawn-helper.txt`) — https://github.com/microsoft/node-pty/blob/v1.1.0/src/unix/pty.cc
- In a packaged app `spawn-helper` is looked up in `app.asar.unpacked`, so it must be unpacked from asar — https://github.com/microsoft/node-pty/blob/v1.1.0/src/unixTerminal.ts
- Windows uses ConPTY on Windows 10 1809 and later — https://github.com/microsoft/node-pty/blob/v1.1.0/README.md
