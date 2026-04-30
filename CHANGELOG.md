# Changelog

All notable changes to `pi-bionic-reading` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2025

### Added

- **Identifier-aware tokenization.** `camelCase` / `PascalCase` /
  `snake_case` / `kebab-case` identifiers are now treated as if each segment
  were a separate word, so the bionic prefix lands on every component
  (`HTTPServer` → `HTTP` + `Server`, `auto-save_on_exit` bolds each segment).
  Previously the whole identifier got a single prefix.
- **`splitHyphenated` config field** (default `false`). Opt-in to splitting
  hyphenated tokens like `react-router-dom`. Off by default to preserve
  English compounds (`well-known`, `state-of-the-art`).
- **`prefixStyle` config field** for ANSI styling of the bionic prefix.
  Accepts named colors, hex (`#rrggbb`), 256-color (`256:N`), `rgb:R,G,B`,
  raw `ansi` escape, and decoration toggles (`bold`, `dim`, `italic`,
  `underline`). Falls back to host `theme.bold` when unset.
- **`/bionic color <value>`** and **`/bionic style <tokens…>`** slash
  subcommands for live styling. `style` toggles each token (second invocation
  removes it); `style none` clears all decorations.
- **Strict validation guard.** Invalid `color` / `style` input preserves the
  previous valid state and surfaces a single warning toast — no more partial
  application where one bad token silently dropped a sibling.
- **`AGENTS.md`** documenting dep / changelog / release rules for
  contributors and AI agents.
- Runtime dep: `jsonc-parser` ^3.3.1 (Microsoft, MIT, zero transitive deps).

### Fixed

- **Host message background no longer stripped at the bionic prefix.** The
  close escape now emits targeted SGR codes (`22;23;24;39`) for only the
  attributes the prefix opened, instead of a universal `\u001b[0m` reset.
  User-message tinting and assistant theme backgrounds survive intact.
- **`bionic.jsonc` string literals containing `//`, block comments, or
  `,]` / `,}` no longer get corrupted at parse time.** The previous
  hand-rolled comment stripper ran across the whole input, including inside
  quoted strings — fatal for OSC 8 hyperlinks in `prefixStyle.ansi`.
  Replaced with the `jsonc-parser` library.


## [0.2.0] — 2025

### Added

- **Configurable hotkey to toggle bionic mode.** New `hotkey` field in
  `bionic.jsonc` (default `"ctrl+x"`). Registered via pi's `registerShortcut`
  API; same toggle behaviour as `/bionic`. Set to `null` or `""` to disable.
  The `BionicHotkey` type is `KeyId | null`, so TypeScript-side configs catch
  unsupported modifiers (`cmd`, `super`, `meta`) at compile time.
- **Active hotkey displayed in toggle toasts.** `[bionic] enabled (fixation 3)`
  is now `[bionic] enabled (fixation 3) · ctrl+x`, so the configured binding is
  visible every time you toggle. Suffix is suppressed when no hotkey is set.
- **README troubleshooting section** ("Hotkey not firing?") covering hard vs.
  soft built-in conflicts, terminal/tmux/macOS keystroke interception, and the
  `cmd+...` non-starter on TTYs.
- **Soft-conflict note for the default `ctrl+x`**, explaining the
  `app.models.clearAll` startup diagnostic emitted by recent pi versions and
  why the binding still works.
- **Tests for `loadBionicConfig`**: defaults shape, project override, `null`
  hotkey, and JSONC comment/trailing-comma tolerance.

### Changed

- `/bionic` command now delegates its `toggle` branch to a shared
  `toggleBionic` helper used by the hotkey too — keeping behaviour identical
  across both entry points.
- `/bionic toggle` is documented in the commands table (was always accepted,
  never listed).

## [0.1.0]

Initial release. Bionic-reading transform applied to rendered Markdown via a
monkey-patch on `Markdown.prototype.render`, with `/bionic [on|off|toggle|1..5]`
command and `bionic.jsonc` configuration. See git history for the development
arc.
