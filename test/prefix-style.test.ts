import { describe, expect, it } from "vitest";
import {
	applyClearColor,
	applyClearStyle,
	applyToggleStyle,
	decideStyleApplication,
	resolvePrefixStyle,
	withPrefixStyleOverride,
} from "../prefix-style.js";

// =============================================================================
// S4 — Configurable prefix style
// =============================================================================
// See .agent-history/SPEC.md § S4. Each `it()` references the EARS criterion
// it covers (S4-AC1 … S4-AC8). The pure-function tests live here; the config
// loading aspect (S4-AC1) is covered in test/config.test.ts.

describe("resolvePrefixStyle", () => {
	describe("S4-AC3 — unset / empty falls through (wrap is null)", () => {
		it("returns null wrap for undefined input", () => {
			const r = resolvePrefixStyle(undefined);
			expect(r.wrap).toBeNull();
			expect(r.warnings).toEqual([]);
		});

		it("returns null wrap for empty object", () => {
			const r = resolvePrefixStyle({});
			expect(r.wrap).toBeNull();
			expect(r.warnings).toEqual([]);
		});

		it("returns null wrap when every structured field is falsy", () => {
			const r = resolvePrefixStyle({
				bold: false,
				italic: false,
				underline: false,
				dim: false,
				color: "",
			});
			expect(r.wrap).toBeNull();
			expect(r.warnings).toEqual([]);
		});
	});

	describe("S4-AC8 — recognizes named ANSI colors (30–37)", () => {
		const cases: Array<[string, number]> = [
			["black", 30],
			["red", 31],
			["green", 32],
			["yellow", 33],
			["blue", 34],
			["magenta", 35],
			["cyan", 36],
			["white", 37],
		];
		for (const [name, code] of cases) {
			it(`color: "${name}" → SGR ${code}`, () => {
				const r = resolvePrefixStyle({ color: name });
				expect(r.warnings).toEqual([]);
				expect(r.wrap).not.toBeNull();
				expect(r.wrap?.("text")).toBe(`\u001b[${code}mtext\u001b[39m`);
			});
		}
	});

	describe("S4-AC8 — recognizes bright color names (90–97)", () => {
		const cases: Array<[string, number]> = [
			["brightBlack", 90],
			["gray", 90], // alias
			["brightRed", 91],
			["brightGreen", 92],
			["brightYellow", 93],
			["brightBlue", 94],
			["brightMagenta", 95],
			["brightCyan", 96],
			["brightWhite", 97],
		];
		for (const [name, code] of cases) {
			it(`color: "${name}" → SGR ${code}`, () => {
				const r = resolvePrefixStyle({ color: name });
				expect(r.warnings).toEqual([]);
				expect(r.wrap?.("x")).toBe(`\u001b[${code}mx\u001b[39m`);
			});
		}
	});

	describe("S4-AC8 — 256-color form `256:N`", () => {
		it('parses "256:226" as 38;5;226', () => {
			const r = resolvePrefixStyle({ color: "256:226" });
			expect(r.warnings).toEqual([]);
			expect(r.wrap?.("x")).toBe("\u001b[38;5;226mx\u001b[39m");
		});

		it('parses "256:0" (boundary low)', () => {
			const r = resolvePrefixStyle({ color: "256:0" });
			expect(r.wrap?.("x")).toBe("\u001b[38;5;0mx\u001b[39m");
		});

		it('parses "256:255" (boundary high)', () => {
			const r = resolvePrefixStyle({ color: "256:255" });
			expect(r.wrap?.("x")).toBe("\u001b[38;5;255mx\u001b[39m");
		});

		it('rejects "256:256" (out of range)', () => {
			const r = resolvePrefixStyle({ color: "256:256" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});

		it('rejects "256:-1" (negative)', () => {
			const r = resolvePrefixStyle({ color: "256:-1" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});
	});

	describe("S4-AC8 — hex `#rrggbb`", () => {
		it("parses #ffaa00 as 38;2;255;170;0", () => {
			const r = resolvePrefixStyle({ color: "#ffaa00" });
			expect(r.warnings).toEqual([]);
			expect(r.wrap?.("x")).toBe("\u001b[38;2;255;170;0mx\u001b[39m");
		});

		it("accepts uppercase #FFAA00", () => {
			const r = resolvePrefixStyle({ color: "#FFAA00" });
			expect(r.wrap?.("x")).toBe("\u001b[38;2;255;170;0mx\u001b[39m");
		});

		it('rejects "#zzzzzz" (non-hex)', () => {
			const r = resolvePrefixStyle({ color: "#zzzzzz" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});

		it('rejects "#fff" (3-digit short form not supported)', () => {
			const r = resolvePrefixStyle({ color: "#fff" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});
	});

	describe("S4-AC8 — `rgb:R,G,B` truecolor", () => {
		it("parses rgb:255,170,0", () => {
			const r = resolvePrefixStyle({ color: "rgb:255,170,0" });
			expect(r.warnings).toEqual([]);
			expect(r.wrap?.("x")).toBe("\u001b[38;2;255;170;0mx\u001b[39m");
		});

		it("rejects components > 255", () => {
			const r = resolvePrefixStyle({ color: "rgb:256,0,0" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});

		it("rejects malformed rgb:", () => {
			const r = resolvePrefixStyle({ color: "rgb:1,2" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
		});
	});

	describe("S4-AC5 — unrecognized color emits a warning, returns null", () => {
		it('"not-a-color" is rejected', () => {
			const r = resolvePrefixStyle({ color: "not-a-color" });
			expect(r.wrap).toBeNull();
			expect(r.warnings.length).toBe(1);
			// Warning message must mention the offending value so it's actionable.
			expect(r.warnings[0]).toContain("not-a-color");
		});

		it("warning is informational only (no throw, no I/O)", () => {
			// The function MUST be pure (S4-AC6).  We can't easily intercept
			// console here, so this test asserts the structural property: even
			// the worst input never throws.
			expect(() =>
				resolvePrefixStyle({ color: "💥" }),
			).not.toThrow();
		});
	});

	describe("S4-AC8 — text decorations (bold/italic/underline/dim)", () => {
		it('bold: true → "\\u001b[1m...\\u001b[22m" (S8: targeted close)', () => {
			const r = resolvePrefixStyle({ bold: true });
			expect(r.wrap?.("x")).toBe("\u001b[1mx\u001b[22m");
		});

		it('italic: true → "\\u001b[3m...\\u001b[23m" (S8: targeted close)', () => {
			expect(resolvePrefixStyle({ italic: true }).wrap?.("x")).toBe(
				"\u001b[3mx\u001b[23m",
			);
		});

		it('underline: true → "\\u001b[4m...\\u001b[24m" (S8: targeted close)', () => {
			expect(resolvePrefixStyle({ underline: true }).wrap?.("x")).toBe(
				"\u001b[4mx\u001b[24m",
			);
		});

		it('dim: true → "\\u001b[2m...\\u001b[22m" (S8: targeted close)', () => {
			expect(resolvePrefixStyle({ dim: true }).wrap?.("x")).toBe(
				"\u001b[2mx\u001b[22m",
			);
		});
	});

	describe("S4-AC8 — combining color + decorations emits one CSI", () => {
		it("color: red + bold: true → 31;1", () => {
			// Reference case from SPEC table.
			const r = resolvePrefixStyle({ color: "red", bold: true });
			expect(r.wrap?.("text")).toBe("\u001b[31;1mtext\u001b[39;22m");
		});

		it("multi-decoration: bold + underline → 1;4", () => {
			const r = resolvePrefixStyle({ bold: true, underline: true });
			expect(r.wrap?.("x")).toBe("\u001b[1;4mx\u001b[22;24m");
		});

		it("color hex + dim → 38;2;...;2", () => {
			const r = resolvePrefixStyle({ color: "#ffaa00", dim: true });
			expect(r.wrap?.("x")).toBe("\u001b[38;2;255;170;0;2mx\u001b[39;22m");
		});
	});

	describe("S4-AC2 — `ansi` escape hatch wins over structured fields", () => {
		it("ansi alone uses raw escape, closes with reset", () => {
			// Reference case from SPEC table.
			const r = resolvePrefixStyle({ ansi: "\u001b[38;5;226m" });
			expect(r.warnings).toEqual([]);
			expect(r.wrap?.("text")).toBe("\u001b[38;5;226mtext\u001b[0m");
		});

		it("ansi + structured fields: ansi wins, structured ignored", () => {
			const r = resolvePrefixStyle({
				ansi: "\u001b[X",
				color: "red",
				bold: true,
			});
			expect(r.warnings).toEqual([]);
			expect(r.wrap?.("text")).toBe("\u001b[Xtext\u001b[0m");
		});

		it("ansi + invalid color: ansi wins, no warning emitted", () => {
			// Because structured fields are ignored, their validation is too.
			const r = resolvePrefixStyle({
				ansi: "\u001b[1m",
				color: "not-a-color",
			});
			expect(r.wrap?.("x")).toBe("\u001b[1mx\u001b[0m");
			expect(r.warnings).toEqual([]);
		});
	});

	describe("S8 — targeted SGR closes preserve host attributes", () => {
		// S8 supersedes S4-AC7 for structured fields.  We close only the bits
		// the wrapper opened so the host's background color (and anything else
		// it set on the line) survives.  The `ansi` escape hatch is the one
		// exception — we don't know what the user's escape opened, so we keep
		// the universal reset.

		describe("S8-AC1 — single-attribute targeted closes", () => {
			const cases: Array<[string, object, string]> = [
				["bold", { bold: true }, "\u001b[22m"],
				["dim", { dim: true }, "\u001b[22m"],
				["italic", { italic: true }, "\u001b[23m"],
				["underline", { underline: true }, "\u001b[24m"],
				["color (named)", { color: "red" }, "\u001b[39m"],
				["color (hex)", { color: "#ffaa00" }, "\u001b[39m"],
				["color (256)", { color: "256:226" }, "\u001b[39m"],
				["color (rgb)", { color: "rgb:1,2,3" }, "\u001b[39m"],
			];
			for (const [label, style, expectedClose] of cases) {
				it(`close for ${label} is ${JSON.stringify(expectedClose)} (NOT \\u001b[0m)`, () => {
					const wrapped = resolvePrefixStyle(style).wrap?.("x");
					expect(wrapped).toBeDefined();
					expect(wrapped?.endsWith(expectedClose)).toBe(true);
					expect(wrapped).not.toMatch(/\u001b\[0m$/);
				});
			}
		});

		describe("S8-AC2 — bold + dim dedupe to a single 22 in the close", () => {
			it("{ bold: true, dim: true } closes with one 22, not two", () => {
				const wrapped = resolvePrefixStyle({
					bold: true,
					dim: true,
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[1;2mx\u001b[22m");
			});
		});

		describe("S8-AC3 — deterministic close order: 39, 22, 23, 24", () => {
			it("all four attributes plus color: open then matching reverse-order close", () => {
				const wrapped = resolvePrefixStyle({
					color: "red",
					bold: true,
					italic: true,
					underline: true,
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[31;1;3;4mx\u001b[39;22;23;24m");
			});

			it("color + dim closes in canonical order (39 before 22)", () => {
				const wrapped = resolvePrefixStyle({
					color: "red",
					dim: true,
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[31;2mx\u001b[39;22m");
			});

			it("italic + underline closes in 23;24 order", () => {
				const wrapped = resolvePrefixStyle({
					italic: true,
					underline: true,
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[3;4mx\u001b[23;24m");
			});
		});

		describe("S8-AC4 — raw `ansi` escape hatch keeps the universal reset", () => {
			it("ansi alone closes with \\u001b[0m", () => {
				const wrapped = resolvePrefixStyle({
					ansi: "\u001b[7m",
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[7mx\u001b[0m");
			});

			it("ansi + ignored structured fields still closes with \\u001b[0m", () => {
				const wrapped = resolvePrefixStyle({
					ansi: "\u001b[X",
					color: "red",
					bold: true,
				}).wrap?.("x");
				expect(wrapped).toBe("\u001b[Xx\u001b[0m");
			});
		});

		describe("S8-AC1 — background-color survival (the QA bug)", () => {
			it("the wrap output does not contain \\u001b[0m anywhere when only structured fields are used", () => {
				// This is the structural property that prevents the host's
				// background from being clobbered. If a future regression reintroduces
				// `\u001b[0m` into the close path, this test fires.
				const styles = [
					{ color: "red" },
					{ underline: true },
					{ color: "red", bold: true, underline: true },
					{ color: "#ffaa00", dim: true },
				];
				for (const style of styles) {
					const wrapped = resolvePrefixStyle(style).wrap?.("x");
					expect(wrapped).toBeDefined();
					expect(wrapped).not.toContain("\u001b[0m");
				}
			});
		});
	});
});

describe("withPrefixStyleOverride", () => {
	function makeTheme(originalBoldOutput = "[BOLD]") {
		const original = (t: string): string => `${originalBoldOutput}${t}${originalBoldOutput}`;
		return {
			bold: original,
			original,
		};
	}

	describe("S4-AC3 — null override leaves theme.bold unchanged", () => {
		it("does not touch theme.bold when override is null", () => {
			const theme = makeTheme();
			const before = theme.bold;
			const out = withPrefixStyleOverride(theme, null, () => {
				expect(theme.bold).toBe(before);
				return theme.bold("hi");
			});
			expect(out).toBe("[BOLD]hi[BOLD]");
			expect(theme.bold).toBe(before);
		});
	});

	describe("S4-AC4 — non-null override is applied during render and restored after", () => {
		it("swaps theme.bold inside render, restores after", () => {
			const theme = makeTheme();
			const original = theme.bold;
			const override = (t: string): string => `<<${t}>>`;
			const out = withPrefixStyleOverride(theme, override, () => {
				// Inside render, theme.bold is the override.
				expect(theme.bold).toBe(override);
				return theme.bold("hi");
			});
			expect(out).toBe("<<hi>>");
			// After render, theme.bold is restored to the original.
			expect(theme.bold).toBe(original);
		});

		it("restores theme.bold even when render throws", () => {
			const theme = makeTheme();
			const original = theme.bold;
			const override = (t: string): string => `!!${t}!!`;
			expect(() =>
				withPrefixStyleOverride(theme, override, () => {
					expect(theme.bold).toBe(override);
					throw new Error("render exploded");
				}),
			).toThrow("render exploded");
			expect(theme.bold).toBe(original);
		});

		it("restores even when render throws synchronously before producing output", () => {
			const theme = makeTheme();
			const original = theme.bold;
			expect(() =>
				withPrefixStyleOverride(theme, () => "x", () => {
					throw new Error("immediate");
				}),
			).toThrow("immediate");
			expect(theme.bold).toBe(original);
		});
	});
});

// =============================================================================
// S6 — Toggle semantics for `/bionic style <token>`
// =============================================================================
// Pure helpers consumed by the index.ts dispatcher.  Toggle = flip the field
// based on its current value (S6-AC1/AC2). Repeated calls fold/unfold the
// same field. `applyClearStyle` is the `none` form (S6-AC4).
describe("applyToggleStyle", () => {
	describe("S6-AC1 — single field flips based on current value", () => {
		it("undefined → true", () => {
			expect(applyToggleStyle({ color: "red" }, ["bold"])).toEqual({
				color: "red",
				bold: true,
			});
		});

		it("false → true", () => {
			expect(
				applyToggleStyle({ color: "red", bold: false }, ["bold"]),
			).toEqual({ color: "red", bold: true });
		});

		it("true → false", () => {
			expect(
				applyToggleStyle({ color: "red", bold: true }, ["bold"]),
			).toEqual({ color: "red", bold: false });
		});

		it("is a pure function (does not mutate input)", () => {
			const input = { color: "red", bold: true };
			const output = applyToggleStyle(input, ["bold"]);
			expect(input).toEqual({ color: "red", bold: true });
			expect(output).not.toBe(input);
		});
	});

	describe("S6-AC2 — multi-field toggles each independently", () => {
		it("flips each field based on its own current value", () => {
			// bold:true → false; underline:undefined → true; dim/italic untouched.
			expect(
				applyToggleStyle(
					{ color: "red", bold: true, dim: true },
					["bold", "underline"],
				),
			).toEqual({
				color: "red",
				bold: false,
				dim: true, // untouched
				underline: true,
			});
		});

		it("unnamed fields are not modified (color, ansi survive)", () => {
			expect(
				applyToggleStyle(
					{ color: "#ffaa00", ansi: "\u001b[X", italic: true },
					["underline"],
				),
			).toEqual({
				color: "#ffaa00",
				ansi: "\u001b[X",
				italic: true,
				underline: true,
			});
		});
	});

	describe("S6-AC1 — fold / unfold round-trip", () => {
		it("toggling the same field twice returns to the starting value", () => {
			const start = { color: "red", bold: true };
			const once = applyToggleStyle(start, ["underline"]);
			const twice = applyToggleStyle(once, ["underline"]);
			// `underline: false` instead of `undefined` is intentional — the toggle
			// records its decision explicitly so re-resolution sees a stable shape.
			expect(twice).toEqual({
				color: "red",
				bold: true,
				underline: false,
			});
		});
	});
});

describe("applyClearStyle", () => {
	describe("S6-AC4 — sets all four decoration booleans to false", () => {
		it("clears decorations, preserves color/ansi", () => {
			expect(
				applyClearStyle({
					color: "red",
					bold: true,
					dim: true,
					italic: true,
					underline: true,
				}),
			).toEqual({
				color: "red",
				bold: false,
				dim: false,
				italic: false,
				underline: false,
			});
		});

		it("is idempotent (applying twice equals applying once)", () => {
			const once = applyClearStyle({ color: "red", bold: true });
			const twice = applyClearStyle(once);
			expect(twice).toEqual(once);
		});

		it("is a pure function (does not mutate input)", () => {
			const input = { color: "red", bold: true };
			const output = applyClearStyle(input);
			expect(input).toEqual({ color: "red", bold: true });
			expect(output).not.toBe(input);
		});
	});
});

// `applyClearColor` is the pure helper behind `/bionic color none`. It must
// drop only the `color` field and leave decorations / `ansi` untouched. The
// dispatcher then runs the result through `decideStyleApplication`; an empty
// result resolves to `wrap: null` and the renderer falls through to the host
// `theme.bold` (S4-AC3 — i.e. terminal default foreground).
describe("applyClearColor", () => {
	it("drops color, preserves decorations", () => {
		expect(
			applyClearColor({
				color: "red",
				bold: true,
				underline: true,
			}),
		).toEqual({ bold: true, underline: true });
	});

	it("drops color, preserves ansi escape hatch", () => {
		// `ansi` wins over structured fields per S4-AC2. Clearing color
		// should not touch the escape hatch — different concern.
		expect(
			applyClearColor({ color: "red", ansi: "\u001b[X" }),
		).toEqual({ ansi: "\u001b[X" });
	});

	it("is a no-op when color is already absent", () => {
		expect(applyClearColor({ bold: true })).toEqual({ bold: true });
		expect(applyClearColor({})).toEqual({});
	});

	it("is idempotent (applying twice equals applying once)", () => {
		const once = applyClearColor({ color: "red", bold: true });
		const twice = applyClearColor(once);
		expect(twice).toEqual(once);
	});

	it("is a pure function (does not mutate input)", () => {
		const input = { color: "red", bold: true };
		const output = applyClearColor(input);
		expect(input).toEqual({ color: "red", bold: true });
		expect(output).not.toBe(input);
	});

	it("empty result resolves to wrap:null (falls through to theme.bold)", () => {
		// Integration sanity check: clearing color from a color-only style
		// produces the same effect as never having set prefixStyle at all.
		const cleared = applyClearColor({ color: "red" });
		const decision = decideStyleApplication(cleared);
		expect(decision.apply).toBe(true);
		expect(decision.wrap).toBeNull();
		expect(decision.warnings).toEqual([]);
	});

	it("non-empty decoration result still produces a wrap", () => {
		// Clearing color while bold remains keeps the prefix bold; only
		// the foreground SGR is gone.
		const cleared = applyClearColor({ color: "red", bold: true });
		const decision = decideStyleApplication(cleared);
		expect(decision.apply).toBe(true);
		expect(decision.wrap).not.toBeNull();
		expect(decision.wrap?.("x")).toBe("\u001b[1mx\u001b[22m");
	});
});

// =============================================================================
// S7 — Strict validation guard on `applyPrefixStyle`
// =============================================================================
// Tests the pure decision function used by the dispatcher. The contract:
// `apply` is `true` iff `warnings` is empty. Any single warning blocks the
// whole change — partial validation success does not silently drop the bad
// field while keeping the good ones.
describe("decideStyleApplication", () => {
	describe("S7-AC1 — any non-empty warnings array blocks application", () => {
		it("empty / no-op input → apply=true (nothing to reject)", () => {
			const d = decideStyleApplication({});
			expect(d.apply).toBe(true);
			expect(d.warnings).toEqual([]);
		});

		it("valid color alone → apply=true", () => {
			const d = decideStyleApplication({ color: "red" });
			expect(d.apply).toBe(true);
			expect(d.warnings).toEqual([]);
			expect(d.wrap?.("x")).toBe("\u001b[31mx\u001b[39m");
		});

		it("invalid color alone → apply=false, warning surfaced", () => {
			const d = decideStyleApplication({ color: "not-a-color" });
			expect(d.apply).toBe(false);
			expect(d.warnings.length).toBe(1);
			expect(d.warnings[0]).toContain("not-a-color");
		});

		it("invalid color + valid bold → apply=FALSE (the QA bug)", () => {
			// This is the case S7 was written to fix. Pre-S7, the bad color was
			// silently dropped while bold survived — user perceived a reset.
			// Post-S7, the partial validation success is treated as failure.
			const d = decideStyleApplication({
				color: "not-a-color",
				bold: true,
			});
			expect(d.apply).toBe(false);
			expect(d.warnings.length).toBe(1);
		});

		it("invalid hex form → apply=false", () => {
			expect(decideStyleApplication({ color: "#zzzzzz" }).apply).toBe(
				false,
			);
		});

		it("out-of-range 256 → apply=false", () => {
			expect(decideStyleApplication({ color: "256:999" }).apply).toBe(
				false,
			);
		});

		it("raw ansi escape hatch → apply=true (no validation needed)", () => {
			const d = decideStyleApplication({ ansi: "\u001b[1m" });
			expect(d.apply).toBe(true);
			expect(d.warnings).toEqual([]);
		});
	});

	describe("S7-AC1 — wrap is reported alongside the decision", () => {
		it("on apply=true with a valid style, wrap is non-null", () => {
			expect(
				decideStyleApplication({ color: "red" }).wrap,
			).not.toBeNull();
		});

		it("on apply=true with empty input, wrap is null (caller falls through)", () => {
			expect(decideStyleApplication({}).wrap).toBeNull();
		});

		it("on apply=false, wrap is the partial-validation result (caller ignores it)", () => {
			// We don't make guarantees about the value of `wrap` when apply=false;
			// the caller MUST gate on `apply` first. This test just locks in
			// that the structure is consistent.
			const d = decideStyleApplication({
				color: "not-a-color",
				bold: true,
			});
			expect(d.apply).toBe(false);
			// `wrap` reflects what would have happened: bold-only since the bad
			// color contributed nothing. Targeted close per S8.
			expect(d.wrap?.("x")).toBe("\u001b[1mx\u001b[22m");
		});
	});
});

// =============================================================================
// `markers` field on ResolvedPrefixStyle / StyleApplicationDecision
// =============================================================================
// Bridges `resolvePrefixStyle` and `withHeadingRestore`. Exposes the exact
// open / close ANSI substrings the `wrap` function injects, alongside a
// `safeToStrip` flag that is `false` only for the `ansi` raw-escape hatch
// (whose close is the universal `\u001b[0m` reset — collides with closes from
// theme.underline / inline theme.code / etc. and is unsafe to blind-strip).
import { withHeadingRestore } from "../prefix-style.js";

describe("resolvePrefixStyle markers field", () => {
	it("is null when style is undefined", () => {
		expect(resolvePrefixStyle(undefined).markers).toBeNull();
	});

	it("is null when style yields no codes (every field empty / falsy)", () => {
		// Same path as the empty-codes wrap:null case — caller falls through
		// to host theme.bold; markers null mirrors that.
		expect(resolvePrefixStyle({}).markers).toBeNull();
		expect(resolvePrefixStyle({ bold: false, dim: false }).markers).toBeNull();
	});

	it("exposes open + targeted close for structured styles, safeToStrip=true", () => {
		const { wrap, markers } = resolvePrefixStyle({ dim: true });
		expect(markers).not.toBeNull();
		if (!markers) return; // narrowing
		expect(markers.open).toBe("\u001b[2m");
		expect(markers.close).toBe("\u001b[22m");
		expect(markers.safeToStrip).toBe(true);
		// Round-trip: wrap('x') === open + 'x' + close
		expect(wrap?.("x")).toBe(`${markers.open}x${markers.close}`);
	});

	it("close is targeted (only the bits we opened) for color + dim combo", () => {
		// Lock in S8-AC1/AC2/AC3 ordering: 39 (color), 22 (dim shares with bold).
		const { markers } = resolvePrefixStyle({ color: "red", dim: true });
		if (!markers) throw new Error("expected markers");
		expect(markers.close).toBe("\u001b[39;22m");
		expect(markers.safeToStrip).toBe(true);
	});

	it("safeToStrip is FALSE for the `ansi` raw-escape hatch", () => {
		// Motivating reason: ansi's close is the universal `\u001b[0m`, which
		// also closes theme.underline / inline theme.code / etc. on the same
		// line. Stripping it indiscriminately corrupts non-bionic spans —
		// `withHeadingRestore` honors this flag and falls through.
		const { markers } = resolvePrefixStyle({ ansi: "\u001b[38;5;226;1m" });
		if (!markers) throw new Error("expected markers");
		expect(markers.open).toBe("\u001b[38;5;226;1m");
		expect(markers.close).toBe("\u001b[0m");
		expect(markers.safeToStrip).toBe(false);
	});
});

describe("decideStyleApplication markers field", () => {
	it("forwards markers from resolvePrefixStyle on apply", () => {
		// applyPrefixStyle in index.ts reads `decision.markers` to keep
		// `state.prefixMarkers` in sync with `state.prefixWrap`. Lock in the
		// forwarding so a future StyleApplicationDecision shape change keeps
		// markers attached.
		const d = decideStyleApplication({ dim: true });
		expect(d.apply).toBe(true);
		expect(d.markers).not.toBeNull();
		expect(d.markers?.open).toBe("\u001b[2m");
		expect(d.markers?.close).toBe("\u001b[22m");
		expect(d.markers?.safeToStrip).toBe(true);
	});

	it("markers null when style yields no codes", () => {
		const d = decideStyleApplication({});
		expect(d.markers).toBeNull();
	});
});

// =============================================================================
// withHeadingRestore
// =============================================================================
// Heading-aware patch that undoes the bionic `theme.bold` override on heading
// content only. Caller invokes this OUTSIDE the bold override (so it captures
// the host's original bold by reference), then runs the bold override + render
// inside its callback. Heading text is reconstructed by stripping wrap markers
// and re-applying the original bold + heading style.
describe("withHeadingRestore", () => {
	function makeTheme() {
		return {
			bold: (t: string) => `<<bold:${t}>>`,
			heading: (t: string) => `<<heading:${t}>>`,
		};
	}

	it("is a transparent pass-through when markers is null", () => {
		const theme = makeTheme();
		const originalHeading = theme.heading;
		const out = withHeadingRestore(theme, null, () => {
			expect(theme.heading).toBe(originalHeading); // not patched
			return theme.heading("x");
		});
		expect(out).toBe("<<heading:x>>");
		expect(theme.heading).toBe(originalHeading);
	});

	it("is a transparent pass-through when markers.safeToStrip is false (ansi escape)", () => {
		// Ansi raw-escape hatch is opt-out: blind-stripping `\u001b[0m` would
		// corrupt closes from theme.underline / inline theme.code / etc. on the
		// same line. Honor the flag and don't patch.
		const theme = makeTheme();
		const originalHeading = theme.heading;
		const markers = {
			open: "\u001b[38;5;226;1m",
			close: "\u001b[0m",
			safeToStrip: false,
		};
		withHeadingRestore(theme, markers, () => {
			expect(theme.heading).toBe(originalHeading);
		});
	});

	it("strips wrap markers and re-applies original bold + heading", () => {
		// Simulate pi-tui's heading composition: heading(bold(text)). With the
		// override active, bold(x) === wrap(x) === open+x+close. So the input
		// to theme.heading is already-wrapped. The patch should strip and
		// rebold using the ORIGINAL bold (captured before the override).
		const theme = makeTheme();
		const markers = {
			open: "<O>",
			close: "<C>",
			safeToStrip: true,
		};
		const result = withHeadingRestore(theme, markers, () => {
			// Inside render: simulate the bold override being installed.
			theme.bold = (t: string) => `${markers.open}${t}${markers.close}`;
			// pi-tui calls heading(bold(text)) = patched_heading(<O>x<C>)
			return theme.heading(theme.bold("hello"));
		});
		// patched heading strips <O>...<C> -> 'hello', then re-applies the
		// ORIGINAL bold (captured before the test mutated theme.bold), then
		// applies original heading.
		expect(result).toBe("<<heading:<<bold:hello>>>>");
	});

	it("strips multiple non-overlapping wrap regions in the same heading line", () => {
		// Real headings can have multiple theme.bold calls on a single line:
		// pi-tui's renderInlineTokens calls bold() once per text segment plus
		// once per inline `**bold**` token, all concatenated before heading()
		// runs. The strip regex must be non-greedy to unfold each region
		// independently — a greedy match would swallow text between regions.
		const theme = makeTheme();
		const markers = { open: "<O>", close: "<C>", safeToStrip: true };
		const result = withHeadingRestore(theme, markers, () => {
			// Two wrapped regions with text in between. The text in between
			// should NOT be stripped — only the open/close markers themselves.
			return theme.heading("<O>foo<C> middle <O>bar<C>");
		});
		expect(result).toBe("<<heading:<<bold:foo middle bar>>>>");
	});

	it("preserves non-wrap ANSI codes inside the heading (e.g. theme.underline closes)", () => {
		// pi-tui's H1 composition is heading(bold(underline(text))) =
		// patched_heading(<O> + UNDERLINE_OPEN + text + UNDERLINE_CLOSE + <C>).
		// Stripping <O> and <C> must leave the underline codes untouched so
		// pi-tui's underline styling survives the restore.
		const theme = makeTheme();
		const markers = { open: "<O>", close: "<C>", safeToStrip: true };
		const result = withHeadingRestore(theme, markers, () => {
			return theme.heading("<O>\u001b[4mtext\u001b[24m<C>");
		});
		expect(result).toBe("<<heading:<<bold:\u001b[4mtext\u001b[24m>>>>");
	});

	it("restores theme.heading after render completes", () => {
		const theme = makeTheme();
		const originalHeading = theme.heading;
		const markers = { open: "<O>", close: "<C>", safeToStrip: true };
		withHeadingRestore(theme, markers, () => {
			expect(theme.heading).not.toBe(originalHeading); // patched inside
		});
		expect(theme.heading).toBe(originalHeading); // restored after
	});

	it("restores theme.heading even when render throws", () => {
		// Mirrors withPrefixStyleOverride's S4-AC4 contract: an exception
		// during render must not leak the patch into subsequent renders.
		const theme = makeTheme();
		const originalHeading = theme.heading;
		const markers = { open: "<O>", close: "<C>", safeToStrip: true };
		expect(() =>
			withHeadingRestore(theme, markers, () => {
				throw new Error("render exploded");
			}),
		).toThrow("render exploded");
		expect(theme.heading).toBe(originalHeading);
	});

	it("captures originalBold by reference BEFORE the override is installed", () => {
		// Critical contract: the caller MUST invoke withHeadingRestore OUTSIDE
		// withPrefixStyleOverride. The patched heading reads `originalBold`
		// from the closure at call time — it must point at the host bold, not
		// the override. Verify by mutating theme.bold inside the render and
		// confirming the patched heading still uses the captured original.
		const theme = makeTheme();
		const markers = { open: "<O>", close: "<C>", safeToStrip: true };
		const result = withHeadingRestore(theme, markers, () => {
			// Simulate withPrefixStyleOverride installing a `dim` override.
			theme.bold = (t: string) => `<<DIM:${t}>>`;
			return theme.heading("<O>x<C>");
		});
		// originalBold was the ORIGINAL `<<bold:...>>` function captured
		// before the test mutated theme.bold, so the heading content reads
		// `<<bold:x>>` not `<<DIM:x>>`.
		expect(result).toBe("<<heading:<<bold:x>>>>");
	});

	it("escapes regex metacharacters in marker open / close strings", () => {
		// Defensive: structured wraps emit `\u001b[Nm` which is fine, but a
		// future raw-escape variant or a custom marker could include `[`, `(`,
		// `*`, etc. — must be regex-escaped before use in `RegExp`.
		const theme = makeTheme();
		const markers = {
			open: "[(*+?",
			close: ")^$|",
			safeToStrip: true,
		};
		const result = withHeadingRestore(theme, markers, () => {
			return theme.heading("[(*+?content)^$|");
		});
		expect(result).toBe("<<heading:<<bold:content>>>>");
	});
});
