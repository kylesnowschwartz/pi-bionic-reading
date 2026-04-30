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

import type { StyleField } from "./prefix-style.js";

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

const USAGE_TOPLEVEL =
	"[bionic] usage: /bionic [on|off|toggle|1..5|invert|color <value>|style <tokens>]";
const USAGE_COLOR =
	"[bionic] usage: /bionic color <name|#hex|256:N|rgb:R,G,B|none>";
const USAGE_STYLE =
	"[bionic] usage: /bionic style <bold|dim|italic|underline|none> [...]";

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
