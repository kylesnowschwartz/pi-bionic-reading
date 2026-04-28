/**
 * Markdown-aware bionic transform.
 *
 * Operates directly on the markdown source string using regex-based span
 * detection. We identify "preserved" character ranges (code blocks, codespans,
 * link URLs, autolinks, raw HTML, link reference definitions) that must be
 * preserved verbatim; everything else is treated as prose and transformed via
 * `bionicifyText()`.
 *
 * This avoids the parse → AST → mutate → re-stringify roundtrip; we never
 * have to reconstruct markdown source from tokens, which keeps the transform
 * faithful to the original formatting.
 */

import { bionicifyText, type BionicOptions } from "./bionic.js";

interface Range {
	start: number;
	end: number;
}

export interface MarkdownBionicOptions extends BionicOptions {
	/** If true, do not bionic-fy heading lines. Default false. */
	skipHeadings?: boolean;
}

/**
 * Find character ranges in `src` that should be preserved verbatim (not
 * transformed by the bionic walker).
 *
 * Detection precedence is implicit: ranges from different categories are
 * collected into one list and merged later. Overlaps are resolved by union,
 * so e.g. a codespan that happens to live inside a fenced block is harmless.
 *
 * Exported for testing.
 */
export function findPreservedRanges(src: string): Range[] {
	const ranges: Range[] = [];
	const pushAll = (re: RegExp, startOffset = 0) => {
		for (const m of src.matchAll(re)) {
			const start = (m.index ?? 0) + startOffset;
			const end = (m.index ?? 0) + m[0].length;
			if (end > start) ranges.push({ start, end });
		}
	};

	// 1. Fenced code blocks: ```lang … ``` or ~~~lang … ~~~
	//    Opening fence must start a line (with up to 3 spaces of indent).
	//    Closing fence must match the same fence char and length on its own line.
	const fenceRe = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm;
	pushAll(fenceRe);

	// 2. Inline code spans: `…`, ``…``, ```…``` (any backtick count, matched).
	//    May overlap with fenced ranges in pathological inputs; merging handles it.
	const codespanRe = /(`+)[\s\S]+?\1/g;
	pushAll(codespanRe);

	// 3. Link / image URLs: ](…) — protect ONLY the parenthesised URL part.
	//    The link text itself (between `[` and `]`) is left transformable so
	//    "click [here](https://example.com)" still bionic-fies "click" and "here".
	//    Offset 1 skips the closing `]`.
	const linkUrlRe = /\]\(([^)\n]*)\)/g;
	pushAll(linkUrlRe, 1);

	// 4. Autolinks: <https://…>, <a@b.c>
	const autolinkRe = /<(?:https?:\/\/[^>\s]+|[^@\s<>]+@[^@\s<>]+)>/g;
	pushAll(autolinkRe);

	// 5. Raw HTML tags and comments.
	const htmlRe = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
	pushAll(htmlRe);

	// 6. Reference-link definitions on their own line:  [foo]: url ["title"]
	const refDefRe =
		/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]+\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm;
	pushAll(refDefRe);

	// 7. Strong emphasis (bold). Run BEFORE em so the outer ** pair claims its
	//    territory and we don't peel off the leading * as italic.
	//    Asterisk form: **…** with no whitespace adjacent to the delimiters,
	//    and inner * only allowed when not part of another **.
	const strongAstRe = /\*\*(?=\S)(?:[^*\n]|\*(?!\*))+?(?<=\S)\*\*/g;
	//    Underscore form: __…__ with intra-word underscore exclusion.
	const strongUndRe =
		/(?<![\p{L}\p{N}_])__(?=\S)[^_\n]+?(?<=\S)__(?![\p{L}\p{N}_])/gu;
	pushAll(strongAstRe);
	pushAll(strongUndRe);

	// 8. Emphasis (italic). Single * or _.
	//    Asterisk form: *…* — disallow adjacent letters/digits to keep things
	//    like `2*3*4` from being treated as emphasis.
	const emAstRe =
		/(?<![*\p{L}\p{N}])\*(?=\S)[^*\n]+?(?<=\S)\*(?![*\p{L}\p{N}])/gu;
	//    Underscore form: _…_ with CommonMark's intra-word underscore rule
	//    so `snake_case_name` is not parsed as emphasis.
	const emUndRe =
		/(?<![\p{L}\p{N}_])_(?=\S)[^_\n]+?(?<=\S)_(?![\p{L}\p{N}_])/gu;
	pushAll(emAstRe);
	pushAll(emUndRe);

	// 9. Strikethrough (GFM): ~~…~~
	const strikeRe = /~~(?=\S)[^~\n]+?(?<=\S)~~/g;
	pushAll(strikeRe);

	return ranges;
}

/** Sort and merge overlapping/adjacent ranges into a disjoint, ordered list. */
function mergeRanges(ranges: Range[]): Range[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const merged: Range[] = [{ ...sorted[0] }];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		const cur = sorted[i];
		if (cur.start <= last.end) {
			if (cur.end > last.end) last.end = cur.end;
		} else {
			merged.push({ ...cur });
		}
	}
	return merged;
}

/** Regex matching a heading line:  optional indent + 1-6 `#` + space + text. */
const HEADING_LINE_RE = /^[ \t]{0,3}#{1,6}[ \t]/;

/**
 * Apply bionic transform to a markdown source string.
 *
 * Code blocks, inline code spans, link URLs, autolinks, raw HTML tags and
 * link reference definitions are preserved verbatim. Everything else
 * (paragraphs, headings, list items, blockquote contents, link text, emphasis
 * contents, table cells, etc.) is treated as prose.
 */
export function bionicifyMarkdown(
	src: string,
	opts: MarkdownBionicOptions = {},
): string {
	if (!src) return src;

	const merged = mergeRanges(findPreservedRanges(src));

	const transformProse = (text: string): string => {
		if (!opts.skipHeadings) return bionicifyText(text, opts);
		// Per-line: skip heading lines, transform everything else.
		return text
			.split("\n")
			.map((line) =>
				HEADING_LINE_RE.test(line) ? line : bionicifyText(line, opts),
			)
			.join("\n");
	};

	let result = "";
	let pos = 0;
	for (const r of merged) {
		if (pos < r.start) {
			result += transformProse(src.slice(pos, r.start));
		}
		result += src.slice(r.start, r.end);
		pos = r.end;
	}
	if (pos < src.length) {
		result += transformProse(src.slice(pos));
	}
	return result;
}
