/**
 * Router statusline footer.
 *
 * The footer is one line of segments joined by " · ". The first segment shows the selected
 * model and, for a `router/*` selection, the physical model and thinking level after an arrow.
 * The remaining segments are git branch, context usage, subscription quota only for providers
 * present in auth.json, extension statuses from footerData, and a local clock. A narrow terminal
 * wraps between segments.
 *
 * UI only: no tools, no prompt/system-message injection, no session entries. Quota data is
 * fetched off-render every five minutes; render reads cached values and never waits.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";

const QUOTA_REFRESH_MS = 5 * 60_000;
const QUOTA_TIMEOUT_MS = 10_000;
const CLOCK_INTERVAL_MS = 60_000;
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";
/** The usage endpoint aggressively 429s requests without a claude-code user agent. */
const ANTHROPIC_USER_AGENT = "claude-code/2.1";
const CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
/**
 * Remaining quota at or below this percent is rendered with the theme's warning token. The token is
 * named "yellow", but both built-in themes resolve it to amber: #cd9a22 on dark, #8f6802 on light
 * (`vars.yellow` = okhsl(83 88% 67%) and okhsl(83 99% 47%)), so the band reads warm, not primary.
 */
const QUOTA_WARNING_PERCENT = 25;

interface QuotaWindow {
	/**
	 * Percent of the window still available. Both providers report the percent used, so the
	 * footer keeps the inverted value and renders how much is left.
	 */
	remainingPercent: number;
	resetAt?: number;
}

interface ProviderQuota {
	/** The provider has an auth.json entry, so its line belongs in the footer. */
	present: boolean;
	/** A usage read succeeded; false renders a dash instead of stale/guessed windows. */
	ok: boolean;
	primary?: QuotaWindow;
	secondary?: QuotaWindow;
}

interface QuotaState {
	anthropic: ProviderQuota;
	codex: ProviderQuota;
}

interface PhysicalResponse {
	modelId: string;
	thinkingLevel?: string;
}

type AuthEntries = Record<string, unknown>;

/**
 * The tier a tiered router profile chose: the newest virtual-model state or router decision
 * on the branch names it. Cached against the same key the routed model uses.
 */
const TIER_ENTRY = "pi.virtual-model-state";
const DECISION_ENTRY = "router:decision";

/** `sessionManager.routedModel` is documented on AgentSession but omitted from ReadonlySessionManager. */
type MaybeRoutedSession = {
	routedModel?: {
		model?: { id?: string };
		thinkingLevel?: string;
	};
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Epoch milliseconds from Unix seconds, epoch milliseconds, or an ISO date string. */
function toEpochMs(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value < 100_000_000_000 ? value * 1000 : value;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

function percentage(value: unknown): number | undefined {
	const raw = finiteNumber(value);
	if (raw === undefined) return undefined;
	return Math.min(100, Math.max(0, raw));
}

/** Normalize one Anthropic or Codex window object. */
function parseQuotaWindow(value: unknown, fetchedAt: number): QuotaWindow | undefined {
	const item = asRecord(value);
	if (!item) return undefined;
	const usedPercent = percentage(item.utilization ?? item.used_percent ?? item.used_percentage);
	if (usedPercent === undefined) return undefined;

	let resetAt = toEpochMs(item.resets_at ?? item.reset_at);
	if (resetAt === undefined) {
		const afterSeconds = finiteNumber(item.reset_after_seconds ?? item.reset_after);
		if (afterSeconds !== undefined && afterSeconds >= 0) resetAt = fetchedAt + afterSeconds * 1000;
	}
	return { remainingPercent: 100 - usedPercent, resetAt };
}

function parseAnthropicUsage(payload: unknown, fetchedAt: number): Pick<ProviderQuota, "primary" | "secondary"> | undefined {
	const root = asRecord(payload);
	if (!root) return undefined;
	const primary = parseQuotaWindow(root.five_hour, fetchedAt);
	const secondary = parseQuotaWindow(root.seven_day, fetchedAt);
	return primary || secondary ? { primary, secondary } : undefined;
}

function parseCodexUsage(payload: unknown, fetchedAt: number): Pick<ProviderQuota, "primary" | "secondary"> | undefined {
	const limits = asRecord(asRecord(payload)?.rate_limit);
	if (!limits) return undefined;
	const primary = parseQuotaWindow(limits.primary_window, fetchedAt);
	const secondary = parseQuotaWindow(limits.secondary_window, fetchedAt);
	return primary || secondary ? { primary, secondary } : undefined;
}

function authToken(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry.trim() || undefined;
	const record = asRecord(entry);
	if (!record) return undefined;
	for (const key of ["access", "token", "apiKey", "key"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function codexAccountId(token: string, entry: unknown): string | undefined {
	const parts = token.split(".");
	if (parts.length === 3 && parts[1]) {
		try {
			const payload = asRecord(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")));
			const claim = asRecord(payload?.[CODEX_JWT_CLAIM_PATH]);
			const accountId = claim?.chatgpt_account_id;
			if (typeof accountId === "string" && accountId) return accountId;
		} catch {
			// Fall through to the auth entry's accountId.
		}
	}
	const record = asRecord(entry);
	const fallback = record?.accountId ?? record?.chatgpt_account_id;
	return typeof fallback === "string" && fallback ? fallback : undefined;
}

function authPath(): string {
	const override = process.env.PI_CODING_AGENT_DIR;
	if (override) {
		return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
	}
	return join(homedir(), ".pi", "agent");
}

function parseAuth(text: string): AuthEntries {
	try {
		return asRecord(JSON.parse(text)) ?? {};
	} catch {
		return {};
	}
}

/** Synchronous first read so quota lines do not flash in after the first render. */
function readAuthSync(): AuthEntries {
	try {
		return parseAuth(readFileSync(join(authPath(), "auth.json"), "utf-8"));
	} catch {
		return {};
	}
}

/** `undefined` means the file could not be read; `{}` means it has no providers. */
async function readAuth(): Promise<AuthEntries | undefined> {
	try {
		return parseAuth(await readFile(join(authPath(), "auth.json"), "utf-8"));
	} catch {
		return undefined;
	}
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const response = await fetch(url, { headers, signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS) });
	if (!response.ok) return undefined;
	try {
		return (await response.json()) as unknown;
	} catch {
		return undefined;
	}
}

async function readAnthropicQuota(entry: unknown): Promise<ProviderQuota> {
	if (entry === undefined) return { present: false, ok: false };
	const token = authToken(entry);
	if (!token) return { present: true, ok: false };
	try {
		const payload = await fetchJson(ANTHROPIC_USAGE_URL, {
			Authorization: `Bearer ${token}`,
			"anthropic-beta": ANTHROPIC_OAUTH_BETA,
			"User-Agent": ANTHROPIC_USER_AGENT,
		});
		const parsed = payload === undefined ? undefined : parseAnthropicUsage(payload, Date.now());
		return parsed ? { present: true, ok: true, ...parsed } : { present: true, ok: false };
	} catch {
		return { present: true, ok: false };
	}
}

async function readCodexQuota(entry: unknown): Promise<ProviderQuota> {
	if (entry === undefined) return { present: false, ok: false };
	const token = authToken(entry);
	if (!token) return { present: true, ok: false };
	try {
		const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
		const accountId = codexAccountId(token, entry);
		if (accountId) headers["ChatGPT-Account-Id"] = accountId;
		const payload = await fetchJson(CODEX_USAGE_URL, headers);
		const parsed = payload === undefined ? undefined : parseCodexUsage(payload, Date.now());
		return parsed ? { present: true, ok: true, ...parsed } : { present: true, ok: false };
	} catch {
		return { present: true, ok: false };
	}
}

function shortModelId(id: string): string {
	const slash = id.lastIndexOf("/");
	return slash >= 0 ? id.slice(slash + 1) : id;
}

function formatTokens(count: number): string {
	if (!Number.isFinite(count) || count < 0) return "—";
	if (count < 1000) return `${Math.round(count)}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatClock(now: number): string {
	const date = new Date(now);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatCountdown(resetAt: number | undefined, now: number): string {
	if (resetAt === undefined) return "—";
	const remaining = resetAt - now;
	if (remaining <= 0) return "now";
	const minutes = Math.floor(remaining / 60_000);
	if (minutes < 1) return "<1m";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours < 48) return remainingMinutes ? `${hours}h${remainingMinutes}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours ? `${days}d${remainingHours}h` : `${days}d`;
}

function quotaColor(remainingPercent: number): ThemeColor {
	if (remainingPercent <= 0) return "error";
	if (remainingPercent <= QUOTA_WARNING_PERCENT) return "warning";
	return "success";
}

function quotaSegment(
	icon: string,
	label: string,
	quota: ProviderQuota,
	theme: Theme,
	now: number,
): string | undefined {
	if (!quota.present) return undefined;
	const separator = theme.fg("dim", " · ");
	const heading = `${icon} ${theme.fg("accent", label)}`;
	if (!quota.ok) return `${heading}${separator}${theme.fg("dim", "—")}`;

	const format = (window: QuotaWindow | undefined): string => {
		if (!window) return "—";
		const remaining = Math.round(window.remainingPercent);
		const left = theme.fg(quotaColor(remaining), `${remaining}%`);
		return window.resetAt === undefined ? left : `${left} ↻ ${formatCountdown(window.resetAt, now)}`;
	};
	return [
		heading,
		`5h ${format(quota.primary)}`,
		`wk ${format(quota.secondary)}`,
	].join(separator);
}

class RouterStatusline {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly footerData: ReadonlyFooterDataProvider;
	private quota: QuotaState;
	private quotaTimer: ReturnType<typeof setInterval> | undefined;
	private clockTimer: ReturnType<typeof setTimeout> | undefined;
	private refreshing = false;
	private disposed = false;
	private routedCache: { key: string; value: PhysicalResponse | undefined } | undefined;
	private tierCache: { key: string; value: string | undefined } | undefined;
	private contextCache: { key: string; value: ContextUsage | undefined } | undefined;
	private hitRateCache: { key: string; value: number | undefined } | undefined;

	constructor(
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;

		const auth = readAuthSync();
		const codexEntry = auth["openai-codex"] ?? auth.openai;
		this.quota = {
			anthropic: { present: auth.anthropic !== undefined, ok: false },
			codex: { present: codexEntry !== undefined, ok: false },
		};

		this.scheduleClock();
		void this.refreshQuota();
		this.quotaTimer = setInterval(() => void this.refreshQuota(), QUOTA_REFRESH_MS);
		this.quotaTimer.unref?.();
	}

	invalidate(): void {
		// Every render reads live context and cached quota, so nothing is cached here.
	}

	dispose(): void {
		this.disposed = true;
		if (this.clockTimer !== undefined) clearTimeout(this.clockTimer);
		if (this.quotaTimer !== undefined) clearInterval(this.quotaTimer);
		this.clockTimer = undefined;
		this.quotaTimer = undefined;
	}

	private requestRender(): void {
		if (this.disposed) return;
		try {
			this.tui.requestRender();
		} catch {
			// A disposed TUI must never surface as an extension error.
		}
	}

	/** Repaint on the minute boundary so the clock is never a full interval stale. */
	private scheduleClock(): void {
		if (this.disposed) return;
		const delay = CLOCK_INTERVAL_MS - (Date.now() % CLOCK_INTERVAL_MS) + 25;
		this.clockTimer = setTimeout(() => {
			this.requestRender();
			this.scheduleClock();
		}, delay);
		this.clockTimer.unref?.();
	}

	private async refreshQuota(): Promise<void> {
		if (this.refreshing || this.disposed) return;
		this.refreshing = true;
		try {
			const auth = await readAuth();
			// A transient auth read failure keeps the last known quota state.
			if (auth === undefined || this.disposed) return;
			const codexEntry = auth["openai-codex"] ?? auth.openai;
			const [anthropic, codex] = await Promise.all([
				readAnthropicQuota(auth.anthropic),
				readCodexQuota(codexEntry),
			]);
			if (this.disposed) return;
			this.quota = { anthropic, codex };
			this.requestRender();
		} catch {
			// Quota is decoration: never let it fail a session.
		} finally {
			this.refreshing = false;
		}
	}

	/** The router's own record of the model it chose, when the state entry carries one. */
	private stateModel(selectedKey: string): PhysicalResponse | undefined {
		const manager = this.ctx.sessionManager;
		const selectedId = this.ctx.model?.id;
		const branch = manager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: string; customType?: string; data?: unknown };
			if (entry.type !== "custom" || entry.customType !== TIER_ENTRY) continue;
			const data = asRecord(entry.data);
			const modelId = typeof data?.modelId === "string" ? data.modelId : undefined;
			if (selectedId !== undefined && modelId !== undefined && modelId !== selectedId) continue;
			const model = asRecord(asRecord(data?.state)?.model);
			const id = typeof model?.id === "string" ? model.id : undefined;
			if (id === undefined) return undefined;
			const thinking = asRecord(data?.state)?.thinkingLevel;
			return { modelId: id, thinkingLevel: typeof thinking === "string" ? thinking : undefined };
		}
		return undefined;
	}

	/** The tier behind a router selection, when the profile has tiers. */
	private tier(selectedKey: string): string | undefined {
		const manager = this.ctx.sessionManager;
		const key = `${selectedKey}:${manager.getLeafId() ?? "none"}:${manager.getEntries().length}`;
		if (this.tierCache?.key === key) return this.tierCache.value;

		const selectedId = this.ctx.model?.id;
		let value: string | undefined;
		const branch = manager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: string; customType?: string; data?: unknown };
			if (entry.type !== "custom") continue;
			const data = asRecord(entry.data);
			if (!data) continue;
			if (entry.customType === TIER_ENTRY) {
				// A state entry names the virtual model it belongs to, so a stale one cannot leak.
				const modelId = typeof data.modelId === "string" ? data.modelId : undefined;
				if (selectedId !== undefined && modelId !== undefined && modelId !== selectedId) continue;
				const tier = asRecord(data.state)?.tier;
				if (typeof tier === "string" && tier.length > 0) value = tier;
				break;
			}
			if (entry.customType === DECISION_ENTRY) {
				const tier = data.tier;
				if (typeof tier === "string" && tier.length > 0) value = tier;
				break;
			}
		}
		this.tierCache = { key, value };
		return value;
	}

	/** Prefer the documented routedModel getter; otherwise derive it from the session branch. */
	private routedPhysical(selectedKey: string): PhysicalResponse | undefined {
		const exposed = (this.ctx.sessionManager as unknown as MaybeRoutedSession).routedModel;
		if (exposed?.model?.id) {
			return {
				modelId: exposed.model.id,
				thinkingLevel: exposed.thinkingLevel,
			};
		}
		return this.latestPhysicalResponse(selectedKey);
	}

	private latestPhysicalResponse(selectedKey: string): PhysicalResponse | undefined {
		const manager = this.ctx.sessionManager;
		const key = `${selectedKey}:${manager.getLeafId() ?? "none"}:${manager.getEntries().length}`;
		if (this.routedCache?.key === key) return this.routedCache.value;

		let value: PhysicalResponse | undefined;
		const branch = manager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "assistant") continue;
			if (message.stopReason === "error" || message.stopReason === "aborted") continue;
			value = {
				modelId: message.model,
				thinkingLevel: message.thinkingLevel,
			};
			break;
		}
		this.routedCache = { key, value };
		return value;
	}

	/** The projection behind getContextUsage() only changes with the leaf, entry count or model. */
	private contextUsage(): ContextUsage | undefined {
		const manager = this.ctx.sessionManager;
		const selected = this.ctx.model;
		const key = `${selected?.provider ?? ""}/${selected?.id ?? ""}:${manager.getLeafId() ?? "none"}:${manager.getEntries().length}`;
		if (this.contextCache?.key === key) return this.contextCache.value;
		const value = this.ctx.getContextUsage();
		this.contextCache = { key, value };
		return value;
	}

	/**
	 * Prompt-cache hit rate over the branch, using pi's own definition for its stats line:
	 * cache-read tokens over every prompt token (input + cache read + cache write). Undefined when the
	 * branch has no prompt tokens yet, or when no message ever reported cache activity, so providers
	 * that do not cache never render a meaningless 0%.
	 */
	private cacheHitRate(): number | undefined {
		const manager = this.ctx.sessionManager;
		const key = `${manager.getLeafId() ?? "none"}:${manager.getEntries().length}`;
		if (this.hitRateCache?.key === key) return this.hitRateCache.value;

		let read = 0;
		let prompt = 0;
		let reported = false;
		for (const entry of manager.getBranch()) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "assistant" || !message.usage) continue;
			const usage = message.usage;
			read += usage.cacheRead;
			prompt += usage.input + usage.cacheRead + usage.cacheWrite;
			if (usage.cacheRead + usage.cacheWrite > 0) reported = true;
		}

		const value = prompt > 0 && reported ? (read / prompt) * 100 : undefined;
		this.hitRateCache = { key, value };
		return value;
	}

	private segments(): string[] {
		const { ctx, theme, footerData } = this;
		const selected = ctx.model;
		const isRouter = selected?.provider === "router";
		const selectedKey = selected ? `${selected.provider}/${selected.id}` : "no-model";
		// The state entry names the model the route chose and is written when the decision lands, so it
		// leads; the last response only fills the gaps (its thinking level, or every field when the
		// profile writes no state).
		const chosen = isRouter ? this.stateModel(selectedKey) : undefined;
		const routed = isRouter ? this.routedPhysical(selectedKey) : undefined;

		const physicalId = isRouter ? (chosen?.modelId ?? routed?.modelId) : selected?.id;
		const physicalName = physicalId ? shortModelId(physicalId) : "—";
		const level = isRouter ? (chosen?.thinkingLevel ?? routed?.thinkingLevel) : ctx.thinkingLevel;

		// A tiered profile names the tier the route went to: `router/auto -> high: opus`.
		const tier = isRouter ? this.tier(selectedKey) : undefined;
		const tierSegment = tier === undefined ? "" : `${theme.fg("accent", tier)}${theme.fg("dim", ":")} `;

		const modelSegment = isRouter
			? `${theme.fg("dim", "🤖")} ${theme.fg("accent", selectedKey)} ${theme.fg("dim", "→")} ${tierSegment}${theme.fg("accent", physicalName)} ${theme.fg("dim", "🧠")} ${theme.fg("text", level ?? "—")}`
			: `${theme.fg("dim", "🤖")} ${theme.fg("accent", physicalName)} ${theme.fg("dim", "🧠")} ${theme.fg("text", level ?? "—")}`;

		const usage = this.contextUsage();
		const window =
			usage?.contextWindow && usage.contextWindow > 0
				? usage.contextWindow
				: !isRouter && selected?.contextWindow
					? selected.contextWindow
					: 0;
		const percent =
			usage?.percent === null || usage?.percent === undefined
				? "—%"
				: `${usage.percent.toFixed(1)}%`;
		const used = usage?.tokens === null || usage?.tokens === undefined ? "—" : formatTokens(usage.tokens);
		const windowText = window > 0 ? formatTokens(window) : "—";
		const branch = footerData.getGitBranch() ?? "no-git";

		const now = Date.now();
		const segments = [
			modelSegment,
			`${theme.fg("dim", "📁")} ${theme.fg("accent", branch)}`,
			`${theme.fg("dim", "🪟")} ${theme.fg("text", `${percent} ${used}/${windowText}`)}`,
		];
		const hitRate = this.cacheHitRate();
		if (hitRate !== undefined) {
			// The glyph is East-Asian-Neutral (pi-tui counts it as one column) but terminals usually draw
			// U+267B at two, so the extra space keeps the number from touching it.
			segments.push(`${theme.fg("dim", "♻ ")} ${theme.fg("text", `${hitRate.toFixed(1)}%`)}`);
		}
		const anthropic = quotaSegment("⚡", "claude", this.quota.anthropic, theme, now);
		if (anthropic) segments.push(anthropic);
		const codex = quotaSegment("🧠", "codex", this.quota.codex, theme, now);
		if (codex) segments.push(codex);
		// Extensions own the text, including its formatting. The map is live; setStatus()
		// requests a repaint and clearing a key deletes it, so nothing here is cached.
		for (const status of footerData.getExtensionStatuses().values()) {
			if (status.trim()) segments.push(status);
		}
		segments.push(`${theme.fg("dim", "🕒")} ${theme.fg("text", formatClock(now))}`);
		return segments;
	}

	render(width: number): string[] {
		try {
			// Reserve one column: writing exactly the terminal width can trigger the
			// terminal's own implicit wrap and produce a blank row.
			const available = Math.max(1, (Math.floor(width) || 1) - 1);
			const separator = this.theme.fg("dim", " · ");
			const rows: string[] = [];
			let row = "";
			for (const segment of this.segments()) {
				if (!row) {
					row = segment;
					continue;
				}
				const candidate = `${row}${separator}${segment}`;
				if (visibleWidth(candidate) <= available) {
					row = candidate;
				} else {
					rows.push(row);
					row = segment;
				}
			}
			if (row) rows.push(row);
			return rows.length > 0 ? rows : [""];
		} catch {
			return ["statusline unavailable"];
		}
	}
}

export default function routerStatusline(pi: ExtensionAPI): void {
	let footer: RouterStatusline | undefined;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		footer?.dispose();
		footer = undefined;
		try {
			ctx.ui.setFooter((tui, theme, footerData) => {
				const component = new RouterStatusline(ctx, tui, theme, footerData);
				footer = component;
				return component;
			});
		} catch {
			// Non-interactive or torn-down UI: leave pi's built-in footer alone.
		}
	};

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", () => {
		footer?.dispose();
		footer = undefined;
	});
}
