# Changelog

## [1.1.1] - 2026-11-07

### Changed

- The 1–25% band now uses the theme's `warning` token instead of ANSI 256 colour 208, so the quota
  colours are all theme tokens and a custom theme recolours the band with the rest of its palette.
  Measured on the built-in themes: `warning` resolves to `#cd9a22` (dark) and `#8f6802` (light) — an
  amber 10° from the orange it replaces in sRGB hue, less saturated (S 71% vs 100%). The thresholds,
  the layout, the green and red bands and the `↻` countdown are unchanged.

### Fixed

- The 1.1.0 rationale claimed no built-in theme carries an orange token because "`warning` is yellow".
  That was read from the token *name* (`warning: "yellow"`), not from its value: `vars.yellow` is
  `okhsl(83 88% 67%)` on dark and `okhsl(83 99% 47%)` on light, which resolve to `#cd9a22` and
  `#8f6802` — amber, not yellow. The rationale and the README are corrected against those measured
  values; the 1.1.0 entry below keeps its original text with the correction noted.

## [1.1.0] - 2026-11-07

### Added

- Quota numbers are coloured by remaining: green above 25%, orange at 1–25%, red at 0%. The
  threshold uses the rounded displayed value, so colour and number never disagree. Green and red use
  the theme's `success`/`error` tokens; the warning band used ANSI 256 colour 208. *Corrected in
  1.1.1: that choice was justified by calling `warning` yellow, which was read from the token name
  rather than its value; see the 1.1.1 entry.*

### Verified

- Rendered through the real formatter with stubbed payloads: `100%`/`26%` → `success`, `25%` and
  `20%` → ANSI 208, `0%` → `error`. `theme.style()` emits `ESC[38;5;208m` for the orange band and
  `ESC[38;2;0;175;0m` / `ESC[38;2;224;0;0m` for green and red in truecolor mode.

## [1.0.0] - 2026-11-07

### Added

- Initial package: the footer statusline from `~/.pi/agent/extensions/router-statusline/`, unchanged
  in layout — model and route, git branch, context usage, Claude and Codex subscription quota, and a
  local clock.
- Claude windows from `five_hour` / `seven_day`, Codex windows from `rate_limit.primary_window` /
  `secondary_window`, refreshed off-render every five minutes.

### Changed

- Quota values are rendered as **remaining**, not used. Both providers report percent used
  (`utilization`, `used_percent`); the footer now shows `100 - used`, so `100%` means a fresh window
  and `0%` means an exhausted one. Measured on the same payloads: Claude `0/100 → 100/0`,
  Codex `0/74 → 100/26`.
