---
name: Lutsra
description: Local-first desktop player for lossless and hi-res libraries, where file truth stays visible in every listening shell.
colors:
  accent: "#8b5cf6"
  accent-hover: "#7c3aed"
  accent-active: "#6d28d9"
  accent-text: "#c4b5fd"
  accent-light: "#7c3aed"
  accent-text-light: "#6d28d9"
  graphite-canvas: "#111214"
  graphite-navigation: "#17181b"
  graphite-surface: "#1c1e22"
  graphite-surface-hover: "#26292e"
  graphite-surface-active: "#30343a"
  graphite-surface-elevated: "#23262a"
  graphite-text: "#f3f4f6"
  graphite-text-secondary: "#a7a9ae"
  graphite-text-muted: "#8d9097"
  graphite-border: "rgba(255, 255, 255, 0.12)"
  graphite-border-subtle: "rgba(255, 255, 255, 0.07)"
  cloud-canvas: "#f1f4f8"
  cloud-navigation: "#e5e9f0"
  cloud-surface: "#ffffff"
  cloud-surface-hover: "#eef2f7"
  cloud-surface-active: "#e2e7ef"
  cloud-surface-elevated: "#f8fafc"
  cloud-text: "#0f172a"
  cloud-text-secondary: "#475569"
  cloud-text-muted: "#5d6b7f"
  cloud-border: "rgba(15, 23, 42, 0.12)"
  cloud-border-subtle: "rgba(15, 23, 42, 0.06)"
  status-warning: "#f59e0b"
  status-error: "#ef4444"
typography:
  display-gallery:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.25rem, 1.4rem + 2.6cqi, 3.5rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  display-console:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  display-ambient:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 1.6cqi, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title-rail:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title-card:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.5
  body-sm:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  label-console:
    fontFamily: "'Manrope Variable', system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 650
    letterSpacing: "0.06em"
    fontFeature: "all-small-caps"
  measure:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.01em"
    fontFeature: "tabular-nums"
rounded:
  hairline: "2px"
  sm: "4px"
  console-control: "3px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  gallery-sheet: "20px"
  ambient-sheet: "22px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  shell-gap-gallery: "14px"
  shell-gap-ambient: "10px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.graphite-surface-hover}"
    textColor: "{colors.graphite-text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.graphite-surface-active}"
  play-control:
    backgroundColor: "{colors.graphite-text}"
    textColor: "{colors.graphite-surface}"
    rounded: "{rounded.full}"
    size: "36px"
  play-control-rail:
    size: "56px"
  control-icon:
    textColor: "{colors.graphite-text-secondary}"
    size: "32px"
  gallery-tab:
    textColor: "{colors.graphite-text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "8px 12px"
  gallery-tab-active:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.graphite-text}"
  search-field:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.graphite-text-secondary}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 12px"
  search-field-console:
    backgroundColor: "{colors.graphite-canvas}"
    rounded: "{rounded.console-control}"
    height: "30px"
  console-nav-item:
    textColor: "{colors.graphite-text-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.console-control}"
    height: "28px"
    padding: "0 8px"
  console-nav-item-active:
    backgroundColor: "{colors.graphite-surface-active}"
    textColor: "{colors.graphite-text}"
  console-row:
    textColor: "{colors.graphite-text-secondary}"
    typography: "{typography.body-sm}"
    height: "30px"
    padding: "0 8px"
  console-strip:
    backgroundColor: "{colors.graphite-navigation}"
    height: "52px"
    padding: "0 12px"
  gallery-rail:
    backgroundColor: "{colors.graphite-surface}"
    rounded: "{rounded.gallery-sheet}"
    width: "300px"
    padding: "20px"
  ambient-dock:
    rounded: "{rounded.full}"
    height: "64px"
    padding: "0 12px 0 8px"
  ambient-icon-rail:
    rounded: "{rounded.ambient-sheet}"
    width: "56px"
  album-card-title:
    textColor: "{colors.graphite-text}"
    typography: "{typography.title-card}"
  signal-path:
    textColor: "{colors.graphite-text-secondary}"
    typography: "{typography.measure}"
---

# Design System: Lutsra

## Overview

**Creative North Star: "One Library, Three Listening Rooms"**

Lutsra is one palette and one typeface carried by three shells that differ in topology, not in skin. Gallery (layout id `inset`) is the listening room: text tabs in the header, a single inset sheet with wide gutters and 800-weight display type, chrome-free covers, and a 300px now-playing rail. Console (id `classic`) is the archivist's workstation: a library tree with a Quality group, flush panes split by hairlines, 30px rows, a docked inspector and a 52px instrument strip whose signal path is set in mono. Ambient (id `liquid-glass`) lets chrome recede over the playing artwork: an icon rail, floating header clusters, a glass sheet over blurred cover art and one centred pill dock.

Colour never changes between shells. Each shell takes the Graphite (dark) or Cloud (light) preset plus the user's accent, and each re-declares only its own layout tokens: shell gap, surface radius, control radius, page padding, display size and weight, label variant, row height, cover size, radius and shadow, and motion duration and easing. Type and cover art lead. Colour is rare and means something: the accent marks Hi-Res and active state, and the warning hue marks files and outputs that are not there.

File truth is the thing every shell shows. Format, bit depth and sample rate, and bit-perfect, resampled or shared output appear as a mono, tabular measurement on the card, in the rail, in the table, in the inspector and in the strip or dock, whichever shell is active.

**Key Characteristics:**
- One shared palette (Graphite / Cloud plus six accent sets). Layouts never introduce hues.
- Manrope Variable for all prose. The system monospace is used only for measurements.
- Three distinct topologies driven by a single set of per-layout custom properties on `html[data-layout]`.
- Density spans three steps: 52px rows (Gallery), 44px (Ambient), 30px (Console).
- Motion character differs by layout: an ease-out glide at 320ms, a linear snap at 100ms, a spring at 460ms. All of it collapses to 0ms under reduced motion.

## Colors

The palette is cool graphite or cloud paper, with exactly one user-chosen hue on top. The warning amber is reserved for absence.

### Primary
- **User Accent** (default Violet, dark `accent` / light `accent-light`): the only decorative hue. It marks Hi-Res measurements (`.hires` text in `accent-text`), the active nav item's icon, the active rail item, progress and volume fill, focus rings, selection and caret, the bit-perfect state in the signal path, and the solid empty-state call to action. The user can switch the set to Violet, Blue, Cyan, Emerald, Amber or Rose. Each set ships a darker light-theme variant for contrast, and `accent-text` is the legible text form on each preset.
- **Accent fill** (`--color-accent-fill`, `--color-accent-fill-hover`, `--color-on-accent`): any surface that carries text on the accent uses these, never raw `--color-accent`. They are declared per accent × theme in `_themes.scss` so the pair always reaches 4.5:1. Dark-text presets lighten on hover and white-text presets darken, and `:active` reuses the hover fill. `scripts/check-accent-contrast.mjs` reads the tokens from `_themes.scss` and fails below 4.5:1.

### Neutral
- **Graphite** (dark preset): canvas, navigation, surface, hover, active and elevated steps rise by small value increments, with white hairline borders at 7% and 12%. The text steps are primary, secondary and muted.
- **Cloud** (light preset): the same roles inverted, with slate ink, white surfaces and slate hairlines at 6% and 12%.
- **Navigation tone** (`*-navigation`) is the room colour. Gallery paints the whole window in it so the inset sheet reads as a page laid on a desk. Console uses it for the tree, title bar, inspector and strip.

### Status
- **Missing Amber** (`status-warning`): reserved for file and output truth. It colours the Missing tree entry and its tick, the Missing state cell in tables, a disconnected output in the signal path, and output or playback notices. It is never decoration.
- **Error Red** (`status-error`): failures such as scan errors and runtime errors.
- **Status tints** are derived, not literal: `color-mix(in srgb, var(--status-*) N%, transparent)` for banner and badge backgrounds and borders. No `rgba()` status literals in components.

### Named Rules
**The One Hue Rule.** The accent is the only chromatic colour a layout may use, and it marks meaning (Hi-Res, active, progress, focus), never ornament. Layout tokens never declare a colour.

**The Absence Rule.** Amber means a file or output is not there. If nothing is missing or disconnected, no amber appears on screen.

**The Ink Play Rule.** The play/pause control is solid ink on surface (`text` on `surface`), not accent, so it reads with every accent set.

## Typography

**Display Font:** Manrope Variable (with system-ui, Segoe UI)
**Body Font:** Manrope Variable
**Label/Mono Font:** system monospace (ui-monospace, Consolas), used for measurements only

**Character:** One geometric-humanist sans changes voice by weight and tracking per layout: heavy and tight in Gallery, compact and small-capped in Console, medium and soft in Ambient. Monospace appears only where a number is a measurement.

### Hierarchy
- **Display** (per layout via `--type-display*`): page titles such as Library, Albums and "Recently modified". Gallery is 800 weight on a container-relative clamp up to 3.5rem. Console is 650 at 1.375rem. Ambient is 600 on a clamp up to 2.75rem.
- **Title**: the Gallery rail track title (800, 24px, tight, balanced, three-line clamp) and the album card title (`--card-title-*`: 700 at 15px in Gallery, 600 at 14px in Console and Ambient).
- **Body** (500, 15px, 1.5): the base size for the whole app. 14px is used for nav items, table cells and strip titles.
- **Label**: Console only, using all-small-caps at 650 with 0.06em tracking (`--type-label-variant` / `--type-label-tracking`) for tree headings, table headers and inspector sections. Gallery and Ambient labels stay in normal case.
- **Measure** (mono, 13px / var(--font-size-xs), tabular-nums): format lines such as "FLAC 24/96", times, counts and the signal path. The inspector's file-truth headline uses the same mono at 18px/600.
- **Minimum Size**: 13px is the absolute floor for text legibility. Sizes below 13px are forbidden except for purely decorative non-readable markers.

### Named Rules
**The Measurement Rule.** Mono plus tabular figures mean "this was measured from the file or engine". Prose never goes mono, and measurements never go proportional.

**The Small-Caps Rule.** Console labels use the font's `all-small-caps`, not `text-transform: uppercase`. Other layouts do not use cased labels.

## Layout

All three shells share one Angular shell and one content container. `.main-content` is an inline-size container, so page type and gutters scale with `cqi` and not with the viewport. Per-layout matrix:

| Token | Gallery (`inset`) | Console (`classic`) | Ambient (`liquid-glass`) |
|---|---|---|---|
| Navigation | text tabs in a 60px header (folding into a menu under 900px) | 212px tree with Library and Quality groups (52px collapsed, forced under 650px) | 56px glass icon rail plus floating header clusters (52px high) |
| Content | inset sheet, r20, 14px gap from the room | flush pane, r0, hairline-divided | glass sheet, r22, 10px gap, over blurred artwork |
| Player | 300px now-playing rail (76px slim column under 1100px) | 52px strip; signal path hidden under 1180px | single 64px pill dock, max 860px, centred |
| Side pane | none | docked 320px inspector (selected track, fallback playing) | floating details sheet |
| Page padding | clamp(24, 4cqi, 64) × clamp(28, 4cqi, 52) | 20 × 18 | clamp(20, 3cqi, 44) × 76 (clears the floating header) |
| Row height | 52px | 30px | 44px |
| Cover min / gap / radius | 196 / clamp(20, 2.4cqi, 36) / 12 | 136 / 14 / 2 | 172 / 22 / 16 |
| Control radius | full | 3px | full |
| Motion | 320ms cubic-bezier(0.16, 1, 0.3, 1) | 100ms linear | 460ms cubic-bezier(0.34, 1.28, 0.64, 1) |

Spacing follows a 4px scale (4 to 40). The title bar is a drag region, with every interactive cluster marked as no-drag. Windows controls stay native-styled in every layout.

### Named Rules
**The Topology Rule.** A new layout differs in where navigation, content and the player live, not in colour. If a proposed layout is the same sidebar, content and footer with new tokens, it is not a new layout.

**The Token-Only Switch Rule.** Components read `--surface-radius`, `--control-radius`, `--row-height`, `--cover-*`, `--type-*` and `--motion-*`. They do not branch on layout unless the topology itself differs.

## Elevation & Depth

Depth differs by layout. Gallery is gently lifted, Console is flat, and Ambient is material glass.

### Shadow Vocabulary
- **Cover lift, Gallery** (`0 10px 28px rgba(0,0,0,0.22)`): under covers and the rail cover.
- **Cover lift, Ambient** (`0 8px 24px rgba(0,0,0,0.16)` plus a 1px inset glass-border ring).
- **Sheet edge, Gallery** (`inset 0 0 0 1px` subtle border): defines the inset sheet without a drop shadow. The rail uses `--shadow-md`.
- **Glass** (light `0 14px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)`; dark `0 18px 48px rgba(0,0,0,0.42), 0 1px 3px rgba(0,0,0,0.3)`): paired with `inset 0 1px 0` specular, a 1px glass border and `backdrop-filter: blur(28px) saturate(1.4)`. Used on the icon rail, header clusters and dock.
- **Overlay** (`--shadow-lg`): menus, notices and dialogs.

### Named Rules
**The No-Glow Console Rule.** Inside Console's content, `--shadow-*` and `--accent-glow` resolve to none or transparent, and radii collapse to 2-4px. Hairlines carry all structure.

**The Ambient Ground Rule.** In Ambient, the current cover blurred (80px, saturate 1.25, 55% opacity dark and 42% light) is the ground on every page. It fades in for 1.2s on track change. Inside the glass sheet, surfaces map to glass tints derived from the active preset by `color-mix`, so both presets work.

**The Solid Fallback Rule.** Under `prefers-reduced-transparency` or forced colours, every glass surface becomes its solid preset surface and the artwork ground is removed.

## Shapes

Radius belongs to the layout, not the component. Gallery uses soft sheets (r20) with pill controls and r12 covers. Console uses square panes (r0) with 3px controls, 2px covers, and page cards clamped to 2, 3 and 4px. Ambient uses r22 sheets with pill controls, r16 covers and a round cover in the dock. Artist covers are circular in every layout. The Quality tree marks are 2×10px ticks, measurement marks rather than badges.

## Components

### Buttons
- **Shape:** `--radius-md` (8px; 2px inside Console).
- **Primary:** accent fill with `--color-on-accent` text, 8px × 16px padding. Used for empty-state commits (Add Music Folder, Rescan). There is no hover glow on primary buttons.
- **Secondary:** surface-hover fill, 1px border and text colour. Used for in-page actions such as Shuffle library.
- **Icon controls:** 32-34px, transparent, `--control-radius`. They fill with secondary text on surface-hover when hovered, and the active state uses `accent-text`.
- **Play/pause:** a solid ink circle (36px in the strip and pill, 30px in Console, 56px in the Gallery rail). It scales 1.05 on hover and 0.97 on press.

### Navigation
- **Gallery tabs:** pill tabs at 15px/600 in secondary text. The active tab gets a surface fill with `--shadow-sm`.
- **Console tree:** 28px items at 14px/500, with a mono count on the right. The active item gets surface-active fill, 650 weight and an accent icon. The Quality group lists Lossless, Hi-Res, Lossy and Missing with tick marks (Hi-Res tick in accent, Missing label, count and tick in amber).
- **Ambient icon rail:** 40px round items. The active item gets accent-muted fill with accent icon, and pill tooltips appear on hover and focus.

### Inputs / Fields
- **Search:** pill (36px in Gallery and Ambient), or a 30px field at 3px radius on canvas in Console. Ambient has a transparent border on `glass-clear`.
- **Focus:** accent border plus a 3px accent-muted ring (16% accent ring in Ambient). The global focus-visible style is a 2px accent outline with 2px offset.

### Album Card
A chrome-free tile: the cover is the object and the text sits beneath it. Title, artist and a mono format line follow the cover, with the format line in accent only for Hi-Res. "Mixed · up to FLAC 24/88.2" marks mixed-codec albums. Hover scales the cover 1.03, and quick play and queue buttons rise from the cover's bottom-right corner on hover or focus.

### Signal Path (signature)
A mono line reading `source → path`, for example `FLAC 24/96 → bit-perfect` or `M4A 256k → shared mixer`. The source is set in the text colour (accent if Hi-Res). The path is accent when bit-perfect, amber when the output is disconnected, and secondary otherwise. It states only what the engine reports. It appears in the Console strip, the Gallery rail and the Ambient dock.

### Console Table and Inspector
30px rows separated by subtle hairlines, with small-caps headers. Hover uses surface-hover, and the playing row uses surface-active. Missing rows go muted, with the state cell in amber. The inspector opens with the file-truth block (18px mono format plus the on-disk state) before the tag sections.

### Track Lists and Keyboard
Every track list (Songs, album, artist and playlist detail, Console Home, queue) follows one pattern:
- **Roving tabindex:** exactly one row (or the title button on Console Home) is in the tab order. Row actions are tabbable only on the active row.
- **Keys:** ↑/↓/Home/End/PageUp/PageDown move through `nextRowIndex` (`shared/utils/row-navigation.ts`) and clamp at both ends. Enter runs the row's primary action. Space is left to global play/pause.
- **Selection follows focus** on track tables, so the Console inspector tracks the active row. Home and queue do not change selection.
- **Focus ring:** `2px solid var(--border-focus)` with `-2px` offset. Rows carry `scroll-margin-top` so floating headers never cover the focused row.
- **Playlist Move buttons** use `aria-disabled` at the ends so focus survives a reorder.

### Media Heroes
Text set on artwork (the Folders hero) stays white over a dark scrim in both themes, and its fallback gradient ends in `color-mix(in srgb, var(--accent-primary) 18%, black)`. This is the one place a literal white text colour is allowed.

### Copy
Interface copy is sentence case. Each concept has a single name throughout: **track** for an item ("Songs" names the page only), **library folder**, **Rescan library**, **output device**, **Native Shared** / **Chromium Shared**. Toggles show On/Off and keep a constant accessible name with `aria-pressed`. Errors name what failed and the next step. The product name is shown as **Lutstra**; storage keys stay `lutsra.*`.

## Do's and Don'ts

### Do:
- **Do** take every colour from the preset and accent tokens (`--color-*`, `--text-*`, `--accent-*`). Layout blocks declare only geometry, type voice and motion.
- **Do** set every measurement (format, bit depth/rate, kbps, times, counts, signal path) in mono with tabular figures.
- **Do** reserve the accent for Hi-Res, active state, progress and focus, and amber for Missing or Unavailable files and disconnected outputs.
- **Do** read layout geometry from `--surface-radius`, `--control-radius`, `--row-height`, `--cover-*` and `--motion-*` rather than hard-coding per layout.
- **Do** give every glass surface a solid fallback under reduced transparency and forced colours, and zero `--motion-dur` under reduced motion.

### Don't:
- **Don't** add glow, drop shadows or radii above 4px inside Console.
- **Don't** use amber for emphasis, scan progress or anything that is not an absent file or output.
- **Don't** introduce a second typeface or a system display face. Mono is for measurements only.
- **Don't** reskin one topology three times. A layout earns its id by moving navigation, content and the player.
- **Don't** hard-code hues or gradients for placeholders or heroes. They must follow the preset and accent.

## Known Gaps (critique 2026-10-05, 26/40)
These shipped surfaces do not yet meet this document:
- **Absence colour.** Missing amber reaches only 1.8–2.0:1 on light surfaces, and Unavailable badges in Songs and detail tables use Error Red. The Amber accent preset collides with the warning hue.
- **Now Playing.** The play button is accent-filled with a glow (Ink Play Rule), and the spectrum outranks the Source file section.
- **Motion.** `--motion-ease` overshoots (`cubic-bezier(0.34, 1.28, 0.64, 1)`), although motion should ease out.
- **Quality navigation** exists only in Console. Gallery and Ambient Home are the same page.
- **Type and contrast floor.** Light muted text sits at 4.45:1. The Songs search placeholder uses the browser default (3.6:1). `.filter-count` is 11px.
