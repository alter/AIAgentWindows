# electron@44.6.0

Pinned 2026-10-21: newest release at least two weeks old (44.6.0 published 2026-10-06; 45.0.0 published 2026-10-21 was too new). Chromium 152.0.7977.130, Node 24.21.0 (spike log `tasks/05-feasibility/01-evidence-table/spikes/claude-run.out`).

## Types and limits used by the design

- Clipboard is asynchronous and W3C-shaped: `clear`, `has(mimetype)`, `read()`, `readText()`, `write(ClipboardItem[])`, `writeText()`; `readImage`, `writeImage`, `availableFormats` do not exist (runtime probe and typings in `tasks/05-feasibility/01-evidence-table/spikes/electron-clipboard-api.txt`) — https://github.com/electron/electron/blob/v44.6.0/docs/api/clipboard.md
- `File.path` was removed in 32.0; a dropped file's path comes from `webUtils.getPathForFile(file)` in a preload — https://github.com/electron/electron/blob/v44.6.0/docs/breaking-changes.md#L981-L983
- `safeStorage.getSelectedStorageBackend()` (Linux) returns `basic_text` when no secret store is available; items are then unprotected — https://github.com/electron/electron/blob/v44.6.0/docs/api/safe-storage.md
- `session.setPermissionRequestHandler` receives `media` (microphone, camera) with the requesting URL; `setPermissionCheckHandler` receives the requesting origin — https://github.com/electron/electron/blob/v44.6.0/docs/api/session.md
- `webContents.executeJavaScriptInIsolatedWorld(worldId, scripts)` runs code in an isolated context of the page — https://github.com/electron/electron/blob/v44.6.0/docs/api/web-contents.md
- The `<webview>` tag is discouraged ("We currently recommend to not use the webview tag"); alternatives are `WebContentsView` or an iframe — https://github.com/electron/electron/blob/v44.6.0/docs/api/webview-tag.md
- `webContents.debugger` attaches CDP from the main process; CDP `DOM.setFileInputFiles` sets files on a file input — https://github.com/electron/electron/blob/v44.6.0/docs/api/debugger.md and https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-setFileInputFiles
- A partition named `persist:<name>` is stored on disk, any other name is in memory; `sessionData` must be overridden before `ready` — https://github.com/electron/electron/blob/v44.6.0/docs/api/session.md and https://github.com/electron/electron/blob/v44.6.0/docs/api/app.md
- `NSMicrophoneUsageDescription` must be set in Info.plist for microphone access on macOS — https://github.com/electron/electron/blob/v44.6.0/docs/api/system-preferences.md#L360

## Known issues and pitfalls

- The default user agent carries `Electron/44.6.0`; chat.deepseek.com answers it with an "Abnormal usage environment" dialog, and shows its normal sign-in form when the token is removed (spike screenshots `web-deepseek.png`, `web-deepseek-plain-ua.png` in `tasks/05-feasibility/01-evidence-table/spikes/`) — https://github.com/electron/electron/blob/v44.6.0/docs/api/web-contents.md#contentssetuseragentuseragent
- Google forbids its OAuth sign-in inside an embedded user agent that can inject scripts or read cookies, which an Electron view is: "Sign in with Google" on the three sites is expected to fail — https://developers.google.com/identity/protocols/oauth2/policies
- Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor, which breaks the Chromium sandbox of unpacked/AppImage builds; electron-builder installs an AppArmor profile (`appArmorProfile`) and a SUID `chrome-sandbox` from its `.deb` after-install script — https://documentation.ubuntu.com/release-notes/24.04/ and https://github.com/electron-userland/electron-builder/blob/electron-builder@26.17.0/packages/app-builder-lib/templates/linux/after-install.tpl
