# Semantic Theme Token Matrix

## Core roles

| Token role | Responsibility |
| --- | --- |
| `canvas` | Application or page background |
| `surface-primary` | Primary cards, inputs, drawers, and panels |
| `surface-secondary` | Secondary cards, quiet groups, and unselected regions |
| `text-primary` | Body text, labels, and essential line art |
| `text-secondary` | Supporting and inactive information |
| `structure-strong` | Strong structural accent and active framework |
| `structure-medium` | Intermediate hierarchy and layered objects |
| `structure-soft` | Quiet structure, decoration, and secondary fills |
| `contrast-strong` | High-emphasis contrast family |
| `contrast-medium` | Active, selected, or expressive emphasis |
| `contrast-soft` | Quiet contrast and illustration layers |
| `border` | Default boundaries and separators |
| `focus` | Keyboard and explicit focus indicator |
| `overlay` | Modal or drawer backdrop |
| `navigation-active` | Current navigation destination |
| `popover-surface` | Local overlay surface independent of the page mode |
| `popover-foreground` | Text and icons on local overlays |
| `danger`, `warning`, `success`, `info` | Status roles where the product needs them |

Use project naming conventions, but preserve these responsibilities. Do not merge roles merely because two values happen to match in one theme.

## Mode roles

For every supported mode, define:

- canvas and surfaces;
- primary and secondary text;
- borders, focus, and selection;
- navigation and overlay colors;
- illustrations and data-visualization roles;
- custom-background treatment.

Component-specific roles should describe responsibility, such as `illustration-character-primary` or `chart-series-selected`, not a hue such as `blue-fish`.

## CSS template

```css
.theme-example {
  --canvas: #...;
  --surface-primary: #...;
  --surface-secondary: #...;
  --text-primary: #...;
  --text-secondary: #...;
  --structure-strong: #...;
  --structure-medium: #...;
  --structure-soft: #...;
  --contrast-strong: #...;
  --contrast-medium: #...;
  --contrast-soft: #...;
  --border: #...;
  --focus: #...;
  --overlay: rgb(... / ...%);
  --navigation-active: var(--contrast-medium);
  --popover-surface: #...;
  --popover-foreground: #...;
}

.theme-example.mode-dark {
  --canvas: #...;
  --surface-primary: #...;
  --surface-secondary: #...;
  --text-primary: #...;
  --text-secondary: #...;
  --border: #...;
  --focus: #...;
  --popover-surface: #...;
  --popover-foreground: #...;
}
```

## Non-prescriptive palette examples

- Cool structural colors plus a warm contrast family.
- Warm structural colors plus a deep neutral contrast family.
- Green structural colors plus a violet contrast family.
- Grayscale structure plus one small vivid signal color.

Use these only to illustrate role pairing. Select any palette that fits the target product, content, audience, and accessibility constraints.

