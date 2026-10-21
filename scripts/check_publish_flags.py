# check_publish_flags.py
from __future__ import annotations

import argparse
import json
import pathlib
import re
import shlex
import sys

BUILDER = re.compile(r"(?:^|[/\s])electron-builder(?:\s|$)")
SEGMENTS = re.compile(r"&&|\|\||;|\|")
RELEASE_NAME = re.compile(r"^(?:pre|post)?release(?::.*)?$")


def publish_values(tokens: list[str]) -> list[str]:
    values = []
    for index, token in enumerate(tokens):
        if token.startswith("--publish="):
            values.append(token.split("=", 1)[1])
        elif token == "--publish":
            values.append(tokens[index + 1] if index + 1 < len(tokens) else "")
    return values


def check_command(name: str, command: str) -> list[str]:
    problems = []
    for segment in SEGMENTS.split(command):
        if not BUILDER.search(segment):
            continue
        try:
            tokens = shlex.split(segment)
        except ValueError:
            tokens = segment.split()
        values = publish_values(tokens)
        short = any(re.fullmatch(r"-p\w*", token) or token.startswith("-p=") for token in tokens)
        if not values or any(value != "never" for value in values) or short:
            problems.append(f"package.json scripts.{name} [publish-flag] electron-builder without --publish never: {segment.strip()}")
    return problems


def check(package: pathlib.Path) -> list[str]:
    if not package.is_file():
        return []
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return [f"{package.name} [package-json] not valid JSON: {error}"]
    scripts = data.get("scripts", {}) if isinstance(data, dict) else {}
    problems = []
    for name, command in scripts.items():
        if RELEASE_NAME.match(name):
            problems.append(f"package.json scripts.{name} [release-script] no script may be named release")
        if isinstance(command, str):
            problems.extend(check_command(name, command))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Every electron-builder script carries --publish never; no release script.")
    parser.add_argument("--package", default="package.json", help="path to package.json")
    args = parser.parse_args()
    problems = check(pathlib.Path(args.package))
    for problem in problems:
        print(problem)
    print(f"check_publish_flags: {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
