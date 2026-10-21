# test_arch_check.py
import importlib.util
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "arch_check.py"
SPEC = importlib.util.spec_from_file_location("arch_check", SCRIPT)
arch_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(arch_check)

CODE = re.compile(r"\[([a-z-]+)\]")


class ArchCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def put(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def codes(self) -> set[str]:
        return {m.group(1) for p in arch_check.check(self.root) for m in [CODE.search(p)] if m}

    def test_clean_tree_passes(self) -> None:
        self.put("src/renderer/index.ts", "import { Terminal } from '@xterm/xterm';\nimport { x } from '../shared/ipc';\n")
        self.put("src/shared/ipc.ts", "export const x = 1;\n")
        self.put("src/main/index.ts", "import { app, BrowserWindow } from 'electron';\nimport fs from 'node:fs';\nnew BrowserWindow({ webPreferences: { preload: 'p.js' } });\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_missing_src_passes(self) -> None:
        self.assertEqual(arch_check.check(self.root), [])

    def test_renderer_electron_import(self) -> None:
        self.put("src/renderer/a.ts", "import { ipcRenderer } from 'electron';\n")
        self.assertEqual(self.codes(), {"renderer-electron"})

    def test_renderer_electron_subpath_and_require(self) -> None:
        self.put("src/renderer/a.ts", "const e = require('electron/renderer');\n")
        self.assertEqual(self.codes(), {"renderer-electron"})

    def test_renderer_node_prefixed_import(self) -> None:
        self.put("src/renderer/a.ts", "import fs from 'node:fs';\n")
        self.assertEqual(self.codes(), {"renderer-node"})

    def test_renderer_bare_builtin_import(self) -> None:
        self.put("src/renderer/a.ts", "import { join } from 'path';\nexport * from 'child_process';\n")
        self.assertEqual(self.codes(), {"renderer-node"})
        self.assertEqual(len(arch_check.check(self.root)), 2)

    def test_renderer_dynamic_and_side_effect_import(self) -> None:
        self.put("src/renderer/a.ts", "import 'node:os';\nconst m = await import('node:net');\n")
        self.assertEqual(len(arch_check.check(self.root)), 2)

    def test_renderer_multiline_import_reports_start_line(self) -> None:
        self.put("src/renderer/a.ts", "\nimport {\n  a,\n  b,\n} from 'electron';\n")
        self.assertTrue(arch_check.check(self.root)[0].startswith("src/renderer/a.ts:2 "))

    def test_renderer_imports_main(self) -> None:
        self.put("src/renderer/ui/a.ts", "import { m } from '../../main/pty-manager';\n")
        self.assertEqual(self.codes(), {"renderer-main"})

    def test_renderer_relative_import_outside_main_is_fine(self) -> None:
        self.put("src/renderer/ui/a.ts", "import { m } from '../../shared/ipc';\nimport { n } from '../main-like';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_commented_import_is_ignored(self) -> None:
        self.put("src/renderer/a.ts", "// import fs from 'node:fs';\n/* import e from 'electron'; */\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_shared_imports_electron(self) -> None:
        self.put("src/shared/a.ts", "import { app } from 'electron';\n")
        self.assertEqual(self.codes(), {"shared-native"})

    def test_shared_imports_node_pty(self) -> None:
        self.put("src/shared/a.ts", "import * as pty from 'node-pty';\n")
        self.assertEqual(self.codes(), {"shared-native"})

    def test_shared_may_import_node_builtins(self) -> None:
        self.put("src/shared/a.ts", "import path from 'node:path';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_web_contents_view_with_preload(self) -> None:
        self.put("src/main/views.ts", "const v = new WebContentsView({\n  webPreferences: { preload: p },\n});\n")
        problems = arch_check.check(self.root)
        self.assertEqual(self.codes(), {"site-preload"})
        self.assertTrue(problems[0].startswith("src/main/views.ts:1 "))

    def test_site_browser_window_with_preload(self) -> None:
        self.put("src/main/popup.ts", "new BrowserWindow({ webPreferences: { partition: 'persist:x', preload: p } });\n")
        self.assertEqual(self.codes(), {"site-preload"})

    def test_site_views_without_preload_pass(self) -> None:
        self.put("src/main/views.ts", "new WebContentsView({ webPreferences: { partition: 'persist:x', sandbox: true } });\nnew BrowserWindow({ webPreferences: { partition: 'persist:x' } });\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_cli_exit_codes(self) -> None:
        self.put("src/renderer/a.ts", "export {};\n")
        ok = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.put("src/renderer/b.ts", "import fs from 'node:fs';\n")
        bad = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("src/renderer/b.ts:1 [renderer-node]", bad.stdout)


if __name__ == "__main__":
    unittest.main()
