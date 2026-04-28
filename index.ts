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
} from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";
import { type Fixation } from "./bionic.js";
import { type BionicReadingConfig, loadBionicConfig } from "./config.js";
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
}

type PatchableMarkdown = {
	text: string;
	cachedText?: string;
	cachedLines?: string[];
	cachedWidth?: number;
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

	const state: PatchState = {
		originalRender: Markdown.prototype.render as PatchState["originalRender"],
		cache: new WeakMap(),
		config,
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

			// Reuse the transformed text if only width changed.
			const transformed =
				cached && cached.sourceText === source
					? cached.transformedText
					: bionicifyMarkdown(source, state.config);

			// Swap text, blow away the original instance cache, render, swap back.
			const originalText = this.text;
			this.text = transformed;
			this.cachedText = undefined;
			this.cachedLines = undefined;
			this.cachedWidth = undefined;

			let lines: string[];
			try {
				lines = originalRender.call(this, width);
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

	const statusMessage = (cfg: PatchState["config"]): string =>
		cfg.enabled
			? `[bionic] enabled (fixation ${cfg.fixation})`
			: `[bionic] disabled`;

	// /bionic — toggle, set state, set fixation.
	api.registerCommand("bionic", {
		description:
			"Bionic reading: /bionic [on|off|toggle|1..5]",
		handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
			const arg = rawArgs.trim().toLowerCase();

			if (arg === "" || arg === "toggle") {
				state.config.enabled = !state.config.enabled;
			} else if (arg === "on" || arg === "true") {
				state.config.enabled = true;
			} else if (arg === "off" || arg === "false") {
				state.config.enabled = false;
			} else if (/^[1-5]$/.test(arg)) {
				state.config.enabled = true;
				state.config.fixation = parseInt(arg, 10) as Fixation;
			} else {
				ctx.ui.notify(
					`[bionic] usage: /bionic [on|off|toggle|1..5]`,
					"warning",
				);
				return;
			}

			// Invalidate every cached transform so the change takes effect now.
			state.cache = new WeakMap();
			ctx.ui.notify(statusMessage(state.config), "info");
		},
	});

	api.on("session_shutdown", () => {
		(Markdown.prototype as unknown as { render: unknown }).render =
			state.originalRender;
		g[INSTANCE_KEY] = undefined;
	});
}
