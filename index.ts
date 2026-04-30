/**
 * pi-bionic-reading — entry point.
 *
 * Monkey-patches `Markdown.prototype.render` from `@mariozechner/pi-tui` so
 * that, when enabled, every Markdown component renders with the bionic
 * transform applied to its source text. The original message text in
 * `this.text` is left unmodified, which means:
 *
 *   - The transform is display-only.
 *   - The LLM never sees `**…**` artefacts in subsequent turn context.
 *   - Toggling on/off is a no-op for stored conversation state.
 *
 * Caching strategy
 * ----------------
 * The Markdown component normally caches its rendered lines keyed by `text`
 * and `width`. We can't reuse that cache directly because we need to render
 * with `transformedText` while reporting `sourceText` to outside callers. So
 * we maintain our own per-instance WeakMap cache and invalidate the
 * underlying instance cache on every call (`this.cachedText = undefined` …)
 * to prevent stale state across enable/disable transitions.
 *
 * Idempotency
 * -----------
 * The patch is installed once per process and stored on `globalThis` under
 * INSTANCE_KEY. If the extension reloads (e.g. via `pi extension reload`),
 * we restore the original `render` first and re-patch with fresh state.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";
import { type Fixation } from "./bionic.js";
import { type BionicReadingConfig, loadBionicConfig } from "./config.js";
import {
	applyClearStyle,
	applyToggleStyle,
	decideStyleApplication,
	resolvePrefixStyle,
	withPrefixStyleOverride,
} from "./prefix-style.js";
import { parseBionicCommand } from "./commands.js";
import { bionicifyMarkdown } from "./transform.js";

const INSTANCE_KEY = "__pi_bionic_reading_active__";

interface CacheEntry {
	sourceText: string;
	transformedText: string;
	lines: string[];
	width: number;
}

interface PatchState {
	originalRender: (this: unknown, width: number) => string[];
	cache: WeakMap<object, CacheEntry>;
	config: BionicReadingConfig;
	/**
	 * Resolved prefix-style wrapper, or null when the user hasn't configured
	 * one (fall through to the host theme). Re-resolved lazily on each render
	 * to pick up `prefixStyle` mutations from future slash commands (S5).
	 */
	prefixWrap: ((text: string) => string) | null;
}

type PatchableMarkdown = {
	text: string;
	cachedText?: string;
	cachedLines?: string[];
	cachedWidth?: number;
	/** pi-tui's `Markdown` declares this private; we mutate it for S4. */
	theme?: { bold: (text: string) => string };
};

export default async function bionicReading(api: ExtensionAPI): Promise<void> {
	const g = globalThis as Record<string, unknown>;

	// Restore previous patch (idempotent reload).
	const prev = g[INSTANCE_KEY] as PatchState | undefined;
	if (prev) {
		(Markdown.prototype as unknown as { render: unknown }).render =
			prev.originalRender;
	}

	const config = await loadBionicConfig(process.cwd());

	// S4-AC5: resolve prefixStyle at load and surface validation warnings.
	const resolved = resolvePrefixStyle(config.prefixStyle);
	for (const w of resolved.warnings) console.warn(w);

	const state: PatchState = {
		originalRender: Markdown.prototype.render as PatchState["originalRender"],
		cache: new WeakMap(),
		config,
		prefixWrap: resolved.wrap,
	};
	g[INSTANCE_KEY] = state;

	const originalRender = state.originalRender;

	(Markdown.prototype as unknown as { render: (width: number) => string[] }).render =
		function patchedRender(this: PatchableMarkdown, width: number): string[] {
			if (!state.config.enabled) {
				return originalRender.call(this, width);
			}

			const source = this.text ?? "";

			// WeakMap cache hit?
			const cached = state.cache.get(this);
			if (
				cached &&
				cached.sourceText === source &&
				cached.width === width
			) {
				return cached.lines;
			}

			// Swap text, blow away the original instance cache, render, swap back.
			// All mutations live inside the try so the finally cleanup is the single
			// source of restoration even if bionicifyMarkdown or any cache-reset assignment
			// throws (defensive — bionicifyMarkdown is pure regex work today, but the
			// guarantee is by construction, not by type).
			const originalText = this.text;
			let transformed: string;
			let lines: string[];
			try {
				// Reuse the transformed text if only width changed.
				transformed =
					cached && cached.sourceText === source
						? cached.transformedText
						: bionicifyMarkdown(source, state.config);

				this.text = transformed;
				this.cachedText = undefined;
				this.cachedLines = undefined;
				this.cachedWidth = undefined;

				// S4: when prefixWrap is non-null, swap `theme.bold` for the duration
				// of this render so every `**…**` (including bionic prefixes) renders
				// with the user's configured ANSI style. The override is restored
				// even on throw (S4-AC4).
				lines = withPrefixStyleOverride(
					this.theme ?? { bold: (t: string) => t },
					state.prefixWrap,
					() => originalRender.call(this, width),
				);
			} finally {
				this.text = originalText;
				// Don't leave the underlying cache holding the transformed value —
				// it would be stale if bionic is later disabled mid-session.
				this.cachedText = undefined;
				this.cachedLines = undefined;
				this.cachedWidth = undefined;
			}

			state.cache.set(this, {
				sourceText: source,
				transformedText: transformed,
				lines,
				width,
			});

			return lines;
		};

	const statusMessage = (cfg: PatchState["config"]): string => {
		const base = cfg.enabled
			? `[bionic] enabled (fixation ${cfg.fixation})`
			: `[bionic] disabled`;
		// Suffix with the active hotkey so users see what binding to press next.
		// Suppressed when no hotkey is configured to avoid `· ` dangling suffix.
		return cfg.hotkey ? `${base} · ${cfg.hotkey}` : base;
	};

	// Toggle bionic on/off and notify. Shared between the /bionic command and
	// the configurable hotkey so they stay behaviourally identical.
	const toggleBionic = (ctx: ExtensionContext): void => {
		state.config.enabled = !state.config.enabled;
		state.cache = new WeakMap();
		ctx.ui.notify(statusMessage(state.config), "info");
	};

	// S5/S7: apply a new prefixStyle in-memory. Returns true on apply, false on
	// reject. Rejection happens iff `decideStyleApplication` reports any
	// warnings (S7-AC1) — partial validation success is treated as failure so
	// the user's previous good style survives a typo (S7-AC4). Warnings are
	// surfaced as toasts (S7-AC2). The caller short-circuits the cache+info
	// tail when this returns false (S7-AC3). No persistence to bionic.jsonc
	// (S5-AC6).
	const applyPrefixStyle = (
		next: NonNullable<typeof state.config.prefixStyle>,
		ctx: ExtensionContext,
	): boolean => {
		const decision = decideStyleApplication(next);
		for (const w of decision.warnings) ctx.ui.notify(w, "warning");
		if (!decision.apply) return false;
		state.config.prefixStyle = next;
		state.prefixWrap = decision.wrap;
		return true;
	};

	// /bionic — dispatch over the parser in `commands.ts` (S5).
	api.registerCommand("bionic", {
		description:
			"Bionic reading: /bionic [on|off|toggle|1..5|color <value>|style <tokens>]",
		handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
			const cmd = parseBionicCommand(rawArgs);

			switch (cmd.kind) {
				case "toggle":
					toggleBionic(ctx);
					return;

				case "set-enabled":
					state.config.enabled = cmd.value;
					break;

				case "set-fixation":
					// Setting fixation also enables, matching pre-S5 behavior (S5-AC5).
					state.config.enabled = true;
					state.config.fixation = cmd.value;
					break;

				case "set-color": {
					const next = { ...(state.config.prefixStyle ?? {}), color: cmd.value };
					// S7-AC3: bail before cache+info toast on rejection so the
					// rejected command is a no-op from the user's perspective.
					if (!applyPrefixStyle(next, ctx)) return;
					break;
				}

				case "toggle-style": {
					const current = state.config.prefixStyle ?? {};
					if (!applyPrefixStyle(applyToggleStyle(current, cmd.fields), ctx)) return;
					break;
				}

				case "clear-style": {
					const current = state.config.prefixStyle ?? {};
					if (!applyPrefixStyle(applyClearStyle(current), ctx)) return;
					break;
				}

				case "usage":
					ctx.ui.notify(cmd.message, "warning");
					return;
			}

			// Invalidate every cached transform so the change takes effect now.
			state.cache = new WeakMap();
			ctx.ui.notify(statusMessage(state.config), "info");
		},
	});

	// Configurable hotkey: same effect as `/bionic` (toggle on/off).
	// Built-in shortcut conflicts are reported by the runner and the binding is
	// skipped — we don't need to filter here.
	const hotkey = state.config.hotkey;
	if (hotkey) {
		api.registerShortcut(hotkey, {
			description: "Toggle bionic reading",
			handler: (ctx) => toggleBionic(ctx),
		});
	}

	api.on("session_shutdown", () => {
		(Markdown.prototype as unknown as { render: unknown }).render =
			state.originalRender;
		g[INSTANCE_KEY] = undefined;
	});
}
