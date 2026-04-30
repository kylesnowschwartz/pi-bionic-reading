import { describe, expect, it } from "vitest";
import {
	augmentValidationWarning,
	COLOR_OPTIONS,
	NAMED_COLOR_HINT,
	parseBionicCommand,
	STYLE_OPTIONS,
} from "../commands.js";

// =============================================================================
// S5 — Slash commands for prefix style
// =============================================================================
// See .agent-history/SPEC.md § S5. The parser is a pure function over the
// raw arg string (everything after `/bionic `) and returns an action
// descriptor. The dispatcher in index.ts is a thin switch over the result.

describe("parseBionicCommand", () => {
	describe("S5-AC5 — pre-existing forms continue to parse", () => {
		it('"" → toggle', () => {
			expect(parseBionicCommand("")).toEqual({ kind: "toggle" });
		});

		it('"   " (whitespace only) → toggle', () => {
			expect(parseBionicCommand("   ")).toEqual({ kind: "toggle" });
		});

		it('"toggle" → toggle', () => {
			expect(parseBionicCommand("toggle")).toEqual({ kind: "toggle" });
		});

		it('"on" / "true" → set-enabled true', () => {
			expect(parseBionicCommand("on")).toEqual({
				kind: "set-enabled",
				value: true,
			});
			expect(parseBionicCommand("true")).toEqual({
				kind: "set-enabled",
				value: true,
			});
		});

		it('"off" / "false" → set-enabled false', () => {
			expect(parseBionicCommand("off")).toEqual({
				kind: "set-enabled",
				value: false,
			});
			expect(parseBionicCommand("false")).toEqual({
				kind: "set-enabled",
				value: false,
			});
		});

		it('"1".."5" → set-fixation', () => {
			for (let n = 1; n <= 5; n++) {
				expect(parseBionicCommand(String(n))).toEqual({
					kind: "set-fixation",
					value: n,
				});
			}
		});

		it("uppercase / mixed case still parses (case-insensitive)", () => {
			expect(parseBionicCommand("ON")).toEqual({
				kind: "set-enabled",
				value: true,
			});
			expect(parseBionicCommand("Toggle")).toEqual({ kind: "toggle" });
		});
	});

	describe("S5-AC1 — `/bionic color <value>`", () => {
		it('"color red" → set-color red', () => {
			expect(parseBionicCommand("color red")).toEqual({
				kind: "set-color",
				value: "red",
			});
		});

		it('"color #ffaa00" → set-color #ffaa00 (preserves hex case)', () => {
			expect(parseBionicCommand("color #ffaa00")).toEqual({
				kind: "set-color",
				value: "#ffaa00",
			});
		});

		it('"color 256:226" → set-color 256:226', () => {
			expect(parseBionicCommand("color 256:226")).toEqual({
				kind: "set-color",
				value: "256:226",
			});
		});

		it('"color rgb:255,170,0" → set-color rgb:255,170,0', () => {
			expect(parseBionicCommand("color rgb:255,170,0")).toEqual({
				kind: "set-color",
				value: "rgb:255,170,0",
			});
		});

		it("preserves case for hex / named (no toLowerCase on value)", () => {
			// Color value forwarding must be lossless so resolvePrefixStyle
			// gets the user's input unchanged.
			expect(parseBionicCommand("color #FFAA00")).toEqual({
				kind: "set-color",
				value: "#FFAA00",
			});
			expect(parseBionicCommand("color brightWhite")).toEqual({
				kind: "set-color",
				value: "brightWhite",
			});
		});
	});

	describe("`/bionic color none` — clear-color sentinel", () => {
		// Mirrors `/bionic style none`: the parser emits a dedicated action
		// shape so the dispatcher can drop the color key from prefixStyle.
		// The visible effect is fall-through to host `theme.bold` (S4-AC3).
		it('"color none" → clear-color', () => {
			expect(parseBionicCommand("color none")).toEqual({
				kind: "clear-color",
			});
		});

		it("is case-insensitive on the sentinel (None / NONE / nOnE)", () => {
			// Real color values are case-preserving (`#FFAA00`, `brightWhite`)
			// but `none` is a keyword, not a value. Lowercase the comparison.
			expect(parseBionicCommand("color None")).toEqual({
				kind: "clear-color",
			});
			expect(parseBionicCommand("color NONE")).toEqual({
				kind: "clear-color",
			});
			expect(parseBionicCommand("color nOnE")).toEqual({
				kind: "clear-color",
			});
		});

		it('"color none extra" → usage (cannot be combined)', () => {
			// Mirrors `/bionic style none <other>` rejection: combining the
			// clear sentinel with another token is ambiguous — reject.
			const r = parseBionicCommand("color none extra");
			expect(r.kind).toBe("usage");
		});

		it("`none` does not collide with the literal color name", () => {
			// `none` is not in NAMED_COLORS, so this is purely additive —
			// no recognized color value is being shadowed by the sentinel.
			// Sanity-check the four real shapes still parse to set-color.
			expect(parseBionicCommand("color red").kind).toBe("set-color");
			expect(parseBionicCommand("color #abcdef").kind).toBe("set-color");
			expect(parseBionicCommand("color 256:42").kind).toBe("set-color");
			expect(parseBionicCommand("color rgb:1,2,3").kind).toBe("set-color");
		});

		it("usage message advertises the new `none` form", () => {
			// Empty `color` arg should produce a usage toast that lists every
			// accepted form, including the new sentinel.
			const r = parseBionicCommand("color");
			expect(r.kind).toBe("usage");
			if (r.kind === "usage") {
				expect(r.message).toContain("none");
			}
		});
	});

	describe("S5-AC2 → S6-AC1 — single token produces a toggle-style action", () => {
		it('"style bold" → toggle-style { fields: ["bold"] }', () => {
			expect(parseBionicCommand("style bold")).toEqual({
				kind: "toggle-style",
				fields: ["bold"],
			});
		});

		it('"style dim" → toggle-style { fields: ["dim"] }', () => {
			expect(parseBionicCommand("style dim")).toEqual({
				kind: "toggle-style",
				fields: ["dim"],
			});
		});

		it('"style italic" → toggle-style { fields: ["italic"] }', () => {
			expect(parseBionicCommand("style italic")).toEqual({
				kind: "toggle-style",
				fields: ["italic"],
			});
		});

		it('"style underline" → toggle-style { fields: ["underline"] }', () => {
			expect(parseBionicCommand("style underline")).toEqual({
				kind: "toggle-style",
				fields: ["underline"],
			});
		});

		it('"style none" → clear-style (S6-AC4 regression)', () => {
			expect(parseBionicCommand("style none")).toEqual({
				kind: "clear-style",
			});
		});
	});

	describe("S5-AC3 → S6-AC2/AC3 — multi-token combinations", () => {
		it('"style bold underline" → toggle-style { fields: ["bold", "underline"] }', () => {
			expect(parseBionicCommand("style bold underline")).toEqual({
				kind: "toggle-style",
				fields: ["bold", "underline"],
			});
		});

		it("all four at once", () => {
			expect(
				parseBionicCommand("style bold dim italic underline"),
			).toEqual({
				kind: "toggle-style",
				fields: ["bold", "dim", "italic", "underline"],
			});
		});

		it("S6-AC3 — deduplicates repeated tokens (one toggle, not N)", () => {
			expect(parseBionicCommand("style bold bold bold")).toEqual({
				kind: "toggle-style",
				fields: ["bold"],
			});
		});

		it("multiple spaces between tokens are tolerated", () => {
			expect(parseBionicCommand("style   bold    underline")).toEqual({
				kind: "toggle-style",
				fields: ["bold", "underline"],
			});
		});
		it('"style none bold" is a usage error (none cannot be combined)', () => {
			// "none" is a clear-all action; combining it with a flag is
			// ambiguous. Reject and toast.
			const r = parseBionicCommand("style none bold");
			expect(r.kind).toBe("usage");
		});
	});

	describe("S5-AC4 — invalid / missing args produce usage messages, no mutation", () => {
		it("`color` with no arg → usage", () => {
			const r = parseBionicCommand("color");
			expect(r.kind).toBe("usage");
			if (r.kind === "usage") {
				expect(r.message).toContain("/bionic color");
				expect(r.message).toMatch(/name|hex|256|rgb/i);
			}
		});

		it("`color   ` (trailing whitespace only) → usage", () => {
			expect(parseBionicCommand("color   ").kind).toBe("usage");
		});

		it("`style` with no arg → usage", () => {
			const r = parseBionicCommand("style");
			expect(r.kind).toBe("usage");
			if (r.kind === "usage") {
				expect(r.message).toContain("/bionic style");
				expect(r.message).toMatch(/bold|dim|italic|underline|none/);
			}
		});

		it("`style purple` (unknown token) → usage", () => {
			const r = parseBionicCommand("style purple");
			expect(r.kind).toBe("usage");
			if (r.kind === "usage") {
				expect(r.message).toMatch(/bold|dim|italic|underline|none/);
			}
		});

		it("`style bold purple` (mixed valid+invalid) → usage", () => {
			// Whole-command rejection so the user knows exactly which token
			// was the problem instead of a partial mutation.
			expect(parseBionicCommand("style bold purple").kind).toBe(
				"usage",
			);
		});

		it("entirely unknown subcommand → usage", () => {
			expect(parseBionicCommand("unknown").kind).toBe("usage");
			expect(parseBionicCommand("color red extra").kind).toBe("usage");
		});

		it('"6" / "0" (out-of-range fixation) → usage', () => {
			expect(parseBionicCommand("6").kind).toBe("usage");
			expect(parseBionicCommand("0").kind).toBe("usage");
		});
	});

	describe("`/bionic invert` — toggle suffix-bolding (prototype)", () => {
		// Mirrors `/bionic` (the bare toggle): no args, just flips state.
		// The dispatcher handles the actual flip; the parser only emits the
		// action shape.
		it('"invert" → toggle-invert', () => {
			expect(parseBionicCommand("invert")).toEqual({
				kind: "toggle-invert",
			});
		});

		it("case-insensitive on the subcommand (Invert / INVERT)", () => {
			expect(parseBionicCommand("Invert")).toEqual({
				kind: "toggle-invert",
			});
			expect(parseBionicCommand("INVERT")).toEqual({
				kind: "toggle-invert",
			});
		});

		it('"invert <anything>" → usage (no args accepted)', () => {
			// Toggle has no payload; reject extras to avoid silently accepting
			// `/bionic invert on` etc. (which the user might assume works).
			expect(parseBionicCommand("invert on").kind).toBe("usage");
			expect(parseBionicCommand("invert true").kind).toBe("usage");
			expect(parseBionicCommand("invert garbage").kind).toBe("usage");
		});

		it("top-level usage message advertises `invert`", () => {
			// Unknown subcommand triggers USAGE_TOPLEVEL; verify the new
			// keyword is in there so users can discover it.
			const r = parseBionicCommand("unknown");
			expect(r.kind).toBe("usage");
			if (r.kind === "usage") {
				expect(r.message).toContain("invert");
			}
		});
	});
});

// =============================================================================
// `augmentValidationWarning` — valid-options hint on rejection toasts
// =============================================================================
// Bridges the gap between S5-AC4 (parser-level usage messages) and S7-AC2
// (validator-level rejection toasts). The parser only emits usage messages
// for arg-shape errors; values that pass the shape check but fail validation
// (e.g. `/bionic color off` — looks like a color token, not actually one)
// flow through `decideStyleApplication` and surface as plain warnings. This
// helper appends the `COLOR_OPTIONS` form so the toast lists what the user
// could have typed instead, including the `none` clear-sentinel.
describe("augmentValidationWarning", () => {
	it("appends `valid options:` hint to unrecognized-color warnings", () => {
		// The motivating case: user types `/bionic color off`, which the parser
		// accepts (single token after `color`), but the validator rejects.
		const out = augmentValidationWarning(
			'[bionic] prefixStyle.color: unrecognized color "off"',
		);
		expect(out).toContain('unrecognized color "off"');
		expect(out).toContain("valid options:");
		expect(out).toContain(COLOR_OPTIONS);
	});

	it("reframes the `prefixStyle.color:` config-key prefix as `/bionic color:`", () => {
		// Slash-command toasts should reference what the user typed
		// (`/bionic color X`), not the JSONC config key it would correspond to
		// (`prefixStyle.color`). The reframe keeps the rejection toast in the
		// same vocabulary as the parser-level usage messages — unified template
		// `[bionic] /bionic <subcmd>: <reason>; valid options: <list>`.
		const out = augmentValidationWarning(
			'[bionic] prefixStyle.color: unrecognized color "off"',
		);
		expect(out).toContain("[bionic] /bionic color:");
		expect(out).not.toContain("prefixStyle.color");
	});

	it("the hint advertises the `none` clear-sentinel", () => {
		// Discoverability for `/bionic color none` — the explicit reason this
		// helper exists per the user's report.
		const out = augmentValidationWarning(
			'[bionic] prefixStyle.color: unrecognized color "foo"',
		);
		expect(out).toContain("none");
	});

	it("augments structured-form rejections (hex / 256 / rgb), not just unrecognized", () => {
		// All five `parseColor` warning shapes share the `[bionic] prefixStyle.color:`
		// prefix, so all five get the hint. The user who typed `#fff` or `256:999`
		// also benefits from seeing the full vocabulary including `none`.
		const hex = augmentValidationWarning(
			'[bionic] prefixStyle.color: invalid hex color "#fff" (expected #rrggbb)',
		);
		expect(hex).toContain("valid options:");
		expect(hex).toContain("(expected #rrggbb)");

		const c256 = augmentValidationWarning(
			'[bionic] prefixStyle.color: invalid 256-color value "256:999" (expected 256:0..256:255)',
		);
		expect(c256).toContain("valid options:");

		const rgb = augmentValidationWarning(
			'[bionic] prefixStyle.color: invalid rgb form "rgb:1,2" (expected rgb:R,G,B)',
		);
		expect(rgb).toContain("valid options:");
	});

	it("returns non-color warnings unchanged (anti-fragile to future warning shapes)", () => {
		// `resolvePrefixStyle` only emits color warnings today, but a future
		// validator (e.g. for `ansi` escape hatch hygiene) should not silently
		// inherit a color-flavored hint. Prefix-match keeps the helper honest.
		const other = "[bionic] something-else: bad value";
		expect(augmentValidationWarning(other)).toBe(other);
	});

	it("is idempotent on already-augmented warnings (no double-suffix)", () => {
		// Defensive: if a caller threads a warning through twice, the second
		// pass should not stack a second hint. The current implementation does
		// in fact append twice; lock in the safer behavior so a future regression
		// here surfaces in CI rather than as `valid options: ... ; valid options: ...`
		// in user-visible toasts.
		const once = augmentValidationWarning(
			'[bionic] prefixStyle.color: unrecognized color "x"',
		);
		const twice = augmentValidationWarning(once);
		expect(twice).toBe(once);
	});

	it("COLOR_OPTIONS and STYLE_OPTIONS are the form summaries used in usage messages", () => {
		// Sanity check: the exported constants line up with what the existing
		// usage-message tests already assert (S5-AC4). If these drift, the
		// hint and the usage messages stop matching.
		expect(COLOR_OPTIONS).toMatch(/name.*hex.*256.*rgb.*none/);
		expect(STYLE_OPTIONS).toMatch(/bold.*dim.*italic.*underline.*none/);
	});
});

// =============================================================================
// Named-color discoverability — NAMED_COLOR_HINT
// =============================================================================
// `COLOR_OPTIONS` documents the *forms* a color value can take
// (`<name|#hex|256:N|rgb:R,G,B|none>`), but `<name>` is opaque — a user who
// guesses `purple` has no way to know ANSI's named palette is the 8 standard
// + 8 bright + the `gray` alias. The full list lives in
// `prefix-style.ts`'s `NAMED_COLORS`. `NAMED_COLOR_HINT` enumerates them as a
// sentence clause appended to color rejection toasts and the empty-arg
// usage message, so `purple` rejection points the user at `magenta` directly
// instead of at a placeholder.
describe("NAMED_COLOR_HINT", () => {
	it("enumerates every standard ANSI color name", () => {
		// The 8 standard names (SGR 30–37). If a future refactor drops one,
		// this test pins the regression.
		for (const name of [
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white",
		]) {
			expect(NAMED_COLOR_HINT).toContain(name);
		}
	});

	it("enumerates every bright ANSI color name and the `gray` alias", () => {
		// SGR 90–97 plus `gray` (90 alias). `gray` matters because users will
		// often try the more colloquial spelling before `brightBlack`.
		for (const name of [
			"brightBlack",
			"gray",
			"brightRed",
			"brightGreen",
			"brightYellow",
			"brightBlue",
			"brightMagenta",
			"brightCyan",
			"brightWhite",
		]) {
			expect(NAMED_COLOR_HINT).toContain(name);
		}
	});

	it("is prefixed with `named colors:` so it reads as a sentence clause", () => {
		// The augmenter joins the prior `; valid options: <…>` clause with
		// `; ` and appends NAMED_COLOR_HINT verbatim. The `named colors:`
		// prefix anchors the clause grammatically.
		expect(NAMED_COLOR_HINT).toMatch(/^named colors: /);
	});
});

describe("augmentValidationWarning includes the named-color list", () => {
	it("surfaces every named color in the rejection toast", () => {
		// Motivating case: user types `/bionic color purple`, which fails
		// `parseColor` because `purple` isn't in NAMED_COLORS. The toast
		// should now point them at the actual named-palette vocabulary so
		// they can pick `magenta` (or `brightMagenta`) without leaving the
		// editor.
		const out = augmentValidationWarning(
			'[bionic] prefixStyle.color: unrecognized color "purple"',
		);
		expect(out).toContain('unrecognized color "purple"');
		expect(out).toContain(NAMED_COLOR_HINT);
		// Spot-check a couple of names directly so a regression that
		// re-derives NAMED_COLOR_HINT from a different source still fires.
		expect(out).toContain("magenta");
		expect(out).toContain("brightWhite");
		expect(out).toContain("gray");
	});
});

describe("USAGE_COLOR (parser-level) includes the named-color list", () => {
	// The empty-arg path also benefits from named-color discoverability — the
	// user there hasn't tried anything yet, but they're about to, and seeing
	// the names up front saves a round-trip through a rejection toast.
	it("`color` with no arg surfaces the named-color list", () => {
		const r = parseBionicCommand("color");
		expect(r.kind).toBe("usage");
		if (r.kind === "usage") {
			expect(r.message).toContain(NAMED_COLOR_HINT);
			expect(r.message).toContain("magenta");
		}
	});
});
