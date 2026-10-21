# lint_changed.py
import argparse
import fnmatch
import subprocess
import sys
from pathlib import PurePosixPath


def changed_files(base: str) -> list[str]:
    tracked = subprocess.run(["git", "diff", "--name-only", "--diff-filter=ACMR", base], capture_output=True, text=True, check=True).stdout.split()
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], capture_output=True, text=True, check=True).stdout.split()
    return sorted(set(tracked) | set(untracked))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Run a linter only on the files changed since a base revision, so the old findings of a repository you did not write stay out of the way and new ones do not get in."
    )
    ap.add_argument("--base", required=True, help="revision the work started from (the plan's T00 commit)")
    ap.add_argument("--glob", action="append", required=True, help="file pattern the linter understands, e.g. '*.sh'; repeatable")
    ap.add_argument("command", nargs=argparse.REMAINDER, help="-- linter command; the changed files are appended")
    args = ap.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        ap.error("give the linter command after --")
    files = [f for f in changed_files(args.base) if any(fnmatch.fnmatch(PurePosixPath(f).name, g) or fnmatch.fnmatch(f, g) for g in args.glob)]
    if not files:
        print(f"lint_changed: no changed file matches {args.glob}")
        return 0
    print(f"lint_changed: {len(files)} file(s): {' '.join(files)}")
    return subprocess.run([*command, *files]).returncode


if __name__ == "__main__":
    sys.exit(main())
