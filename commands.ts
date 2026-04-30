/**
 * Slash-command parsing for `/bionic ...`.
 *
 * Pure function: takes the raw arg string (everything after `/bionic `)
 * and returns an action descriptor. The dispatcher in `index.ts` is a thin
 * switch over the result — keeping the parsing here makes it unit-testable
 * without ExtensionCommandContext mocks.
 *
 * See `.agent-history/SPEC.md` § S5.
 */

import type { Fixation } from "./bionic.js";

import { NAMED_COLORS, type StyleField } from "./prefix-style.js";

export type BionicCommand =
	| { kind: "toggle" }
	| { kind: "set-enabled"; value: boolean }
	| { kind: "set-fixation"; value: Fixation }
	| { kind: "set-color"; value: string }
	/** Toggle each named field; dispatcher consults state (S6-AC5). */
	| { kind: "toggle-style"; fields: StyleField[] }
	/** Clear all four decoration booleans (`/bionic style none`). */
	| { kind: "clear-style" }
	/** Drop the `color` field from `prefixStyle` (`/bionic color none`). */
	| { kind: "clear-color" }
	/** Toggle the `invert` config field (`/bionic invert`). */
	| { kind: "toggle-invert" }
	| { kind: "usage"; message: string };

const FIXATION_RE = /^[1-5]$/;
const STYLE_TOKENS = ["bold", "dim", "italic", "underline"] as const;

/**
 * Form summaries for the slash-command argument vocabulary. Shared by the
 * usage messages below AND by `augmentValidationWarning` so the same string
 * surfaces both when the parser rejects an arg shape (e.g. `/bionic color`
 * with no value) and when the dispatcher rejects a value (e.g.
 * `/bionic color off` — parser accepts the shape, validator rejects the
 * value). Keeps the two surfaces from drifting.
 */
export const COLOR_OPTIONS = "<name|#hex|256:N|rgb:R,G,B|none>";
export const STYLE_OPTIONS = "<bold|dim|italic|underline|none>";

/**
 * Comma-separated list of every named color accepted by `parseColor`,
 * formatted as a sentence clause (`named colors: black, red, ...`). Appended
 * to color rejection toasts and usage messages so users can discover the
 * named-palette vocabulary at the point of error — the `<name>` placeholder
 * in `COLOR_OPTIONS` is otherwise opaque (e.g. is `purple` accepted? It
 * isn't; ANSI only ships the 8 standard + 8 bright names plus the `gray`
 * alias).
 *
 * Order mirrors `NAMED_COLORS` insertion order (standard → bright → alias).
 */
export const NAMED_COLOR_HINT = `named colors: ${Object.keys(NAMED_COLORS).join(", ")}`;

// Unified template across every rejection toast: `[bionic] /bionic <subcmd>:
// <reason>; valid options: <list>`. Same shape used by `augmentValidationWarning`
// when reframing prefix-style validator warnings, so the parser and validator
// surfaces don't drift in tone or structure (S5-AC4).
//
// `style` ends in an explicit "(one or more, space-separated)" hint instead of
// the cryptic `[...]` POSIX repetition mark — the latter reads as ellipsis to
// most users and obscures the multi-token affordance (`/bionic style bold underline`).
const USAGE_TOPLEVEL =
	"[bionic] /bionic: unknown subcommand; valid options: on|off|toggle|1..5|invert|color <value>|style <tokens>";
const USAGE_COLOR = `[bionic] /bionic color: missing or invalid value; valid options: ${COLOR_OPTIONS}; ${NAMED_COLOR_HINT}`;
const USAGE_STYLE = `[bionic] /bionic style: missing or invalid token; valid options: ${STYLE_OPTIONS} (one or more, space-separated)`;

export function parseBionicCommand(rawArgs: string): BionicCommand {
	const trimmed = rawArgs.trim();
	if (trimmed === "") return { kind: "toggle" };

	// Lowercase the SUBCOMMAND only — color values and style tokens are
	// handled separately so e.g. `#FFAA00` and `brightWhite` survive.
	const firstSpace = trimmed.search(/\s/);
	const head =
		firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
	const subcommand = head.toLowerCase();
	const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

	// Pre-existing forms (S5-AC5).
	if (subcommand === "toggle") {
		return rest === "" ? { kind: "toggle" } : { kind: "usage", message: USAGE_TOPLEVEL };
	}
	if (subcommand === "on" || subcommand === "true") {
		return rest === ""
			? { kind: "set-enabled", value: true }
			: { kind: "usage", message: USAGE_TOPLEVEL };
	}
	if (subcommand === "off" || subcommand === "false") {
		return rest === ""
			? { kind: "set-enabled", value: false }
			: { kind: "usage", message: USAGE_TOPLEVEL };
	}
	if (FIXATION_RE.test(subcommand) && rest === "") {
		return {
			kind: "set-fixation",
			value: parseInt(subcommand, 10) as Fixation,
		};
	}

	// `/bionic invert` — toggle suffix-bolding mode. Prototype.
	if (subcommand === "invert") {
		return rest === ""
			? { kind: "toggle-invert" }
			: { kind: "usage", message: USAGE_TOPLEVEL };
	}

	// `/bionic color <value>` (S5-AC1) or `/bionic color none` (clear).
	if (subcommand === "color") {
		if (rest === "") return { kind: "usage", message: USAGE_COLOR };
		// Reject extra whitespace-separated words after the value so
		// `color red extra` doesn't silently accept "red". This also
		// rejects `color none extra`, mirroring `style none <other>`.
		if (/\s/.test(rest)) {
			return { kind: "usage", message: USAGE_COLOR };
		}
		// `none` sentinel: clear the color field. Lowercased so `None` /
		// `NONE` work; real color values (`#FFAA00`, `brightWhite`) are
		// case-preserved by `set-color` below.
		if (rest.toLowerCase() === "none") {
			return { kind: "clear-color" };
		}
		return { kind: "set-color", value: rest };
	}

	// `/bionic style <tokens>` (S5-AC2, S5-AC3).
	if (subcommand === "style") {
		if (rest === "") return { kind: "usage", message: USAGE_STYLE };
		const tokens = rest.toLowerCase().split(/\s+/);

		// `none` is a clear-all action and cannot be combined (S6-AC4 / AC6).
		if (tokens.includes("none")) {
			if (tokens.length > 1) {
				return { kind: "usage", message: USAGE_STYLE };
			}
			return { kind: "clear-style" };
		}

		// S6-AC3: dedupe so repeated tokens fold into a single toggle.
		const seen = new Set<string>();
		const fields: StyleField[] = [];
		for (const t of tokens) {
			if (!(STYLE_TOKENS as readonly string[]).includes(t)) {
				return { kind: "usage", message: USAGE_STYLE };
			}
			if (!seen.has(t)) {
				seen.add(t);
				fields.push(t as StyleField);
			}
		}
		return { kind: "toggle-style", fields };
	}

	return { kind: "usage", message: USAGE_TOPLEVEL };
}

/**
 * Reframe a `[bionic] prefixStyle.*` validation warning as a slash-command
 * rejection toast: rewrite the config-key prefix (`prefixStyle.color`) to
 * the slash-command form (`/bionic color`) and append a `valid options:`
 * hint listing the accepted forms.
 *
 * Bridges the gap left by S5-AC4 / S7-AC2: the parser accepts arg shapes
 * like `/bionic color off` (one whitespace-free token after `color`), so
 * the rejection happens later in `decideStyleApplication`. Without this
 * helper the resulting toast (a) cites a JSONC config key the user never
 * typed and (b) gives no hint about the accepted forms — in particular the
 * `none` clear-sentinel, which is easy to forget. The dispatcher in
 * `index.ts` calls this on every warning before forwarding to
 * `ctx.ui.notify`, so all rejection toasts share the unified template
 * `[bionic] /bionic <subcmd>: <reason>; valid options: <list>`.
 *
 * Pure function. Returns the input unchanged when no rule matches and is
 * idempotent on already-augmented warnings (re-running it does not stack a
 * second hint). Config-load warnings (logged via `console.warn` from
 * `resolvePrefixStyle` directly) bypass this path on purpose: a
 * bionic.jsonc edit is not a slash command, so the slash-command syntax
 * `none` would be misleading there.
 */
export function augmentValidationWarning(warning: string): string {
	const suffix = `; valid options: ${COLOR_OPTIONS}; ${NAMED_COLOR_HINT}`;
	// Idempotency guard: a re-augmented warning already ends with the suffix.
	if (warning.endsWith(suffix)) return warning;

	const CONFIG_PREFIX = "[bionic] prefixStyle.color:";
	const SLASH_PREFIX = "[bionic] /bionic color:";
	if (warning.startsWith(CONFIG_PREFIX)) {
		const reframed = SLASH_PREFIX + warning.slice(CONFIG_PREFIX.length);
		return `${reframed}${suffix}`;
	}
	return warning;
}
