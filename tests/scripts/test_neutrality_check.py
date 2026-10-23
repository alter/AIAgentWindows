# test_neutrality_check.py
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "neutrality_check.py"
SPEC = importlib.util.spec_from_file_location("neutrality_check", SCRIPT)
neutrality = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(neutrality)

TWO_TESTS = "it('a', () => {\n  expect(1).toBe(1);\n});\nit('b', () => {\n  expect(2).toBe(2);\n  expect(3).toBe(3);\n});\n"


def entry(root: pathlib.Path, name: str, file: str = "tests/unit/x.test.ts") -> dict:
    return {"name": name, "file": str(root / file), "projectName": "unit"}


class NeutralityCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "t@example.invalid")
        self.git("config", "user.name", "t")
        self.put("tests/unit/x.test.ts", TWO_TESTS)
        self.git("add", "tests")
        self.git("commit", "-q", "-m", "base")
        self.commit = self.git("rev-parse", "HEAD").strip()
        self.before = [entry(self.root, "a"), entry(self.root, "b")]

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, check=True).stdout

    def put(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def notes(self, text: str) -> pathlib.Path:
        path = self.root / "NOTES.md"
        path.write_text(text, encoding="utf-8")
        return path

    def run_check(self, now: list[dict], notes_text: str = "") -> list[str]:
        return neutrality.check(self.root, self.commit, self.before, now, self.notes(notes_text))

    def codes(self, problems: list[str]) -> set[str]:
        return {p.split("[", 1)[1].split("]", 1)[0] for p in problems}

    def test_unchanged_tree_is_neutral(self) -> None:
        self.assertEqual(self.run_check(list(self.before)), [])

    def test_added_tests_and_expects_are_neutral(self) -> None:
        self.put("tests/unit/y.test.ts", "it('c', () => { expect(1).toBe(1); });\n")
        self.assertEqual(self.run_check(self.before + [entry(self.root, "c", "tests/unit/y.test.ts")]), [])

    def test_vanished_test_without_a_note_is_red(self) -> None:
        problems = self.run_check([entry(self.root, "a")])
        self.assertEqual(self.codes(problems), {"test-vanished", "test-count"})
        self.assertIn("tests/unit/x.test.ts :: b", problems[0])

    def test_vanished_test_with_an_old_new_line_is_accepted(self) -> None:
        now = [entry(self.root, "a"), entry(self.root, "b renamed")]
        notes = "- tests/unit/x.test.ts :: b -> tests/unit/x.test.ts :: b renamed\n"
        self.assertEqual(self.run_check(now, notes), [])

    def test_a_note_for_another_id_does_not_excuse_a_vanished_one(self) -> None:
        now = [entry(self.root, "a"), entry(self.root, "c")]
        notes = "tests/unit/x.test.ts :: other -> tests/unit/x.test.ts :: c\n"
        self.assertEqual(self.codes(self.run_check(now, notes)), {"test-vanished"})

    def test_fewer_tests_than_before_is_red_even_when_renamed(self) -> None:
        notes = "tests/unit/x.test.ts :: b -> tests/unit/x.test.ts :: a\n"
        self.assertEqual(self.codes(self.run_check([entry(self.root, "a")], notes)), {"test-count"})

    def test_a_duplicated_id_losing_one_copy_is_red(self) -> None:
        self.before = [entry(self.root, "a"), entry(self.root, "a")]
        self.assertEqual(self.codes(self.run_check([entry(self.root, "a")])), {"test-vanished", "test-count"})

    def test_removed_assertion_is_red(self) -> None:
        self.put("tests/unit/x.test.ts", "it('a', () => {\n  expect(1).toBe(1);\n});\nit('b', () => {});\n")
        problems = self.run_check(list(self.before))
        self.assertEqual(self.codes(problems), {"expect-count"})
        self.assertIn("1 expect( calls now, 3 at", problems[0])

    def test_removed_assertion_offset_by_an_added_one_elsewhere_is_neutral(self) -> None:
        self.put("tests/unit/x.test.ts", "it('a', () => {\n  expect(1).toBe(1);\n});\nit('b', () => {});\n")
        self.put("tests/unit/z.test.ts", "expect(1).toBe(1);\nexpect(2).toBe(2);\n")
        self.assertEqual(self.run_check(list(self.before)), [])

    def test_test_ids_ignore_the_checkout_path(self) -> None:
        a = neutrality.test_ids([{"name": "n", "file": "/one/place/tests/unit/x.test.ts"}])
        b = neutrality.test_ids([{"name": "n", "file": "C:\\other\\x\\tests\\unit\\x.test.ts".replace("\\", "/")}])
        self.assertEqual(a, b)

    def test_a_tree_without_tests_has_no_expects(self) -> None:
        self.git("rm", "-q", "-r", "--cached", "tests")
        self.git("commit", "-q", "-m", "no tests")
        (self.root / "tests" / "unit" / "x.test.ts").unlink()
        self.assertEqual(neutrality.expects_now(self.root), 0)
        self.assertEqual(neutrality.expects_at(self.root, "HEAD"), 0)

    def test_git_failure_is_reported(self) -> None:
        with self.assertRaises(RuntimeError):
            neutrality.expects_at(self.root, "no-such-commit")

    def test_cli_exit_codes(self) -> None:
        before = self.root / "before.json"
        now = self.root / "now.json"
        before.write_text(json.dumps(self.before), encoding="utf-8")
        now.write_text(json.dumps(self.before), encoding="utf-8")
        base = [sys.executable, str(SCRIPT), self.commit, str(before), "--root", str(self.root), "--current", str(now)]
        ok = subprocess.run(base, capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        now.write_text(json.dumps([entry(self.root, "a")]), encoding="utf-8")
        bad = subprocess.run(base, capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("[test-vanished]", bad.stdout)

    def test_cli_reads_notes_beside_the_saved_list(self) -> None:
        before = self.root / "before.json"
        now = self.root / "now.json"
        before.write_text(json.dumps(self.before), encoding="utf-8")
        now.write_text(json.dumps([entry(self.root, "a"), entry(self.root, "c")]), encoding="utf-8")
        base = [sys.executable, str(SCRIPT), self.commit, str(before), "--root", str(self.root), "--current", str(now)]
        self.assertEqual(subprocess.run(base, capture_output=True, text=True).returncode, 1)
        self.notes("tests/unit/x.test.ts :: b -> tests/unit/x.test.ts :: c\n")
        self.assertEqual(subprocess.run(base, capture_output=True, text=True).returncode, 0)

    def test_a_list_that_is_not_an_array_is_refused(self) -> None:
        path = self.root / "bad.json"
        path.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            neutrality.load_listing(path)


if __name__ == "__main__":
    unittest.main()
