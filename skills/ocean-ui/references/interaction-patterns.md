# High-Fidelity Interaction Patterns

## Anchored expansion

- When a control expands from its own trigger, implement the expanded state as one measured component.
- Make the active anchor inside the expanded component cover the trigger's visible bounds. Hide the original trigger group while open if any seam remains.
- Put the outside-dismiss layer above the room and below the panel. Stop propagation inside the panel.
- For many parameters, use a parameter list followed by one full-width wheel, not an ever-wider panel or many narrow columns.

## Bottom sheets

- Close with the top handle and outside tap; do not add a visually unrelated X.
- Dim the header and content evenly. The bottom navigation may stay undimmed so it reads as part of the sheet base.
- End the sheet above the bottom navigation.
- Support compact, medium, and tall detents; let inner content scroll.

## Touch wheels

- Make vertical swipe the primary interaction for date, time, model, and model parameters. Use scroll snap and a visible centered selection row.
- Scroll dependent columns independently and render units beside numeric columns.
- Keep date and time selection independent when both may be enabled.
- Update the semantic value after the wheel settles. Keep tap as a secondary shortcut.

## Pagination, add, and editing

- Render the add card only in the last free slot on the last page.
- Create a new page only after the current page fills. Keep pager indicators derived from data.
- Stretch only the active pager dot into a pill.
- When editing expands in place, preserve the original card bounds and cancel on outside tap.
- Use intrinsic width or measured content plus fixed horizontal padding for dynamic labels.

## Chat and input

- Use 6px between consecutive bubbles from one speaker and 12px when the speaker changes.
- Multiple streamed bubbles may still persist as one assistant turn.
- Show the thinking entry only when reasoning data exists and position it in the decoration's coordinate system.
- Grow composers upward one line at a time rather than opening a large editor on focus.
- Add timestamps only after meaningful silence and preserve the time semantics for the model.

## Drawers, switches, and long press

- Open the theme drawer from the left and settings from the right.
- Treat icon plus label as one centered navigation item; change both together for selection.
- Keep switch thumbs movable and vertically centered within the track. Never fix a thumb in place just to correct alignment.
- Give long-press actions an accessible alternative and suppress the subsequent normal click after a hold fires.
