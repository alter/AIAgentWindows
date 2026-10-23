# neutrality_check.py
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import subprocess
import sys
import tempfile

RENAME = " -> "


def run(args: list[str], cwd: pathlib.Path, ok: tuple[int, ...] = (0,)) -> str:
    done = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if done.returncode not in ok:
        raise RuntimeError(f"{' '.join(args)} exited {done.returncode}: {done.stderr.strip()}")
    return done.stdout


def test_ids(listing: list[dict]) -> collections.Counter:
    ids: collections.Counter = collections.Counter()
    for entry in listing:
        file = str(entry["file"]).replace("\\", "/")
        cut = file.rfind("/tests/")
        rel = file[cut + 1 :] if cut >= 0 else file
        ids[f"{rel} :: {entry['name']}"] += 1
    return ids


def load_listing(path: pathlib.Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path} is not a vitest list")
    return data


def current_listing(root: pathlib.Path, given: pathlib.Path | None) -> list[dict]:
    if given is not None:
        return load_listing(given)
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "list.json"
        run(["npx", "vitest", "list", "--json", str(out)], root)
        return load_listing(out)


def sum_expects(out: str) -> int:
    return sum(int(line.rsplit(":", 1)[1]) for line in out.splitlines() if line.strip())


def expects_at(root: pathlib.Path, commit: str) -> int:
    return sum_expects(run(["git", "grep", "-c", "expect(", commit, "--", "tests/"], root, ok=(0, 1)))


def expects_now(root: pathlib.Path) -> int:
    return sum_expects(run(["git", "grep", "-c", "--untracked", "expect(", "--", "tests/"], root, ok=(0, 1)))


def renamed_ids(notes: pathlib.Path) -> set[str]:
    if not notes.is_file():
        return set()
    found = set()
    for line in notes.read_text(encoding="utf-8").splitlines():
        if RENAME in line:
            found.add(line.split(RENAME, 1)[0].strip().lstrip("-*` ").strip("`"))
    return found


def check(
    root: pathlib.Path,
    commit: str,
    before: list[dict],
    now: list[dict],
    notes: pathlib.Path,
) -> list[str]:
    problems = []
    old, new = test_ids(before), test_ids(now)
    allowed = renamed_ids(notes)
    for test_id in sorted(old):
        if new[test_id] < old[test_id] and test_id not in allowed:
            problems.append(f"{test_id} [test-vanished] absent from HEAD with no 'old{RENAME}new' line in {notes.name}")
    if len(now) < len(before):
        problems.append(f"tests [test-count] {len(now)} tests now, {len(before)} before")
    then, today = expects_at(root, commit), expects_now(root)
    if then > today:
        problems.append(f"tests/ [expect-count] {today} expect( calls now, {then} at {commit}: an assertion was removed")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Behaviour-neutral refactor check: no test id lost, no assertion removed.")
    parser.add_argument("commit", help="commit the refactor started from")
    parser.add_argument("before", type=pathlib.Path, help="saved `npx vitest list --json` of that commit")
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("."), help="repository root")
    parser.add_argument("--current", type=pathlib.Path, default=None, help="a saved vitest list to use instead of running vitest")
    parser.add_argument("--notes", type=pathlib.Path, default=None, help="NOTES.md with `old -> new` lines (default: NOTES.md beside the saved list)")
    args = parser.parse_args()
    notes = args.notes if args.notes is not None else args.before.resolve().parent / "NOTES.md"
    problems = check(args.root, args.commit, load_listing(args.before), current_listing(args.root, args.current), notes)
    for p in problems:
        print(p)
    print(f"neutrality_check: {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
