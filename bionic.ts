/**
 * Bionic word-bolding algorithm.
 *
 * The fixation-point tables and `getBoldLength()` function below are vendored
 * from text-vide v1.8.5 (MIT, © 2022 Gumball12):
 *   https://github.com/Gumball12/text-vide
 *
 * The word-tokenization regex (which keeps hyphenated words like "well-known"
 * and contractions like "don't" as single units) is adapted from
 * data-bionic-reading v2.0.1 (MIT, © 2024 Mark Mead):
 *   https://github.com/markmead/data-bionic-reading
 *
 * Neither upstream supports saccade — that's implemented here.
 */

/**
 * Per-fixation table of word-length boundaries.
 *
 * For a word of length `len` and fixation `f`:
 *   table = FIXATION_TABLES[f - 1]
 *   s     = first index in table where len <= table[s]
 *   bold  = max(0, len - s)            (or len - table.length if no boundary)
 *
 * Higher fixation = lighter bolding (fewer letters bolded per word).
 */
const FIXATION_TABLES: ReadonlyArray<readonly number[]> = [
	// Fixation 1 — heaviest. Roughly bold (len - 1) letters for short words,
	// (len - 2) for medium, (len - 3) for long, etc.
	[0, 4, 12, 17, 24, 29, 35, 42, 48],
	// Fixation 2
	[1, 2, 7, 10, 13, 14, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49],
	// Fixation 3 — balanced. Roughly ceil(len / 2).
	[
		1, 2, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39,
		41, 43, 45, 47, 49,
	],
	// Fixation 4
	[
		0, 2, 4, 5, 6, 8, 9, 11, 14, 15, 17, 18, 20, 0, 21, 23, 24, 26, 27, 29,
		30, 32, 33, 35, 36, 38, 39, 41, 42, 44, 45, 47, 48,
	],
	// Fixation 5 — lightest. Bold roughly 30% of letters.
	[
		0, 2, 3, 5, 6, 7, 8, 10, 11, 12, 14, 15, 17, 19, 20, 21, 23, 24, 25, 26,
		28, 29, 30, 32, 33, 34, 35, 37, 38, 39, 41, 42, 43, 44, 46, 47, 48,
	],
];

export type Fixation = 1 | 2 | 3 | 4 | 5;

export interface BionicOptions {
	/** Fixation strength: 1 (heaviest bolding) … 5 (lightest). Default 3. */
	fixation?: Fixation;
	/** Skip words shorter than this. Default 2. */
	minWordLength?: number;
	/** Bold every Nth word: 1 = every word, 2 = alternate, etc. Default 1. */
	saccade?: number;
	/**
	 * Split hyphenated tokens (`react-router-dom`, `use-effect`) into per-segment
	 * sub-words. Default false to preserve English compounds like `well-known`.
	 * See SPEC § S3.
	 */
	splitHyphenated?: boolean;
}

export const DEFAULT_OPTIONS: Required<BionicOptions> = {
	fixation: 3,
	minWordLength: 2,
	saccade: 1,
	splitHyphenated: false,
};

/**
 * Number of leading characters of `word` that should be bolded.
 * Returns 0 if no characters should be bolded.
 *
 * (Exported for tests and for callers who want raw bolding behavior without
 * the surrounding markdown wrapping.)
 */
export function getBoldLength(word: string, fixation: Fixation): number {
	const table = FIXATION_TABLES[fixation - 1];
	const len = word.length;
	const idx = table.findIndex((boundary) => len <= boundary);
	const boldCount = idx === -1 ? len - table.length : len - idx;
	return Math.max(boldCount, 0);
}

/**
 * Words: any run of unicode letters or numbers, optionally joined by `-` or `'`.
 * "well-known" → 1 word; "don't" → 1 word; "5" → 1 token but rejected as not
 * containing a letter; "Dr." → 1 word ("Dr"), period passes through.
 */
const WORD_RE = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

/**
 * Split a token on case/digit boundaries so that camelCase / PascalCase /
 * acronym-prefixed identifiers are bionic-fied per sub-word.
 *
 * Two passes:
 *   1. lower/digit → Upper            (catches `useEffect`, `v2Beta`)
 *   2. Upper → Upper followed by lower (catches `XMLParser` → `XML | Parser`)
 *
 * The character sequence is preserved exactly; only an internal NUL marker is
 * inserted to delimit sub-words and is stripped by the final split. Tokens
 * with no case boundary (`hello`, `WORD`, `well-known`) round-trip unchanged.
 *
 * Note: this function deliberately does NOT split on `-` or `_`. Underscore
 * splitting is handled upstream by WORD_RE (it is not in the [\p{L}\p{N}]
 * class). Hyphen splitting is opt-in via the `splitHyphenated` config (S3).
 */
export function splitIdentifier(word: string): string[] {
	const step1 = word.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1\u0000$2");
	const step2 = step1.replace(
		/(\p{Lu})(\p{Lu}\p{Ll})/gu,
		"$1\u0000$2",
	);
	return step2.split("\u0000");
}

/** True if the candidate token contains at least one unicode letter. */
const LETTER_RE = /\p{L}/u;

/**
 * Bionic-fy a plain prose string. Wraps the leading portion of each word in
 * `**...**` (markdown bold). Non-word characters and pure-numeric tokens are
 * preserved verbatim.
 *
 * This function does NOT understand markdown — call sites must hand it spans
 * that are already known to be plain prose (no code, no link targets, no raw
 * HTML). See `transform.ts` for the markdown-aware walker.
 */
export function bionicifyText(text: string, opts: BionicOptions = {}): string {
	const fixation = (opts.fixation ?? DEFAULT_OPTIONS.fixation) as Fixation;
	const minWordLength = opts.minWordLength ?? DEFAULT_OPTIONS.minWordLength;
	const saccade = Math.max(1, opts.saccade ?? DEFAULT_OPTIONS.saccade);
	const splitHyphenated =
		opts.splitHyphenated ?? DEFAULT_OPTIONS.splitHyphenated;

	let result = "";
	let lastIdx = 0;
	let wordIndex = 0;

	for (const match of text.matchAll(WORD_RE)) {
		const word = match[0];
		const start = match.index ?? 0;

		// Pass through whatever was between the last word and this one.
		result += text.slice(lastIdx, start);
		lastIdx = start + word.length;

		// Skip pure-numeric tokens like "1", "5'10", "2024".
		if (!LETTER_RE.test(word)) {
			result += word;
			continue;
		}

		// S3 — if splitHyphenated is on, split the matched WORD_RE token on `-`
		// and emit a literal `-` between the resulting sub-tokens. When off,
		// segments == [word] and the original behavior (with the right-flanking
		// hyphen-nudge below) is preserved exactly.
		const segments = splitHyphenated ? word.split("-") : [word];

		for (let segIdx = 0; segIdx < segments.length; segIdx++) {
			if (segIdx > 0) result += "-";
			const segment = segments[segIdx];

			// S1 — split camelCase / PascalCase / acronym-prefixed identifiers
			// into sub-words. For non-camel tokens this returns [segment] unchanged.
			for (const sub of splitIdentifier(segment)) {
				// Sub-word may be pure-numeric (e.g. `2024Q4` → `2024`, `Q4`).
				if (!LETTER_RE.test(sub)) {
					result += sub;
					continue;
				}

				// Skip sub-words too short to be worth bolding (S1-AC3).
				if (sub.length < minWordLength) {
					result += sub;
					wordIndex++;
					continue;
				}

				// Saccade applies per sub-word (S1-AC6).
				if (wordIndex % saccade !== 0) {
					result += sub;
					wordIndex++;
					continue;
				}

				let bold = getBoldLength(sub, fixation);

				// Nudge the bold boundary off of `-` or `'` joiners.
				//
				// WORD_RE keeps tokens like `pipefail-sensitive` and `let's-go` as
				// single words when splitHyphenated is off, so the split can land
				// such that the prefix ends in a hyphen or apostrophe
				// (e.g. `**pipefail-**sensitive`). CommonMark's right-flanking rule
				// then prevents the closing `**` from closing: preceded by
				// punctuation, followed by a letter, not right-flanking, renders as
				// literal asterisks.
				//
				// Shifting `bold` inward by one lands the closing `**` between a
				// letter and the joiner (`**pipefail**-sensitive`), which IS
				// right-flanking and renders correctly. Word tokens always start
				// with a letter/digit per WORD_RE, so this loop can't undershoot to 0.
				while (
					bold > 0 &&
					(sub[bold - 1] === "-" || sub[bold - 1] === "'")
				) {
					bold--;
				}

				if (bold <= 0) {
					result += sub;
				} else if (bold >= sub.length) {
					// Whole sub-word is bolded (rare — fixation 1, very short sub-word).
					result += `**${sub}**`;
				} else {
					result += `**${sub.slice(0, bold)}**${sub.slice(bold)}`;
				}
				wordIndex++;
			}
		}
	}
	result += text.slice(lastIdx);
	return result;
}
