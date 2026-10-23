# wcag@2.2

Pinned 2026-10-23: WCAG 2.2, W3C Recommendation of 12 December 2024 — https://www.w3.org/TR/WCAG22/. The project's level is AA together with APCA (PLAN D1 of `tasks/10-app-shell/05-design-contrast/PLAN.md`); `scripts/contrast_check.py` computes the WCAG ratio itself from the formulas below.

## Success criteria used

- SC 1.4.3 Contrast (Minimum), Level AA: "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1", except large-scale text and images of large-scale text at least 3:1; incidental text (part of an inactive user interface component, pure decoration, invisible, part of a picture) and logotypes have no requirement — https://www.w3.org/TR/WCAG22/#contrast-minimum
- The computed ratio "should not be rounded (e.g., 4.499:1 would not meet the 4.5:1 threshold)": the gate compares the unrounded value — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Large-scale text: "at least 18 point or 14 point bold or font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts"; 18 pt is 24 CSS px, 14 pt bold is about 18.67 CSS px bold — https://www.w3.org/TR/WCAG22/#dfn-large-scale
- SC 1.4.11 Non-text Contrast, Level AA: user interface components (visual information required to identify components and states, except inactive components) and graphical objects (parts of graphics required to understand the content) have "a contrast ratio of at least 3:1 against adjacent color(s)" — https://www.w3.org/TR/WCAG22/#non-text-contrast
- The adjacent colours of a component are the colours next to it (an input's border against the page around it, the focus indicator against the surface it sits on); a focus indicator "grey #949494 against white" is the example given at 3:1 — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- SC 2.4.7 Focus Visible, Level AA: "Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible." It states no ratio; the 3:1 of the indicator comes from 1.4.11 ("In combination with 2.4.7 Focus Visible, the visual focus indicator for a component must have sufficient contrast against the adjacent background when the component is focused") — https://www.w3.org/TR/WCAG22/#focus-visible and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- SC 2.4.13 Focus Appearance (a 2 CSS px thick perimeter and 3:1 change of contrast) is Level AAA and is not a requirement of this project — https://www.w3.org/TR/WCAG22/#focus-appearance
- SC 2.5.8 Target Size (Minimum), Level AA: the size of the target for pointer inputs is at least 24 by 24 CSS pixels, except spacing (undersized targets whose 24 px circles do not intersect another target), equivalent, inline, user agent control and essential — https://www.w3.org/TR/WCAG22/#target-size-minimum

## Formulas

- Relative luminance: `L = 0.2126 * R + 0.7152 * G + 0.0722 * B` where for each channel `c = value8bit / 255`, `c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4` (the threshold was 0.03928 before May 2021 and has "no practical effect") — https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
- Contrast ratio: `(L1 + 0.05) / (L2 + 0.05)`, L1 the relative luminance of the lighter colour and L2 of the darker one; ratios range from 1 to 21 (1:1 to 21:1) — https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
- Reference values for the gate's tests: black and white give exactly 21 (`(1 + 0.05) / (0 + 0.05)`), a colour against itself gives 1, and `#949494` on `#ffffff` gives 3.0335 (documented as the 3:1 grey) — https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
