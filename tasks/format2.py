# format2.py
from __future__ import annotations

import pathlib
import re

REPO = pathlib.Path(".")
TECH_REF = re.compile(r"docs/tech/\S+")
TECH_NAME = re.compile(r"^[^@/]+@[^/]*\d[^/]*\.md$")
URL = re.compile(r"https?://\S+")
SECTION_HEAD = re.compile(r"^(TASK:|GOAL|CONTEXT|SCOPE|OUTCOME|VERIFY|ROLE|DEPENDS|WRITE-SET|DATA|SECURITY)\b", re.M)
SCOPE_PLUS = re.compile(r"^\s*\+\s*(.*)$")
SCOPE_ID = re.compile(r"^S(\d+)\b")
VERIFY_ITEM = re.compile(r"^\s*(\d+)\.\s")
EVIDENCE_LINE = re.compile(r"^\s*(?:[-*|]\s*)?([SV]\d+)\b[\s:|—-]*(.*)$")
PATH_LINE = re.compile(r"[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,6}:\d+")
EXIT_CODE = re.compile(r"(?:\bexit(?:\s+code)?|код выхода)\s*[:=]?\s*\d+", re.I)


def section(body: str, name: str) -> str:
    heads = [(m.start(), m.group(1)) for m in SECTION_HEAD.finditer(body)]
    for i, (start, head) in enumerate(heads):
        if head == name:
            end = heads[i + 1][0] if i + 1 < len(heads) else len(body)
            return body[start:end].split("\n", 1)[1] if "\n" in body[start:end] else ""
    return ""


def requirement_ids(rel: str, body: str, problems: list[str]) -> list[str]:
    ids: list[str] = []
    for line in section(body, "SCOPE").splitlines():
        m = SCOPE_PLUS.match(line)
        if not m:
            continue
        sid = SCOPE_ID.match(m.group(1).strip())
        if not sid:
            problems.append(f"{rel}: SCOPE '+' line without an S<n> id: {line.strip()!r}")
            continue
        tag = f"S{sid.group(1)}"
        if tag in ids:
            problems.append(f"{rel}: SCOPE id {tag} is used twice")
        ids.append(tag)
    for line in section(body, "VERIFY").splitlines():
        m = VERIFY_ITEM.match(line)
        if m:
            ids.append(f"V{m.group(1)}")
    return ids


def evidence_map(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in text.splitlines():
        m = EVIDENCE_LINE.match(line)
        if m:
            found[m.group(1)] = found.get(m.group(1), "") + " " + m.group(2)
    return found


def check_evidence(rel: str, ids: list[str], verify_md: pathlib.Path, problems: list[str]) -> None:
    found = evidence_map(verify_md.read_text(encoding="utf-8"))
    for tag in ids:
        if tag not in found:
            problems.append(f"{rel}: VERIFY.md has no evidence for {tag}")
        elif not (PATH_LINE.search(found[tag]) or EXIT_CODE.search(found[tag])):
            problems.append(f"{rel}: VERIFY.md evidence for {tag} names neither a path:line nor a command with its exit code")


def write_units(body: str) -> list[tuple[str, str | None]]:
    units = []
    for line in section(body, "WRITE-SET").splitlines():
        item = line.strip()
        if not item or item.startswith(("#", "(")):
            continue
        path, _, symbol = item.split()[0].partition("::")
        units.append((path, symbol or None))
    return units


def overlaps(a: tuple[str, str | None], b: tuple[str, str | None]) -> bool:
    (pa, sa), (pb, sb) = a, b
    if pa.endswith("/") or pb.endswith("/"):
        return pb.startswith(pa) if pa.endswith("/") else pa.startswith(pb)
    return pa == pb and (sa is None or sb is None or sa == sb)


DATA_REQUIRED = ("dir", "type", "null", "interpretable", "source")
VERSIONED_URL = re.compile(r"^https?://\S*\d")
TEST_REF = re.compile(r"[/:]")


def has_section(body: str, name: str) -> bool:
    return any(m.group(1) == name for m in SECTION_HEAD.finditer(body))


def data_records(body: str) -> dict[str, dict[str, str]]:
    records: dict[str, dict[str, str]] = {}
    for line in section(body, "DATA").splitlines():
        item = line.strip()
        if not item or item.startswith(("#", "(")) or ":" not in item:
            continue
        name, _, rest = item.partition(":")
        fields = {}
        for part in rest.split(";"):
            key, eq, value = part.strip().partition("=")
            if eq:
                fields[key.strip()] = value.strip()
        records[name.strip()] = fields
    return records


def check_data(rel: str, body: str, problems: list[str]) -> None:
    if not has_section(body, "DATA"):
        problems.append(f"{rel}: format 2 task without a DATA section (write '(none)' when it touches no external input or output)")
        return
    for name, f in data_records(body).items():
        for key in DATA_REQUIRED:
            if not f.get(key):
                problems.append(f"{rel}: DATA {name} has no {key}=")
        if not (f.get("range") or f.get("size")):
            problems.append(f"{rel}: DATA {name} type={f.get('type', '?')} has neither range= nor size= — a bare type is a guess")
        if f.get("source") and not VERSIONED_URL.match(f["source"]):
            problems.append(f"{rel}: DATA {name} source is not a link to versioned documentation: {f['source']}")
        if f.get("interpretable") not in (None, "yes", "no"):
            problems.append(f"{rel}: DATA {name} interpretable={f['interpretable']} (yes or no)")
        if f.get("interpretable") == "no" and not TEST_REF.search(f.get("validated", "")):
            problems.append(f"{rel}: DATA {name} is interpretable=no but names no input validation test in validated=")


SINK_LINE = re.compile(r"^\s*sink\s+(\S+?):\s*consumes\s+([^;]+)(.*)$")


def sinks(body: str) -> list[tuple[str, list[str], dict[str, str]]]:
    out = []
    for line in section(body, "SECURITY").splitlines():
        m = SINK_LINE.match(line)
        if not m:
            continue
        fields = [f.strip() for f in m.group(2).split(",") if f.strip()]
        extra = {}
        for part in m.group(3).split(";"):
            key, eq, value = part.strip().partition("=")
            if eq:
                extra[key.strip()] = value.strip()
        out.append((m.group(1), fields, extra))
    return out


def check_sinks(tasks: dict[str, tuple[str, dict[str, str]]], problems: list[str]) -> None:
    fields: dict[str, dict[str, str]] = {}
    for body, _ in tasks.values():
        fields.update(data_records(body))
    for rel, (body, _) in sorted(tasks.items()):
        if not has_section(body, "SECURITY"):
            problems.append(f"{rel}: format 2 task without a SECURITY section (write '(no sinks)' when it adds none)")
            continue
        for sink, consumed, extra in sinks(body):
            for name in consumed:
                record = fields.get(name)
                if record is None:
                    problems.append(f"{rel}: sink {sink} consumes {name}, which no task describes in DATA")
                    continue
                if record.get("interpretable") == "yes":
                    if not extra.get("protection"):
                        problems.append(f"{rel}: sink {sink} consumes {name} (interpretable=yes) without protection=")
                    if not TEST_REF.search(extra.get("test", "")):
                        problems.append(f"{rel}: sink {sink} consumes {name} (interpretable=yes) without a test= that proves the protection")


TIER = re.compile(r"^\s*\d+\.\s*\[(fast|full)(\s*,\s*heavy)?\]")
REVERSE = re.compile(r"(?:reverse control|обратный контроль):\s*(\S.*?)\s*(?:→|->)\s*(\S+)", re.I)
MAX_FAST_HEAVY = 3


def check_verify(rel: str, body: str, problems: list[str]) -> None:
    items = [line for line in section(body, "VERIFY").splitlines() if VERIFY_ITEM.match(line)]
    fast_heavy = 0
    for line in items:
        m = TIER.match(line)
        if not m:
            problems.append(f"{rel}: VERIFY item without [fast] or [full]: {line.strip()!r}")
        elif m.group(1) == "fast" and m.group(2):
            fast_heavy += 1
    if fast_heavy > MAX_FAST_HEAVY:
        problems.append(f"{rel}: {fast_heavy} heavy tests in the fast tier (at most {MAX_FAST_HEAVY}); move the rest to [full, heavy]")
    named = [m for m in (REVERSE.search(line) for line in items) if m and TEST_REF.search(m.group(2))]
    if not named:
        problems.append(f"{rel}: no VERIFY item names reverse control as 'reverse control: <mutation> → <path::test>'")


def check_tech(rel: str, body: str, problems: list[str]) -> None:
    for ref in TECH_REF.findall(section(body, "CONTEXT")):
        path = REPO / ref
        if not TECH_NAME.match(path.name):
            problems.append(f"{rel}: {ref} does not name the version it studies (docs/tech/<name>@<version>.md)")
        if not path.is_file():
            problems.append(f"{rel}: CONTEXT names {ref}, which does not exist — study the technology before designing against it")
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"^\s*[-*]\s+\S", line) and not URL.search(line):
                problems.append(f"{rel}: {ref}:{n} is an item without a URL")


def check_task(rel: str, task_dir: pathlib.Path, body: str, problems: list[str]) -> None:
    check_data(rel, body, problems)
    check_tech(rel, body, problems)
    check_verify(rel, body, problems)
    has_children = any(p.parent != task_dir for p in task_dir.rglob("task.txt"))
    if not has_children:
        if not write_units(body):
            problems.append(f"{rel}: format 2 task without a WRITE-SET")
        if not re.search(r"^\s*indivisible:\s*\S", section(body, "SCOPE"), re.M):
            problems.append(f"{rel}: neither split into child tasks nor marked 'indivisible: <why>' in SCOPE")
    ids = requirement_ids(rel, body, problems)
    verify_md = task_dir / "VERIFY.md"
    if verify_md.exists():
        check_evidence(rel, ids, verify_md, problems)


def check_tree(tasks: dict[str, tuple[str, dict[str, str]]], problems: list[str]) -> None:
    def deps(kv: dict[str, str]) -> set[str]:
        return {x.strip() for x in kv.get("depends", "").split(",") if x.strip()}

    check_sinks(tasks, problems)
    contracts = {rel for rel, (_, kv) in tasks.items() if kv.get("split") == "contract"}

    def parent(rel: str) -> str:
        return rel.rsplit("/", 1)[0] if "/" in rel else ""

    def upstream(rel: str, seen: set[str] | None = None) -> set[str]:
        seen = set() if seen is None else seen
        for d in deps(tasks[rel][1]) if rel in tasks else ():
            if d not in seen:
                seen.add(d)
                upstream(d, seen)
        return seen

    names = sorted(tasks)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if parent(a) != parent(b) or a in upstream(b) or b in upstream(a):
                continue
            body_a, kv_a = tasks[a]
            body_b, kv_b = tasks[b]
            if "assembly" in (kv_a.get("split"), kv_b.get("split")):
                continue
            ua, ub = write_units(body_a), write_units(body_b)
            if any(overlaps(x, y) for x in ua for y in ub):
                problems.append(f"{a} and {b}: write sets overlap — two agents would edit the same unit")
                continue
            shared = {x[0] for x in ua} & {y[0] for y in ub}
            if shared and not (deps(kv_a) & deps(kv_b) & contracts):
                problems.append(
                    f"{a} and {b}: share {sorted(shared)} at different symbols but do not both depend on a split:contract task"
                )
