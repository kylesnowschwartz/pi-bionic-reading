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
}

export const DEFAULT_OPTIONS: Required<BionicOptions> = {
	fixation: 3,
	minWordLength: 2,
	saccade: 1,
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
	const c = idx === -1 ? len - table.length : len - idx;
	return Math.max(c, 0);
}

/**
 * Words: any run of unicode letters or numbers, optionally joined by `-` or `'`.
 * "well-known" → 1 word; "don't" → 1 word; "5" → 1 token but rejected as not
 * containing a letter; "Dr." → 1 word ("Dr"), period passes through.
 */
const WORD_RE = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

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

		// Skip words too short to be worth bolding.
		if (word.length < minWordLength) {
			result += word;
			wordIndex++;
			continue;
		}

		// Saccade: only bold every Nth word.
		if (wordIndex % saccade !== 0) {
			result += word;
			wordIndex++;
			continue;
		}

		const bold = getBoldLength(word, fixation);
		if (bold <= 0) {
			result += word;
		} else if (bold >= word.length) {
			// Whole word is bolded (rare — fixation 1, very short word).
			result += `**${word}**`;
		} else {
			result += `**${word.slice(0, bold)}**${word.slice(bold)}`;
		}
		wordIndex++;
	}
	result += text.slice(lastIdx);
	return result;
}
