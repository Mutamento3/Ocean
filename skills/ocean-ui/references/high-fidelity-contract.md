# High-Fidelity Implementation Contract

## Read Figma before implementation

1. Confirm the file, node ID, target state, and baseline viewport.
2. Inspect children recursively. A group is not unreadable; drill into it or export the whole group when its combined geometry is intentional.
3. Separate visible component bounds from parent whitespace, annotations, pager dots, prototype arrows, transparent hit areas, and clipping frames.
4. Create an asset inventory with node ID, purpose, local path, intrinsic size, `viewBox`, color mode, and theme requirements.
5. Create a state inventory covering default, selected, disabled, empty, editing, expanded, swipe, long-content, error, and loading states.

## Geometry and assets

- Use actual node coordinates and dimensions rather than screenshot estimates.
- If an outer group includes pagination, use the card child bounds for the card, not the group bounds.
- Preserve one coordinate system for ticket stubs, bookshelves, furniture, and compound decorations when internal relationships matter.
- For monochrome SVGs, preserve the path and apply `currentColor` or a CSS mask.
- For multicolor SVGs, preserve all paths and bind semantic parts to `--accent`, `--warm`, `--ink`, and related tokens.
- Use CSS for layout, responsiveness, state, and tokens, not as a second illustration tool.
- Preserve intrinsic aspect ratios. Put the hit target in a separate container.
- Mirror only the intended visual part, never its text, shadow, or unrelated siblings.

## Typography and text

- Align visible glyphs, not only text boxes. Record any necessary one-pixel optical correction.
- Keep dynamic labels as real text. Outline only short decorative labels when the required font cannot ship and exact metrics are essential.
- Use intrinsic width plus explicit padding for durations, status labels, project names, and localized text.
- Load the intended font before adjusting line height and letter spacing.

## Implementation order

1. Establish the fixed 390x844 preview and safe areas.
2. Localize the exact assets and load fonts.
3. Match static structure and measured bounds.
4. Add the full state model without changing calibrated bounds.
5. Bind semantic theme roles and day/night variants.
6. Compare identical content and state.
7. Fix structure, size, spacing, type, icons, color, then shadow.
8. Test 360/390/430px and real touch/scroll gestures.

## Common root causes

- Broad drift usually means the wrong parent bounds or substitute assets, not one bad margin.
- Distorted icons usually come from forcing different SVG `viewBox` values into one visible box.
- Persistent arrow/text misalignment usually comes from font metrics versus visible SVG pixels.
- Partial theming usually means hardcoded colors, external `<img>` assets that cannot inherit variables, or global filtering of multicolor art.
- Popover leaks usually mean the expanded surface does not cover the trigger or fill its measured frame.
- Broken mobile wheels usually implement clicks but omit touch scroll, snap, and settled semantic values.
- Broken paged lists usually render the add card on every page or derive pagination from DOM position instead of data.
