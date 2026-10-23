# contrast_check.py
from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sys

MAIN_TRC = 2.4
NORM_BG = 0.56
NORM_TXT = 0.57
REV_TXT = 0.62
REV_BG = 0.65
S_RCO = 0.2126729
S_GCO = 0.7151522
S_BCO = 0.0721750
BLK_THRS = 0.022
BLK_CLMP = 1.414
LO_CLIP = 0.1
DELTA_Y_MIN = 0.0005
SCALE_BOW = 1.14
SCALE_WOB = 1.14
LO_BOW_OFFSET = 0.027
LO_WOB_OFFSET = 0.027

NEUTRAL_CHROMA = 0.03
MIN_HUE_DISTANCE = 40.0
NEUTRAL_TEXT = ((255, 255, 255), (0, 0, 0))

USES = {
    "preferred": {"lc": 90.0, "ratio": 4.5, "text": True},
    "body": {"lc": 75.0, "ratio": 4.5, "text": True},
    "text": {"lc": 60.0, "ratio": 4.5, "text": True},
    "heading": {"lc": 60.0, "ratio": 4.5, "text": True},
    "heading-large": {"lc": 45.0, "ratio": 3.0, "text": True},
    "non-text": {"lc": 45.0, "ratio": 3.0, "text": False},
}

LIGHT_MEDIA = "@media (prefers-color-scheme: light)"
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
COLOUR_FUNCTION = re.compile(r"\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(", re.I)
NAMED = re.compile(
    r"\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|aqua|cyan|"
    r"magenta|lime|olive|fuchsia|brown|gold|violet|indigo|crimson|coral|salmon|tan|beige|ivory)\b",
    re.I,
)
VAR_REFERENCE = re.compile(r"var\(\s*(--[\w-]+)")
RGB_FUNCTION = re.compile(r"^rgba?\(\s*(.*?)\s*\)$", re.I)
FOREGROUND_PROPS = re.compile(r"^(?:color|caret-color|fill|stroke|outline(?:-color)?|text-decoration-color|accent-color|border[\w-]*)$")
BACKGROUND_PROPS = re.compile(r"^background(?:-color)?$")
NAMED_COLOUR_PROPS = re.compile(
    r"^(?:--[\w-]+|color|background[\w-]*|border[\w-]*|outline[\w-]*|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration[\w-]*)$"
)


def srgb_channel(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def wcag_luminance(rgb: tuple[int, int, int]) -> float:
    red, green, blue = (srgb_channel(c / 255) for c in rgb[:3])
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def wcag_ratio(first: tuple[int, int, int], second: tuple[int, int, int]) -> float:
    lighter, darker = sorted((wcag_luminance(first), wcag_luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def apca_luminance(rgb: tuple[int, int, int]) -> float:
    red, green, blue = ((c / 255) ** MAIN_TRC for c in rgb[:3])
    return S_RCO * red + S_GCO * green + S_BCO * blue


def apca_lc(text: tuple[int, int, int], background: tuple[int, int, int]) -> float:
    text_y = apca_luminance(text)
    background_y = apca_luminance(background)
    if min(text_y, background_y) < 0.0 or max(text_y, background_y) > 1.1:
        return 0.0
    if text_y <= BLK_THRS:
        text_y += (BLK_THRS - text_y) ** BLK_CLMP
    if background_y <= BLK_THRS:
        background_y += (BLK_THRS - background_y) ** BLK_CLMP
    if abs(background_y - text_y) < DELTA_Y_MIN:
        return 0.0
    if background_y > text_y:
        scaled = (background_y**NORM_BG - text_y**NORM_TXT) * SCALE_BOW
        return 0.0 if scaled < LO_CLIP else (scaled - LO_BOW_OFFSET) * 100.0
    scaled = (background_y**REV_BG - text_y**REV_TXT) * SCALE_WOB
    return 0.0 if scaled > -LO_CLIP else (scaled + LO_WOB_OFFSET) * 100.0


def oklch(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    red, green, blue = (srgb_channel(c / 255) for c in rgb[:3])
    long = (0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue) ** (1 / 3)
    medium = (0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue) ** (1 / 3)
    short = (0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue) ** (1 / 3)
    lightness = 0.2104542553 * long + 0.7936177850 * medium - 0.0040720468 * short
    axis_a = 1.9779984951 * long - 2.4285922050 * medium + 0.4505937099 * short
    axis_b = 0.0259040371 * long + 0.7827717662 * medium - 0.8086757660 * short
    return lightness, math.hypot(axis_a, axis_b), math.degrees(math.atan2(axis_b, axis_a)) % 360.0


def hue_distance(first: float, second: float) -> float:
    gap = abs(first - second) % 360.0
    return min(gap, 360.0 - gap)


def parse_alpha(text: str) -> float | None:
    try:
        return float(text[:-1]) / 100 if text.endswith("%") else float(text)
    except ValueError:
        return None


def parse_rgb_function(inner: str, allow_alpha: bool):
    parts = [part for part in re.split(r"[\s,/]+", inner) if part]
    if len(parts) not in (3, 4):
        return None
    channels = []
    for part in parts[:3]:
        try:
            value = float(part[:-1]) * 2.55 if part.endswith("%") else float(part)
        except ValueError:
            return None
        channels.append(max(0, min(255, round(value))))
    if len(parts) == 3:
        return tuple(channels)
    alpha = parse_alpha(parts[3])
    if alpha is None or not allow_alpha:
        return None
    return (*channels, alpha)


def parse_colour(value: str, allow_alpha: bool = False):
    text = value.strip()
    if text.startswith("#") and re.fullmatch(r"#[0-9a-fA-F]+", text) and len(text) in (4, 5, 7, 9):
        digits = text[1:]
        if len(digits) in (3, 4):
            digits = "".join(c * 2 for c in digits)
        numbers = [int(digits[i : i + 2], 16) for i in range(0, len(digits), 2)]
        if len(numbers) == 3:
            return tuple(numbers)
        return (*numbers[:3], numbers[3] / 255) if allow_alpha else None
    match = RGB_FUNCTION.match(text)
    if match:
        return parse_rgb_function(match.group(1), allow_alpha)
    return None


def looks_like_colour(value: str) -> bool:
    return bool(HEX.fullmatch(value.strip()) or COLOUR_FUNCTION.search(value) or NAMED.fullmatch(value.strip()))


def strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group()), text, flags=re.S)


def parse_blocks(text: str) -> list[dict]:
    blocks = []
    stack: list[dict] = []
    buffer: list[str] = []
    buffer_line = 1
    line = 1
    depth = 0
    quote = ""

    def take_declaration() -> None:
        raw = "".join(buffer).strip()
        buffer.clear()
        if stack and ":" in raw:
            prop, value = raw.split(":", 1)
            value = re.sub(r"\s*!important\s*$", "", value.strip())
            stack[-1]["decls"].append((prop.strip().lower(), value, buffer_line))

    for char in text:
        if char == "\n":
            line += 1
        if quote:
            buffer.append(char)
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and char == "{":
            selector = re.sub(r"\s+", " ", "".join(buffer).strip())
            buffer.clear()
            at_chain = tuple(frame["selector"] for frame in stack if frame["selector"].startswith("@"))
            frame = {"selector": selector, "line": line, "at": at_chain, "decls": []}
            stack.append(frame)
            blocks.append(frame)
            continue
        elif depth == 0 and char == ";":
            take_declaration()
            continue
        elif depth == 0 and char == "}":
            take_declaration()
            if stack:
                stack.pop()
            continue
        if not buffer:
            if char.isspace():
                continue
            buffer_line = line
        buffer.append(char)
    take_declaration()
    return blocks


def format_finding(path: str, line: int, rule: str, message: str) -> str:
    return f"{path}:{line} [{rule}] {message}"


def collect_tokens(blocks: list[dict], css_path: str, findings: list) -> tuple[dict, dict | None]:
    dark: dict = {}
    light: dict | None = None
    for block in blocks:
        if block["selector"] != ":root":
            continue
        if block["at"] == ():
            target, scheme = dark, "dark"
        elif block["at"] == (LIGHT_MEDIA,):
            if light is None:
                light = {}
            target, scheme = light, "light"
        else:
            continue
        for prop, value, line in block["decls"]:
            if not prop.startswith("--") or not looks_like_colour(value):
                continue
            colour = parse_colour(value, allow_alpha=True)
            if colour is None:
                findings.append((css_path, line, "palette", f"{scheme} token {prop}: unsupported colour form {value}, use #rrggbb"))
            elif len(colour) == 4 and colour[3] < 1:
                findings.append((css_path, line, "translucent-token", f"{scheme} token {prop}: {value} is translucent, tokens are opaque"))
            elif len(colour) == 4:
                target[prop] = (colour[:3], line)
            else:
                target[prop] = (colour, line)
    return dark, light


def check_rules(blocks: list[dict], css_path: str, token_names: set, findings: list) -> tuple[set, set]:
    foreground_used: list = []
    background_used: list = []
    for block in blocks:
        if block["selector"] == ":root" and block["at"] in ((), (LIGHT_MEDIA,)):
            continue
        for prop, value, line in block["decls"]:
            scan = VAR_REFERENCE.sub("var(", re.sub(r"url\([^)]*\)", "", value))
            if HEX.search(scan) or COLOUR_FUNCTION.search(scan) or (NAMED_COLOUR_PROPS.match(prop) and NAMED.search(scan)):
                findings.append((css_path, line, "literal-colour", f"{prop}: {value} uses a colour literal, use a token"))
            if prop == "opacity":
                try:
                    allowed = float(value) in (0.0, 1.0)
                except ValueError:
                    allowed = False
                if not allowed:
                    findings.append((css_path, line, "opacity", f"opacity: {value}, only 0 or 1"))
            role = None
            if FOREGROUND_PROPS.match(prop):
                role = foreground_used
            elif BACKGROUND_PROPS.match(prop):
                role = background_used
            if role is not None:
                for name in VAR_REFERENCE.findall(value):
                    if name in token_names:
                        role.append((name, line, prop))
    return foreground_used, background_used


def load_pairs(pairs_text: str, pairs_path: str, findings: list) -> list | None:
    try:
        data = json.loads(pairs_text)
    except json.JSONDecodeError as error:
        findings.append((pairs_path, 1, "manifest", f"not valid JSON: {error}"))
        return None
    if not isinstance(data, list):
        findings.append((pairs_path, 1, "manifest", "top level must be a list of {fg, bg, use}"))
        return None
    lines = pairs_text.splitlines()
    pairs = []
    for entry in data:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(key), str) for key in ("fg", "bg", "use")):
            findings.append((pairs_path, 1, "manifest", f"pair needs string fg, bg and use: {entry!r}"))
            continue
        line = next((i + 1 for i, text in enumerate(lines) if f'"{entry["fg"]}"' in text and f'"{entry["bg"]}"' in text), 1)
        pairs.append({**entry, "line": line})
    return pairs


def check_pair(pair: dict, scheme: str, palette: dict, pairs_path: str, findings: list) -> None:
    fg_name, bg_name, use = pair["fg"], pair["bg"], pair["use"]
    level = USES.get(use)
    if level is None:
        findings.append((pairs_path, pair["line"], "manifest", f"{fg_name} on {bg_name}: unknown use {use}, one of {', '.join(USES)}"))
        return
    missing = [name for name in (fg_name, bg_name) if name not in palette]
    if missing:
        findings.append((pairs_path, pair["line"], "manifest", f"no opaque colour token {', '.join(missing)}"))
        return
    foreground, background = palette[fg_name][0], palette[bg_name][0]
    label = f"{scheme}: {fg_name} on {bg_name} ({use})"
    ratio = wcag_ratio(foreground, background)
    if ratio < level["ratio"]:
        findings.append((pairs_path, pair["line"], "contrast-wcag", f"{label} ratio {ratio:.2f}:1 below {level['ratio']}:1"))
    lc = apca_lc(foreground, background)
    if abs(lc) < level["lc"]:
        findings.append((pairs_path, pair["line"], "contrast-apca", f"{label} Lc {lc:.1f} below {level['lc']:.0f}"))
    fg_l, fg_c, fg_h = oklch(foreground)
    bg_l, bg_c, bg_h = oklch(background)
    if fg_c >= NEUTRAL_CHROMA and bg_c >= NEUTRAL_CHROMA:
        if hue_distance(fg_h, bg_h) < MIN_HUE_DISTANCE:
            findings.append((pairs_path, pair["line"], "same-hue", f"{label} hues {fg_h:.0f} and {bg_h:.0f} degrees are within {MIN_HUE_DISTANCE:.0f}"))
    elif fg_c < NEUTRAL_CHROMA and bg_c < NEUTRAL_CHROMA and level["text"] and foreground not in NEUTRAL_TEXT:
        findings.append((pairs_path, pair["line"], "same-hue", f"{label} grey text on a neutral surface, text there is #ffffff or #000000"))


def finish(findings: list) -> list[str]:
    unique = list(dict.fromkeys(findings))
    unique.sort(key=lambda item: (item[0], item[1]))
    return [format_finding(*item) for item in unique]


def check(css_text: str, pairs_text: str, css_path: str = "styles.css", pairs_path: str = "contrast-pairs.json") -> list[str]:
    findings: list = []
    blocks = parse_blocks(strip_comments(css_text))
    dark, light = collect_tokens(blocks, css_path, findings)
    if light is None:
        findings.append((css_path, 1, "palette", f"no light token block, expected :root inside {LIGHT_MEDIA}"))
    if not dark:
        findings.append((css_path, 1, "palette", "no dark token block, expected a top-level :root with colour tokens"))
    token_names = set(dark) | set(light or {})
    foreground_used, background_used = check_rules(blocks, css_path, token_names, findings)
    pairs = load_pairs(pairs_text, pairs_path, findings)
    if pairs is None:
        return finish(findings)
    palettes = {"dark": dark}
    if light is not None:
        palettes["light"] = {**dark, **light}
    for pair in pairs:
        for scheme, palette in palettes.items():
            check_pair(pair, scheme, palette, pairs_path, findings)
    covered_foreground = {pair["fg"] for pair in pairs}
    covered_background = {pair["bg"] for pair in pairs}
    for used, covered, role in ((foreground_used, covered_foreground, "foreground"), (background_used, covered_background, "background")):
        for name, line, prop in used:
            if name not in covered:
                findings.append((css_path, line, "uncovered-token", f"{prop}: {name} is used as a {role} but no pair in the manifest has it as {'fg' if role == 'foreground' else 'bg'}"))
    return finish(findings)


def main() -> int:
    parser = argparse.ArgumentParser(description="WCAG 2 and APCA contrast of the colour pairs of both palettes, same-hue pairs, translucent tokens, colour literals, opacity.")
    parser.add_argument("--css", default="src/renderer/styles.css", help="path to the stylesheet")
    parser.add_argument("--pairs", default="src/renderer/contrast-pairs.json", help="path to the pair manifest")
    args = parser.parse_args()
    try:
        css_text = pathlib.Path(args.css).read_text(encoding="utf-8")
        pairs_text = pathlib.Path(args.pairs).read_text(encoding="utf-8")
    except OSError as error:
        print(f"contrast_check: cannot read {error.filename}: {error.strerror}")
        return 1
    findings = check(css_text, pairs_text, args.css, args.pairs)
    for finding in findings:
        print(finding)
    print(f"contrast_check: {len(findings)} findings")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
