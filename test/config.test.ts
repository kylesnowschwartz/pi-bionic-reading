import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyLiveThemeName,
	applyThemePreset,
	CONFIG_DEFAULTS,
	loadBionicConfig,
	resolveActiveTheme,
	type BionicReadingConfig,
} from "../config.js";

describe("CONFIG_DEFAULTS", () => {
	it("ships expected default values", () => {
		expect(CONFIG_DEFAULTS).toEqual({
			enabled: true,
			fixation: 3,
			minWordLength: 2,
			saccade: 1,
			skipHeadings: false,
			splitHyphenated: false,
			invert: false,
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

	// Invert mode (prototype) — config field exists with default false.
	it("defaults `invert` to false", () => {
		expect(CONFIG_DEFAULTS.invert).toBe(false);
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
		// File-load test: opt out of preset overlay so a user-level themes
		// block in the dev's ~/.pi/bionic.jsonc can't bleed into this assertion.
		const config = await loadBionicConfig(cwd, { skipThemePreset: true });
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
		const config = await loadBionicConfig(cwd, { skipThemePreset: true });
		expect(config.prefixStyle).toEqual({ ansi: "ESC//x" });
	});

	it("preserves `/* */` inside string literals (handover task 2)", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			'{ "prefixStyle": { "ansi": "a/* not a comment */b" } }\n',
			"utf-8",
		);
		const config = await loadBionicConfig(cwd, { skipThemePreset: true });
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
		const config = await loadBionicConfig(cwd, { skipThemePreset: true });
		expect(config.prefixStyle).toEqual({ ansi: "a, ]b" });
	});
});

describe("resolveActiveTheme", () => {
	let cwd: string;
	let originalColorFgBg: string | undefined;
	let originalAgentDir: string | undefined;
	let agentDir: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "pi-bionic-theme-cwd-"));
		agentDir = await mkdtemp(join(tmpdir(), "pi-bionic-theme-agent-"));
		originalColorFgBg = process.env.COLORFGBG;
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		// Force the global-settings probe at a deterministic location so we
		// don't read the dev's actual ~/.pi/agent/settings.json mid-test.
		process.env.PI_CODING_AGENT_DIR = agentDir;
		delete process.env.COLORFGBG;
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
		await rm(agentDir, { recursive: true, force: true });
		if (originalColorFgBg === undefined) delete process.env.COLORFGBG;
		else process.env.COLORFGBG = originalColorFgBg;
		if (originalAgentDir === undefined)
			delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	});

	it("honours an explicit `light` pin without touching the filesystem", async () => {
		const resolved = await resolveActiveTheme(cwd, "light");
		expect(resolved).toEqual({
			name: undefined,
			kind: "light",
			source: "manual",
		});
	});

	it("honours an explicit `dark` pin", async () => {
		const resolved = await resolveActiveTheme(cwd, "dark");
		expect(resolved.kind).toBe("dark");
		expect(resolved.source).toBe("manual");
	});

	it("reads the project `.pi/settings.json` `theme` field on auto", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{ "theme": "light" }\n',
			"utf-8",
		);
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved).toEqual({
			name: "light",
			kind: "light",
			source: "project-settings",
		});
	});

	it("falls through to the global agent settings when no project file exists", async () => {
		await writeFile(
			join(agentDir, "settings.json"),
			'{ "theme": "dark" }\n',
			"utf-8",
		);
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved).toEqual({
			name: "dark",
			kind: "dark",
			source: "global-settings",
		});
	});

	it("buckets unknown theme names into `dark` (mirrors host isLightTheme)", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{ "theme": "solarized-mauve" }\n',
			"utf-8",
		);
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved.name).toBe("solarized-mauve");
		expect(resolved.kind).toBe("dark");
		expect(resolved.source).toBe("project-settings");
	});

	it("falls through to COLORFGBG when no settings.json declares a theme", async () => {
		process.env.COLORFGBG = "15;0"; // bg index 0 → dark
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved).toEqual({
			name: undefined,
			kind: "dark",
			source: "colorfgbg",
		});
	});

	it("COLORFGBG with a high bg index resolves to light", async () => {
		process.env.COLORFGBG = "0;15"; // bg index 15 → light
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved.kind).toBe("light");
		expect(resolved.source).toBe("colorfgbg");
	});

	it("final fallback is `dark` with source=default", async () => {
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved).toEqual({
			name: undefined,
			kind: "dark",
			source: "default",
		});
	});

	it("tolerates JSONC comments in pi's settings.json", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{\n\t// dev override\n\t"theme": "light",\n}\n',
			"utf-8",
		);
		const resolved = await resolveActiveTheme(cwd, "auto");
		expect(resolved.kind).toBe("light");
	});
});

describe("applyThemePreset", () => {
	const base: BionicReadingConfig = {
		...CONFIG_DEFAULTS,
		prefixStyle: { color: "red", bold: true },
		themes: {
			light: { fixation: 2, prefixStyle: { color: "blue" } },
			dark: { fixation: 5 },
		},
	};

	it("applies the matching preset on top of the base", () => {
		const out = applyThemePreset(base, "light");
		expect(out.fixation).toBe(2);
		// Shallow replacement: the preset's `prefixStyle` wins as a whole.
		expect(out.prefixStyle).toEqual({ color: "blue" });
	});

	it("keeps base values for keys the preset omits", () => {
		const out = applyThemePreset(base, "dark");
		expect(out.fixation).toBe(5);
		expect(out.prefixStyle).toEqual({ color: "red", bold: true });
	});

	it("is a no-op when no `themes` block is configured", () => {
		const bare: BionicReadingConfig = { ...CONFIG_DEFAULTS };
		const out = applyThemePreset(bare, "light");
		expect(out).toEqual(bare);
	});

	it("is a no-op when the matching preset slot is missing", () => {
		const onlyDark: BionicReadingConfig = {
			...CONFIG_DEFAULTS,
			themes: { dark: { fixation: 1 } },
		};
		const out = applyThemePreset(onlyDark, "light");
		expect(out).toEqual(onlyDark);
	});
});

describe("applyLiveThemeName", () => {
	const base: BionicReadingConfig = {
		...CONFIG_DEFAULTS,
		prefixStyle: { color: "red", bold: true },
		themes: {
			light: { fixation: 2, prefixStyle: { color: "blue" } },
			dark: { fixation: 5, prefixStyle: { color: "brightYellow" } },
		},
	};

	it("returns null when liveName is undefined (no signal yet)", () => {
		expect(applyLiveThemeName(base, undefined)).toBeNull();
	});

	it("classifies `light` as light and applies the light preset", () => {
		const out = applyLiveThemeName(base, "light");
		expect(out).not.toBeNull();
		expect(out!.kind).toBe("light");
		expect(out!.config.fixation).toBe(2);
		expect(out!.config.prefixStyle).toEqual({ color: "blue" });
	});

	it("classifies `dark` as dark and applies the dark preset", () => {
		const out = applyLiveThemeName(base, "dark");
		expect(out).not.toBeNull();
		expect(out!.kind).toBe("dark");
		expect(out!.config.fixation).toBe(5);
	});

	it("buckets unknown theme names into dark (mirrors classifyThemeName)", () => {
		const out = applyLiveThemeName(base, "solarized-mauve");
		expect(out!.kind).toBe("dark");
		expect(out!.config.fixation).toBe(5);
	});

	it("returns null when manual `themeKind: light` pin is set (live changes inert)", () => {
		const pinned: BionicReadingConfig = { ...base, themeKind: "light" };
		// Pi flipped to dark; pin must win.
		expect(applyLiveThemeName(pinned, "dark")).toBeNull();
		// Even matching the pin still returns null — caller decides whether
		// to do anything based on its own resolvedThemeKind memo.
		expect(applyLiveThemeName(pinned, "light")).toBeNull();
	});

	it("returns null when manual `themeKind: dark` pin is set", () => {
		const pinned: BionicReadingConfig = { ...base, themeKind: "dark" };
		expect(applyLiveThemeName(pinned, "light")).toBeNull();
		expect(applyLiveThemeName(pinned, "dark")).toBeNull();
	});

	it("`themeKind: auto` does NOT pin (auto means \"react to live signal\")", () => {
		const auto: BionicReadingConfig = { ...base, themeKind: "auto" };
		const out = applyLiveThemeName(auto, "light");
		expect(out).not.toBeNull();
		expect(out!.kind).toBe("light");
	});

	it("surfaces prefix-style warnings on flip when the preset has invalid color", () => {
		const broken: BionicReadingConfig = {
			...CONFIG_DEFAULTS,
			themes: {
				light: { prefixStyle: { color: "not-a-real-color" } },
			},
		};
		const out = applyLiveThemeName(broken, "light");
		expect(out).not.toBeNull();
		expect(out!.prefixWarnings.length).toBeGreaterThan(0);
	});

	it("resolves prefixWrap from the preset's prefixStyle, not the base's", () => {
		// Live flip from dark base prefixStyle (red) to light preset (blue).
		// The wrap function must reflect blue, not red.
		const lightFlip = applyLiveThemeName(base, "light");
		const darkFlip = applyLiveThemeName(base, "dark");
		expect(lightFlip!.prefixWrap).toBeTypeOf("function");
		expect(darkFlip!.prefixWrap).toBeTypeOf("function");
		// Different presets → different wrap closures (no accidental reuse).
		expect(lightFlip!.prefixWrap).not.toBe(darkFlip!.prefixWrap);
	});

	it("falls through cleanly when no themes block is configured", () => {
		const bare: BionicReadingConfig = { ...CONFIG_DEFAULTS };
		const out = applyLiveThemeName(bare, "light");
		expect(out).not.toBeNull();
		expect(out!.kind).toBe("light");
		// applyThemePreset is a no-op when there's no preset; config equals base.
		expect(out!.config.fixation).toBe(bare.fixation);
	});
});

describe("loadBionicConfig — theme integration", () => {
	let cwd: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;
	let originalColorFgBg: string | undefined;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "pi-bionic-theme-load-"));
		agentDir = await mkdtemp(join(tmpdir(), "pi-bionic-theme-load-agent-"));
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		originalColorFgBg = process.env.COLORFGBG;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		delete process.env.COLORFGBG;
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
		await rm(agentDir, { recursive: true, force: true });
		if (originalAgentDir === undefined)
			delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		if (originalColorFgBg === undefined) delete process.env.COLORFGBG;
		else process.env.COLORFGBG = originalColorFgBg;
	});

	it("applies the `light` preset when pi's project settings select light", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{ "theme": "light" }\n',
			"utf-8",
		);
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			JSON.stringify({
				fixation: 3,
				prefixStyle: { color: "red", bold: true },
				themes: {
					light: {
						fixation: 2,
						prefixStyle: { color: "blue", bold: true },
					},
					dark: { fixation: 4 },
				},
			}),
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.fixation).toBe(2);
		expect(config.prefixStyle).toEqual({ color: "blue", bold: true });
	});

	it("applies the `dark` preset when no theme is configured (default fallback)", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			JSON.stringify({
				fixation: 3,
				themes: {
					light: { fixation: 2 },
					dark: { fixation: 4 },
				},
			}),
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.fixation).toBe(4);
	});

	it("a manual `themeKind: light` pin overrides pi's settings.json", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{ "theme": "dark" }\n',
			"utf-8",
		);
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			JSON.stringify({
				themeKind: "light",
				themes: {
					light: { fixation: 2 },
					dark: { fixation: 4 },
				},
			}),
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.fixation).toBe(2);
		expect(config.themeKind).toBe("light");
	});

	it("keeps `themes` and `themeKind` reachable on the resolved config", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			JSON.stringify({
				themeKind: "dark",
				themes: { dark: { fixation: 5 } },
			}),
			"utf-8",
		);
		const config = await loadBionicConfig(cwd);
		expect(config.themes).toEqual({ dark: { fixation: 5 } });
		expect(config.themeKind).toBe("dark");
	});

	it("`skipThemePreset: true` returns the unlayered base config", async () => {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			'{ "theme": "dark" }\n',
			"utf-8",
		);
		await writeFile(
			join(cwd, ".pi", "bionic.jsonc"),
			JSON.stringify({
				fixation: 3,
				themes: {
					dark: { fixation: 5 },
				},
			}),
			"utf-8",
		);
		const layered = await loadBionicConfig(cwd);
		const base = await loadBionicConfig(cwd, { skipThemePreset: true });
		expect(layered.fixation).toBe(5); // dark preset wins by default
		expect(base.fixation).toBe(3); // base untouched
		expect(base.themes).toEqual({ dark: { fixation: 5 } }); // preset still reachable
	});
});
