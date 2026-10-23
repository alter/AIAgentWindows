
## 2026-10-23 T01 reverse control

Dropped `nativeTheme.themeSource = choice;` from the theme:set handler in src/main/ipc-handlers.ts, rebuilt, ran `npx playwright test --project=electron-smoke tests/full/theme-switch.spec.ts`: red. File restored (cmp against the saved copy: identical), rebuilt.

```

Running 1 test using 1 worker

  ✘  1 [electron-smoke] › tests/full/theme-switch.spec.ts:35:5 › the chosen theme applies and survives a restart (15.5s)


  1) [electron-smoke] › tests/full/theme-switch.spec.ts:35:5 › the chosen theme applies and survives a restart 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "light"
    Received: "system"

    Call Log:
    - Timeout 15000ms exceeded while waiting on the predicate

      44 |     await radio(page, 'light').click();
      45 |     await expect(radio(page, 'light')).toBeChecked();
    > 46 |     await expect.poll(() => themeSource(app)).toBe('light');
         |                                               ^
      47 |     await expect.poll(() => pageIsDark(page)).toBe(false);
      48 |
      49 |     await page.keyboard.press('ArrowRight');
        at /Users/user/workflow/git/AIAgentWindows/tests/full/theme-switch.spec.ts:46:47

```

# NOTES — summary (2026-10-23)
- Built: `src/shared/theme.ts` (ThemeChoice, parseThemeChoice → system for unknown); validated `theme:get` / `theme:set`; the choice is kept in agents.json through AgentController (`theme` optional, old files load); `nativeTheme.themeSource` set in main before the window is created and on every set; `src/renderer/theme-switch.ts` radio group "Theme" (System, Light, Dark) at the sidebar bottom; one contrast pair added.
- Checks (coordinator, this run): `bash .claude/scratch/gates.sh` exit 0 — fast tier 12 commands exit 0, vitest 974/974, coverage 100.00 %, build exit 0, electron-smoke 51/51.
- Left for the owner: AC4.
