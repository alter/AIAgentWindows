# test_check_publish_flags.py
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "check_publish_flags.py"
SPEC = importlib.util.spec_from_file_location("check_publish_flags", SCRIPT)
check_publish_flags = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_publish_flags)


class PublishFlagsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.package = pathlib.Path(self.tmp.name) / "package.json"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def put(self, scripts: dict) -> None:
        self.package.write_text(json.dumps({"name": "x", "scripts": scripts}), encoding="utf-8")

    def codes(self) -> list[str]:
        return [p.split("[", 1)[1].split("]", 1)[0] for p in check_publish_flags.check(self.package)]

    def test_missing_package_passes(self) -> None:
        self.assertEqual(check_publish_flags.check(self.package), [])

    def test_scripts_without_builder_pass(self) -> None:
        self.put({"build": "node scripts/build.mjs", "start": "electron ."})
        self.assertEqual(self.codes(), [])

    def test_builder_with_publish_never_passes(self) -> None:
        self.put({"dist": "npm run build && electron-builder --publish never", "pack": "electron-builder --dir --publish=never"})
        self.assertEqual(self.codes(), [])

    def test_builder_without_flag_fails(self) -> None:
        self.put({"dist": "electron-builder --mac"})
        self.assertEqual(self.codes(), ["publish-flag"])

    def test_npx_builder_without_flag_fails(self) -> None:
        self.put({"dist": "npm run build && npx electron-builder"})
        self.assertEqual(self.codes(), ["publish-flag"])

    def test_every_chained_builder_needs_the_flag(self) -> None:
        self.put({"dist": "electron-builder --publish never && electron-builder --linux"})
        self.assertEqual(self.codes(), ["publish-flag"])

    def test_publish_always_and_short_flag_fail(self) -> None:
        self.put({"a": "electron-builder --publish always", "b": "electron-builder --publish never -p always"})
        self.assertEqual(self.codes(), ["publish-flag", "publish-flag"])

    def test_release_script_fails(self) -> None:
        self.put({"release": "echo hi", "postrelease:x": "echo hi"})
        self.assertEqual(self.codes(), ["release-script", "release-script"])

    def test_invalid_json_fails(self) -> None:
        self.package.write_text("{", encoding="utf-8")
        self.assertEqual(self.codes(), ["package-json"])

    def test_cli_exit_codes(self) -> None:
        self.put({"dist": "electron-builder --publish never"})
        ok = subprocess.run([sys.executable, str(SCRIPT), "--package", str(self.package)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.put({"dist": "electron-builder"})
        bad = subprocess.run([sys.executable, str(SCRIPT), "--package", str(self.package)], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)


if __name__ == "__main__":
    unittest.main()
