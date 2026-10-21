# @xterm/addon-fit@0.11.0

Pinned 2026-10-21 (published 2025-12-22); built for `@xterm/xterm` 6.0.0.

- API: `new FitAddon()`, `terminal.loadAddon(fit)`, `fit.fit()` resizes the terminal to its container, `fit.proposeDimensions()` returns `{ cols, rows } | undefined` — https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-fit/typings/addon-fit.d.ts#L11-L36
- `proposeDimensions()` returns `undefined` (and `fit()` does nothing) when the terminal has no element or parent, or the cell size is 0 — i.e. before `terminal.open(el)` or while the container is `display: none`; call `fit()` after the pane becomes visible — https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-fit/src/FitAddon.ts#L36-L66
- Minimum fitted size is 2 columns by 1 row; the scrollbar width (default, or `options.overviewRuler.width`; 0 when `scrollback` is 0) is subtracted from the width — https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-fit/src/FitAddon.ts#L23-L88
- `fit()` only calls `terminal.resize(cols, rows)` when the size changed and never touches the pty; the app forwards `terminal.cols/rows` to `pty.resize` itself (for example from `terminal.onResize`) — https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-fit/src/FitAddon.ts#L35-L48
