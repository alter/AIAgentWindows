# jsdom@29.1.1

Dev dependency (with `@types/jsdom` 28.0.3, the newest types published before the 30.x line) of the unit tests only (tests/unit/site-adapters.test.ts): a DOM for the site adapters' page scripts. Never imported from `src/`. Version 29.1.1 (2026-04-30) rather than 30.x: 30.x requires Node `^22.22.2`, the project runs Node 22.22.0 — https://www.npmjs.com/package/jsdom (engines of 29.1.1: `^20.19.0 || ^22.13.0 || >=24.0.0`).

- `new JSDOM(html, { runScripts: "dangerously", url })` executes the page's `<script>` elements; `runScripts: "outside-only"` installs `window.eval` so the test can run code in the page's context — https://github.com/jsdom/jsdom/blob/29.1.1/README.md
- jsdom does no layout: `HTMLElement.innerText` and `document.execCommand` are undefined (checked on 29.1.1 in this repository), so a page script reads `innerText` only when it is a string and falls back to `textContent`.
- Event handler attributes and scripts do not run unless `runScripts: "dangerously"`; the test uses it only for its own local fixture, never for a real site — https://github.com/jsdom/jsdom/blob/29.1.1/README.md
- jsdom is not Chromium: it proves the adapter's DOM logic (input events, literal text, selectors), not Electron's `executeJavaScriptInIsolatedWorld` or CDP; those two were checked once in a hidden Electron run against `tests/fixtures/sites/generic.html` (see NOTES.md of tasks/10-app-shell/02-room).
