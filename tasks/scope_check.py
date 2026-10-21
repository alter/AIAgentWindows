# scope_check.py
from __future__ import annotations

import fnmatch
import pathlib
import subprocess
import importlib
import sys

sys.dont_write_bytecode = True
format2 = importlib.import_module("format2")

ALWAYS_ALLOWED = ("docs/plans/*", ".coverage-gate.json")


def declared(task_dir: pathlib.Path) -> list[str]:
    body = (task_dir / "task.txt").read_text(encoding="utf-8")
    entries = format2.section(body, "WRITE-SET") or format2.section(body, "CONTEXT")
    out = []
    for line in entries.splitlines():
        item = line.strip().split()[0] if line.strip() else ""
        if item and not item.startswith(("#", "(")):
            out.append(item.split("::", 1)[0].split(":", 1)[0])
    return out


def allowed(path: str, patterns: list[str]) -> bool:
    for p in patterns:
        if p.endswith("/") and path.startswith(p):
            return True
        if path == p or fnmatch.fnmatch(path, p):
            return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: scope_check.py <task dir> [base revision, default HEAD~1]")
        return 2
    task_dir = pathlib.Path(sys.argv[1]).resolve()
    base = sys.argv[2] if len(sys.argv) > 2 else "HEAD~1"
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
    own = str(task_dir.relative_to(pathlib.Path(top).resolve())) + "/"
    patterns = declared(task_dir) + [own, *ALWAYS_ALLOWED]
    changed = subprocess.run(
        ["git", "diff", "--name-only", f"{base}..HEAD"], cwd=top, capture_output=True, text=True, check=True
    ).stdout.split()
    outside = [c for c in changed if not allowed(c, patterns)]
    if outside:
        print(f"changed outside the declared write set of {own.rstrip('/')}:")
        for c in outside:
            print(f"  • {c}")
        return 1
    print(f"scope ok: {len(changed)} changed file(s) inside the write set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
