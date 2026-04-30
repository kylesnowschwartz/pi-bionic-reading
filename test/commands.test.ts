import { describe, expect, it } from "vitest";
import { parseBionicCommand } from "../commands.js";

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
});
