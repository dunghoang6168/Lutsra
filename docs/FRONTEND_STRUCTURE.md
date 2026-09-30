# Frontend component and SCSS structure

Angular components keep implementation, markup, and presentation in separate files:

```text
component-name/
├── component-name.component.ts
├── component-name.component.html
└── component-name.component.scss
```

New components must use external HTML and SCSS. Inline `template` or `styles` metadata is reserved for an exceptional, documented reason. The Angular schematics configuration enforces external files and SCSS by default.

## Styling boundary

`src/styles.scss` is only the global entrypoint. It composes these modules with `@use`:

- `_tokens.scss`: semantic color aliases, typography, spacing, dimensions, radii, shadows, and transitions.
- `_themes.scss`: dark and light themes, six accent palettes, and light-theme overrides.
- `_base.scss`: reset, document layout, focus, scrollbar, and native control defaults.
- `_primitives.scss`: reusable buttons, badges, cards, form controls, tables, modal actions, and loading/empty/error states.
- `_utilities.scss`: small single-purpose helpers such as truncation and screen-reader-only text.
- `_responsive.scss`: shared desktop-window breakpoints and reduced-motion behavior.

A component stylesheet owns only its layout, responsive behavior, and component-specific presentation. A pattern moves to a global primitive only after at least three components share the same visual behavior. Components consume semantic tokens instead of hard-coded theme colors.

Do not use `@extend`, and do not load CSS-emitting global modules from component SCSS; either approach can duplicate emitted CSS. Global classes need purpose-specific names such as `.state-loading` or `.modal-actions`, never broad names such as `.title`, `.header`, or `.active`.
