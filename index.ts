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
import {
	applyLiveThemeName,
	applyThemePreset,
	type BionicReadingConfig,
	loadBionicConfig,
	resolveActiveTheme,
	type ThemeKind,
} from "./config.js";
import {
	applyClearColor,
	applyClearStyle,
	applyToggleStyle,
	decideStyleApplication,
	resolvePrefixStyle,
	withPrefixStyleOverride,
} from "./prefix-style.js";
import { augmentValidationWarning, parseBionicCommand } from "./commands.js";
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
	/**
	 * Active config = `baseConfig` with the matching theme preset layered
	 * on top. Mutated by live `/bionic` commands (S5). Re-derived from
	 * `baseConfig` whenever the resolved theme kind flips.
	 */
	config: BionicReadingConfig;
	/**
	 * File-loaded config before any preset layering. Source of truth for
	 * `applyThemePreset` so a theme flip can re-derive `config` cleanly
	 * without leaking the previous preset's settings.
	 */
	baseConfig: BionicReadingConfig;
	/**
	 * Last resolved theme kind. Compared against the live `ctx.ui.theme.name`
	 * on every render; a mismatch triggers preset re-layering.
	 */
	resolvedThemeKind: ThemeKind;
	/**
	 * Captured at `session_start`. Lets `patchedRender` consult
	 * `ctx.ui.theme.name` for live theme detection. Undefined before the
	 * first session_start, in print/RPC mode, and after session_shutdown.
	 */
	ctx?: ExtensionContext;
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

	// Load the file layer (defaults < user < project) without any preset
	// layering yet — we keep the unlayered config as `baseConfig` so theme
	// flips can re-derive cleanly.
	const baseConfig = await loadBionicConfig(process.cwd(), {
		skipThemePreset: true,
	});
	const initialTheme = await resolveActiveTheme(
		process.cwd(),
		baseConfig.themeKind,
	);
	const config = applyThemePreset(baseConfig, initialTheme.kind);

	// S4-AC5: resolve prefixStyle at load and surface validation warnings.
	const resolved = resolvePrefixStyle(config.prefixStyle);
	for (const w of resolved.warnings) console.warn(w);

	const state: PatchState = {
		originalRender: Markdown.prototype.render as PatchState["originalRender"],
		cache: new WeakMap(),
		config,
		baseConfig,
		resolvedThemeKind: initialTheme.kind,
		prefixWrap: resolved.wrap,
	};
	g[INSTANCE_KEY] = state;

	/**
	 * Reconcile the active config with the live theme reported by
	 * `ctx.ui.theme.name`. Cheap fast path when the kind hasn't moved —
	 * just a property read + one strict-equality compare. The actual flip
	 * logic (pin honoring, preset layering, prefix-style re-resolution)
	 * lives in `applyLiveThemeName` so it can be unit-tested without
	 * standing up the whole extension factory + render patch.
	 *
	 * Surfaces prefix-style warnings as `ctx.ui.notify` toasts when a
	 * context is available, matching the existing `applyPrefixStyle` path
	 * for slash-command warnings. Falls back to `console.warn` when the
	 * reconcile fires before `session_start` (no ctx yet) so warnings are
	 * never silently dropped.
	 *
	 * Live `/bionic color` / `/bionic style` mutations to `state.config`
	 * are intentionally clobbered on flip — they're session-only by design
	 * (S5-AC6) and the user's expectation is that the per-theme preset is
	 * what each theme "looks like" until they save the tweak to bionic.jsonc.
	 */
	const reconcileThemeKind = (): void => {
		const liveName = state.ctx?.ui?.theme?.name;
		const next = applyLiveThemeName(state.baseConfig, liveName);
		if (!next || next.kind === state.resolvedThemeKind) return;
		state.resolvedThemeKind = next.kind;
		state.config = next.config;
		state.prefixWrap = next.prefixWrap;
		state.cache = new WeakMap();
		for (const w of next.prefixWarnings) {
			if (state.ctx) state.ctx.ui.notify(w, "warning");
			else console.warn(w);
		}
	};

	const originalRender = state.originalRender;

	(Markdown.prototype as unknown as { render: (width: number) => string[] }).render =
		function patchedRender(this: PatchableMarkdown, width: number): string[] {
			// Live theme reconciliation. No-op fast path when the kind hasn't
			// moved; on flip it rebuilds `state.config` / `state.prefixWrap`
			// and clears the cache so prior renders re-bionicify.
			reconcileThemeKind();

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
		// Surface invert mode in the toggle toast so users have feedback that
		// `/bionic invert` actually flipped state. Slotted between base and
		// hotkey so the hotkey hint stays the rightmost dot-separated suffix.
		const withInvert = cfg.invert ? `${base} · inverted` : base;
		// Suffix with the active hotkey so users see what binding to press next.
		// Suppressed when no hotkey is configured to avoid `· ` dangling suffix.
		return cfg.hotkey ? `${withInvert} · ${cfg.hotkey}` : withInvert;
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
		// Run each warning through `augmentValidationWarning` so toasts that
		// reject a value (e.g. `/bionic color off`) advertise the accepted forms,
		// including the `none` clear-sentinel. Config-load warnings emitted by
		// `resolvePrefixStyle` directly bypass this on purpose — see the helper's
		// docstring in commands.ts.
		for (const w of decision.warnings) {
			ctx.ui.notify(augmentValidationWarning(w), "warning");
		}
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

				case "clear-color": {
					// `/bionic color none` — drop the color override, leave the
					// rest of the style intact. When nothing else is set the
					// renderer falls through to the host's `theme.bold`.
					const current = state.config.prefixStyle ?? {};
					if (!applyPrefixStyle(applyClearColor(current), ctx)) return;
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

				case "toggle-invert": {
					// Prototype: flip suffix-bolding mode. No persistence to
					// bionic.jsonc — mirrors S5-AC6 (slash commands are session-only).
					state.config.invert = !state.config.invert;
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

	// Capture the ExtensionContext so `reconcileThemeKind` can read the live
	// `ctx.ui.theme.name` from inside the render patch (which doesn't get a
	// ctx of its own — it runs inside pi-tui internals). Reconcile once at
	// session_start too, in case the theme already moved between extension
	// load and the first session: e.g. the-themer's own `session_start` may
	// have called `setTheme()` before our render patch fires.
	api.on("session_start", (_event, ctx) => {
		state.ctx = ctx;
		reconcileThemeKind();
	});

	api.on("session_shutdown", () => {
		state.ctx = undefined;
		(Markdown.prototype as unknown as { render: unknown }).render =
			state.originalRender;
		g[INSTANCE_KEY] = undefined;
	});
}
