# Theme QA Matrix

## Token coverage

- [ ] Canvas, primary surface, secondary surface, primary text, and secondary text are mapped.
- [ ] Structural and contrast families have strong, medium, and soft roles where needed.
- [ ] Border, focus, overlay, navigation, and local popover roles are explicit.
- [ ] Status roles are defined only where the product uses them.
- [ ] Reusable components contain no original-palette literals.

## Interface coverage

- [ ] Global shell, header, navigation, and footers are themed.
- [ ] Cards, lists, forms, switches, inputs, and empty states are themed.
- [ ] Drawers, dialogs, sheets, popovers, menus, tooltips, and toasts are themed.
- [ ] Illustrations, icons, charts, and decorative graphics use semantic roles.
- [ ] Custom backgrounds preserve aspect ratio, alpha, and independent opacity controls.

## State coverage

- [ ] Default, hover, pressed, selected, disabled, focus, loading, success, warning, and error states remain distinguishable where present.
- [ ] Active state does not rely on color alone.
- [ ] Light and dark modes cover local overlays and embedded components.
- [ ] Long content, scrolling, clipping, and responsive widths do not reveal unthemed regions.

## Numeric audit

- [ ] Normal text/background reaches 4.5:1.
- [ ] Large text/background reaches 3:1.
- [ ] Required icons, boundaries, states, and meaningful adjacent graphics reach 3:1.
- [ ] Thin lines exceed the minimum or use sufficient stroke width.
- [ ] Near-threshold pairs have recorded `contrast_audit.py` output.

## Visual audit

- [ ] Check representative screens rather than only token swatches.
- [ ] Check every supported mode with identical content and state.
- [ ] Inspect grayscale and real target devices in addition to numeric checks.
- [ ] Verify that shadows, highlights, gradients, and antialiasing still look intentional.

