# High-Fidelity UI Acceptance Checklist

## Figma and assets

- [ ] The correct node and target state were used.
- [ ] Component bounds come from component children, not an outer group.
- [ ] Every visible icon is the exact Figma asset or an explicitly approved substitute.
- [ ] SVG aspect ratios are intact; circles remain circular.
- [ ] Compound assets preserve internal placement, mirroring, and clipping.

## Structure and type

- [ ] Header, content, and navigation anchors match at 390x844.
- [ ] Sample content matches wrapping, stacking, and visual centers.
- [ ] Fonts are loaded, Chinese text has no unintended serif, and visible text is at least 10px.
- [ ] Dynamic titles, durations, and states do not overflow fixed plates.
- [ ] Rounded corners are not clipped into square corners during scroll.

## Interaction

- [ ] Default, selected, add, editing, expanded, long-content, and swiping states were exercised.
- [ ] Outside tap dismisses temporary editing and panels.
- [ ] Touch wheels, horizontal swipes, and pagers update real data.
- [ ] Expanded components do not reveal dormant controls or wallpaper seams.
- [ ] Sheets stop above navigation, use the handle, and have no unnecessary X.
- [ ] Focus, accessible names, and hit targets are usable.

## Theme and state matrix

- [ ] Every built-in theme was checked across the product's representative screens.
- [ ] Day/night variants cover surfaces, illustrations, wallpaper, text, icons, and overlays.
- [ ] Selected, unselected, disabled, and expanded states do not rely on color alone.
- [ ] Custom wallpaper is not forcibly recolored or assigned a fixed opacity.

## Engineering

- [ ] 360/390/430px have no unintended overlap or overflow.
- [ ] `prefers-reduced-motion` preserves comprehension and operation.
- [ ] The build succeeds with no missing assets or layout errors.
- [ ] Comparison evidence and intentional deviations are recorded in `docs/UI_FIDELITY.md`.
