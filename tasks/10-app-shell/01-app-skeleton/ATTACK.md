# ATTACK.md

Attacker: attacker subagent (Opus), 2026-10-21; catalogs: owasp-top10, owasp-llm, asvs (all) plus the mandatory minimum; did not write the code under review. Reproductions live in `.claude/scratch/attack-app/` (a build of the repo at this commit) under `tests/attack/`.

## Sources and sinks

| field | interpretable | sinks reached |
|---|---|---|
| agent.cwd (dialog / AIAW_TEST_FOLDER / tampered agents.json) | yes | login-shell spawn **cwd option only** (never argv), state-file JSON, sidebar title via `textContent` |
| agent.sessionId (app UUID / Codex rollout / tampered agents.json) | no (UUID-validated) | login-shell argv (`--session-id`/`--resume`/`resume`), state-file JSON |
| state.file agents.json (userData, tamperable) | no (schema-checked on read) | agent-controller restore → login-shell spawn, renderer render |
| ipc.request (renderer over contextBridge) | no (validateRequest) | agent-controller (pty write/resize, select, add, siteNav) |
| pty.input (xterm keystrokes and **pastes**) | yes | pty → CLI stdin (login shell child) |
| dropped file path (webUtils.getPathForFile) | yes | xterm paste → pty (quoted by `quotePathForShell`) |
| site view URL / navigation / window.open (remote chat pages) | yes | WebContentsView in a per-agent `persist:` partition, no preload; permission + popup handlers |
| AIAW_SITE_URL_* / AIAW_*_BIN / AIAW_USER_DATA (env) | yes but trusted (launcher) | site start URL, CLI binary, userData path |

## Findings

```
CONFIRMED
CATALOG: A05:2025
WHERE: src/renderer/terminal-pane.ts:29 (xterm paste -> api.ptyWrite) -> src/main/pty-manager.ts:47 (terminal.write -> CLI stdin)
PAYLOAD: pasted clipboard text containing the bracketed-paste END marker, e.g. "\x1b[201~PROBE-7F3\r"
PATH: xterm wraps a paste as ESC[200~ <text> ESC[201~ and sends it in one onData chunk to api.ptyWrite,
      which writes it unmodified to the pty. Because the attacker's text already contains ESC[201~, the CLI
      sees bracketed paste end immediately; the following PROBE-7F3\r is now OUTSIDE paste mode, so the CLI
      treats \r as Enter and SUBMITS the line. The app never strips the inner markers, so the SECURITY-block
      protection "paste is never submitted by the app" (test pty-stub::paste is not submitted, which only
      pastes benign content) is bypassed. Source is attacker-reachable: a hostile/compromised chat page in a
      site view (or any untrusted copy source) can place text containing ESC bytes on the clipboard via
      navigator.clipboard / a copy button; the user then pastes it into the CLI terminal.
REPRODUCTION:
  cd .claude/scratch/attack-app
  npx playwright test -c playwright.attack.config.ts tests/attack/paste.spec.ts -g clipboard --reporter=line
  -> BREAKOUT "SUBMITTED:probe-control\rstill-in-pastePROBE-7F3\r\r"   (control paste: CONTROL submitted=false)
  Byte-level proof that the END marker survives the DataTransfer and reaches the pty unchanged:
  npx playwright test -c playwright.attack.config.ts tests/attack/paste.spec.ts -g bytes --reporter=line
  -> DATATRANSFER 1b 5b 32 30 31 7e 58
  -> PTY-INPUT-HEX 1b5b3230307e1b5b3230317e50524f42452d3746330d1b5b3230317e
     (= ESC[200~ ESC[201~ PROBE-7F3 \r ESC[201~  -> inner ESC[201~ closes the bracket, \r submits)
  Independent pty-only confirmation with the stub CLI:
  node tests/attack/stub-feed.cjs 1b5b3230307e1b5b3230317e50524f42452d3746330d1b5b3230317e
  -> "...\r\nPROBE-7F3\r\r\nSUBMITTED:PROBE-7F3\r\r\n"
FIX: In the renderer paste path (src/renderer/terminal-pane.ts) before data leaves to api.ptyWrite, strip or
     neutralise every ESC[200~ and ESC[201~ (\x1b[200~ / \x1b[201~) occurring inside the pasted content so an
     embedded end marker cannot close bracketed-paste mode; keep only the single outer wrapper. Equivalently,
     sanitise paste content of C0/C1 control characters except plain newline. Add a regression test that pastes
     "\x1b[201~X\r" and asserts the pty never receives a SUBMITTED line.
```

```
PLAUSIBLE
CATALOG: A02:2025
WHERE: src/main/index.ts:30-46 (createWindow, no will-navigate / setWindowOpenHandler on the privileged renderer) -> src/main/ipc-handlers.ts:30-36 (sender === appContents() still true after navigation) -> CLI pty
PAYLOAD: a foreign document becoming the main window's top-level document (e.g. an OS file drop onto the
         sidebar / empty area, which the main window never preventDefaults), serving the FOREIGN_PAGE probe
PATH: The main BrowserWindow (preload exposing `aiaw`, sandbox:true, contextIsolation:true) has no navigation
      lock. The preload re-runs on every top-level document in that webContents, and the IPC sender guard
      compares against the same webContents object, so a navigated foreign page keeps the full `aiaw` bridge
      and can call listAgents / ptyWrite, driving the CLI pty. Only site-views set a setWindowOpenHandler;
      the main window sets none. CONFIRMED part: once foreign content is the main document, IPC is fully
      reachable and submits CLI commands. UNPROVEN part: an attacker-reachable trigger for that top-level
      navigation. Electron's default file-drop-navigates behaviour is the suspected vector (terminal pane
      preventDefaults drop, but the sidebar / content-empty / nav-bar areas do not), but an OS-originated
      drag cannot be delivered in the headless Playwright harness, so the end-to-end chain is not reproduced.
REPRODUCTION:
  cd .claude/scratch/attack-app
  npx playwright test -c playwright.attack.config.ts tests/attack/main-window.spec.ts --reporter=line
  -> FOREIGN-RESULT url=http://127.0.0.1:<port>/foreign title=foreign-ipc SUBMITTED   (IPC + CLI submit from a foreign origin loaded into the main window)
  -> POPUP-RESULT title=foreign-no-api                                                 (popups correctly get NO preload bridge -- that protection holds)
  Code check: grep shows no will-navigate handler and no setWindowOpenHandler on the main window.
FIX: Add a will-navigate handler on the main window's webContents that calls event.preventDefault() for any
     URL that is not the packaged app file, and a setWindowOpenHandler that denies (or opens externally) every
     popup; preventDefault dragover/drop at the document root so a dropped file can never navigate the window.
     Add an electron-smoke assertion that a window.location change to a foreign URL leaves the renderer on the
     app file and that `window.aiaw` is gone after any blocked navigation attempt.
```

## Mandatory minimum

| attack | pairs tried | result |
|---|---|---|
| XSS incl. non-HTML sinks (push/deep link/URL scheme, terminal control sequences) | agent.title/url -> renderer (`textContent` only), icons innerHTML (kind restricted to AGENT_KINDS), popup/nav URL (popupAllowed allows only http/https/about:blank, no javascript:), pty control-sequence paste | CONFIRMED on the pty control-sequence sink (paste injection, above); no HTML/script XSS found (title/url use textContent, innerHTML uses a validated enum) |
| CSRF on cookie-authenticated state change | IPC surface | N/A: IPC is not cookie-authenticated; it is gated by `event.sender === main webContents`. The app exposes no cookie-authenticated HTTP endpoint of its own. |
| SQL injection incl. blind / second-order | whole scope | N/A: no SQL or database anywhere in scope. |
| attacker-controlled slow queries / ReDoS / unbounded consumption | regexes and size caps | None: UUID_PATTERN and ELECTRON_TOKEN are linear; caps enforced (IPC 64 KB, paste 1 MB, state 1 MB, cwd 4096 B, id 200, dimensions 1..1000). No attacker-built regex. |
| prompt injection, direct and indirect | app-built prompts | N/A: the app builds no LLM prompt; it forwards keystrokes to the CLI and loads remote chat sites. The pty paste-injection is the nearest analog and is reported. |
| model output used as code/SQL/HTML/URL/shell | CLI stdout -> xterm; remote model output -> site view | CLI stdout is rendered by xterm as a terminal (control sequences interpreted by design; OSC 8 link click needs user confirm and opens a no-preload window). Remote model output renders in a sandboxed, no-preload, per-agent partition. No path from model output to the app's shell/IPC was found. |

## What was not attacked

- The real `claude`/`codex` binaries and the owner's userData: never spawned or touched (used `tests/fixtures/stub-cli.mjs` via `AIAW_*_BIN` and temporary `AIAW_USER_DATA`, per the rules).
- The real `chatgpt.com` / `grok.com` / `chat.deepseek.com`: never loaded; site-view behaviour was exercised only against local `http://127.0.0.1` fixtures.
- OS-originated drag-and-drop file navigation of the main window: not reproducible in the headless Playwright/CDP harness (synthetic drops carry no files and do not trigger Chromium's default navigate-to-dropped-file), so the end-to-end chain for the PLAUSIBLE finding is unproven.
- Windows and Ubuntu spawn path (`platform === 'win32'` branch) was read but not run on those OSes; only macOS was available.
- electron-builder / packaging / publishing, postinstall spawn-helper bit, and the Python gate scripts (arch_check, coverage_gate, check_publish_flags) are outside the attacker's source->sink scope and were not attacked.
- Cross-partition cookie/session isolation of real services and real OAuth/login flows: not exercised (no real sites loaded).

## Verdict

attack:failed for tasks/10-app-shell/01-app-skeleton — a crafted clipboard paste containing the bracketed-paste END marker (`\x1b[201~`) is passed unmodified to the CLI pty and auto-submits, defeating the task's stated "paste is never submitted" protection (CONFIRMED, A05:2025); the privileged main renderer additionally has no navigation lock, so any top-level navigation retains full IPC (PLAUSIBLE, attacker trigger unproven).

## Round 2

Attacker: attacker subagent (Opus), 2026-10-21; scope: ATTACK.md round-1 finding 1 and its fix `89aaf5a` (T16a: `sanitizePaste` in src/shared/terminal-input.ts, the capturing `paste` listener and the drop path in src/renderer/terminal-pane.ts); catalogs: owasp-top10, owasp-llm, asvs plus the mandatory minimum; did not write the code under review. Scratch copy `.claude/scratch/attack-app/` re-synced (src identical to HEAD, `diff -rq` exit 0) and rebuilt (`npm run build`, bundle contains `isEscapeOrC1`). Stub CLI only (`tests/attack/echo-stub.mjs`: bracketed-paste-aware like `tests/fixtures/stub-cli.mjs`, plus a hex log of every pty read and an optional "tool output" line), temporary `AIAW_USER_DATA`; no real site loaded, no real CLI spawned, system clipboard never written.

### Sources and sinks (round 2)

| field | interpretable | sinks reached |
|---|---|---|
| pasted clipboard text (`ClipboardEvent.clipboardData` text/plain) | yes | `sanitizePaste` -> `terminal.paste` -> xterm `bracketTextForPaste` -> onData -> `api.ptyWrite` -> pty -> CLI stdin |
| dropped file path (`webUtils.getPathForFile`) | yes | `quotePathForShell` -> `sanitizePaste` -> same pty sink |
| dropped text (no files) | yes | none (drop handler reads only `files`, default insertion prevented) |
| Ctrl+V / Alt+V keydown | no (fixed bytes) | `rawKeySequence` -> pty (`\x16`, `\x1bv`); the CLI itself then reads the clipboard |
| pty output (CLI / model / tool text) controlling xterm's DECSET 2004 state | yes | decides whether a paste is bracketed at all |

### Findings (round 2)

```
PLAUSIBLE
CATALOG: A05:2025 (also V1 Encoding and Sanitization)
WHERE: src/renderer/terminal-pane.ts:99-104 (handlePaste -> terminal.paste) -> node_modules/@xterm/xterm/src/browser/Clipboard.ts:24-29 (bracketTextForPaste wraps ONLY when decPrivateModes.bracketedPasteMode) -> src/renderer/terminal-pane.ts:29 (onData -> api.ptyWrite) -> src/main/pty-manager.ts:47 (pty write)
PAYLOAD: pty output containing "\x1b[?2004l" (e.g. a file or model text the CLI prints verbatim; RIS "\x1bc" and DECSTR "\x1b[!p" reset the same mode), followed by a user paste of "probe-7f3\rtail"
PATH: The T16a protection relies entirely on xterm's bracketed-paste mode being ON at the moment of the paste. That mode is set and cleared
      by whatever the pty prints. Once untrusted output turns it off (or before the CLI has enabled it at all, i.e. the window between
      "+ Claude Code/Codex" focusing the new pane and the CLI printing ESC[?2004h), sanitizePaste still runs but there is no ESC to strip:
      xterm sends the text unbracketed with every line break as a raw \r, and the CLI submits each line. "Paste is never submitted by the app"
      (SECURITY sink pty) is then false for any multi-line paste. App-side relay CONFIRMED with the stub; UNPROVEN part: that the real
      claude/codex ever print an unfiltered ESC[?2004l / RIS from model or tool output (cannot be tested here: real CLIs must not be spawned).
REPRODUCTION:
  cd .claude/scratch/attack-app
  npx playwright test -c playwright.attack.config.ts tests/attack/paste-round2.spec.ts -g "bracketed paste off" --reporter=line
  -> ROUND2 MODE-OFF pty-input-hex="70726f62652d3766330d7461696c" submitted="SUBMITTED:probe-7f3\r\r"
  control (same paste, mode left on):  -g "control" ->
  -> ROUND2 MODE-ON pty-input-hex="...1b5b3230307e70726f62652d3766330d7461696c1b5b3230317e" submitted=false
FIX: In TerminalPane.handlePaste (and handleDrop), read this.terminal.modes.bracketedPasteMode; when it is false and the sanitised text
     contains \r or \n, do not hand it to terminal.paste as is: either replace line breaks with spaces, or show a multi-line-paste
     confirmation before sending. Add a test that writes "\x1b[?2004l" to the pane, pastes "X\rY" and asserts no raw \r reaches ptyWrite.
```

Observation, not a weakness: a dropped path containing a C1 character (e.g. `/tmp/report\u0085.pdf`) passes `quotePathForShell` (it rejects only C0 and DEL) and is then silently rewritten by `sanitizePaste` to `/tmp/report.pdf`, a different file. Reproduction: `node --experimental-strip-types -e "import('./src/shared/terminal-input.ts').then(m=>{const p='/tmp/report\u0085.pdf';console.log(m.sanitizePaste(m.dropPastePayload([p]))===\"'\"+p+\"'\")})"` -> `false`. Suggested: make `hasControlCharacter` also reject 0x80-0x9f so such a path is dropped rather than altered.

### Bypass attempts on the fix (all held)

| attempt | how | result |
|---|---|---|
| 7-bit end marker `\x1b[201~A7F3\r` | ClipboardEvent on 5 targets: xterm helper textarea, `.xterm`, `.xterm-screen`, the pane container, `document.activeElement` | held: 55 pastes, 55 end markers, 0 ESC / 0 UTF-8 C1 inside any bracket, no SUBMITTED (`ROUND2 targets=5 pastes=55 ends=55 problems=0 submitted=false`) |
| 8-bit C1 CSI `\x9b201~` | same | held: U+009B removed |
| doubled ESC `\x1b\x1b[201~` | same | held |
| marker split across two paste events (`...\x1b[20` + `1~...\r`) | same | held: each paste is bracketed on its own, ESC removed from both |
| NUL inside paste (`\x00\r\x00`) | same | held: NUL kept literal inside the bracket, no submit |
| `\r\n`, `\n`, `\r` inside paste | same | held: xterm maps to `\r`, all inside the bracket |
| raw 0x9b as a UTF-8 continuation byte (U+06DB `DB 9B`) | same | held at the app: the CLI receives valid UTF-8; only a byte-level 8-bit-C1 parser would misread it (Node and crossterm parsers do not) |
| OSC + BEL `\x1b]0;...\x07` | same | held: ESC removed, BEL literal inside the bracket |
| C1 NEL/ST/DCS `\u0085\u009c\u0090` | same | held |
| nested `\x1b[200~...\x1b[201~` | same | held |
| text drop (no files), synthetic DragEvent on textarea and screen | `-g "synthetic text drop"` | held: `pty-input-hex=""` |
| text drop, trusted CDP `Input.dispatchDragEvent` on screen and on the textarea | `-g "trusted CDP"` | held: `pty-input-hex="" textarea=""` |
| Ctrl+V / Alt+V | `-g "Ctrl+V"` | app forwards only `16` and `1b76`; no clipboard content leaves the renderer |
| xterm's own paste listeners (textarea and `.xterm`) | code: CoreBrowserTerminal.ts:342-344; app listener is capture-phase on the ancestor and calls stopPropagation | never reached (all 5 targets above) |
| right-click / context menu paste | code: Electron shows no native context menu, xterm's rightClickHandler only moves the textarea; any paste then is the same `paste` event | same path as above |
| Linux middle-click (PRIMARY selection) | code: Chromium fires `paste` into the textarea (CoreBrowserTerminal.ts:363-371) | same path; not run (macOS only) |
| IME / composition, `insertText` input | code: CompositionHelper and `_inputEvent` read only what the IME or keyboard inserted; clipboard text cannot reach the textarea because paste and drop defaults are prevented | no clipboard route |
| Cmd+V / Paste and Match Style (`editMenu` role) | `webContents.paste()` dispatches the same DOM `paste` event | same path; not run against the real system clipboard (left untouched) |

### Mandatory minimum (round 2)

| attack | pairs tried | result |
|---|---|---|
| XSS incl. non-HTML sinks (terminal control sequences) | paste text and dropped path -> pty | fix holds for ESC/C1 in the paste; PLAUSIBLE residual when bracketed-paste mode is off (above) |
| CSRF on cookie-authenticated state change | paste/drop -> IPC `ptyWrite` | N/A: IPC is sender-gated, not cookie-authenticated |
| SQL injection incl. blind / second-order | scope | N/A: no SQL in scope |
| attacker-controlled slow queries / ReDoS | `sanitizePaste` (linear filter over code points, paste capped at 1 MB by `MAX_PTY_WRITE_BYTES`) | none |
| prompt injection, direct and indirect | pasted text reaching the CLI's model | N/A at the app: the app builds no prompt; text is delivered as typed. Indirect injection through the pasted content is the CLI's concern |
| model output used as code/SQL/HTML/URL/shell | model/tool output -> xterm DECSET 2004 state -> paste framing | the output-controls-paste-framing path is the PLAUSIBLE finding above |

### What was not attacked (round 2)

- The real `claude`/`codex`: never spawned, so whether they print unfiltered `ESC[?2004l`/RIS from model or tool output (the trigger of the PLAUSIBLE finding), how they treat C0 controls such as `\x03`/`\x04` inside a bracketed paste (sanitizePaste keeps them), how they handle a paste split across several pty reads, and what they do on Ctrl+V/Alt+V (they read the clipboard themselves, outside the app) are unverified.
- The real OS clipboard: not written; trusted Cmd+V / Paste and Match Style / Shift+Insert were reasoned from code, not run. All synthetic and CDP routes were run.
- Linux middle-click and Windows paste routes: macOS only.
- Backlog rehydration: `OutputBuffer` keeps only the last 256 KB, so a pane hydrated after more output would lose the CLI's `ESC[?2004h` and paste unbracketed; no renderer reload path exists today (Cmd+R is bound to the site reload), so this was read, not reproduced.
- Round-1 PLAUSIBLE (main window navigation lock) and everything outside the T16a scope were not re-attacked.

### Verdict (round 2)

attack:passed for tasks/10-app-shell/01-app-skeleton round 2 — every tested route and terminator (7-bit and 8-bit CSI, split, NUL, line endings, OSC, C1, nested markers, five paste targets, text drop, Ctrl+V/Alt+V) stays inside a single bracket with no submission; the only residual (multi-line paste submits when untrusted pty output has turned bracketed-paste mode off) is PLAUSIBLE because the real CLIs' trigger cannot be tested here.
