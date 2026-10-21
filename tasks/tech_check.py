# tech_check.py
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

MANIFESTS = {
    "requirements": re.compile(r"^(requirements[^/]*\.(txt|in)|constraints[^/]*\.txt)$"),
    "pyproject": re.compile(r"^pyproject\.toml$"),
    "package": re.compile(r"^package\.json$"),
    "cargo": re.compile(r"^Cargo\.toml$"),
    "gomod": re.compile(r"^go\.mod$"),
    "gemfile": re.compile(r"^Gemfile$"),
}
PATTERNS = {
    "requirements": re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|<=|~=|!=|>|<|@|;|$)"),
    "pyproject": re.compile(r"""^\s*(?:"([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*[=<>~!]|([A-Za-z0-9_.-]+)\s*=\s*["{])"""),
    "package": re.compile(r"""^\s*"((?:@[^"/]+/)?[^"@/][^"]*)"\s*:\s*"(?:[\^~>=<]*\d|workspace:|npm:|github:|git\+)"""),
    "cargo": re.compile(r"""^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"[\^~>=<]*\d|\{)"""),
    "gomod": re.compile(r"^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}/\S+)\s+v\d"),
    "gemfile": re.compile(r"""^\s*gem\s+["']([^"']+)["']"""),
}
SKIP_KEYS = {"name", "version", "edition", "description", "license", "python", "requires-python", "node", "go"}


def kind_of(path: str) -> str | None:
    name = pathlib.PurePosixPath(path).name
    for kind, pattern in MANIFESTS.items():
        if pattern.match(name):
            return kind
    return None


def names(kind: str, lines: list[str]) -> set[str]:
    found = set()
    for line in lines:
        m = PATTERNS[kind].match(line)
        if not m:
            continue
        name = next(g for g in m.groups() if g)
        if name.lower() not in SKIP_KEYS:
            found.add(name.lower())
    return found


def documented(repo: pathlib.Path, dep: str) -> bool:
    base = dep.rsplit("/", 1)[-1]
    tech = repo / "docs" / "tech"
    return tech.is_dir() and any(tech.glob(f"{base}@*.md"))


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "HEAD~1"
    repo = pathlib.Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip())
    changed = subprocess.run(["git", "diff", "--name-only", f"{base}..HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.split()
    missing: list[str] = []
    for path in changed:
        kind = kind_of(path)
        if not kind:
            continue
        diff = subprocess.run(["git", "diff", "-U0", f"{base}..HEAD", "--", path], cwd=repo, capture_output=True, text=True, check=True).stdout
        added = [line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")]
        removed = [line[1:] for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")]
        for dep in sorted(names(kind, added) - names(kind, removed)):
            if not documented(repo, dep):
                missing.append(f"{path}: new dependency {dep} has no docs/tech/{dep.rsplit('/', 1)[-1]}@<version>.md")
    if missing:
        print("new direct dependencies without a study of their pinned version:")
        for m in missing:
            print(f"  • {m}")
        return 1
    print("dependencies ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
