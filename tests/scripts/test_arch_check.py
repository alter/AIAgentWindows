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

    def test_shared_imports_main_or_renderer(self) -> None:
        self.put("src/shared/a.ts", "import { m } from '../main/pty-manager';\n")
        self.put("src/shared/sub/b.ts", "import { r } from '../../renderer/dom';\nexport * from '../../main';\n")
        self.assertEqual(self.codes(), {"shared-layer"})
        self.assertEqual(len(arch_check.check(self.root)), 3)

    def test_shared_relative_imports_inside_shared_are_fine(self) -> None:
        self.put("src/shared/a.ts", "import { x } from './b';\nimport { y } from '../shared/b';\nimport { z } from './main-like';\n")
        self.put("src/shared/b.ts", "export const x = 1;\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_renderer_uses_the_ipc_table(self) -> None:
        self.put("src/renderer/a.ts", "import { INVOKE_CHANNELS } from '../shared/ipc';\nconst c = EVENT_CHANNELS.length;\nvalidateRequest('x', 1);\n")
        self.assertEqual(self.codes(), {"renderer-ipc-table"})
        self.assertEqual(len(arch_check.check(self.root)), 3)

    def test_renderer_type_imports_from_ipc_and_main_side_table_are_fine(self) -> None:
        self.put("src/renderer/a.ts", "import type { AgentsSnapshot } from '../shared/ipc';\n// validateRequest INVOKE_CHANNELS\n")
        self.put("src/main/ipc-handlers.ts", "import { INVOKE_CHANNELS, validateRequest } from '../shared/ipc';\n")
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


    def test_store_imports_electron(self) -> None:
        self.put("src/main/store/atomic-file.ts", "import { app } from 'electron';\n")
        self.assertEqual(self.codes(), {"store-electron"})

    def test_electron_outside_store_is_fine(self) -> None:
        self.put("src/main/index.ts", "import { app } from 'electron';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_delete_calls_outside_the_store_are_refused(self) -> None:
        self.put("src/main/a.ts", "await rm(dir, { recursive: true });\nfs.unlinkSync(f);\nsession.clearStorageData();\n")
        self.assertEqual(self.codes(), {"no-delete"})
        self.assertEqual(len(arch_check.check(self.root)), 3)

    def test_delete_in_atomic_file_and_in_tests_is_allowed(self) -> None:
        self.put("src/main/store/atomic-file.ts", "await rm(temp, { force: true });\n")
        self.put("tests/unit/a.test.ts", "await rm(dir);\n")
        self.assertEqual(arch_check.check(self.root), [])
    def test_projects_import_electron(self) -> None:
        self.put("src/main/projects/git.ts", "import { app } from 'electron';\n")
        self.assertEqual(self.codes(), {"projects-electron"})

    def test_projects_may_import_node_and_store(self) -> None:
        self.put("src/main/projects/git.ts", "import { execFile } from 'node:child_process';\nimport { a } from '../store/app-state';\nimport { b } from './service';\nimport { c } from '../../shared/projects';\n")
        self.put("src/main/projects/service.ts", "import { a } from '../store/app-state';\nimport { g } from './git';\nimport { p } from '../../shared/projects';\nimport { fs } from 'node:fs';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_project_service_imports_main_outside_projects_and_store(self) -> None:
        self.put("src/main/projects/service.ts", "import { r } from '../room-archive';\nimport { c } from '../agent-controller';\nimport { s } from '../projects-extra/x';\n")
        self.assertEqual(self.codes(), {"projects-service-layer"})
        self.assertEqual(len(arch_check.check(self.root)), 3)

    def test_other_project_files_may_import_main(self) -> None:
        self.put("src/main/projects/git.ts", "import { r } from '../room-archive';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_project_service_layer_names_the_file_and_line(self) -> None:
        self.put("src/main/projects/service.ts", "\nimport { r } from '../room-archive';\n")
        self.assertTrue(arch_check.check(self.root)[0].startswith("src/main/projects/service.ts:2 [projects-service-layer]"))

    def test_runs_import_electron(self) -> None:
        self.put("src/main/runs/other.ts", "import { app } from 'electron';\n")
        self.assertEqual(self.codes(), {"runs-electron"})

    def test_context_pack_imports_only_shared(self) -> None:
        self.put("src/main/runs/context-pack.ts", "import { a } from '../../shared/room-history';\nimport type { b } from '../../shared/kinds/capabilities';\n")
        self.assertEqual(arch_check.check(self.root), [])

    def test_context_pack_imports_main_node_or_a_package(self) -> None:
        self.put("src/main/runs/context-pack.ts", "\nimport { r } from '../room-archive';\nimport { f } from 'node:fs';\nimport { z } from 'zod';\nimport { s } from './other';\n")
        problems = arch_check.check(self.root)
        self.assertEqual(self.codes(), {"context-pack-layer"})
        self.assertEqual(len(problems), 4)
        self.assertTrue(problems[0].startswith("src/main/runs/context-pack.ts:2 [context-pack-layer]"))

    def test_other_runs_files_may_import_main_and_node(self) -> None:
        self.put("src/main/runs/other.ts", "import { r } from '../room-archive';\nimport { f } from 'node:fs';\n")
        self.assertEqual(arch_check.check(self.root), [])


if __name__ == "__main__":
    unittest.main()
