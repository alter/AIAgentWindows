# coverage_gate.py
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

CONFIG_NAME = ".coverage-gate.json"
DEFAULT_TOLERANCE = 0.2


def load_config(root: pathlib.Path) -> dict:
    path = root / CONFIG_NAME
    if not path.exists():
        sys.exit(
            f"no {CONFIG_NAME} in {root}\n"
            "Create one (the /test skill does it), for example:\n"
            '{"command": "pytest -q --cov=src --cov-report=json",\n'
            ' "format": "coverage-py", "report": "coverage.json",\n'
            ' "floor": 0.0, "tolerance": 0.2}'
        )
    config = json.loads(path.read_text(encoding="utf-8"))
    for key in ("format", "report"):
        if key not in config:
            sys.exit(f"{CONFIG_NAME}: missing key {key!r}")
    config.setdefault("floor", 0.0)
    config.setdefault("tolerance", DEFAULT_TOLERANCE)
    return config


def save_floor(root: pathlib.Path, config: dict, value: float) -> None:
    config["floor"] = round(value, 2)
    (root / CONFIG_NAME).write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def percent_coverage_py(text: str) -> float:
    return float(json.loads(text)["totals"]["percent_covered"])


def percent_json_summary(text: str) -> float:
    data = json.loads(text)
    total = data.get("total") or data
    return float(total["lines"]["pct"])


def percent_cobertura(text: str) -> float:
    root = ET.fromstring(text)
    rate = root.get("line-rate")
    if rate is not None:
        return float(rate) * 100
    covered = int(root.get("lines-covered", 0))
    valid = int(root.get("lines-valid", 0))
    return covered / valid * 100 if valid else 0.0


def percent_lcov(text: str) -> float:
    found = hit = 0
    for line in text.splitlines():
        if line.startswith("LF:"):
            found += int(line[3:] or 0)
        elif line.startswith("LH:"):
            hit += int(line[3:] or 0)
    return hit / found * 100 if found else 0.0


def percent_go(text: str) -> float:
    values = [float(m.group(1)) for m in re.finditer(r"coverage:\s+([0-9.]+)%", text)]
    if not values:
        sys.exit("go format: no 'coverage: NN.N%' line in the report")
    return sum(values) / len(values)


PARSERS = {
    "coverage-py": percent_coverage_py,
    "json-summary": percent_json_summary,
    "cobertura": percent_cobertura,
    "lcov": percent_lcov,
    "go": percent_go,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Coverage ratchet: fail when coverage drops, raise the floor when it grows.")
    parser.add_argument("--root", default=".")
    parser.add_argument("--run", action="store_true", help="run the configured command before reading the report")
    parser.add_argument("--print", dest="print_only", action="store_true", help="print the current percentage and exit 0")
    parser.add_argument("--set-floor", action="store_true", help="record the current percentage as the floor, whatever it is")
    args = parser.parse_args()

    root = pathlib.Path(args.root).resolve()
    config = load_config(root)

    if args.run:
        command = config.get("command")
        if not command:
            sys.exit(f"{CONFIG_NAME}: --run needs a 'command' key")
        result = subprocess.run(command, shell=True, cwd=root)
        if result.returncode != 0 and not config.get("allow_failing_tests"):
            print(f"coverage gate: the test command exited {result.returncode}; fix the tests first")
            return result.returncode

    report = root / config["report"]
    if not report.exists():
        sys.exit(f"report not found: {report} (run with --run, or produce it first)")

    fmt = config["format"]
    if fmt not in PARSERS:
        sys.exit(f"unknown format {fmt!r}; use one of: {', '.join(sorted(PARSERS))}")
    percent = PARSERS[fmt](report.read_text(encoding="utf-8", errors="ignore"))

    floor = float(config["floor"])
    tolerance = float(config["tolerance"])

    if args.print_only:
        print(f"coverage {percent:.2f}% (floor {floor:.2f}%)")
        return 0

    if args.set_floor:
        save_floor(root, config, percent)
        print(f"coverage gate: floor set to {percent:.2f}%")
        return 0

    if percent < floor - tolerance:
        print(
            f"coverage gate: FAIL {percent:.2f}% < floor {floor:.2f}% (tolerance {tolerance:.2f})\n"
            "Something that was covered is not any more. Either the change removed a test, "
            "or new code arrived without one. Do not lower the floor to make this pass."
        )
        return 1

    if percent > floor:
        save_floor(root, config, percent)
        print(f"coverage gate: PASS {percent:.2f}%, floor raised from {floor:.2f}%")
        return 0

    print(f"coverage gate: PASS {percent:.2f}% (floor {floor:.2f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
