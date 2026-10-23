# test_contrast_check.py
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "contrast_check.py"
SPEC = importlib.util.spec_from_file_location("contrast_check", SCRIPT)
contrast_check = importlib.util.module_from_spec(SPEC)
sys.modules["contrast_check"] = contrast_check
SPEC.loader.exec_module(contrast_check)

APCA_PAIRS = [
    ("#888", "#fff", 63.056469930209424),
    ("#fff", "#888", -68.54146436644962),
    ("#000", "#aaa", 58.146262578561334),
    ("#aaa", "#000", -56.24113336839742),
    ("#123", "#def", 91.66830811481631),
    ("#def", "#123", -93.06770049484275),
    ("#123", "#444", 8.32326136957393),
    ("#444", "#123", -7.526878460278154),
    ("#000", "#fff", 106.04067321268862),
    ("#fff", "#000", -107.88473318309848),
]

BASE_CSS = """:root {
  --bg: #000000;
  --fg: #ffffff;
  --width: 260px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --fg: #000000;
  }
}
body { background: var(--bg); color: var(--fg); }
"""

BASE_PAIRS = [{"fg": "--fg", "bg": "--bg", "use": "body"}]


def pairs_text(pairs: list) -> str:
    return "[\n" + ",\n".join("  " + json.dumps(pair) for pair in pairs) + "\n]\n"


def with_tokens(dark: str = "", light: str = "", rules: str = "") -> str:
    return (
        ":root {\n  --bg: #000000;\n  --fg: #ffffff;\n" + dark + "}\n"
        "@media (prefers-color-scheme: light) {\n  :root {\n    --bg: #ffffff;\n    --fg: #000000;\n" + light + "  }\n}\n"
        "body { background: var(--bg); color: var(--fg); }\n" + rules
    )


def rules_of(findings: list[str]) -> list[str]:
    return [finding.split("[", 1)[1].split("]", 1)[0] for finding in findings]


def run_check(css: str, pairs: list) -> list[str]:
    return contrast_check.check(css, pairs_text(pairs))


class ContrastMathTest(unittest.TestCase):
    def test_apca_reference_pairs(self) -> None:
        for text, background, expected in APCA_PAIRS:
            with self.subTest(text=text, background=background):
                lc = contrast_check.apca_lc(contrast_check.parse_colour(text), contrast_check.parse_colour(background))
                self.assertAlmostEqual(lc, expected, places=9)

    def test_apca_sign_follows_polarity(self) -> None:
        dark_on_light = contrast_check.apca_lc((0, 0, 0), (255, 255, 255))
        light_on_dark = contrast_check.apca_lc((255, 255, 255), (0, 0, 0))
        self.assertGreater(dark_on_light, 0)
        self.assertLess(light_on_dark, 0)

    def test_apca_equal_colours_are_zero(self) -> None:
        self.assertEqual(contrast_check.apca_lc((10, 20, 30), (10, 20, 30)), 0.0)

    def test_wcag_ratios(self) -> None:
        ratio = contrast_check.wcag_ratio
        self.assertAlmostEqual(ratio((0, 0, 0), (255, 255, 255)), 21.0, places=9)
        self.assertAlmostEqual(ratio((255, 255, 255), (0, 0, 0)), 21.0, places=9)
        self.assertAlmostEqual(ratio((255, 255, 255), (255, 255, 255)), 1.0, places=9)
        self.assertAlmostEqual(ratio((0x76, 0x76, 0x76), (255, 255, 255)), 4.54, places=2)
        self.assertAlmostEqual(ratio((0x77, 0x77, 0x77), (255, 255, 255)), 4.48, places=2)
        self.assertAlmostEqual(ratio((0x94, 0x94, 0x94), (255, 255, 255)), 3.0335, places=3)

    def test_oklch_hue_and_chroma(self) -> None:
        _, chroma, hue = contrast_check.oklch((255, 0, 0))
        self.assertAlmostEqual(chroma, 0.2577, places=3)
        self.assertAlmostEqual(hue, 29.23, places=1)
        self.assertAlmostEqual(contrast_check.oklch((0, 0, 255))[2], 264.05, places=1)
        self.assertLess(contrast_check.oklch((128, 128, 128))[1], 0.001)

    def test_parse_colour_forms(self) -> None:
        parse = contrast_check.parse_colour
        self.assertEqual(parse("#123"), (17, 34, 51))
        self.assertEqual(parse("#112233"), (17, 34, 51))
        self.assertEqual(parse("rgb(17, 34, 51)"), (17, 34, 51))
        self.assertEqual(parse("#11223344", allow_alpha=True), (17, 34, 51, 68 / 255))
        self.assertIsNone(parse("hsl(0 0% 0%)"))


class ContrastRulesTest(unittest.TestCase):
    def test_clean_css_has_no_findings(self) -> None:
        self.assertEqual(run_check(BASE_CSS, BASE_PAIRS), [])

    def test_wcag_rule_names_the_pair(self) -> None:
        css = with_tokens(light="    --soft: #777777;\n", rules=".a { color: var(--soft); background: var(--bg); }\n")
        findings = run_check(css, BASE_PAIRS + [{"fg": "--soft", "bg": "--bg", "use": "text"}])
        wcag = [f for f in findings if "[contrast-wcag]" in f]
        self.assertEqual(len(wcag), 1)
        self.assertIn("--soft", wcag[0])
        self.assertIn("light", wcag[0])
        self.assertTrue(wcag[0].startswith("contrast-pairs.json:3 "))

    def test_apca_rule_fires_without_wcag(self) -> None:
        css = with_tokens(light="    --soft: #767676;\n", rules=".a { color: var(--soft); }\n")
        rules = rules_of(run_check(css, BASE_PAIRS + [{"fg": "--soft", "bg": "--bg", "use": "body"}]))
        self.assertIn("contrast-apca", rules)
        self.assertNotIn("contrast-wcag", rules)

    def test_dark_body_text_808080_fails_naming_the_pair(self) -> None:
        css = BASE_CSS.replace("--fg: #ffffff", "--fg: #808080")
        findings = run_check(css, BASE_PAIRS)
        self.assertTrue(any("[contrast-apca]" in f and "--fg" in f and "--bg" in f and "dark" in f for f in findings))

    def test_non_text_level(self) -> None:
        css = with_tokens(dark="  --edge: #333333;\n", rules=".a { border: 1px solid var(--edge); }\n")
        findings = run_check(css, BASE_PAIRS + [{"fg": "--edge", "bg": "--bg", "use": "non-text"}])
        self.assertTrue(any("[contrast-wcag]" in f and "--edge" in f for f in findings))
        self.assertTrue(any("[contrast-apca]" in f and "--edge" in f for f in findings))

    def test_same_hue_pair_fails(self) -> None:
        css = with_tokens(
            dark="  --red-text: #ffcccc;\n  --red-fill: #400000;\n",
            light="    --red-text: #ffcccc;\n    --red-fill: #400000;\n",
            rules=".a { color: var(--red-text); background: var(--red-fill); }\n",
        )
        findings = run_check(css, BASE_PAIRS + [{"fg": "--red-text", "bg": "--red-fill", "use": "text"}])
        self.assertEqual({r for r in rules_of(findings)}, {"same-hue"})
        self.assertTrue(all("--red-text" in f and "--red-fill" in f for f in findings))

    def test_different_hues_pass(self) -> None:
        css = with_tokens(
            dark="  --blue-text: #99bbff;\n  --red-fill: #400000;\n",
            light="    --blue-text: #99bbff;\n    --red-fill: #400000;\n",
            rules=".a { color: var(--blue-text); background: var(--red-fill); }\n",
        )
        self.assertEqual(run_check(css, BASE_PAIRS + [{"fg": "--blue-text", "bg": "--red-fill", "use": "text"}]), [])

    def test_grey_text_on_neutral_surface_fails(self) -> None:
        css = with_tokens(
            dark="  --grey: #cccccc;\n",
            light="    --grey: #cccccc;\n",
            rules=".a { color: var(--grey); }\n",
        )
        findings = run_check(css, BASE_PAIRS + [{"fg": "--grey", "bg": "--bg", "use": "text"}])
        self.assertIn("same-hue", rules_of(findings))

    def test_translucent_tokens_fail(self) -> None:
        for value in ("rgba(255, 255, 255, 0.15)", "#ffffff26", "rgb(255 255 255 / 50%)"):
            with self.subTest(value=value):
                css = with_tokens(dark=f"  --glass: {value};\n")
                findings = run_check(css, BASE_PAIRS)
                self.assertEqual(rules_of(findings), ["translucent-token"])
                self.assertIn("--glass", findings[0])

    def test_literal_colour_outside_token_blocks_fails(self) -> None:
        for declaration in (
            "color: #ff0000",
            "background: rgba(0, 0, 0, 0.5)",
            "border: 1px solid white",
            "box-shadow: 0 2px 4px rgb(0 0 0)",
            "--local: #123456",
        ):
            with self.subTest(declaration=declaration):
                findings = run_check(with_tokens(rules=f".a {{ {declaration}; }}\n"), BASE_PAIRS)
                self.assertEqual(rules_of(findings), ["literal-colour"])
                self.assertTrue(findings[0].startswith("styles.css:12 "))

    def test_transparent_and_current_color_are_not_literals(self) -> None:
        css = with_tokens(rules=".a { background: transparent; border-color: currentColor; color: inherit; }\n")
        self.assertEqual(run_check(css, BASE_PAIRS), [])

    def test_opacity_other_than_zero_or_one_fails(self) -> None:
        bad = run_check(with_tokens(rules=".a { opacity: 0.5; }\n"), BASE_PAIRS)
        self.assertEqual(rules_of(bad), ["opacity"])
        ok = run_check(with_tokens(rules=".a { opacity: 0; }\n.b { opacity: 1; }\n"), BASE_PAIRS)
        self.assertEqual(ok, [])

    def test_uncovered_token_fails(self) -> None:
        css = with_tokens(dark="  --extra: #00ff00;\n", light="    --extra: #006600;\n", rules=".a { background: var(--extra); }\n")
        findings = run_check(css, BASE_PAIRS)
        self.assertEqual(rules_of(findings), ["uncovered-token"])
        self.assertIn("--extra", findings[0])

    def test_token_used_in_other_role_than_covered_fails(self) -> None:
        css = with_tokens(rules=".a { color: var(--bg); }\n")
        self.assertEqual(rules_of(run_check(css, BASE_PAIRS)), ["uncovered-token"])

    def test_missing_light_block_is_reported(self) -> None:
        css = ":root {\n  --bg: #000000;\n  --fg: #ffffff;\n}\nbody { background: var(--bg); color: var(--fg); }\n"
        self.assertEqual(rules_of(run_check(css, BASE_PAIRS)), ["palette"])

    def test_manifest_problems_are_reported(self) -> None:
        unknown_token = run_check(BASE_CSS, BASE_PAIRS + [{"fg": "--nope", "bg": "--bg", "use": "body"}])
        self.assertEqual(rules_of(unknown_token), ["manifest"])
        unknown_use = run_check(BASE_CSS, BASE_PAIRS + [{"fg": "--fg", "bg": "--bg", "use": "shout"}])
        self.assertEqual(rules_of(unknown_use), ["manifest"])
        self.assertEqual(rules_of(contrast_check.check(BASE_CSS, "{not json")), ["manifest"])

    def test_comments_do_not_hide_or_invent_findings(self) -> None:
        css = with_tokens(rules="/* color: #fff; */\n.a { opacity: 0.5; }\n")
        findings = run_check(css, BASE_PAIRS)
        self.assertEqual(rules_of(findings), ["opacity"])
        self.assertTrue(findings[0].startswith("styles.css:13 "))


class ContrastCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, css: str, pairs: list) -> subprocess.CompletedProcess:
        css_path = self.dir / "styles.css"
        pairs_path = self.dir / "pairs.json"
        css_path.write_text(css, encoding="utf-8")
        pairs_path.write_text(pairs_text(pairs), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--css", str(css_path), "--pairs", str(pairs_path)],
            capture_output=True,
            text=True,
        )

    def test_clean_exits_zero(self) -> None:
        result = self.run_cli(BASE_CSS, BASE_PAIRS)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_finding_exits_one_with_path_line_rule(self) -> None:
        result = self.run_cli(BASE_CSS + ".a { opacity: 0.5; }\n", BASE_PAIRS)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"styles\.css:\d+ \[opacity\] ")

    def test_missing_files_exit_one(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--css", str(self.dir / "none.css"), "--pairs", str(self.dir / "none.json")],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
