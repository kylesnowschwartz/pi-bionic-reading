/**
 * Configurable ANSI styling for the bionic prefix.
 *
 * Pure module — no I/O side effects, no exceptions thrown. The Markdown
 * renderer integration lives in `index.ts`; this file is responsible only
 * for parsing the `prefixStyle` config and producing a text-wrapping
 * function (or `null` to fall through to the host theme).
 *
 * See `.agent-history/SPEC.md` § S4 for the contract.
 */

export interface PrefixStyle {
	/** Foreground color: named, `#rrggbb`, `256:N`, or `rgb:R,G,B`. */
	color?: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	dim?: boolean;
	/**
	 * Raw escape-sequence prefix. When set, structured fields are ignored
	 * (S4-AC2) and the close is always `\u001b[0m` (S4-AC7).
	 */
	ansi?: string;
}

export interface ResolvedPrefixStyle {
	/** Text-wrapping function, or null when the caller should fall through. */
	wrap: ((text: string) => string) | null;
	/** Human-readable warnings (e.g. invalid color value). Caller logs them. */
	warnings: string[];
}

/** Universal SGR reset. All wrappers close with this (S4-AC7). */
const RESET = "\u001b[0m";

/** Standard + bright ANSI named colors → SGR codes (S4-AC8). */
const NAMED_COLORS: Readonly<Record<string, number>> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	brightBlack: 90,
	gray: 90, // alias
	brightRed: 91,
	brightGreen: 92,
	brightYellow: 93,
	brightBlue: 94,
	brightMagenta: 95,
	brightCyan: 96,
	brightWhite: 97,
};

interface ParsedColor {
	codes: string | null;
	warning?: string;
}

/**
 * Parse a color string into one SGR sub-sequence.
 * Returns `{ codes: null, warning }` when the value is unrecognized so the
 * caller can decide whether to fall through or include other styles.
 */
function parseColor(value: string): ParsedColor {
	if (Object.hasOwn(NAMED_COLORS, value)) {
		return { codes: String(NAMED_COLORS[value]) };
	}
	if (value.startsWith("256:")) {
		const n = Number(value.slice(4));
		if (Number.isInteger(n) && n >= 0 && n <= 255) {
			return { codes: `38;5;${n}` };
		}
		return {
			codes: null,
			warning: `[bionic] prefixStyle.color: invalid 256-color value "${value}" (expected 256:0..256:255)`,
		};
	}
	if (value.startsWith("#")) {
		const m = /^#([0-9a-fA-F]{6})$/.exec(value);
		if (m) {
			const r = parseInt(m[1].slice(0, 2), 16);
			const g = parseInt(m[1].slice(2, 4), 16);
			const b = parseInt(m[1].slice(4, 6), 16);
			return { codes: `38;2;${r};${g};${b}` };
		}
		return {
			codes: null,
			warning: `[bionic] prefixStyle.color: invalid hex color "${value}" (expected #rrggbb)`,
		};
	}
	if (value.startsWith("rgb:")) {
		const parts = value.slice(4).split(",");
		if (parts.length !== 3) {
			return {
				codes: null,
				warning: `[bionic] prefixStyle.color: invalid rgb form "${value}" (expected rgb:R,G,B)`,
			};
		}
		const nums = parts.map((p) => Number(p));
		if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
			return {
				codes: null,
				warning: `[bionic] prefixStyle.color: invalid rgb component in "${value}" (each must be 0..255)`,
			};
		}
		return { codes: `38;2;${nums.join(";")}` };
	}
	return {
		codes: null,
		warning: `[bionic] prefixStyle.color: unrecognized color "${value}"`,
	};
}

/**
 * Resolve a `prefixStyle` config into a text-wrapping function.
 *
 * - Returns `{ wrap: null, warnings: [] }` when the input is unset/empty
 *   (S4-AC3) — caller falls through to the host's `theme.bold`.
 * - Returns `{ wrap: null, warnings: [...] }` when no usable style is
 *   present after validation (S4-AC5).
 * - When `ansi` is set, that escape sequence is used verbatim and structured
 *   fields are ignored (S4-AC2).
 * - The close is always `\u001b[0m` (S4-AC7).
 *
 * Pure function: no I/O, never throws (S4-AC6).
 */
export function resolvePrefixStyle(
	style: PrefixStyle | undefined,
): ResolvedPrefixStyle {
	if (!style) return { wrap: null, warnings: [] };

	// S4-AC2: raw ansi escape hatch wins, structured fields ignored.
	if (style.ansi) {
		const open = style.ansi;
		return {
			wrap: (text: string) => `${open}${text}${RESET}`,
			warnings: [],
		};
	}

	const codes: string[] = [];
	const warnings: string[] = [];

	if (style.color) {
		const parsed = parseColor(style.color);
		if (parsed.warning) warnings.push(parsed.warning);
		if (parsed.codes !== null) codes.push(parsed.codes);
	}

	// SGR attributes — pushed in canonical numeric order so output is stable.
	if (style.bold) codes.push("1");
	if (style.dim) codes.push("2");
	if (style.italic) codes.push("3");
	if (style.underline) codes.push("4");

	if (codes.length === 0) {
		return { wrap: null, warnings };
	}

	const open = `\u001b[${codes.join(";")}m`;
	return {
		wrap: (text: string) => `${open}${text}${RESET}`,
		warnings,
	};
}

/**
 * Apply a prefix-style override to `theme.bold` for the duration of `render`,
 * then restore the original — even when `render` throws.
 *
 * When `wrap` is `null`, this is a transparent pass-through (S4-AC3).
 *
 * The restore is in a `finally` block so exceptions during render do not
 * leak the override into subsequent renders (S4-AC4).
 */
export function withPrefixStyleOverride<T>(
	theme: { bold: (text: string) => string },
	wrap: ((text: string) => string) | null,
	render: () => T,
): T {
	if (!wrap) return render();
	const original = theme.bold;
	theme.bold = wrap;
	try {
		return render();
	} finally {
		theme.bold = original;
	}
}

/** Decoration fields togglable via `/bionic style <token>`. */
export type StyleField = "bold" | "dim" | "italic" | "underline";

/**
 * Toggle each named field of `current` (treating `undefined` as `false`).
 * Pure: returns a new object, never mutates the input. Caller is responsible
 * for deduplicating `fields` if it cares about cancellation semantics.
 *
 * See SPEC § S6-AC1 / AC2 / AC5.
 */
export function applyToggleStyle(
	current: PrefixStyle,
	fields: readonly StyleField[],
): PrefixStyle {
	const next: PrefixStyle = { ...current };
	for (const f of fields) {
		next[f] = !next[f];
	}
	return next;
}

/**
 * Set every decoration field to `false` regardless of current value.
 * Color and ansi survive. See SPEC § S6-AC4.
 */
export function applyClearStyle(current: PrefixStyle): PrefixStyle {
	return {
		...current,
		bold: false,
		dim: false,
		italic: false,
		underline: false,
	};
}

/**
 * Decision returned by `decideStyleApplication`. Callers MUST gate on
 * `apply` before reading `wrap`; the wrap value when `apply` is false
 * reflects whatever survived partial validation and is intentionally
 * ignored to preserve the caller's previous good state.
 */
export interface StyleApplicationDecision {
	apply: boolean;
	warnings: string[];
	wrap: ((text: string) => string) | null;
}

/**
 * Strict validation gate for `applyPrefixStyle` (S7-AC1).
 *
 * Wraps `resolvePrefixStyle` and applies the rule: a non-empty `warnings`
 * array means the user's input was partially or fully invalid. Reject the
 * whole change rather than silently keep the bits that happened to validate —
 * partial-success-with-dropped-fields is the bug this guards against.
 *
 * Pure: no I/O, never throws.
 */
export function decideStyleApplication(
	next: PrefixStyle,
): StyleApplicationDecision {
	const resolved = resolvePrefixStyle(next);
	return {
		apply: resolved.warnings.length === 0,
		warnings: resolved.warnings,
		wrap: resolved.wrap,
	};
}
