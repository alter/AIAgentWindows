# NOTES

## 2026-10-23 T01 sidebar on the content palettes

- Sidebar: `--sidebar-bg` (dark #14161a, light #f4f5f7; content #1a1d21 / #ffffff), `border-right: 1px solid var(--border)`, text `--text`. Own state tokens `--sidebar-hover` and `--sidebar-select` in both palettes: the shared `--hover-bg` (light #d5d8dd, Lc 83.1) and `--info-bg` (light #c9e0f5, Lc 86.1) cannot carry --text at Lc 90 in the light palette; the content tokens are unchanged. Menus drawn on the sidebar (add menu, agent and room context menus) hover on `--sidebar-hover`.
- Shared token moved: `--danger-bg` #a3123f -> #9c1139 (white on it Lc 89.9 -> 91.4, needed for the confirm button at Lc 90; content text on it only gains contrast, no palette token of the content lost a level).
- Removed: `--aubergine`, `--aubergine-hover`, `--aubergine-select`, `--glyph-bg`, `--glyph-hover`, `--focus-sidebar` (no use left; the focus ring of the sidebar is the shared `--focus`). `--on-fill` stays for filled buttons and the kind tiles. "+", confirm Yes/No buttons are `--button-bg` / `--danger-bg` with `--on-fill` and a 1px `--border` outline, so their edge reaches Lc 45 against `--sidebar-bg` (button-bg alone on the dark sidebar is Lc 12).
- Gate: new use `preferred` (Lc 90, WCAG 4.5:1, text) in scripts/contrast_check.py; test `test_preferred_level_needs_lc_90_where_body_needs_75` in tests/scripts/test_contrast_check.py, seen red first (unknown use gave rule `manifest`, not `contrast-apca`): `FAIL: test_preferred_level_needs_lc_90_where_body_needs_75 (tests.scripts.test_contrast_check.ContrastRulesTest.test_preferred_level_needs_lc_90_where_body_needs_75) AssertionError: Lists differ: ['manifest'] != ['contrast-apca'] FAILED (failures=1) `.
- Pairs (computed with scripts/contrast_check.py's own apca_lc, wcag_ratio and collect_tokens; Lc as magnitude; text rows need Lc 90 and 4.5:1, non-text rows Lc 45 and 3:1). Kind-tile pairs are unchanged. Aubergine and glyph pairs are removed from src/renderer/contrast-pairs.json.

| fg | bg | use | dark fg/bg | dark Lc | dark ratio | light fg/bg | light Lc | light ratio |
|---|---|---|---|---|---|---|---|---|
| --text | --sidebar-bg | preferred | #ffffff / #14161a | 107.0 | 18.11 | #000000 / #f4f5f7 | 100.0 | 19.25 |
| --text | --sidebar-hover | preferred | #ffffff / #4b4f57 | 93.0 | 8.22 | #000000 / #e4e7ec | 91.7 | 16.94 |
| --text | --sidebar-select | preferred | #ffffff / #0b4f82 | 93.5 | 8.55 | #000000 / #d6e8f8 | 91.0 | 16.76 |
| --text | --input-bg | preferred | #ffffff / #0f1114 | 107.4 | 18.91 | #000000 / #ffffff | 106.0 | 21.00 |
| --text | --menu-bg | preferred | #ffffff / #33373d | 101.0 | 11.97 | #000000 / #ffffff | 106.0 | 21.00 |
| --on-fill | --button-bg | preferred | #ffffff / #0b4f82 | 93.5 | 8.55 | #ffffff / #0b4f82 | 93.5 | 8.55 |
| --on-fill | --danger-bg | preferred | #ffffff / #9c1139 | 91.4 | 8.23 | #ffffff / #9c1139 | 91.4 | 8.23 |
| --text | --sidebar-bg | non-text | #ffffff / #14161a | 107.0 | 18.11 | #000000 / #f4f5f7 | 100.0 | 19.25 |
| --border | --sidebar-bg | non-text | #b4bac2 / #14161a | 63.9 | 9.27 | #5f6670 / #f4f5f7 | 73.0 | 5.32 |
| --focus | --sidebar-bg | non-text | #6cc8ff / #14161a | 67.0 | 9.78 | #0b4fd0 / #f4f5f7 | 76.9 | 6.33 |
| --focus | --sidebar-hover | non-text | #6cc8ff / #4b4f57 | 53.1 | 4.44 | #0b4fd0 / #e4e7ec | 68.6 | 5.57 |

### Reverse control

Scratch copy of styles.css (original untouched, sha unchanged) with dark `--text: #ffffff` -> `#8a919b` (a cool grey of the sidebar hue); `python3 scripts/contrast_check.py --css <copy>`:

```
src/renderer/contrast-pairs.json:2 [contrast-apca] dark: --text on --content-bg (body) Lc -41.1 below 75
src/renderer/contrast-pairs.json:2 [same-hue] dark: --text on --content-bg (body) grey text on a neutral surface, text there is #ffffff or #000000
src/renderer/contrast-pairs.json:3 [contrast-apca] dark: --text on --sidebar-bg (preferred) Lc -41.8 below 90
src/renderer/contrast-pairs.json:3 [same-hue] dark: --text on --sidebar-bg (preferred) grey text on a neutral surface, text there is #ffffff or #000000
src/renderer/contrast-pairs.json:3 [contrast-apca] dark: --text on --sidebar-bg (non-text) Lc -41.8 below 45
src/renderer/contrast-pairs.json:4 [contrast-wcag] dark: --text on --sidebar-hover (preferred) ratio 2.58:1 below 4.5:1
src/renderer/contrast-pairs.json:4 [contrast-apca] dark: --text on --sidebar-hover (preferred) Lc -27.9 below 90
src/renderer/contrast-pairs.json:4 [same-hue] dark: --text on --sidebar-hover (preferred) grey text on a neutral surface, text there is #ffffff or #000000
...
contrast_check: 45 findings
exit=1
```

### Checks

- `python3 scripts/contrast_check.py`: 0 findings. `bash .claude/scratch/gates.sh`: exit 0; vitest 974/974, coverage 100.00 % (floor 100.00 %), electron-smoke 52/52 incl. `the sidebar background follows the colour scheme`.
- First smoke run failed that one test (`getComputedStyle` on null: `.sidebar` is built by index.ts after `firstWindow()` resolves); root cause is evidence-backed, fix is `waitFor` on `.sidebar` in the test.
- docs/PROJECT.md was already modified in the working tree when T01 started its edits (Themes row, T02 text); T01 did not touch it.

# NOTES — summary (2026-10-23)
- Sidebar on the light/dark palettes: --sidebar-bg, --sidebar-hover, --sidebar-select, 1px --border separator, --text, --focus; aubergine/glyph/focus-sidebar tokens removed; gate level `preferred` (Lc 90, 4.5:1); sidebar text pairs Lc 91.0-107.4, non-text Lc 53.1-107.0 (table above).
- Checks (coordinator, this run): gates.sh exit 0, contrast_check 0 findings, vitest 976/976, coverage 100.00 %, electron-smoke 52/52.
- Left for the owner: AC4.
