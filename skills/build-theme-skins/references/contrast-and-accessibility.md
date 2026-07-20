# Color Distinguishability Thresholds

## Measurement

Use WCAG 2.2 sRGB relative luminance and contrast ratio. Do not use raw HSL/HSV lightness difference as the pass/fail metric.

Relative luminance:

`L = 0.2126R + 0.7152G + 0.0722B`

Linearize each sRGB channel first: divide values at or below `0.04045` by `12.92`; otherwise use `((c + 0.055) / 1.055) ^ 2.4`.

Contrast ratio:

`(L1 + 0.05) / (L2 + 0.05)`, where `L1` is lighter.

## Thresholds

| Object | Minimum contrast |
| --- | ---: |
| Normal text, button labels, input values | 4.5:1 |
| Large text | 3:1 |
| Boundaries, arrows, checks, focus, or selected state required to identify a control | 3:1 against adjacent color |
| Meaningful adjacent graphic segments | 3:1, or add a border that is 3:1 against both |
| Disabled or purely decorative content | No universal WCAG minimum; must not be the only information cue |

Apply the WCAG definition of large text. Do not classify a label as large merely because it is a product heading. Checking ordinary 14-18px mobile text at 4.5:1 is safer.

Do not round threshold results; `2.999:1` does not satisfy `3:1`. Thin antialiased lines can appear lighter than their source color, so exceed the threshold or increase stroke width.

## Test method

1. Decide whether the boundary carries information. Would users still identify the control, state, or graphic if that boundary disappeared?
2. Test the least-contrasting adjacent colors. For gradients, test the weakest region.
3. Test text against its actual rendered background.
4. Test icons, toggle thumbs, arrows, card boundaries, and selection rings against immediate neighbors.
5. Fix weak pairs at the semantic-token level. If palette changes are undesirable, add a compliant border, shape, or textual cue.
6. Also inspect grayscale and a real phone, but do not substitute those checks for numeric audit.

## Primary sources

- [WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- [WCAG 2.2 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)
- [W3C Technique G209 for adjoining colors](https://www.w3.org/WAI/WCAG22/Techniques/general/G209.html)
- [WCAG 2.2 relative luminance definition](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance)
- [WCAG 2.2 SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)
