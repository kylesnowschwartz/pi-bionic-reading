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
			hotkey: "ctrl+x",
		});
	});

	it("has a hotkey that uses only ctrl/shift/alt modifiers", () => {
		// pi-tui rejects cmd/super/meta — guard the default against accidental drift.
		const hotkey = CONFIG_DEFAULTS.hotkey ?? "";
		expect(hotkey).not.toMatch(/\b(cmd|super|meta)\+/i);
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
});
