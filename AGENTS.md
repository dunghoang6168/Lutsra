# Lutstra: instructions for coding agents

Lutstra is a local-first desktop music player for lossless and Hi-Res libraries: Angular 21 in an Electron shell on Windows. The longer human guide is [docs/APP_GUIDE.md](docs/APP_GUIDE.md). The design system is [DESIGN.md](DESIGN.md), and its rules are binding.

## Hard rules
- **Stay in the UI layer unless the task says otherwise.** Do not change playback behaviour, `PlayerService` logic, gateways, `electron/`, IPC or the database.
- **No new dependencies.**
- **Angular style:** standalone components, signals and `computed`, `@if`/`@for` (never `*ngIf`/`*ngFor` in new code). Use external `.html` and `.scss` files (see [docs/FRONTEND_STRUCTURE.md](docs/FRONTEND_STRUCTURE.md)).
- **Tokens only.** Colours, spacing, radii, type, shadows and motion come from `src/styles/_tokens.scss` and `_themes.scss`. Do not hard-code values. If a value is missing, ask before adding a token.
- **Names:** the product is **Lutstra** and technical names use `lutstra`. Preserve the renderer origin `app://lutsra`, localStorage keys `lutsra.*` and IndexedDB name `lutsra-waveform` for existing browser data. Legacy profile migration also retains the old profile and database names to locate source data.
- **Keep accessibility:** real buttons and links, accessible names, visible focus, and the keyboard pattern described below.
- **Line endings:** keep LF.
- **Files to leave alone:** do not commit `docs/AUDIO_ENGINE_PLAN.md` or `skills-lock.json` unless asked.

## Design rules (full text in DESIGN.md)
- **Three layouts, one palette.** `html[data-layout]` is `inset` (Gallery), `classic` (Console) or `liquid-glass` (Ambient). Layouts change topology, never colour. Components read layout tokens (`--surface-radius`, `--control-radius`, `--row-height`, `--cover-*`, `--type-*`, `--motion-*`) instead of branching on layout.
- **Accent is meaning, not decoration.** It marks Hi-Res, active state, progress and focus. Accent text uses `--text-accent`. `--accent-primary` is for fills, rings and borders only. Do not use accent gradients or glows for ornament.
- **Amber means absence.** `--status-warning` / `--status-warning-text` are only for missing or unavailable files and disconnected outputs.
- **Ink play.** The play/pause control is `--text-primary` fill with a `--text-inverse` icon. Never accent, never glow.
- **Measurements are mono.** Format, bit depth and rate, kbps, times, counts and the signal path use the mono face with tabular figures. Prose never does. Format with `formatTrackFormat`, `formatResolution` and `trackQuality` in `src/app/features/home/library-quality.ts`. Hi-Res means lossless at 24-bit or above 48 kHz.
- **Type floor is 13px** (`--font-size-xs`). Console labels use `--type-label-variant` (small caps), never `text-transform: uppercase`.
- **Overlays:** text over artwork stays white on `--scrim-soft`, `--scrim-strong` or `--scrim-heavy`. Destructive buttons use `--status-error-fill`, `--status-error-fill-hover` and `--color-on-error`.
- **Copy:** sentence case everywhere: buttons, headings, aria-labels and tooltips. Page names (Home, Songs, Albums, Now Playing…) and engine names (Native Shared, Chromium Shared) keep their capitals. One item is a **track** ("Songs" only names the page).
- **Responsive:** respond to the `.main-content` container (`@container main-content (...)`, `cqi`), not the viewport, so Console's tree and inspector are accounted for.

## Track lists and keyboard
Every track table follows the same pattern: `role="grid"` with roving tabindex (one row in the tab order), ↑/↓/Home/End/PageUp/PageDown through `nextRowIndex` in `src/app/shared/utils/row-navigation.ts`, Enter for the row's main action, and Space left to global play/pause. Selection follows focus (`aria-selected`), and row actions are tabbable only on the active row. Songs and the album, artist and playlist detail tables also multi-select through `shared/utils/row-selection.ts`: Ctrl+click or Ctrl+Space toggles, Shift+click or Shift+arrows select a range, Ctrl+arrows move focus only, Ctrl+A selects all visible rows, and Esc collapses to the focused row. At least one row stays selected. From two selected rows, `app-track-selection-bar` covers the header. Detail pages read `route.paramMap`, not the snapshot, so a reused component reloads when the id changes.

## Verify before you report
1. `npx ng build` and `npx vitest run` (all files under `tests/`). `*.spec.ts` is gitignored, so commit new test files with `git add -f`, or name them `*.spec.mts`.
2. `node scripts/check-accent-contrast.mjs` when you touch colour tokens.
3. Look at the real UI. With a dev server running, `env -u ELECTRON_RUN_AS_NODE npx electron scripts/ui-sweep.cjs` covers every route × 3 layouts × 2 themes × 1440/560 and must report 0 flagged pages. It does not measure text over images, so check those screenshots by eye.
4. In your own probes, inject a no-transition style before measuring. Hidden windows freeze CSS transitions and give false results.
5. Stop any dev server you started.

## Working alongside other agents
- Several agents may work at once. Work only in the folder and branch you were given (a git worktree for parallel work) and on the port you were given. Touch only the files the task names.
- **Do not commit, push, checkout, stash or reset** unless the task explicitly allows it. The reviewer merges.
- **Reply in Vietnamese (most important):** always talk to the user in Vietnamese, and write the files in `plan/` in Vietnamese too. Code, comments, commit messages and the English docs stay in English.
- **Working notes go in `plan/<type>/`:** every `.md` you create goes in the matching subfolder of `plan/` at the repo root (gitignored), never in a home or temp folder: `plans/` (plans, timelines), `prompts/` (prompts for other agents), `reports/` (task results, investigations), `reviews/` (code or design reviews), `notes/` (backlogs, drafts, anything else). This does not cover real project docs such as `docs/`.
- **Commit messages:** ask the user to approve the message before committing. Never add `Co-Authored-By`, a model name, or any AI attribution to commits or PR descriptions.
- Send a short plan first and wait for approval. In the final report, list changed files, test output, screenshots, any deviations from the task, and bugs you noticed outside scope. Copy before/after tables from `git diff`; do not reconstruct them.
