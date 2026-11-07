# Changelog

## [1.1.0] - 2026-11-07

### Added

- Quota numbers are coloured by remaining: green above 25%, orange at 1–25%, red at 0%. The
  threshold uses the rounded displayed value, so colour and number never disagree. Green and red use
  the theme's `success`/`error` tokens; the warning band uses ANSI 256 colour 208 because neither
  built-in theme carries an orange token (`warning` is yellow in both).

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
