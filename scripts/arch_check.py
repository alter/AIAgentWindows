# arch_check.py
from __future__ import annotations

import argparse
import pathlib
import posixpath
import re
import sys

SOURCE_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"}
NODE_BUILTINS = {
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
    "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
    "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "sea", "sqlite", "stream", "string_decoder", "sys", "test", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
}
IMPORT_FROM = re.compile(r"""\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1""")
IMPORT_BARE = re.compile(r"""\bimport\s*(['"])([^'"\n]+)\1""")
IMPORT_CALL = re.compile(r"""\b(?:require|import)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)""")
CONSTRUCTOR = re.compile(r"\bnew\s+(WebContentsView|BrowserWindow)\s*\(")
PRELOAD = re.compile(r"\bpreload\b")
SITE_MARK = re.compile(r"\bpartition\b|persist:")
COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)


def blank_comments(text: str) -> str:
    return COMMENTS.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def specifiers(text: str) -> list[tuple[int, str]]:
    found = []
    for pattern in (IMPORT_FROM, IMPORT_BARE, IMPORT_CALL):
        found.extend((line_of(text, m.start()), m.group(2)) for m in pattern.finditer(text))
    return sorted(set(found))


def is_node_builtin(spec: str) -> bool:
    return spec.startswith("node:") or spec.split("/")[0] in NODE_BUILTINS


def is_package(spec: str, name: str) -> bool:
    return spec == name or spec.startswith(name + "/")


def resolves_into(rel: str, spec: str, target: str) -> bool:
    if not spec.startswith("."):
        return False
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec))
    return resolved == target or resolved.startswith(target + "/")


def balanced(text: str, open_index: int) -> str:
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_index : i + 1]
    return text[open_index:]


def renderer_problems(rel: str, text: str) -> list[str]:
    out = []
    for line, spec in specifiers(text):
        if is_package(spec, "electron"):
            out.append(f"{rel}:{line} [renderer-electron] renderer imports {spec}")
        elif is_node_builtin(spec):
            out.append(f"{rel}:{line} [renderer-node] renderer imports Node builtin {spec}")
        elif resolves_into(rel, spec, "src/main"):
            out.append(f"{rel}:{line} [renderer-main] renderer imports main-process module {spec}")
    return out


def shared_problems(rel: str, text: str) -> list[str]:
    out = []
    for line, spec in specifiers(text):
        if is_package(spec, "electron") or is_package(spec, "node-pty"):
            out.append(f"{rel}:{line} [shared-native] shared code imports {spec}")
    return out


def preload_problems(rel: str, text: str) -> list[str]:
    out = []
    for m in CONSTRUCTOR.finditer(text):
        call = balanced(text, m.end() - 1)
        if not PRELOAD.search(call):
            continue
        if m.group(1) == "WebContentsView" or SITE_MARK.search(call):
            out.append(f"{rel}:{line_of(text, m.start())} [site-preload] {m.group(1)} for a site is created with preload")
    return out


def check_file(rel: str, text: str) -> list[str]:
    text = blank_comments(text)
    out = []
    if rel.startswith("src/renderer/"):
        out.extend(renderer_problems(rel, text))
    if rel.startswith("src/shared/"):
        out.extend(shared_problems(rel, text))
    if rel.startswith("src/"):
        out.extend(preload_problems(rel, text))
    return out


def check(root: pathlib.Path) -> list[str]:
    problems = []
    src = root / "src"
    if not src.is_dir():
        return problems
    for path in sorted(src.rglob("*")):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            rel = path.relative_to(root).as_posix()
            problems.extend(check_file(rel, path.read_text(encoding="utf-8")))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Layer boundaries of src/: renderer, shared, site views.")
    parser.add_argument("--root", default=".", help="repository root that holds src/")
    args = parser.parse_args()
    problems = check(pathlib.Path(args.root))
    for p in problems:
        print(p)
    print(f"arch_check: {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
