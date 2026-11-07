# Changelog

## [1.2.2] - 2026-11-07

### Changed

- Cache hit rate glyph is now `💾` (U+1F4BE floppy disk) instead of `♻`. U+1F4BE is East-Asian-Wide, so
  pi-tui measures it as two columns and terminals draw it as two: the glyph and the renderer agree, and
  the padding space added in 1.2.1 is gone, leaving `💾 97.4%` with a single space and exact wrap
  arithmetic.

## [1.2.1] - 2026-11-07

### Fixed

- Space after the `♻` cache glyph. U+267B is East-Asian-Neutral, so pi-tui measures it as one column,
  but terminals usually draw it at two and swallow the following space, leaving the rate glued to the
  symbol. The padding space is emitted inside the dim span so the gap survives either rendering.

## [1.2.0] - 2026-11-07

### Added

- Cache hit rate segment, `♻ <rate>`, placed after context usage:
  `cacheRead / (input + cacheRead + cacheWrite)` summed over every assistant message on the branch.
  This is pi's own definition — its stats line prints `Cached: <tokens> (<rate>%)` the same way — so the
  two never disagree.
- Omits the segment when the branch has no prompt tokens or when no message reported cache activity, so
  providers without caching do not render a meaningless `0%`. Recomputed only when the leaf or entry
  count changes.

### Verified

- Synthetic branch (cacheRead 9500, promptTokens 13000) renders `♻ 73.1%`.
- A real 123-assistant-turn session file sums to `cacheRead 11,090,688 / promptTokens 11,383,993` =
  `97.4235%`; the rendered footer reads `♻ 97.4%`.
- A no-cache branch and an empty branch both omit the segment.

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
