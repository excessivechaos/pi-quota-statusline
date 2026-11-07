# Changelog

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
