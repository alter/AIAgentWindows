# check.py
from __future__ import annotations

import pathlib
import re
import importlib
import sys

sys.dont_write_bytecode = True
format2 = importlib.import_module("format2")

ROOT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
SECTIONS = ["TASK:", "GOAL", "CONTEXT", "SCOPE", "OUTCOME", "VERIFY", "ROLE", "DEPENDS"]
LABELS = {"phase", "role", "type", "priority", "status", "verify", "depends", "milestone", "gate", "format", "split", "attack", "capability"}
PHASES: set[str] = set()
ROLES: set[str] = {"HUMAN"}
TYPES = {"feature", "fix", "research", "decision", "chore"}
PRIORITIES = {"P0", "P1", "P2", "P3"}
MILESTONES: dict[str, int] = {}
STATUSES = {"todo", "in_progress", "review", "done", "blocked"}
VERIFIES = {"pending", "passed", "failed"}
FORMATS = {"1", "2"}
GATES_EXPECTED: int | None = None
VERIFY_REQUIRED = (("Verifier:", "Проверил:"), ("## How to reproduce", "## Как воспроизвести"), ("## What was not checked", "## Что не проверено"))
BLOCKED_REQUIRED = (("Blocked:", "Заблокировано:"), ("Missing:", "Чего не хватает:"), ("Done before stopping:", "Что сделано до остановки:"))
LINE_REF = re.compile(r"(?<![\w/.-])([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,6}):(\d+)(?:-(\d+))?")


def read_labels(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"line without a colon: {line!r}")
        key, value = line.split(":", 1)
        out[key.strip()] = value.strip()
    return out


def load_vocab() -> None:
    global GATES_EXPECTED
    readme = ROOT / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        block = re.search(r"^phase:\s+(.+?)(?=^\w+:|^```)", text, re.M | re.S)
        if block:
            PHASES.update(w for w in re.split(r"[|\s]+", block.group(1)) if re.fullmatch(r"[a-z][a-z0-9-]*", w))
    roles = ROOT / "ROLES.md"
    if roles.exists():
        for m in re.finditer(r"^\| \*\*([A-Z]+)\*\*", roles.read_text(encoding="utf-8"), re.M):
            ROLES.add(m.group(1))
    goal = ROOT / "GOAL.md"
    if goal.exists():
        text = goal.read_text(encoding="utf-8")
        for m in re.finditer(r"\*\*(M\d+)\b", text):
            MILESTONES.setdefault(m.group(1), int(m.group(1)[1:]))
        gates = len(re.findall(r"^\*\*Gate \d+|^\*\*Ворота \d+", text, re.M))
        GATES_EXPECTED = gates or None
    if not PHASES:
        for d in ROOT.iterdir():
            if d.is_dir() and re.match(r"^\d{2}-", d.name):
                PHASES.add(d.name.split("-", 1)[1])


def ledger() -> dict[str, str]:
    path = REPO / "docs" / "PROJECT.md"
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8")
    body = text.split("## 3. Capability ledger", 1)[1].split("\n## ", 1)[0] if "## 3. Capability ledger" in text else ""
    rows = {}
    for line in body.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.startswith("|") and len(cells) >= 2 and cells[0] not in ("Capability", "") and not set(cells[0]) <= set("-"):
            rows[cells[0].lower()] = cells[1]
    return rows


def check_line_refs(rel: str, body: str, problems: list[str]) -> None:
    for m in LINE_REF.finditer(body):
        path, start = m.group(1), int(m.group(2))
        candidates = [REPO / path] + list(REPO.glob(f"**/{path}")) if "/" not in path else [REPO / path]
        target = next((c for c in candidates if c.is_file()), None)
        if target is None:
            continue
        try:
            total = sum(1 for _ in target.open(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        if start > total:
            problems.append(f"{rel}: reference {path}:{start} is past the end of the file ({total} lines)")


def main() -> int:
    load_vocab()
    format2.REPO = REPO
    problems: list[str] = []
    tasks: dict[str, dict[str, str]] = {}
    gates: list[str] = []
    format2_tasks: dict[str, tuple[str, dict[str, str]]] = {}

    for task_txt in sorted(ROOT.rglob("task.txt")):
        d = task_txt.parent
        rel = str(d.relative_to(ROOT))
        body = task_txt.read_text(encoding="utf-8")

        positions = []
        for s in SECTIONS:
            m = re.search(rf"^{re.escape(s)}", body, re.M)
            if not m:
                problems.append(f"{rel}: section {s} is missing")
            else:
                positions.append(m.start())
        if positions != sorted(positions):
            problems.append(f"{rel}: sections are not in the order given by README")
        if "−" not in body:
            problems.append(f"{rel}: SCOPE has no '−' lines (the boundary is not written down)")
        check_line_refs(rel, body, problems)

        labels_path = d / "labels.txt"
        if not labels_path.exists():
            problems.append(f"{rel}: labels.txt is missing")
            continue
        try:
            kv = read_labels(labels_path)
        except ValueError as exc:
            problems.append(f"{rel}: labels.txt — {exc}")
            continue
        tasks[rel] = kv

        for k in kv:
            if k not in LABELS:
                problems.append(f"{rel}: unknown label {k}")
        for k in ("phase", "role", "type", "priority", "status", "verify", "milestone"):
            if k not in kv:
                problems.append(f"{rel}: label {k} is missing")
        if PHASES and kv.get("phase") not in PHASES:
            problems.append(f"{rel}: phase={kv.get('phase')}")
        for role in re.split(r"[,\s]+", kv.get("role", "")):
            if role and role not in ROLES:
                problems.append(f"{rel}: role={role}")
        if kv.get("type") not in TYPES:
            problems.append(f"{rel}: type={kv.get('type')}")
        if kv.get("priority") not in PRIORITIES:
            problems.append(f"{rel}: priority={kv.get('priority')}")
        if MILESTONES and kv.get("milestone") not in MILESTONES:
            problems.append(f"{rel}: milestone={kv.get('milestone')}")
        if kv.get("status") not in STATUSES:
            problems.append(f"{rel}: status={kv.get('status')}")
        if kv.get("verify") not in VERIFIES:
            problems.append(f"{rel}: verify={kv.get('verify')}")
        if kv.get("gate") == "yes":
            gates.append(rel)
        if kv.get("capability"):
            state = ledger().get(kv["capability"].strip().lower())
            if state not in ("included", "available"):
                problems.append(
                    f"{rel}: capability:{kv['capability']} has no included/available row in the docs/PROJECT.md ledger"
                    f" (found: {state or 'no row'}) — a direct request is recorded there first"
                )
        if "attack" in kv and kv["attack"] not in VERIFIES:
            problems.append(f"{rel}: attack={kv['attack']}")
        if kv.get("attack") in ("passed", "failed") and not (d / "ATTACK.md").exists():
            problems.append(f"{rel}: attack:{kv['attack']} without ATTACK.md")
        if "format" in kv and kv["format"] not in FORMATS:
            problems.append(f"{rel}: format={kv['format']}")
        if kv.get("format") == "2":
            format2.check_task(rel, d, body, problems)
            format2_tasks[rel] = (body, kv)

        deps = [x.strip() for x in kv.get("depends", "").split(",") if x.strip()]
        for dep in deps:
            if not (ROOT / dep).is_dir():
                problems.append(f"{rel}: depends points nowhere: {dep}")
        m = re.search(r"(?ms)^DEPENDS\n\s+(.+?)\s*$", body)
        txt = m.group(1).strip() if m else ""
        for dep in deps:
            if dep not in txt:
                problems.append(f"{rel}: DEPENDS prose '{txt}' does not contain the label '{dep}'")

        if kv.get("status") == "blocked":
            bp = d / "BLOCKED.md"
            if not bp.exists():
                problems.append(f"{rel}: status:blocked without BLOCKED.md")
            else:
                b = bp.read_text(encoding="utf-8")
                for need in BLOCKED_REQUIRED:
                    if not any(n in b for n in need):
                        problems.append(f"{rel}: BLOCKED.md without '{need[0]}'")
        if kv.get("verify") == "passed":
            vp = d / "VERIFY.md"
            if not vp.exists():
                problems.append(f"{rel}: verify:passed without VERIFY.md")
            else:
                v = vp.read_text(encoding="utf-8")
                for need in VERIFY_REQUIRED:
                    if not any(n in v for n in need):
                        problems.append(f"{rel}: VERIFY.md without '{need[0]}'")
        if kv.get("status") == "done" and kv.get("gate") == "yes" and kv.get("verify") != "passed":
            problems.append(f"{rel}: a gate task is closed without verify:passed")
        runs = sorted(p for p in d.glob("FULLRUN-*.tsv") if p.stat().st_size > 0)
        if kv.get("status") == "done" and kv.get("gate") == "yes" and runs:
            red = [line.split("\t")[1] for line in runs[-1].read_text(encoding="utf-8").splitlines() if line.startswith(("fail\t", "stale\t", "timeout\t", "empty\t", "dup\t", "mem\t"))]
            if red:
                problems.append(f"{rel}: the milestone is closed while its latest full run ({runs[-1].name}) is red: {red}")
        plan = d / "PLAN.md"
        if plan.exists() and kv.get("status") in {"done", "blocked"}:
            head = plan.read_text(encoding="utf-8")[:400]
            if "status: running" in head:
                problems.append(f"{rel}: PLAN.md is still running while status:{kv.get('status')}")

    format2.check_tree(format2_tasks, problems)

    for rel, kv in tasks.items():
        dep = kv.get("depends")
        if dep and dep in tasks and MILESTONES:
            mine = MILESTONES.get(kv.get("milestone", ""), 0)
            theirs = MILESTONES.get(tasks[dep].get("milestone", ""), 0)
            if theirs > mine:
                problems.append(
                    f"{rel} ({kv.get('milestone')}) depends on {dep} "
                    f"({tasks[dep].get('milestone')}) — a later milestone"
                )

    if tasks and GATES_EXPECTED is not None and len(gates) != GATES_EXPECTED:
        problems.append(f"{len(gates)} gate tasks, expected {GATES_EXPECTED}: {gates}")

    print(f"task directories: {len(tasks)}; gates: {gates}")
    if problems:
        print(f"problems: {len(problems)}")
        for p in problems:
            print("  •", p)
        return 1
    print("problems: 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
