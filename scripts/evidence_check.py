# evidence_check.py
from __future__ import annotations

import argparse
import pathlib
import re
import sys

KINDS = {"run", "doc", "assumption"}
STATUSES = {"confirmed", "refuted", "open"}
URL = re.compile(r"https?://\S+")
ARTEFACT = re.compile(r"`([^`\s]+)`")
PLACE = re.compile(r"\btasks/\S+|\bT\d{2}\b|\bHUMAN\b")
CELL_SPLIT = re.compile(r"(?<!\\)\|")


def table_lines(text: str) -> list[list[str]]:
    out = []
    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip().replace("\\|", "|") for c in CELL_SPLIT.split(line.strip().strip("|"))]
        if cells[0] == "ID" or set(cells[0]) <= {"-", ":"}:
            continue
        out.append(cells)
    return out


def rows(text: str) -> list[list[str]]:
    return [cells for cells in table_lines(text) if len(cells) == 5]


def check_row(cells: list[str], root: pathlib.Path) -> list[str]:
    rid, _, kind, evidence, status = cells
    problems = []
    if kind not in KINDS:
        problems.append(f"{rid}: [kind] kind {kind!r} is not one of {sorted(KINDS)}")
    if status not in STATUSES:
        problems.append(f"{rid}: [status] status {status!r} is not one of {sorted(STATUSES)}")
    if not evidence:
        return problems + [f"{rid}: [no-evidence] no evidence"]
    if kind == "doc" and not URL.search(evidence):
        problems.append(f"{rid}: [doc-url] doc evidence without a URL")
    if kind == "run":
        paths = ARTEFACT.findall(evidence)
        if not paths:
            problems.append(f"{rid}: [run-artefact] run evidence names no artefact in backticks")
        for p in paths:
            if not (root / p).exists():
                problems.append(f"{rid}: [run-artefact] artefact {p} does not exist")
    if kind == "assumption":
        if not PLACE.search(evidence):
            problems.append(f"{rid}: [assumption-place] assumption names no place where it is checked (tasks/…, T##, HUMAN)")
        if status != "open":
            problems.append(f"{rid}: [assumption-status] an assumption can only be open")
    elif status == "open":
        problems.append(f"{rid}: [open-status] open status needs kind assumption")
    return problems


def check(text: str, root: pathlib.Path) -> list[str]:
    table = rows(text)
    problems = [f"{cells[0]}: [malformed] {len(cells)} cells instead of 5" for cells in table_lines(text) if len(cells) != 5]
    if not table:
        return problems + ["[empty] no claim rows found"]
    seen = set()
    for cells in table:
        if cells[0] in seen:
            problems.append(f"{cells[0]}: [duplicate] duplicate id")
        seen.add(cells[0])
        problems.extend(check_row(cells, root))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Every claim in the evidence table carries evidence of a known kind.")
    parser.add_argument("path", nargs="?", default="docs/EVIDENCE.md")
    parser.add_argument("--root", default=".", help="directory that run artefact paths are relative to")
    args = parser.parse_args()
    problems = check(pathlib.Path(args.path).read_text(encoding="utf-8"), pathlib.Path(args.root))
    for p in problems:
        print(p)
    print(f"evidence_check: {len(rows(pathlib.Path(args.path).read_text(encoding='utf-8')))} rows, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
