---
name: ocean-ui
description: Implement, repair, or review mobile and web interfaces against an existing high-fidelity Figma design. Use for pixel-accurate restoration, exact SVG and component reuse, fixed-viewport calibration, geometry/spacing/type/icon corrections, drawers/wheels/pagination/anchored expansions, theme-ready component construction, or diagnosing why an implementation looks similar but does not match its design source. Apply this methodology to any product; use that product's own visual language and tokens.
---

# Ocean UI

Treat Figma as structured implementation input, not as a mood board. Reuse original structure and assets before using CSS for interaction, responsiveness, and semantic token binding. The workflow is product-agnostic; examples learned from Ocean do not prescribe a specific palette or component set.

## Start here

1. Read the user's latest decisions, the exact Figma node, the PRD, and any project fidelity log.
2. Inspect the target node and its children before coding. Do not infer structure from a full-screen screenshot.
3. Read [references/high-fidelity-contract.md](references/high-fidelity-contract.md) for geometry, asset, and typography rules.
4. Read [references/interaction-patterns.md](references/interaction-patterns.md) when the task includes popovers, sheets, wheels, pagination, editing, or chat.
5. Run [references/acceptance-checklist.md](references/acceptance-checklist.md) before handoff.
6. Also use `$build-theme-skins` for palette, day/night, wallpaper, or recoloring work.

## Resolve conflicts in this order

1. The user's latest explicit product decision.
2. Figma components, variants, and state frames.
3. Exact child hierarchy and geometry of the target node.
4. Current PRD and implemented interaction contracts.
5. The target product's semantic tokens.
6. CSS approximation only where no exact node, asset, or value exists.

Record intentional differences from older design frames in the project's fidelity log instead of silently mixing old and new behavior.

## Workflow

### 1. Build a fidelity manifest

Record the baseline viewport, target state, reusable components, exact SVG/image assets, visible bounds, coordinates, size, padding, gap, radius, stroke, shadow, typography, stacking, and clipping.

List default, selected, disabled, empty/add, editing, expanded, maximum-content, swiping, loading, and error states. Obtain behavior that cannot be inferred visually from the PRD or the user.

### 2. Restore structure and source assets first

- Measure the component node, not an outer group containing pager dots, prototype arrows, annotations, whitespace, or transparent hit areas.
- Reuse exact Figma SVGs. Use `currentColor` or masks for monochrome assets; keep multicolor geometry inline and bind each semantic layer to tokens.
- Preserve the original `viewBox` and aspect ratio. Separate the visible asset from its hit target.
- Keep intentional icon-plus-label and compound illustration groups in one coordinate system.
- Map font roles deliberately. Use readable local/system fallbacks only after checking metric changes.
- Do not substitute font glyphs for optically aligned arrows, plus icons, or directional marks.

### 3. Lock the design baseline

Match the exact design viewport before responsive work. Compare the same content and state, then fix in this order: structure, component bounds, spacing, typography, icons, color, shadows.

After the baseline matches, test the product's supported widths and explicitly decide what flexes, wraps, scrolls, or stays fixed.

### 4. Implement the full state model

Mock data is acceptable; fake interaction is not. Pagination, add/cancel flows, swiping, expansion, selection, date logic, and scoped conversations must update real local state.

Reuse calibrated shared components. Do not create page-local near-duplicates that slowly drift in geometry and behavior.

### 5. Keep components theme-ready

Geometry belongs to components. Color, wallpaper, type role, shadow role, and icon color belong to semantic tokens. Never hardcode a particular product, brand, or theme color inside a reusable component.

A theme change must update the real screen, including illustrations, surfaces, text, icons, popovers, and navigation, not only a theme-picker preview.

### 6. Verify visually and functionally

Use side-by-side comparison or overlays with the same viewport, content, and state. Inspect actual bounding boxes for one-pixel drift, font baselines, SVG distortion, clipping, and stacking leaks.

Run the project build and relevant tests. Resolve missing assets, layout warnings, and console errors before handoff.

## Default mobile type and spacing guidance

Use the target design's measured values when available. When a design omits a role, start from: page title 24px; title 18px; subsection 16px; body and field value 14px; supporting label/action 12px; compact metadata 10px.

- Do not render visible mobile text below 10px.
- Use a 4px base scale with common gaps of 8, 12, 16, 24, and 32px.
- Consecutive bubbles from the same speaker may use 6px; a speaker change may use 12px when the design has no measured alternative.
- Visible icons may be smaller than their hit targets; keep touch targets around 40-44px where appropriate.

Treat these as fallback defaults, not permission to overwrite measured design values.

## Prohibited shortcuts

- Do not infer components from screenshots or outer selection bounds.
- Do not redraw a known design asset with CSS or replace it with a merely similar icon.
- Do not recolor a multicolor SVG with a global overlay, filter, or opacity.
- Do not paste a static decorative skin over a generic component without defining responsive geometry.
- Do not accept native controls that visibly conflict with the target product's design language.
- Do not use color as the only state indicator.
- Do not lock dynamic titles, durations, or status labels into fixed-width plates.
- Do not postpone correct design structure under the label of polishing later.

