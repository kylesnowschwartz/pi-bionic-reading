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
