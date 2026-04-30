/**
 * pi-bionic-reading configuration.
 *
 * Loads from ~/.pi/bionic.jsonc (user-level) and <cwd>/.pi/bionic.jsonc
 * (project-level). Project values override user values.
 *
 * JSONC is parsed with the `jsonc-parser` library (MIT, no deps; the parser
 * Microsoft uses in VS Code) so // and block comments AND `,]` / `,}` trailing
 * commas are tolerated WITHOUT corrupting string literals that happen to
 * contain those byte sequences (e.g. OSC 8 hyperlinks in `prefixStyle.ansi`).
 */

import { readFile } from "node:fs/promises";
import { parse as parseJsoncLib } from "jsonc-parser";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KeyId } from "@mariozechner/pi-tui";
import { DEFAULT_OPTIONS, type Fixation } from "./bionic.js";
import { resolvePrefixStyle, type PrefixStyle } from "./prefix-style.js";

/**
 * Hotkey identifier (e.g. "ctrl+x", "ctrl+q", "f6"). Same string format pi
 * uses for keybindings; see `KeyId` in `@mariozechner/pi-tui`. Set to `null`
 * (or empty string) to disable the hotkey entirely.
 *
 * pi-tui only recognises `ctrl`, `shift`, and `alt` modifiers — there is no
 * `cmd`/`super`/`meta` token, and the Kitty-protocol parser explicitly
 * rejects those modifier bits. Cmd-based shortcuts cannot work in a TTY.
 */
export type BionicHotkey = KeyId | null;

/**
 * Coarse classification of the active pi theme. Custom themes are bucketed
 * by name match against `"light"` (anything else falls into `"dark"`),
 * mirroring `isLightTheme()` in `pi-coding-agent`.
 */
export type ThemeKind = "light" | "dark";

/**
 * Subset of `BionicReadingConfig` fields that may be overridden per theme.
 * `themes` and `themeKind` are intentionally excluded — a theme preset can
 * not declare further nested presets, and pinning the kind from inside a
 * preset would create a feedback loop.
 */
export type ThemePreset = Partial<
	Omit<BionicReadingConfig, "themes" | "themeKind">
>;

export interface BionicReadingConfig {
	/** Master switch. When false, the patch is installed but no-ops. */
	enabled: boolean;
	/** Fixation strength: 1 (heaviest) … 5 (lightest). */
	fixation: Fixation;
	/** Skip words shorter than this. */
	minWordLength: number;
	/** Bold every Nth word: 1 = every word, 2 = alternate, etc. */
	saccade: number;
	/** Skip heading lines (so `# Foo Bar` is left untouched). */
	skipHeadings: boolean;
	/**
	 * Split hyphenated tokens (`react-router-dom`) into per-segment sub-words.
	 * Default false to preserve English compounds like `well-known`.
	 */
	splitHyphenated: boolean;
	/**
	 * Invert the fixation cue: bold the SUFFIX of each sub-word instead of
	 * the prefix. Default false. Toggleable live via `/bionic invert`.
	 */
	invert: boolean;
	/**
	 * ANSI styling for the bionic prefix. When unset, the host's `theme.bold`
	 * is used as today. See SPEC § S4 / `prefix-style.ts` for accepted forms.
	 */
	prefixStyle?: PrefixStyle;
	/**
	 * Hotkey to toggle bionic mode on/off. Defaults to `"ctrl+x"`.
	 * Set to `null` or `""` to disable.
	 */
	hotkey: BionicHotkey;
	/**
	 * Pin the theme kind used to pick a preset from `themes`. When omitted
	 * or set to `"auto"`, the kind is inferred from pi's configured theme
	 * (project then global `settings.json`), with `COLORFGBG` and `"dark"`
	 * as final fallbacks. Set to `"light"` or `"dark"` to bypass detection.
	 */
	themeKind?: "auto" | ThemeKind;
	/**
	 * Per-theme presets applied as a final layer on top of the merged base
	 * config (defaults < user < project). The preset matching the resolved
	 * theme kind wins for every key it sets; keys it omits keep the base
	 * value. Replacement is **shallow** — `prefixStyle` is replaced as a
	 * whole object, not deep-merged.
	 */
	themes?: {
		light?: ThemePreset;
		dark?: ThemePreset;
	};
}

export const CONFIG_DEFAULTS: BionicReadingConfig = {
	...DEFAULT_OPTIONS,
	enabled: true,
	skipHeadings: false,
	hotkey: "ctrl+x",
};

/** Strip JSONC comments and trailing commas, returning a parsed value. */
function parseJsonc<T>(text: string): T {
	return parseJsoncLib(text, undefined, { allowTrailingComma: true }) as T;
}

async function tryLoad(path: string): Promise<Partial<BionicReadingConfig>> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsonc<Partial<BionicReadingConfig>>(raw);
	} catch {
		return {};
	}
}

/**
 * Source of the resolved theme kind. Surfaced by {@link resolveActiveTheme}
 * so callers can log or test which layer won the resolution chain.
 */
export type ThemeResolutionSource =
	| "manual"
	| "project-settings"
	| "global-settings"
	| "colorfgbg"
	| "default";

export interface ResolvedTheme {
	/** Pi theme name as configured, or undefined if none was found. */
	name: string | undefined;
	/** Coarse `light` / `dark` classification used for preset selection. */
	kind: ThemeKind;
	/** Layer that decided the kind. Useful for debugging the chain. */
	source: ThemeResolutionSource;
}

/** Pi's own settings.json layout — only the field we care about here. */
interface PiSettingsShape {
	theme?: string;
}

async function tryLoadJson<T>(path: string): Promise<T | undefined> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsoncLib(raw, undefined, {
			allowTrailingComma: true,
		}) as T;
	} catch {
		return undefined;
	}
}

/**
 * Resolve pi's agent directory the same way `pi-coding-agent` does:
 * `$PI_CODING_AGENT_DIR` if set (with `~`/`~/` expansion), else
 * `~/.pi/agent`. Kept private to avoid exporting an unstable surface.
 */
function getPiAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(homedir(), ".pi", "agent");
}

/**
 * Map a raw theme name to a {@link ThemeKind}. Mirrors the host's
 * `isLightTheme()` (literally a name match against `"light"`); every
 * other name — including custom themes — buckets to `"dark"`.
 */
function classifyThemeName(name: string | undefined): ThemeKind | undefined {
	if (name === undefined) return undefined;
	return name === "light" ? "light" : "dark";
}

/**
 * Heuristic fallback: parse the `COLORFGBG` env var (set by some terminals
 * — notably rxvt and recent xterms — to `fg;bg` ANSI palette indices). Pi
 * uses the same trick in `detectTerminalBackground()`.
 */
function classifyFromColorFgBg(
	colorfgbg: string | undefined,
): ThemeKind | undefined {
	if (!colorfgbg) return undefined;
	const parts = colorfgbg.split(";");
	if (parts.length < 2) return undefined;
	const bg = Number.parseInt(parts[1], 10);
	if (Number.isNaN(bg)) return undefined;
	return bg < 8 ? "dark" : "light";
}

/**
 * Walk the resolution chain and report the active theme kind. Pure save
 * for two file reads (`<cwd>/.pi/settings.json`, `<agentDir>/settings.json`)
 * and one env var.
 *
 * Order:
 *   1. `themeKind` set to `"light"` / `"dark"` (manual pin)
 *   2. project `settings.json` `theme` field
 *   3. global `settings.json` `theme` field
 *   4. `COLORFGBG` heuristic
 *   5. `"dark"` (matches pi's hard-coded fallback)
 */
export async function resolveActiveTheme(
	cwd: string,
	manualKind?: "auto" | ThemeKind,
): Promise<ResolvedTheme> {
	if (manualKind === "light" || manualKind === "dark") {
		return { name: undefined, kind: manualKind, source: "manual" };
	}

	const projectSettings = await tryLoadJson<PiSettingsShape>(
		join(cwd, ".pi", "settings.json"),
	);
	const projectKind = classifyThemeName(projectSettings?.theme);
	if (projectKind) {
		return {
			name: projectSettings?.theme,
			kind: projectKind,
			source: "project-settings",
		};
	}

	const globalSettings = await tryLoadJson<PiSettingsShape>(
		join(getPiAgentDir(), "settings.json"),
	);
	const globalKind = classifyThemeName(globalSettings?.theme);
	if (globalKind) {
		return {
			name: globalSettings?.theme,
			kind: globalKind,
			source: "global-settings",
		};
	}

	const envKind = classifyFromColorFgBg(process.env.COLORFGBG);
	if (envKind) {
		return { name: undefined, kind: envKind, source: "colorfgbg" };
	}

	return { name: undefined, kind: "dark", source: "default" };
}

/**
 * Apply the matching theme preset on top of an already-merged config.
 * Exported for testability — `loadBionicConfig` is the public entry point
 * that wires this together with the file-system layers.
 *
 * Replacement is shallow: a preset that sets `prefixStyle` replaces the
 * whole object. This is the same semantics as the user / project layer
 * merge, kept consistent on purpose.
 */
export function applyThemePreset(
	base: BionicReadingConfig,
	kind: ThemeKind,
): BionicReadingConfig {
	const preset = base.themes?.[kind];
	if (!preset) return base;
	return { ...base, ...preset };
}

/**
 * Result of a live theme-name evaluation. `null` means "no flip" — either
 * the manual `themeKind` pin forbids reacting to live changes, or no live
 * name is available yet.
 */
export interface LiveThemeFlip {
	/** Newly resolved theme kind. */
	kind: ThemeKind;
	/** `baseConfig` with the matching preset layered on top. */
	config: BionicReadingConfig;
	/** Re-resolved prefix-style wrapper (or `null` to fall through). */
	prefixWrap: ((text: string) => string) | null;
	/** prefix-style validation warnings, one per malformed field. */
	prefixWarnings: string[];
}

/**
 * Compute the next `(kind, config, prefixWrap)` triple from a live theme
 * name, honoring a manual `themeKind` pin. Pure — no I/O, no mutation.
 *
 * Returns `null` when:
 *   - `baseConfig.themeKind` is `"light"` or `"dark"` (manual pin wins;
 *     live changes are inert), OR
 *   - `liveName` is `undefined` (no live signal to react to).
 *
 * The caller is responsible for the "did the kind actually change" check.
 * Splitting that out lets the caller keep its own `state.resolvedThemeKind`
 * memo and avoid pointless re-derivations when the live name flutters.
 */
export function applyLiveThemeName(
	baseConfig: BionicReadingConfig,
	liveName: string | undefined,
): LiveThemeFlip | null {
	if (
		baseConfig.themeKind === "light" ||
		baseConfig.themeKind === "dark"
	) {
		return null;
	}
	if (liveName === undefined) return null;
	const kind: ThemeKind = liveName === "light" ? "light" : "dark";
	const config = applyThemePreset(baseConfig, kind);
	const prefix = resolvePrefixStyle(config.prefixStyle);
	return {
		kind,
		config,
		prefixWrap: prefix.wrap,
		prefixWarnings: prefix.warnings,
	};
}

/**
 * Options for {@link loadBionicConfig}.
 */
export interface LoadBionicConfigOptions {
	/**
	 * When `true`, return the merged base config (defaults < user < project)
	 * **without** applying a theme preset. Callers that need to react to
	 * live theme changes (`index.ts`'s `patchedRender`) keep the unlayered
	 * config so they can re-derive on flip via {@link applyThemePreset}.
	 */
	skipThemePreset?: boolean;
}

export async function loadBionicConfig(
	cwd: string,
	options: LoadBionicConfigOptions = {},
): Promise<BionicReadingConfig> {
	const user = await tryLoad(join(homedir(), ".pi", "bionic.jsonc"));
	const project = await tryLoad(join(cwd, ".pi", "bionic.jsonc"));
	const merged: BionicReadingConfig = {
		...CONFIG_DEFAULTS,
		...user,
		...project,
	};
	if (options.skipThemePreset) return merged;
	const resolved = await resolveActiveTheme(cwd, merged.themeKind);
	return applyThemePreset(merged, resolved.kind);
}
