/**
 * pi-bionic-reading configuration.
 *
 * Loads from ~/.pi/bionic.jsonc (user-level) and <cwd>/.pi/bionic.jsonc
 * (project-level). Project values override user values.
 *
 * JSONC is parsed with a minimal stripper for // and block comments plus
 * trailing-comma tolerance (same approach as pi-recap).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KeyId } from "@mariozechner/pi-tui";
import { DEFAULT_OPTIONS, type Fixation } from "./bionic.js";

/**
 * Hotkey identifier (e.g. "ctrl+x", "ctrl+q", "f6"). Same string format pi
 * uses for keybindings; see `KeyId` in `@mariozechner/pi-tui`. Set to `null`
 * (or empty string) to disable the hotkey entirely.
 *
 * pi-tui only recognises `ctrl`, `shift`, and `alt` modifiers — there is no
 * `cmd`/`super`/`meta` token, and the Kitty-protocol parser explicitly
 * rejects those modifier bits. Cmd-based shortcuts cannot work in a TTY.
 */
export type BionicHotkey = KeyId | null;

export interface BionicReadingConfig {
	/** Master switch. When false, the patch is installed but no-ops. */
	enabled: boolean;
	/** Fixation strength: 1 (heaviest) … 5 (lightest). */
	fixation: Fixation;
	/** Skip words shorter than this. */
	minWordLength: number;
	/** Bold every Nth word: 1 = every word, 2 = alternate, etc. */
	saccade: number;
	/** Skip heading lines (so `# Foo Bar` is left untouched). */
	skipHeadings: boolean;
	/**
	 * Hotkey to toggle bionic mode on/off. Defaults to `"ctrl+x"`.
	 * Set to `null` or `""` to disable.
	 */
	hotkey: BionicHotkey;
}

export const CONFIG_DEFAULTS: BionicReadingConfig = {
	...DEFAULT_OPTIONS,
	enabled: true,
	skipHeadings: false,
	hotkey: "ctrl+x",
};

/** Minimal JSONC parser — strips // and block comments and trailing commas. */
function parseJsonc<T>(text: string): T {
	let stripped = text.replace(/\/\/.*$/gm, "");
	stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
	stripped = stripped.replace(/,\s*([\]}])/g, "$1");
	return JSON.parse(stripped);
}

async function tryLoad(path: string): Promise<Partial<BionicReadingConfig>> {
	try {
		const raw = await readFile(path, "utf-8");
		return parseJsonc<Partial<BionicReadingConfig>>(raw);
	} catch {
		return {};
	}
}

export async function loadBionicConfig(
	cwd: string,
): Promise<BionicReadingConfig> {
	const user = await tryLoad(join(homedir(), ".pi", "bionic.jsonc"));
	const project = await tryLoad(join(cwd, ".pi", "bionic.jsonc"));
	return { ...CONFIG_DEFAULTS, ...user, ...project };
}
