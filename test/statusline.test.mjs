import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function piDir() {
	if (process.env.PI_PI_DIR) return process.env.PI_PI_DIR;
	const base = join(homedir(), ".pi", "agent", "install", "releases");
	const versions = readdirSync(base).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
	versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	return join(base, versions.at(-1));
}
const PI_DIR = piDir();
const { createJiti } = await import(`${PI_DIR}/node_modules/jiti/lib/jiti.mjs`);
const j = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, alias: {
	"@earendil-works/pi-coding-agent": `${PI_DIR}/node_modules/@earendil-works/pi-coding-agent/dist/index.js`,
	"@earendil-works/pi-ai": `${PI_DIR}/node_modules/@earendil-works/pi-ai/dist/index.js`,
	"@earendil-works/pi-tui": `${PI_DIR}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	typebox: `${PI_DIR}/node_modules/typebox/build/index.mjs` } });
const m = await j.import("/home/qualidiv/pi-quota-statusline/index.ts");

let checks = 0;
const ok = (v, msg) => { checks++; return assert.ok(v, msg); };
const is = (a, b, msg) => { checks++; return assert.strictEqual(a, b, msg); };

test("peek snapshots map to footer windows", () => {
	const anthropic = m.quotaFromSnapshot("anthropic", {
		status: "available",
		windows: [
			{ name: "five_hour", usedPercent: 88, resetAt: 1794693600000 },
			{ name: "seven_day_opus", usedPercent: 41 },
		],
	});
	is(anthropic.ok, true, "an available snapshot is ok");
	is(anthropic.primary.remainingPercent, 12, "five_hour is the primary");
	is(anthropic.primary.resetAt, 1794693600000, "the reset carries over");
	ok(anthropic.secondary && anthropic.secondary.remainingPercent === 59, "the weekly window maps");
	const codex = m.quotaFromSnapshot("openai-codex", {
		status: "stale",
		windows: [
			{ name: "5h", usedPercent: 100, resetAt: 1794693600000 },
			{ name: "7d", usedPercent: 12 },
		],
	});
	is(codex.ok, true, "stale keeps the last good windows");
	is(codex.primary.remainingPercent, 0, "a spent window reads zero");
	const failed = m.quotaFromSnapshot("anthropic", { status: "error", windows: [] });
	is(failed.ok, false, "an error snapshot renders the dash");
	const empty = m.quotaFromSnapshot("anthropic", { status: "available", windows: [] });
	is(empty.ok, false, "no windows render the dash");
});

test("banked resets render as one glyph and a count", () => {
	const theme = { fg: (_color, text) => text };
	const now = 1794693600000;
	const base = { present: true, ok: true, primary: { remainingPercent: 0, resetAt: now + 3_600_000 }, secondary: { remainingPercent: 2 } };
	const withTwo = m.quotaSegment("◆", "claude", { ...base, resets: 2 }, theme, now);
	ok(withTwo.includes("↺2"), "the count appears");
	const without = m.quotaSegment("◆", "claude", base, theme, now);
	ok(!without.includes("↺"), "and nothing appears when there are none");
	is(m.resetCount({ status: "available", grants: [{ resetsLeft: 2 }, { resetsLeft: 1, paused: true }] }), 2, "paused grants do not count");
	is(m.resetCount({ status: "gated", grants: [{ resetsLeft: 5 }] }), 0, "a gated read counts nothing");
	is(m.resetCount(undefined), 0, "no answer counts nothing");
});

test("summary", () => console.log(`ok ${checks} checks`));
