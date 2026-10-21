# project_check.py
import os
import re
import subprocess
import sys
from pathlib import Path

STATES = {"included", "available", "absent", "removed"}
AGENTS_WORD_BUDGET = 1500
BOOTSTRAP_MARKERS = ("<!-- BOOTSTRAP_ONLY_START -->", "<!-- BOOTSTRAP_ONLY_END -->")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
FENCE = re.compile(r"^```.*?^```", re.M | re.S)


SKIP_DIRS = {".git", "node_modules", "vendor", ".venv", "venv", "__pycache__", "dist", "build", "target", ".claude", "graphify-out"}
SIGNAL_NAME = re.compile(
    r"^(package\.json|requirements[^/]*\.(txt|in)|pyproject\.toml|setup\.py|setup\.cfg|go\.mod|Cargo\.toml|Gemfile|composer\.json|"
    r"pom\.xml|build\.gradle(\.kts)?|[^/]+\.csproj|mix\.exs|Makefile|Justfile|Taskfile\.ya?ml|Dockerfile[^/]*|"
    r"(docker-)?compose[^/]*\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|ansible\.cfg|\.eslintrc.*|eslint\.config\..*|\.?ruff\.toml|"
    r"tox\.ini|\.?mypy\.ini|pytest\.ini|\.flake8|\.golangci\.ya?ml|\.?clippy\.toml|\.shellcheckrc|\.yamllint.*|"
    r"tsconfig[^/]*\.json|jest\.config\..*|vitest\.config\..*|\.pre-commit-config\.ya?ml|\.tflint\.hcl|\.ansible-lint|"
    r"\.coverage-gate\.json)$"
)
SIGNAL_DIRS = {"tests", "test", "__tests__", "spec", "e2e", "migrations"}
FINGERPRINT = re.compile(r"```fingerprint\n(.*?)```", re.S)


def signals() -> list[str]:
    found: set[str] = set()
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = Path(root).relative_to(".")
        for d in dirs:
            if d in SIGNAL_DIRS:
                found.add(str(rel / d) + "/")
        for f in files:
            path = str(rel / f)
            if SIGNAL_NAME.match(f) or path.startswith(".github/workflows/") or f.endswith(".tf"):
                found.add(str(rel) + "/*.tf" if f.endswith(".tf") else path)
    return sorted(p[2:] if p.startswith("./") else p for p in found)


def head_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "none"


def refresh_fingerprint(path: Path, text: str) -> str:
    block = "```fingerprint\ncommit " + head_commit() + "\n" + "".join(s + "\n" for s in signals()) + "```"
    if FINGERPRINT.search(text):
        return FINGERPRINT.sub(lambda _: block, text, count=1)
    return text.rstrip("\n") + "\n\n## 10. Fingerprint\n\n" + block + "\n"


def check_fingerprint(text: str, completed: bool, problems: list[str]) -> None:
    m = FINGERPRINT.search(text)
    lines = [x.strip() for x in m.group(1).splitlines() if x.strip()] if m else []
    if not lines:
        if completed:
            problems.append("no fingerprint in docs/PROJECT.md: run python3 scripts/project_check.py --refresh-fingerprint")
        return
    since = lines[0].split(" ", 1)[1] if lines[0].startswith("commit ") else "?"
    recorded = set(lines[1:] if lines[0].startswith("commit ") else lines)
    now = set(signals())
    added, gone = sorted(now - recorded), sorted(recorded - now)
    if added or gone:
        parts = ([f"appeared {added}"] if added else []) + ([f"disappeared {gone}"] if gone else [])
        problems.append(
            f"docs/PROJECT.md is out of date since {since}: " + "; ".join(parts)
            + " — update §6/§3/§1 (/intake refresh), then --refresh-fingerprint"
        )


def slug(heading: str) -> str:
    text = re.sub(r"[^\w\- ]", "", heading.strip().lower())
    return text.replace(" ", "-")


def anchors(path: Path) -> set[str]:
    text = FENCE.sub("", path.read_text(encoding="utf-8", errors="ignore"))
    return {slug(m.group(1)) for m in re.finditer(r"^#{1,6}\s+(.+?)\s*#*$", text, re.M)}


def check_links(problems: list[str]) -> None:
    files = [p for p in (Path("AGENTS.md"), Path("README.md")) if p.is_file()]
    files += sorted(Path("docs").rglob("*.md")) if Path("docs").is_dir() else []
    for f in files:
        text = FENCE.sub("", f.read_text(encoding="utf-8", errors="ignore"))
        for m in LINK.finditer(text):
            target = m.group(1)
            if re.match(r"^[a-z][a-z0-9+.-]*:", target):
                continue
            path_part, _, anchor = target.partition("#")
            dest = (f.parent / path_part).resolve() if path_part else f.resolve()
            if path_part and not dest.exists():
                problems.append(f"{f}: link to {target} — {path_part} does not exist")
            elif anchor and dest.suffix == ".md" and dest.is_file() and anchor not in anchors(dest):
                problems.append(f"{f}: link to {target} — no heading #{anchor} in {dest.name}")


def check_instructions(text: str, problems: list[str]) -> None:
    agents_path, claude_path = Path("AGENTS.md"), Path("CLAUDE.md")
    if agents_path.is_file():
        agents = agents_path.read_text(encoding="utf-8")
        words = len(agents.split())
        if words > AGENTS_WORD_BUDGET:
            problems.append(f"AGENTS.md has {words} words (budget {AGENTS_WORD_BUDGET}): every session pays for it; move area detail into docs/ or .claude/rules/")
        if re.search(r"^intake:\s*completed", text, re.M) and any(m in agents for m in BOOTSTRAP_MARKERS):
            problems.append("intake is completed but AGENTS.md still carries the BOOTSTRAP_ONLY block; delete it and its markers")
        if claude_path.is_file():
            claude = FENCE.sub("", claude_path.read_text(encoding="utf-8"))
            lines = {line.strip() for line in claude.splitlines()}
            if "@AGENTS.md" not in lines:
                problems.append("CLAUDE.md does not import AGENTS.md with a standalone '@AGENTS.md' line")
            sections = {line.strip() for line in FENCE.sub("", agents).splitlines() if line.startswith("## ")}
            copied = sorted(lines & sections)
            if copied:
                problems.append(f"CLAUDE.md repeats AGENTS.md sections {copied}; it imports them with @AGENTS.md")


def main() -> int:
    path = Path("docs/PROJECT.md")
    if not path.exists():
        print("docs/PROJECT.md missing; run /intake")
        return 1
    text = path.read_text(encoding="utf-8")
    if "--refresh-fingerprint" in sys.argv[1:]:
        path.write_text(refresh_fingerprint(path, text), encoding="utf-8")
        print(f"fingerprint refreshed: {len(signals())} signal file(s) at {head_commit()}")
        return 0
    problems: list[str] = []

    intake = re.search(r"^intake:\s*(.+)$", text, re.M)
    if not intake:
        problems.append("frontmatter lacks 'intake:'")
    completed = bool(intake and intake.group(1).strip().startswith("completed"))

    ledger = text.split("## 3. Capability ledger", 1)
    if len(ledger) < 2:
        problems.append("section '3. Capability ledger' missing")
    else:
        body = ledger[1].split("\n## ", 1)[0]
        for line in body.splitlines():
            if not line.startswith("|") or "---" in line or line.startswith("| Capability"):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) < 2:
                continue
            if cells[1] not in STATES:
                problems.append(f"ledger row '{cells[0]}' has state '{cells[1]}' (allowed: {sorted(STATES)})")

    if completed:
        open_cells = [m.start() for m in re.finditer(r"_unanswered_", text)]
        if open_cells:
            lines = sorted({text.count("\n", 0, i) + 1 for i in open_cells})
            problems.append(f"intake completed but {len(lines)} '_unanswered_' cell(s) remain at lines {lines[:12]}")

    for heading in ("## 5. Unattended policy", "## 6. Gate checks"):
        if heading not in text:
            problems.append(f"section '{heading[3:]}' missing")

    gates = text.split("## 6. Gate checks", 1)[1].split("\n## ", 1)[0] if "## 6. Gate checks" in text else ""
    for tier in ("### Fast tier", "### Full tier"):
        if gates and tier not in gates:
            problems.append(f"section 6 has no '{tier[4:]}' — the fast and the full run are declared separately")
    if gates and "marked full-only" not in gates:
        problems.append("section 6 does not say how a test is marked full-only in this project")

    check_fingerprint(text, completed, problems)
    check_instructions(text, problems)
    check_links(problems)

    if problems:
        print("\n".join(problems))
        return 1
    print(f"PROJECT.md ok (intake: {intake.group(1).strip() if intake else '?'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
