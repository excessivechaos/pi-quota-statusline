# pi-quota-statusline

A pi footer statusline that shows, left to right:

```
🤖 router/auto → high: opus-5-5 🧠 high · 📁 main · 🪟 6.0% 12k/200k · ⚡ claude · 5h 100% · wk 0% ↻ 7h8m · 🧠 codex · 5h 100% ↻ 3h41m · wk 26% ↻ 4d1h · 🕒 17:52
```

| Segment | Meaning |
|---|---|
| `🤖 <model> 🧠 <level>` | The selected model and thinking level. With a `router/*` selection it also shows the physical model the route chose and, for tiered profiles, the tier. |
| `📁 <branch>` | Git branch of the working directory. |
| `🪟 <% used tokens/window>` | Context window usage. |
| `⚡ claude` | Claude subscription quota: `5h` session window, `wk` weekly window. |
| `🧠 codex` | ChatGPT Codex subscription quota: `5h` session window, `wk` weekly window. |
| `🕒 <HH:MM>` | Local clock, repainted on the minute boundary. |

## Quota numbers are what is LEFT, not what is spent

Both providers report the percent *used*; this extension inverts it so the footer answers "how
much do I have left". `100%` is a fresh window, `0%` is an exhausted one. The `↻` suffix is the
time until that window resets.

- Claude: `five_hour.utilization`, `seven_day.utilization` — `0 → 100%` left, `100 → 0%` left.
- Codex: `rate_limit.primary_window.used_percent` (18000 s window), `secondary_window.used_percent`
  (604800 s window) — inverted the same way.

A provider line appears only when `auth.json` has an entry for it (`anthropic`, `openai-codex`).
A failed read renders `—` rather than a stale or guessed figure, and a single transient auth-file
read failure keeps the last known values.

## Requirements

- A pi install supplying `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` (declared as
  `*` peer dependencies — the package has no runtime dependencies of its own).
- Credentials in `<agent dir>/auth.json` for whichever providers you want shown:
  `anthropic` (OAuth access token) and/or `openai-codex` (OAuth access token; the account id is read
  from the JWT's `https://api.openai.com/auth` claim, falling back to `accountId`).
- `<agent dir>` is `~/.pi/agent` or `$PI_CODING_AGENT_DIR`.
- Network access to `api.anthropic.com/api/oauth/usage` and `chatgpt.com/backend-api/wham/usage`.
  Nothing else is contacted, and no data is written anywhere.

## Install

```sh
pi install git:github.com/excessivechaos/pi-quota-statusline@v1.0.0
```

Other forms:

```sh
pi install npm:pi-quota-statusline@1.0.0     # after publishing to npm
pi install C:\path\to\pi-quota-statusline     # local copy, loaded in place
pi -e C:\path\to\pi-quota-statusline          # try it for one run
```

Windows: the extension is path- and platform-neutral — it resolves the auth file with `homedir()`
and `join()`, so it reads `C:\Users\<you>\.pi\agent\auth.json`, and `$PI_CODING_AGENT_DIR` is honoured
including a leading `~`. Requires pi 1.5.0 or newer, since it uses `ctx.ui.setFooter`,
`ctx.getContextUsage()` and `footerData.getExtensionStatuses()`.

## Behaviour

- UI only: no tools, no prompt or system-message injection, no session entries.
- Quota is fetched off-render every five minutes with a 10 s timeout; a render reads cached values
  and never waits. The first read is synchronous so the quota segments do not flash in.
- If the terminal is narrow the footer wraps between segments.
- Skips itself outside the TUI (`ctx.mode !== "tui"`), leaving pi's built-in footer in place.
- Any internal error degrades to `statusline unavailable` instead of failing the session.

## Development

```sh
npm install --no-save typescript @types/node @earendil-works/pi-tui @earendil-works/pi-coding-agent
npx tsc --noEmit
```
