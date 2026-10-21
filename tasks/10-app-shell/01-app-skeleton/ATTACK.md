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
