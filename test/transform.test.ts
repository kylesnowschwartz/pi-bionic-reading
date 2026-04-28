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
