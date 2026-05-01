import { describe, expect, it } from "vitest";
import { bionicifyMarkdown, findPreservedRanges } from "../transform.js";

describe("findPreservedRanges", () => {
	it("identifies fenced code blocks", () => {
		const src = "before\n```js\nconst x = 1;\n```\nafter";
		const ranges = findPreservedRanges(src);
		const blockStart = src.indexOf("```js");
		const blockEnd = src.lastIndexOf("```") + 3;
		const matched = ranges.find(
			(r) => r.start === blockStart && r.end >= blockEnd,
		);
		expect(matched).toBeDefined();
	});

	it("identifies tilde-fenced code blocks", () => {
		const src = "~~~\ncode\n~~~";
		const ranges = findPreservedRanges(src);
		expect(ranges.some((r) => r.start === 0)).toBe(true);
	});

	it("identifies inline codespans", () => {
		const src = "Use `foo` not `bar`.";
		const ranges = findPreservedRanges(src);
		expect(ranges.some((r) => r.start === 4 && r.end === 9)).toBe(true);
		expect(ranges.some((r) => r.start === 14 && r.end === 19)).toBe(true);
	});

	it("identifies link URLs but leaves the link text transformable", () => {
		const src = "click [here](https://example.com) now";
		const ranges = findPreservedRanges(src);
		const start = src.indexOf("(https");
		const end = src.indexOf(")", start) + 1;
		expect(ranges.some((r) => r.start === start && r.end === end)).toBe(true);
		// "[here]" range is NOT in preserved list (start at index of '[')
		const bracketStart = src.indexOf("[here]");
		expect(ranges.every((r) => r.start !== bracketStart)).toBe(true);
	});

	it("identifies autolinks", () => {
		const src = "see <https://foo.com> please";
		const ranges = findPreservedRanges(src);
		const start = src.indexOf("<https");
		const end = src.indexOf(">", start) + 1;
		expect(ranges.some((r) => r.start === start && r.end === end)).toBe(true);
	});

	it("identifies HTML tags and comments", () => {
		const src = "before <span>x</span> <!-- note --> after";
		const ranges = findPreservedRanges(src);
		expect(ranges.some((r) => src.slice(r.start, r.end) === "<span>")).toBe(
			true,
		);
		expect(
			ranges.some((r) => src.slice(r.start, r.end) === "</span>"),
		).toBe(true);
		expect(
			ranges.some((r) => src.slice(r.start, r.end) === "<!-- note -->"),
		).toBe(true);
	});

	it("identifies link reference definitions on their own line", () => {
		const src = "para text\n\n[foo]: https://example.com\n\nmore text";
		const ranges = findPreservedRanges(src);
		const start = src.indexOf("[foo]:");
		expect(ranges.some((r) => r.start === start)).toBe(true);
	});
});

describe("bionicifyMarkdown — preservation", () => {
	it("does not transform fenced code blocks", () => {
		const src = "Hello world\n\n```js\nconst hello = world;\n```\n\nbye";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("```js\nconst hello = world;\n```");
		// Surrounding prose IS transformed
		expect(out).toContain("**Hel**lo");
		expect(out).toContain("**wor**ld");
		expect(out).toContain("**b**ye"); // "bye" len 3 → bold 1 at fixation 3
	});

	it("does not transform inline code spans", () => {
		const src = "Call `myFunction` today";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("`myFunction`");
		expect(out).toContain("**Ca**ll");
		expect(out).toContain("**tod**ay");
	});

	it("does not transform link URLs but does transform link text", () => {
		const src = "click [here](https://example.com) please";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("(https://example.com)");
		// "here" len 4 at fixation 3 → bold 2 → **he**re
		expect(out).toContain("**he**re");
		expect(out).toContain("**cli**ck");
	});

	it("does not transform autolinks", () => {
		const src = "see <https://foo.com> for details";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("<https://foo.com>");
		// "details" len 7 at fixation 3 → bold 4 → **deta**ils
		expect(out).toContain("**deta**ils");
	});

	it("does not transform raw HTML tags", () => {
		const src = "before <strong>bold text</strong> after";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("<strong>");
		expect(out).toContain("</strong>");
		expect(out).toContain("**bef**ore");
		expect(out).toContain("**aft**er");
		// Inside HTML tag content is still prose — bionic-fy it
		expect(out).toContain("**bo**ld");
	});

	it("does not transform link reference definitions", () => {
		const src = "see [foo] for more\n\n[foo]: https://example.com\n";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("[foo]: https://example.com");
	});

	it("returns empty string unchanged", () => {
		expect(bionicifyMarkdown("", {})).toBe("");
	});

	it("returns null/undefined-safe for falsy input", () => {
		// @ts-expect-error testing runtime behavior with undefined
		expect(bionicifyMarkdown(undefined, {})).toBeFalsy();
	});
});

describe("bionicifyMarkdown — headings", () => {
	it("transforms heading text by default", () => {
		const out = bionicifyMarkdown("# Hello world\n", { fixation: 3 });
		expect(out).toContain("**Hel**lo");
		expect(out).toContain("**wor**ld");
		expect(out.startsWith("# ")).toBe(true);
	});

	it("skipHeadings preserves heading lines verbatim", () => {
		const out = bionicifyMarkdown("# Hello world\n\nbody text\n", {
			fixation: 3,
			skipHeadings: true,
		});
		expect(out).toContain("# Hello world\n");
		expect(out).not.toContain("**Hel**lo");
		// Body still transformed
		expect(out).toContain("**bo**dy");
	});
});

describe("bionicifyMarkdown — combinations", () => {
	it("handles a complex assistant-style message", () => {
		const src = `Here's how to **fix** the bug:

1. Open \`config.ts\`
2. Add this line:

\`\`\`ts
export const FOO = 42;
\`\`\`

Then visit [the docs](https://example.com/docs) for more.`;

		const out = bionicifyMarkdown(src, { fixation: 3 });

		// Code block preserved
		expect(out).toContain("```ts\nexport const FOO = 42;\n```");
		// Inline code preserved
		expect(out).toContain("`config.ts`");
		// Link URL preserved
		expect(out).toContain("(https://example.com/docs)");
		// Link text transformed ("the" len 3 → bold 1, "docs" len 4 → bold 2)
		expect(out).toContain("**t**he");
		expect(out).toContain("**do**cs");
		// Prose transformed ("Here's" len 6 with apostrophe → bold 3 → **Her**e's;
		// "bug" len 3 → bold 1 → **b**ug)
		expect(out).toContain("**Her**e's");
		expect(out).toContain("**b**ug");
	});

	it("does not introduce backticks or asterisks inside preserved spans", () => {
		const src = "Run `echo hello world` to print";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		// The inside of the codespan has the original content untouched
		expect(out).toContain("`echo hello world`");
		// But "hello" elsewhere wouldn't be — there's no other "hello"
		expect(out.match(/\*\*/g)?.length).toBeGreaterThanOrEqual(2); // at least one transform happened
	});

	it("idempotent on already-transformed input (round-trip safety)", () => {
		// We don't currently dedupe ** ** — applying twice will nest. This test
		// documents that limitation: the call site is responsible for not
		// double-applying. If we ever add idempotency, flip this to .toBe().
		const once = bionicifyMarkdown("hello world", { fixation: 3 });
		const twice = bionicifyMarkdown(once, { fixation: 3 });
		expect(twice).not.toBe(once);
	});
});

describe("bionicifyMarkdown — emphasis preservation", () => {
	it("preserves italic spans verbatim (asterisk form)", () => {
		const out = bionicifyMarkdown(
			"*bolds the first letters* of each word",
			{ fixation: 3 },
		);
		expect(out).toContain("*bolds the first letters*");
		// No corruption from nested bold-inside-italic.
		expect(out).not.toMatch(/\*\*\*[^*]/);
		// Prose outside the span still transforms.
		expect(out).toContain("**ea**ch");
	});

	it("preserves italic spans verbatim (underscore form)", () => {
		const out = bionicifyMarkdown("_emphasised phrase_ around it", {
			fixation: 3,
		});
		expect(out).toContain("_emphasised phrase_");
		expect(out).toContain("**aro**und");
	});

	it("preserves bold spans verbatim (asterisk form)", () => {
		const out = bionicifyMarkdown("Here is how to **fix** the bug", {
			fixation: 3,
		});
		expect(out).toContain("**fix**");
		// Outer ** must not be peeled off as italic, so we should never see
		// ***fi** or similar collisions.
		expect(out).not.toMatch(/\*\*\*fi/);
		expect(out).toContain("**b**ug");
	});

	it("preserves bold spans verbatim (underscore form)", () => {
		const out = bionicifyMarkdown("please __read this__ carefully", {
			fixation: 3,
		});
		expect(out).toContain("__read this__");
		expect(out).toContain("**caref**ully");
	});

	it("does not treat snake_case as italic emphasis", () => {
		const out = bionicifyMarkdown("rename my_var_name to clearer", {
			fixation: 3,
		});
		// WORD_RE splits on `_`, so each segment of `my_var_name` is bolded
		// independently — but the key property is that the underscores survive
		// as literal characters (they aren't consumed as italic delimiters,
		// which would have wrapped `_var_` into emphasis).
		const underscoreCount = (out.match(/_/g) ?? []).length;
		expect(underscoreCount).toBe(2);
		expect(out).toContain("**clea**rer");
	});

	it("preserves strikethrough spans verbatim", () => {
		const out = bionicifyMarkdown("this is ~~wrong~~ actually right", {
			fixation: 3,
		});
		expect(out).toContain("~~wrong~~");
		expect(out).toContain("**actu**ally");
	});

	it("preserves emphasis containing multiple words", () => {
		const out = bionicifyMarkdown(
			"prefix *bolds the first few letters of each word* suffix",
			{ fixation: 3 },
		);
		expect(out).toContain("*bolds the first few letters of each word*");
		expect(out).toContain("**pre**fix");
		expect(out).toContain("**suf**fix");
	});

	it("does not match emphasis with adjacent whitespace (CommonMark rule)", () => {
		// `* foo *` is not emphasis in CommonMark; should be transformed as prose.
		const out = bionicifyMarkdown("a * foo bar * b", { fixation: 3 });
		expect(out).toContain("**f**oo");
	});
});

describe("findPreservedRanges — math", () => {
	it("identifies $$...$$ block math", () => {
		const src = "before\n$$\nx = 1\n$$\nafter";
		const ranges = findPreservedRanges(src);
		const start = src.indexOf("$$");
		const end = src.lastIndexOf("$$") + 2;
		expect(ranges.some((r) => r.start === start && r.end === end)).toBe(true);
	});

	it("identifies block math spanning multiple lines", () => {
		const src = "$$\n\\frac{a}{b} + \\sqrt{c}\n$$";
		const ranges = findPreservedRanges(src);
		expect(ranges.some((r) => r.start === 0 && r.end === src.length)).toBe(true);
	});

	it("identifies $...$ inline math", () => {
		const src = "see $x = 5$ here";
		const ranges = findPreservedRanges(src);
		const start = src.indexOf("$x");
		const end = src.indexOf("5$") + 2;
		expect(ranges.some((r) => r.start === start && r.end === end)).toBe(true);
	});

	it("does not match currency-shaped $5 / $10 patterns as math", () => {
		// Pandoc rule: closing `$` followed by a digit is rejected, so
		// "buy at $5, save $10" stays prose.
		const src = "buy at $5, save $10 today";
		const ranges = findPreservedRanges(src);
		// Neither dollar should anchor a preserved range.
		const dollar1 = src.indexOf("$5");
		const dollar2 = src.indexOf("$10");
		expect(
			ranges.every((r) => r.start !== dollar1 && r.start !== dollar2),
		).toBe(true);
	});

	it("does not match $ with adjacent whitespace (Pandoc rule)", () => {
		// Opening `$` followed by whitespace, OR closing `$` preceded by
		// whitespace, is not math — prevents "a $ b $ c" from being captured.
		const src = "a $ foo bar $ b";
		const ranges = findPreservedRanges(src);
		expect(ranges.every((r) => src.slice(r.start, r.end) !== "$ foo bar $")).toBe(true);
	});

	it("does not match escaped \\$ as the start of math", () => {
		const src = "price was \\$5 yesterday and $x$ today";
		const ranges = findPreservedRanges(src);
		// The math span $x$ should be preserved…
		const mathStart = src.indexOf("$x$");
		expect(
			ranges.some((r) => r.start === mathStart && r.end === mathStart + 3),
		).toBe(true);
		// …but the escaped \$5 must not anchor a preserved range.
		const escapedStart = src.indexOf("\\$5") + 1;
		expect(ranges.every((r) => r.start !== escapedStart)).toBe(true);
	});
});

describe("bionicifyMarkdown — math preservation", () => {
	it("does not transform $$...$$ block math", () => {
		const src =
			"Solve the quadratic:\n\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\nwhere a, b, c are constants.";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$");
		// Surrounding prose still gets bionic-fied.
		expect(out).toContain("**Sol**ve"); // "Solve" len 5 fix=3 → bold 3
		expect(out).toContain("**quadr**atic"); // "quadratic" len 9 fix=3 → 5
		expect(out).toContain("**const**ants"); // "constants" len 9 fix=3 → 5
	});

	it("does not transform $...$ inline math", () => {
		const src = "Let $\\alpha + \\beta = \\gamma$ be given.";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("$\\alpha + \\beta = \\gamma$");
		// LaTeX command tokens like \alpha must not get **…** wrapped.
		expect(out).not.toMatch(/\*\*[a-z]*alpha/i);
		expect(out).not.toMatch(/\*\*[a-z]*beta/i);
		expect(out).not.toMatch(/\*\*[a-z]*gamma/i);
		// Prose still transformed.
		expect(out).toContain("**giv**en"); // "given" len 5 fix=3 → bold 3
	});

	it("preserves block math containing markdown-shaped tokens (no mangling)", () => {
		// `**` and `_` inside math must not be peeled into bold/italic spans.
		const src = "$$a**b**c + d_e_f$$";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toBe("$$a**b**c + d_e_f$$");
	});

	it("leaves currency dollars in prose alone (still bionic-fies surrounding words)", () => {
		const src = "It cost $5 and $10 today";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		// Dollars survive verbatim.
		expect(out).toContain("$5");
		expect(out).toContain("$10");
		// Surrounding words still get the bionic treatment.
		expect(out).toContain("**tod**ay");
	});

	it("preserves multi-line block math verbatim", () => {
		const src = "prefix\n\n$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$\n\nsuffix";
		const out = bionicifyMarkdown(src, { fixation: 3 });
		expect(out).toContain("$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$");
		expect(out).toContain("**pre**fix");
		expect(out).toContain("**suf**fix");
	});
});
