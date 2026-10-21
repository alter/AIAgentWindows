# test_evidence_check.py
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

import evidence_check  # noqa: E402
import re  # noqa: E402

CODE = re.compile(r"\[([a-z-]+)\]")

HEADER = "| ID | Claim | Kind | Evidence | Status |\n|---|---|---|---|---|\n"


class EvidenceCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root / "spikes").mkdir()
        (self.root / "spikes" / "out.log").write_text("ok\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def problems(self, rows: str) -> list[str]:
        return evidence_check.check(HEADER + rows, self.root)

    def codes(self, rows: str) -> set[str]:
        return {m.group(1) for p in self.problems(rows) for m in [CODE.search(p)] if m}

    def test_valid_rows_pass(self) -> None:
        rows = (
            "| A1 | runs | run | `spikes/out.log` | confirmed |\n"
            "| A2 | documented | doc | https://example.org/v1.2/page quote | refuted |\n"
            "| A3 | unknown yet | assumption | checked in tasks/10-app/01-x | open |\n"
        )
        self.assertEqual(self.problems(rows), [])

    def test_row_without_evidence_fails(self) -> None:
        self.assertIn("no-evidence", self.codes("| A1 | runs | run |  | confirmed |\n"))

    def test_unknown_kind_fails(self) -> None:
        self.assertIn("kind", self.codes("| A1 | x | guess | `spikes/out.log` | confirmed |\n"))

    def test_doc_without_url_fails(self) -> None:
        self.assertIn("doc-url", self.codes("| A1 | x | doc | the docs say so | confirmed |\n"))

    def test_run_with_missing_artefact_fails(self) -> None:
        self.assertIn("run-artefact", self.codes("| A1 | x | run | `spikes/missing.log` | confirmed |\n"))

    def test_assumption_without_place_fails(self) -> None:
        self.assertIn("assumption-place", self.codes("| A1 | x | assumption | probably fine | open |\n"))

    def test_assumption_cannot_be_confirmed(self) -> None:
        self.assertIn("assumption-status", self.codes("| A1 | x | assumption | checked in T00 | confirmed |\n"))

    def test_open_needs_assumption(self) -> None:
        self.assertIn("open-status", self.codes("| A1 | x | run | `spikes/out.log` | open |\n"))

    def test_duplicate_id_fails(self) -> None:
        row = "| A1 | x | run | `spikes/out.log` | confirmed |\n"
        self.assertIn("duplicate", self.codes(row + row))

    def test_escaped_pipe_stays_in_cell(self) -> None:
        rows = "| A1 | runs `a \\| b` | run | `spikes/out.log` | confirmed |\n"
        self.assertEqual(self.problems(rows), [])
        self.assertEqual(len(evidence_check.rows(HEADER + rows)), 1)

    def test_row_with_wrong_cell_count_is_reported(self) -> None:
        self.assertIn("malformed", self.codes("| A1 | a | b | run | `spikes/out.log` | confirmed |\n"))

    def test_empty_table_fails(self) -> None:
        self.assertIn("empty", self.codes(""))


if __name__ == "__main__":
    unittest.main()
