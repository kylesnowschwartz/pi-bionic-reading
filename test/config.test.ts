import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, loadBionicConfig } from "../config.js";

describe("CONFIG_DEFAULTS", () => {
	it("ships expected default values", () => {
		expect(CONFIG_DEFAULTS).toEqual({
			enabled: true,
			fixation: 3,
			minWordLength: 2,
			saccade: 1,
			skipHeadings: false,
			splitHyphenated: false,
			hotkey: "ctrl+x",
		});
	});

	it("has a hotkey that uses only ctrl/shift/alt modifiers", () => {
		// pi-tui rejects cmd/super/meta — guard the default against accidental drift.
		const hotkey = CONFIG_DEFAULTS.hotkey ?? "";
		expect(hotkey).not.toMatch(/\b(cmd|super|meta)\+/i);
	});

	// S3-AC1 — splitHyphenated config field exists with default false.
	it("defaults `splitHyphenated` to false", () => {
		expect(CONFIG_DEFAULTS.splitHyphenated).toBe(false);
	});
});

describe("loadBionicConfig", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "pi-bionic-config-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("falls back to defaults when no project config exists", async () => {
		const config = await loadBionicConfig(cwd);
		// We can't isolate ~/.pi/bionic.jsonc, but defaults must at least define every key.
		expect(config).toMatchObject({
			enabled: expect.any(Boolean),
			fixation: expect.any(Number),
			minWordLength: expect.any(Number),
			saccade: expect.any(Number),
			skipHeadings: expect.any(Boolean),
		});
		expect("hotkey" in config).toBe(true);
	});

	it("lets project config override the hotkey", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "hotkey": "f12" }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.hotkey).toBe("f12");
	});

	it("accepts null hotkey to disable the binding", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "hotkey": null }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.hotkey).toBeNull();
	});

	it("tolerates JSONC comments and trailing commas", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			`{
				// trailing comma + comment
				"hotkey": "ctrl+q",
			}
			`,
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.hotkey).toBe("ctrl+q");
	});

	// S3-AC6 — splitHyphenated loads from project config and overrides defaults.
	it("lets project config override `splitHyphenated`", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "splitHyphenated": true }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.splitHyphenated).toBe(true);
	});

	// S4-AC1 — prefixStyle accepted from project config.
	it("loads `prefixStyle` from project config", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "prefixStyle": { "color": "red", "bold": true } }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.prefixStyle).toEqual({ color: "red", bold: true });
	});

	// Handover task 2 — parseJsonc must not corrupt string-literal contents.
	// The previous hand-rolled stripper applied // and /* */ removal across the
	// whole input, including inside quoted strings. The fields most likely to
	// contain // or /* are prefixStyle.ansi (raw escape sequences — OSC 8
	// hyperlinks contain `//` legitimately) and any future URL-shaped value.
	it("preserves `//` inside string literals (handover task 2)", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "prefixStyle": { "ansi": "ESC//x" } }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.prefixStyle).toEqual({ ansi: "ESC//x" });
	});

	it("preserves `/* */` inside string literals (handover task 2)", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "prefixStyle": { "ansi": "a/* not a comment */b" } }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.prefixStyle).toEqual({ ansi: "a/* not a comment */b" });
	});

	it("preserves trailing-comma-shaped substrings inside string literals (handover task 2)", async () => {
		// The hand-rolled `,\s*([\]}])` stripper would remove the comma in `,]`
		// or `, }` even when those bytes are inside a quoted string.
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "prefixStyle": { "ansi": "a, ]b" } }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.prefixStyle).toEqual({ ansi: "a, ]b" });
	});
});
