# xterm@6.0.0

Pinned 2026-10-21 (`@xterm/xterm` and `@xterm/headless` 6.0.0, published 2025-12-22).

- Bracketed paste wraps pasted text in `ESC[200~ … ESC[201~` when the application enabled mode 2004; both CLIs enable it (`bracketedPasteMode=true` in `tasks/05-feasibility/01-evidence-table/spikes/claude-run.out` and `codex-run.out`) — https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/Clipboard.ts#L23
- `attachCustomKeyEventHandler` runs before xterm processes a key and decides whether xterm handles it; the paste itself arrives through a DOM `paste` listener, not through this hook — https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts and https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L343-L344
- `@xterm/headless` renders the same terminal state without a DOM; the spikes used it to read the screen — https://github.com/xtermjs/xterm.js/tree/6.0.0/headless
