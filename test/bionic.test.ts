import { describe, expect, it } from "vitest";
import { bionicifyText, getBoldLength } from "../bionic.js";

describe("getBoldLength", () => {
	// Reference values from text-vide v1.8.5 fixation tables.
	// These were computed by running the original library and locking in.
	describe("fixation 3 (balanced, ~ceil(len/2))", () => {
		const cases: Array<[string, number]> = [
			["a", 1],
			["it", 1],
			["the", 1],
			["text", 2],
			["hello", 3],
			["world", 3],
			["bionic", 3],
			["reading", 4],
			["highlighted", 6],
			["fixation", 4],
		];
		for (const [word, expected] of cases) {
			it(`bolds ${expected} of "${word}" (${word.length} chars)`, () => {
				expect(getBoldLength(word, 3)).toBe(expected);
			});
		}
	});

	describe("fixation 1 (heaviest)", () => {
		// From text-vide README: textVide('text-vide') → '<b>tex</b>t-<b>vid</b>e'
		// So "text" → 3 bolded, "vide" → 3 bolded.
		it('"text" → 3 bolded (fixation 1)', () => {
			expect(getBoldLength("text", 1)).toBe(3);
		});
		it('"vide" → 3 bolded (fixation 1)', () => {
			expect(getBoldLength("vide", 1)).toBe(3);
		});
	});

	describe("fixation 5 (lightest)", () => {
		// From text-vide README: textVide('text-vide', { fixationPoint: 5 })
		//   → '<b>t</b>ext-<b>v</b>ide'
		it('"text" → 1 bolded (fixation 5)', () => {
			expect(getBoldLength("text", 5)).toBe(1);
		});
		it('"vide" → 1 bolded (fixation 5)', () => {
			expect(getBoldLength("vide", 5)).toBe(1);
		});
	});

	it("never returns more than the word length", () => {
		for (let f = 1; f <= 5; f++) {
			for (let len = 1; len <= 60; len++) {
				const word = "x".repeat(len);
				const bold = getBoldLength(word, f as 1 | 2 | 3 | 4 | 5);
				expect(bold).toBeGreaterThanOrEqual(0);
				expect(bold).toBeLessThanOrEqual(len);
			}
		}
	});
});

describe("bionicifyText", () => {
	it("wraps the leading half of each word in **…**", () => {
		expect(bionicifyText("hello world", { fixation: 3 })).toBe(
			"**hel**lo **wor**ld",
		);
	});

	it("preserves whitespace and punctuation between words", () => {
		expect(bionicifyText("Hello, world!", { fixation: 3 })).toBe(
			"**Hel**lo, **wor**ld!",
		);
	});

	it("treats hyphenated words as one unit", () => {
		// "well-known" length 10 at fixation 3: raw bold = 5, but that lands
		// on the `-` joiner and would emit `**well-**known` — a CommonMark
		// right-flanking violation that renders as literal asterisks. The
		// boundary is nudged inward to 4 so the closing `**` lands between
		// the letter `l` and the `-`, which closes cleanly.
		expect(bionicifyText("well-known issue", { fixation: 3 })).toBe(
			"**well**-known **iss**ue",
		);
	});

	it("treats contractions as one unit", () => {
		// "don't" length 5 at fixation 3 → bold first 3 chars ("don"); apostrophe
		// is at offset 3, so it stays outside the bold span. "know" length 4 → 2.
		expect(bionicifyText("I don't know", { fixation: 3 })).toBe(
			"I **don**'t **kn**ow",
		);
	});

	it("skips pure-numeric tokens (no letter)", () => {
		expect(bionicifyText("year 2024 ended", { fixation: 3 })).toBe(
			"**ye**ar 2024 **end**ed",
		);
	});

	it("skips short words below minWordLength", () => {
		// At fixation 3: "the" len 3 → bold 1, "answer" len 6 → bold 3.
		// "a" and "is" are below minWordLength=3 and pass through.
		expect(
			bionicifyText("a is the answer", {
				fixation: 3,
				minWordLength: 3,
			}),
		).toBe("a is **t**he **ans**wer");
	});

	it("respects saccade (every other word)", () => {
		// Bold words at indices 0, 2, 4 only:
		//   "one"   len 3 → bold 1 → **o**ne
		//   "three" len 5 → bold 3 → **thr**ee
		//   "five"  len 4 → bold 2 → **fi**ve
		const out = bionicifyText("one two three four five", {
			fixation: 3,
			saccade: 2,
		});
		expect(out).toBe("**o**ne two **thr**ee four **fi**ve");
	});

	it("preserves leading and trailing whitespace", () => {
		expect(bionicifyText("  hello  ", { fixation: 3 })).toBe("  **hel**lo  ");
	});

	it("returns empty string unchanged", () => {
		expect(bionicifyText("", {})).toBe("");
	});

	it("handles unicode prose", () => {
		// "le" len 2 → bold 1; "café" len 4 → bold 2; "est" len 3 → bold 1;
		// "ouvert" len 6 → bold 3.
		expect(bionicifyText("le café est ouvert", { fixation: 3 })).toBe(
			"**l**e **ca**fé **e**st **ouv**ert",
		);
	});

	it("handles multi-line input", () => {
		// "line" len 4 → bold 2; "one"/"two" len 3 → bold 1.
		const out = bionicifyText("line one\nline two", { fixation: 3 });
		expect(out).toBe("**li**ne **o**ne\n**li**ne **t**wo");
	});

	describe("hyphen/apostrophe boundary safety", () => {
		// CommonMark right-flanking rule: a closing `**` preceded by
		// punctuation (`-` or `'`) and followed by a letter is not
		// right-flanking, so the markers leak as literal asterisks. The
		// transform must shift the bold boundary inward to the previous
		// letter so the closing `**` lands between letter and joiner.

		it("does not split `pipefail-sensitive` at the hyphen (fixation 3)", () => {
			// Without the fix this would emit `**pipefail-**sensitive`.
			const out = bionicifyText("pipefail-sensitive", { fixation: 3 });
			expect(out).toBe("**pipefail**-sensitive");
			expect(out).not.toContain("-**");
		});

		it("does not split on apostrophe-then-letter", () => {
			// Hypothetical hyphen+apostrophe joined word.
			// `let's-go` len 7, fixation 3 → bold 4 lands on `'`. Nudge to 3.
			const out = bionicifyText("let's-go", { fixation: 3 });
			expect(out).not.toMatch(/'\*\*[a-z]/);
		});

		it("keeps short hyphenated words renderable", () => {
			// `well-known` len 10, fixation 3 → bold 5 lands on `-`. Nudge to 4.
			const out = bionicifyText("well-known", { fixation: 3 });
			expect(out).toBe("**well**-known");
		});

		it("leaves clean letter-letter boundaries alone", () => {
			// `tic-tac-toe` len 11, fixation 3 → bold 6, lands on `a`/`c`.
			// No nudge needed.
			const out = bionicifyText("tic-tac-toe", { fixation: 3 });
			expect(out).toBe("**tic-ta**c-toe");
		});
	});

	it("uses fixation 3 by default", () => {
		expect(bionicifyText("hello world")).toBe(
			bionicifyText("hello world", { fixation: 3 }),
		);
	});
});

// =============================================================================
// S1 — Split camelCase / PascalCase into sub-words
// =============================================================================
// See .agent-history/SPEC.md § S1.  Each `it()` below maps 1:1 to an
// acceptance criterion (S1-AC1 … S1-AC6) plus the reference-case table.
describe("S1 — camelCase / PascalCase splitting", () => {
	describe("S1-AC1 — split at lower→Upper and digit→Upper boundaries", () => {
		it("splits camelCase at lower→Upper", () => {
			// `useEffect` → sub-words `use` (len 3, bold 1) | `Effect` (len 6, bold 3)
			expect(bionicifyText("useEffect", { fixation: 3 })).toBe(
				"**u**se**Eff**ect",
			);
		});

		it("splits at digit→Upper boundary", () => {
			// `v2Beta` → `v2` (len 2, has letter, bold 1) | `Beta` (len 4, bold 2)
			expect(bionicifyText("v2Beta", { fixation: 3 })).toBe(
				"**v**2**Be**ta",
			);
		});
	});

	describe("S1-AC2 — split at Upper→Upper+lower so acronym runs stay whole", () => {
		it("splits XMLParser as XML | Parser, not X|M|L|Parser", () => {
			expect(bionicifyText("XMLParser", { fixation: 3 })).toBe(
				"**X**ML**Par**ser",
			);
		});

		it("splits IOError as IO | Error", () => {
			expect(bionicifyText("IOError", { fixation: 3 })).toBe(
				"**I**O**Err**or",
			);
		});

		it("keeps a trailing digit run attached to the preceding upper run", () => {
			// `parseHTML5` → `parse` | `HTML5`. `HTML5` has no case boundary;
			// digit-only suffix does not split.
			expect(bionicifyText("parseHTML5", { fixation: 3 })).toBe(
				"**par**se**HTM**L5",
			);
		});
	});

	describe("S1-AC3 — minWordLength applies per sub-word", () => {
		it("skips a sub-word shorter than minWordLength but bolds the rest", () => {
			// `IOError` with minWordLength=3:
			//   `IO` (len 2) → skipped (no markers)
			//   `Error` (len 5) → bold 3 → **Err**or
			expect(
				bionicifyText("IOError", { fixation: 3, minWordLength: 3 }),
			).toBe("IO**Err**or");
		});
	});

	describe("S1-AC4 — character-preservation round-trip", () => {
		const inputs = [
			"useEffect",
			"XMLParser",
			"IOError",
			"parseHTML5",
			"hello world",
			"call useEffect inside a React component",
		];
		for (const input of inputs) {
			it(`stripping ** from output yields the original: ${JSON.stringify(input)}`, () => {
				const out = bionicifyText(input, { fixation: 3 });
				expect(out.replace(/\*\*/g, "")).toBe(input);
			});
		}
	});

	describe("S1-AC5 — no regression on tokens without a case boundary", () => {
		it("all-lowercase token unchanged from pre-S1 behavior", () => {
			expect(bionicifyText("hello", { fixation: 3 })).toBe("**hel**lo");
		});

		it("all-uppercase token unchanged from pre-S1 behavior", () => {
			// `WORD` len 4, fixation 3, no boundary → bold 2.
			expect(bionicifyText("WORD", { fixation: 3 })).toBe("**WO**RD");
		});

		it("prose without identifiers matches existing snapshot", () => {
			expect(bionicifyText("hello world", { fixation: 3 })).toBe(
				"**hel**lo **wor**ld",
			);
		});
	});

	describe("S1-AC6 — saccade indexing advances per sub-word", () => {
		it("saccade=2 alternates within and across identifiers", () => {
			// Sub-words across the input, in order:
			//   0: `use`     (bold 1)
			//   1: `Effect`  (skip)
			//   2: `another` (len 7, bold 4)
			//   3: `Word`    (skip)
			const out = bionicifyText("useEffect anotherWord", {
				fixation: 3,
				saccade: 2,
			});
			expect(out).toBe("**u**seEffect **anot**herWord");
		});
	});
});

// =============================================================================
// S2 — snake_case continues to split (regression guard)
// =============================================================================
// See .agent-history/SPEC.md § S2.  These tests lock in behavior that today
// emerges implicitly from `_` not being in the WORD_RE character class — a
// future refactor (adding `_` to a joiner, swapping the regex) must not
// silently regress them.
describe("S2 — snake_case regression guard", () => {
	describe("S2-AC1 — tokenize snake_case as two sub-words", () => {
		it("bolds `snake` and `case` independently", () => {
			// `snake` len 5 → bold 3; `case` len 4 → bold 2.
			expect(bionicifyText("snake_case", { fixation: 3 })).toBe(
				"**sna**ke_**ca**se",
			);
		});

		it("bolds each segment of a 3-segment snake_case identifier", () => {
			// `my_var_name` → `my` (len 2, bold 1) | `var` (len 3, bold 1) | `name` (len 4, bold 2)
			expect(bionicifyText("my_var_name", { fixation: 3 })).toBe(
				"**m**y_**v**ar_**na**me",
			);
		});
	});

	describe("S2-AC2 — underscores preserved literally, never inside `**…**`", () => {
		const inputs = [
			"snake_case",
			"my_var_name",
			"_leading",
			"trailing_",
			"a__b",
			"x_y_z",
		];
		for (const input of inputs) {
			it(`preserves every \`_\` and never wraps one in **: ${JSON.stringify(input)}`, () => {
				const out = bionicifyText(input, { fixation: 3 });

				// Same number of underscores in, same number out.
				const inputUnderscores = (input.match(/_/g) ?? []).length;
				const outputUnderscores = (out.match(/_/g) ?? []).length;
				expect(outputUnderscores).toBe(inputUnderscores);

				// Stripping ** markers must round-trip to the original input.
				expect(out.replace(/\*\*/g, "")).toBe(input);

				// Every `**…**` span in the output must contain zero underscores.
				const boldSpans = [...out.matchAll(/\*\*([^*]+)\*\*/g)];
				for (const m of boldSpans) {
					expect(m[1]).not.toContain("_");
				}
			});
		}
	});

	describe("S2-AC3 — emitted `**…**` does not turn `__` into accidental bold", () => {
		it("output of `__double_underscores__` keeps both `__` runs intact and untouched", () => {
			// WORD_RE matches `double` and `underscores`; the surrounding `__`
			// runs are gap characters and pass through verbatim. The bolded
			// prefixes never consume the underscores, so the original `__…__`
			// outer delimiters survive in their original positions.
			const out = bionicifyText("__double_underscores__", { fixation: 3 });
			expect(out.startsWith("__")).toBe(true);
			expect(out.endsWith("__")).toBe(true);
			// Total underscore count: 2 (leading) + 1 (middle) + 2 (trailing) = 5.
			expect((out.match(/_/g) ?? []).length).toBe(5);
			// Round-trip.
			expect(out.replace(/\*\*/g, "")).toBe("__double_underscores__");
		});

		it("does not introduce a new `__` substring that wasn't in the input", () => {
			// Counts of `__` runs must match between input and output. The
			// transform only adds `**` markers; it must never coalesce single
			// `_` characters into `__` (which would be a new bold delimiter).
			const inputs = ["snake_case", "my_var_name", "a_b_c_d", "_x_"];
			for (const input of inputs) {
				const out = bionicifyText(input, { fixation: 3 });
				const inDoubles = (input.match(/__/g) ?? []).length;
				const outDoubles = (out.match(/__/g) ?? []).length;
				expect(outDoubles).toBe(inDoubles);
			}
		});
	});
});

// =============================================================================
// S3 — Opt-in `splitHyphenated` flag for kebab-case identifiers
// =============================================================================
// See .agent-history/SPEC.md § S3.  Default-off; opt-in splits each
// hyphen-separated segment as its own bionic sub-word while preserving every
// `-` literally between segments.  S3-AC1 / S3-AC6 are covered in
// test/config.test.ts (config field + project-override behavior).
describe("S3 — splitHyphenated opt-in", () => {
	describe("S3-AC2 — default (off) preserves today's hyphen behavior", () => {
		it("`well-known` stays a single bionic token by default", () => {
			expect(bionicifyText("well-known", { fixation: 3 })).toBe(
				"**well**-known",
			);
		});

		it("`well-known` stays a single bionic token when explicitly false", () => {
			expect(
				bionicifyText("well-known", {
					fixation: 3,
					splitHyphenated: false,
				}),
			).toBe("**well**-known");
		});

		it("`pipefail-sensitive` keeps the existing nudge behavior when off", () => {
			// Regression guard: this is the well-known right-flanking case.
			expect(
				bionicifyText("pipefail-sensitive", {
					fixation: 3,
					splitHyphenated: false,
				}),
			).toBe("**pipefail**-sensitive");
		});
	});

	describe("S3-AC3 — `splitHyphenated: true` splits each segment", () => {
		it("splits `well-known` into per-segment sub-words", () => {
			// `well` len 4 → bold 2 → **we**ll
			// `known` len 5 → bold 3 → **kno**wn
			expect(
				bionicifyText("well-known", {
					fixation: 3,
					splitHyphenated: true,
				}),
			).toBe("**we**ll-**kno**wn");
		});

		it("splits a 3-segment kebab identifier", () => {
			// `react` len 5 → bold 3; `router` len 6 → bold 3; `dom` len 3 → bold 1.
			expect(
				bionicifyText("react-router-dom", {
					fixation: 3,
					splitHyphenated: true,
				}),
			).toBe("**rea**ct-**rou**ter-**d**om");
		});

		it("splits `use-effect`", () => {
			expect(
				bionicifyText("use-effect", {
					fixation: 3,
					splitHyphenated: true,
				}),
			).toBe("**u**se-**eff**ect");
		});

		it("splits `pipefail-sensitive` with no closing-`**`-after-hyphen artifact", () => {
			// `pipefail` len 8 → bold 4; `sensitive` len 9 → bold 5.
			const out = bionicifyText("pipefail-sensitive", {
				fixation: 3,
				splitHyphenated: true,
			});
			expect(out).toBe("**pipe**fail-**sensi**tive");
			// Right-flanking guard: the original bug emitted `**pipefail-**sensitive`
			// where a closing `**` was preceded by `-`. The structural guarantee
			// — no `**…**` span contains `-` — is locked in by S3-AC4 below.
		});
	});

	describe("S3-AC4 — every `-` preserved literally, never inside `**…**`", () => {
		const inputs = [
			"well-known",
			"react-router-dom",
			"use-effect",
			"pipefail-sensitive",
			"a-b-c-d",
		];
		for (const input of inputs) {
			it(`preserves every \`-\` and never wraps one in **: ${JSON.stringify(input)}`, () => {
				const out = bionicifyText(input, {
					fixation: 3,
					splitHyphenated: true,
				});

				const inputHyphens = (input.match(/-/g) ?? []).length;
				const outputHyphens = (out.match(/-/g) ?? []).length;
				expect(outputHyphens).toBe(inputHyphens);

				expect(out.replace(/\*\*/g, "")).toBe(input);

				const boldSpans = [...out.matchAll(/\*\*([^*]+)\*\*/g)];
				for (const m of boldSpans) {
					expect(m[1]).not.toContain("-");
				}
			});
		}
	});

	describe("S3-AC5 — apostrophe stays inside the first segment", () => {
		it("splits `let's-go` between `let's` and `go`", () => {
			// `let's` len 5 (with apostrophe) → bold 3 lands on 't', no nudge.
			// `go` len 2 → bold 1.
			expect(
				bionicifyText("let's-go", {
					fixation: 3,
					splitHyphenated: true,
				}),
			).toBe("**let**'s-**g**o");
		});
	});

	describe("S3 — interaction with S1 (camelCase) inside hyphen segments", () => {
		it("applies camelCase splitting to each hyphen-separated segment", () => {
			// `use-effectHook` with splitHyphenated=true:
			//   segment 1: `use` (len 3) → bold 1 → **u**se
			//   segment 2: `effectHook` → sub-words `effect` (len 6, bold 3),
			//                                       `Hook` (len 4, bold 2)
			//   → **eff**ect**Ho**ok
			expect(
				bionicifyText("use-effectHook", {
					fixation: 3,
					splitHyphenated: true,
				}),
			).toBe("**u**se-**eff**ect**Ho**ok");
		});
	});
});

// =============================================================================
// Invert mode (prototype) — `/bionic invert`
// =============================================================================
// Same partition as normal mode (same `getBoldLength`), but the `**…**`
// markers wrap the SUFFIX of each sub-word instead of the prefix. Wired up
// through `BionicOptions.invert`. Each sub-word inverts independently so
// camelCase / acronym splits still produce one cue per sub-word.
describe("invert mode", () => {
	describe("swaps which side gets the `**…**` wrap", () => {
		it("single word: `bionic` (len 6, fix 3, bold 3) → `bio**nic**`", () => {
			expect(bionicifyText("bionic", { fixation: 3, invert: true })).toBe(
				"bio**nic**",
			);
		});

		it("`reading` (len 7, fix 3, bold 4) → `read**ing**`", () => {
			expect(bionicifyText("reading", { fixation: 3, invert: true })).toBe(
				"read**ing**",
			);
		});

		it("prose: each word inverts independently, whitespace preserved", () => {
			expect(
				bionicifyText("the quick brown fox", { fixation: 3, invert: true }),
			).toBe("t**he** qui**ck** bro**wn** f**ox**");
		});
	});

	describe("identifier-aware tokenization still applies per sub-word", () => {
		it("camelCase: `useEffect` → `u**se**Eff**ect**`", () => {
			// splitIdentifier carves `use` + `Effect`; each sub-word inverts
			// independently so the cue lands at the end of each segment.
			expect(
				bionicifyText("useEffect", { fixation: 3, invert: true }),
			).toBe("u**se**Eff**ect**");
		});

		it("PascalCase + acronym: `XMLParser` → `X**ML**Par**ser**`", () => {
			expect(
				bionicifyText("XMLParser", { fixation: 3, invert: true }),
			).toBe("X**ML**Par**ser**");
		});

		it("snake_case: each segment inverts independently", () => {
			// WORD_RE splits on `_` so segments are tokenized separately;
			// underscores stay literal and never appear inside `**…**`.
			expect(
				bionicifyText("snake_case", { fixation: 3, invert: true }),
			).toBe("sna**ke**_ca**se**");
		});

		it("splitHyphenated=true: each hyphen segment inverts independently", () => {
			expect(
				bionicifyText("react-router-dom", {
					fixation: 3,
					invert: true,
					splitHyphenated: true,
				}),
			).toBe("rea**ct**-rou**ter**-d**om**");
		});
	});

	describe("hyphen / apostrophe nudge — inverted direction", () => {
		// Normal mode nudges `bold` INWARD so the closing `**` is
		// right-flanking. Invert mode nudges `bold` FORWARD so the OPENING
		// `**` is left-flanking (must be followed by a letter, not by a
		// joiner). WORD_RE guarantees the loop terminates.

		it("`a-b` (bold 1 lands on `-`) advances to bold 2: `a-**b**`", () => {
			// fix 3 boundary table places len=3 → bold=1; sub[1]='-' triggers
			// the forward nudge to bold=2 (sub[2]='b').
			expect(bionicifyText("a-b", { fixation: 3, invert: true })).toBe(
				"a-**b**",
			);
		});

		it("contraction `let's`: `let'**s**` (no joiner at sub[bold])", () => {
			expect(bionicifyText("let's", { fixation: 3, invert: true })).toBe(
				"let'**s**",
			);
		});

		it("hyphenated compound `well-known`: `well-**known**`", () => {
			expect(
				bionicifyText("well-known", { fixation: 3, invert: true }),
			).toBe("well-**known**");
		});
	});

	describe("edge cases", () => {
		it("sub-word below minWordLength is unwrapped (same as normal mode)", () => {
			// Single-letter sub-words pass through verbatim regardless of mode.
			expect(bionicifyText("a", { fixation: 3, invert: true })).toBe("a");
		});

		it("pure-numeric tokens pass through unchanged", () => {
			expect(
				bionicifyText("123 v2 a1", { fixation: 3, invert: true }),
			).toBe("123 v**2** a**1**");
		});

		it("saccade still applies (every Nth sub-word styled)", () => {
			// saccade=2 means every other sub-word gets a cue; the cue still
			// lands on the suffix when invert is on.
			expect(
				bionicifyText("the quick brown fox", {
					fixation: 3,
					invert: true,
					saccade: 2,
				}),
			).toBe("t**he** quick bro**wn** fox");
		});

		it("invert: false matches default behavior (no regression)", () => {
			// Explicit invert:false should equal omitting the option.
			const src = "the quickBrownFox jumpsOver theLazyDog";
			expect(
				bionicifyText(src, { fixation: 3, invert: false }),
			).toBe(bionicifyText(src, { fixation: 3 }));
		});

		it("character-preservation: stripping `**` from invert output yields the source", () => {
			// Mirrors S1-AC4 round-trip property — invert must not lose or
			// duplicate any source character.
			const inputs = [
				"useEffect",
				"XMLParser",
				"the quick brown fox",
				"snake_case identifier",
				"well-known compound",
			];
			for (const src of inputs) {
				const out = bionicifyText(src, { fixation: 3, invert: true });
				expect(out.replaceAll("**", "")).toBe(src);
			}
		});
	});
});
