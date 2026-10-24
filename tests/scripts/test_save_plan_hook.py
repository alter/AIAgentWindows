# test_save_plan_hook.py
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild"
HOOK_CHECK = "head -n 8 \"$1\" | grep -qE '^status: *running *$'"

CASES = {
    "front-matter": "---\nstatus: running\n---\n\n# Plan\n\n- [ ] T01 first\n",
    "intro-and-fence": "Here is the plan in this repository's format:\n\n```markdown\n---\nstatus: running\n---\n- [ ] T01 first\n```\n",
    "no-front-matter": "status: running\n\n# Plan\n",
    "no-space": "---\nstatus:running\n---\n# Plan\n",
    "padded": "---\nstatus:    running   \n---\n# Plan\n",
}

ENTRY = """
import { savePlanFile } from '%(root)s/src/main/projects/save-plan';
import { planSlug, planText } from '%(root)s/src/shared/plan-file';
const [project, cases] = [process.argv[2], JSON.parse(process.argv[3])];
const out = {};
for (const [name, text] of Object.entries(cases)) {
  const result = await savePlanFile(project, planSlug(name, 'r1'), planText(text), false, { trash: async () => undefined });
  out[name] = result.ok ? result.file : result.error;
}
process.stdout.write(JSON.stringify(out));
"""


def hook_matches(file: str) -> bool:
    return subprocess.run(["sh", "-c", HOOK_CHECK, "sh", file], check=False).returncode == 0


class SavePlanHookTest(unittest.TestCase):
    def test_saved_files_never_match_the_hook_while_the_raw_text_does(self) -> None:
        self.assertTrue(ESBUILD.exists(), "node_modules/.bin/esbuild is missing: run npm ci")
        with tempfile.TemporaryDirectory() as tmp:
            base = pathlib.Path(tmp)
            entry = base / "entry.mjs"
            entry.write_text(ENTRY % {"root": ROOT}, encoding="utf8")
            bundle = base / "bundle.mjs"
            subprocess.run(
                [str(ESBUILD), str(entry), "--bundle", "--platform=node", "--format=esm", f"--outfile={bundle}", "--log-level=error"],
                check=True,
                cwd=ROOT,
            )
            project = base / "project"
            project.mkdir()
            run = subprocess.run(["node", str(bundle), str(project), json.dumps(CASES)], check=True, capture_output=True, text=True)
            saved = json.loads(run.stdout)
            self.assertEqual(sorted(saved), sorted(CASES))
            for name, text in CASES.items():
                raw = base / f"raw-{name}.md"
                raw.write_text(text, encoding="utf8")
                self.assertTrue(hook_matches(str(raw)), f"control: the raw text of {name} must match the hook")
                self.assertTrue(pathlib.Path(saved[name]).is_file(), saved[name])
                self.assertEqual(pathlib.Path(saved[name]).parent, project / "docs" / "plans")
                self.assertFalse(hook_matches(saved[name]), f"the saved plan of {name} still matches the hook")
                self.assertIn("status: draft", pathlib.Path(saved[name]).read_text(encoding="utf8"))


if __name__ == "__main__":
    unittest.main()
