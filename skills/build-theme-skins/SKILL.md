---
name: build-theme-skins
description: Create, modify, audit, or repair reusable theme and skin systems for any software interface. Use for rapid palette variants, semantic color tokens, light/dark modes, user backgrounds, SVG and illustration recoloring, state-color coverage, partial-theme bugs, or evaluating text and adjacent-color contrast across multiple screens.
---

# Build Theme Skins

Create skins by replacing a complete semantic role matrix, not by recoloring components one at a time. Each skin must cover structural colors, contrast accents, content, interaction states, overlays, illustrations, and supported display modes.

## Start here

1. Inspect the existing token system and search reusable components for hardcoded colors.
2. Copy the complete role inventory in [references/theme-token-matrix.md](references/theme-token-matrix.md).
3. Apply [references/contrast-and-accessibility.md](references/contrast-and-accessibility.md) to meaningful color pairs.
4. Run [references/theme-qa-matrix.md](references/theme-qa-matrix.md) after implementation.
5. Use `scripts/contrast_audit.py` for critical or near-threshold pairs.

## Workflow

### 1. Inventory color responsibilities

Identify every role before choosing colors: canvas, primary and secondary surfaces, primary and muted text, structural accent, contrast accent, borders, focus, selection, disabled state, overlays, navigation, data graphics, illustrations, and light/dark variants.

Separate semantic roles from component geometry. Do not name tokens after a specific hue unless the hue itself is a permanent product semantic such as danger.

### 2. Choose color families

Choose one structural family and one lower-volume contrast family. The structural family carries hierarchy and stable states; the contrast family carries selection, emphasis, warmth, or product-specific signals.

Possible combinations include cool structure with warm contrast, warm structure with dark neutral contrast, green structure with violet contrast, or grayscale structure with one vivid signal color. These are examples, not a fixed palette list.

Do not use global hue rotation as the theme model. Canvas, surface, text, selected state, and dark mode need independent luminance and saturation decisions.

### 3. Fill the semantic matrix

Define the complete core matrix before component-specific overrides. Components must consume semantic roles rather than palette literals.

After adding a skin, search outside theme definitions for hardcoded colors from the original palette. When the same override appears in multiple themes, promote it to a semantic token.

### 4. Separate user imagery from palette

- Do not attach a user background to a palette unless it is an intentional bundled preset.
- Preserve image aspect ratio with `cover`, or expose an explicit `contain` option.
- Preserve source alpha and expose background opacity as a separate user setting.
- Treat dimming, blur, tint, and mode-specific overlays as independent controls.
- Recheck text and controls against the composite background, not only the base palette.

### 5. Recolor icons and illustrations by structure

- Monochrome assets: prefer `currentColor` or CSS masks.
- Multicolor assets: preserve paths and bind meaningful parts to semantic tokens.
- Assets with shadows, highlights, gradients, or several color layers: do not recolor with one global overlay or filter.
- If an external `<img>` cannot inherit variables, convert it to a mask, inline SVG, or a deliberate theme asset.
- Use CSS filters only for temporary, low-risk monochrome decoration and verify every theme visually.

### 6. Apply contrast thresholds

Use WCAG 2.2 sRGB relative luminance and contrast ratio. Do not use raw HSL/HSV lightness difference as the pass/fail metric.

- Normal text and images of text: at least 4.5:1.
- Large text: at least 3:1.
- Adjacent colors required to identify a control, state, boundary, or meaningful graphic: at least 3:1.
- If meaningful adjacent segments are below 3:1, add a border that reaches 3:1 against both sides.
- Decorative color has no independent threshold, but it must not carry the only semantic cue.

Do not round threshold results. `2.999:1` fails a `3:1` requirement.

### 7. Run the complete matrix

Check representative screens and every mode: global shell, navigation, content surfaces, forms, lists, data graphics, overlays, drawers, sheets, popovers, custom backgrounds, selected/unselected/disabled/focus/error states, long content, and responsive widths.

Verify the complete interface, not only the theme picker or token preview.

## Prohibited shortcuts

- Do not change only the page and accent tokens and call the skin complete.
- Do not leave original-palette literals in reusable components.
- Do not distinguish selected and unselected states with only a weak hue shift.
- Do not globally modify user-image opacity or tint as a side effect of palette selection.
- Do not let a local light surface inherit unreadable dark-mode text; give overlays explicit foreground roles.
- Do not apply one tint to multicolor assets with highlights or shadows.
- Do not validate only static samples; exercise real states and interactions.

