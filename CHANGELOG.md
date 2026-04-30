# Changelog

All notable changes to `pi-bionic-reading` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] — 2026

### Changed

- **Color rejection toasts now enumerate ANSI's named palette inline.**
  When `/bionic color <value>` is rejected (or `/bionic color` runs
  empty), the toast appends `named colors: black, red, green, yellow,
  blue, magenta, cyan, white, brightBlack, gray, brightRed, brightGreen,
  brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite` so
  the `<name>` placeholder in `valid options:` stops being opaque — a
  user who tries `purple` and gets rejected can now pick `magenta`
  without leaving the editor. README gains a matching "Named colors"
  table for passive reference.

## [0.4.0] — 2026

### Added

- **`/bionic color none` clears the color override.** Drops only the
  `color` field from the active `prefixStyle`, leaving decorations and the
  `ansi` escape hatch intact. When no decoration remains, the renderer
  falls through to the host's `theme.bold` — i.e. the terminal's default
  foreground. Mirrors the existing `/bionic style none` clear sentinel.
- **`/bionic invert` toggles suffix-bolding (prototype).** Inverts the
  fixation cue: same partition, but the `**…**` wrap lands on the
  SUFFIX of each sub-word instead of the prefix — useful for users who
  track a trailing cue more easily than a leading one. Each sub-word
  inverts independently, so camelCase / acronym splits still produce one
  cue per sub-word. Persistable in `bionic.jsonc` via the new
  `invert: boolean` config field; toggleable live with `/bionic invert`
  (session-only). Default `false`.

- **Per-theme presets (prototype).** New optional `themes` block in
  `bionic.jsonc` lets you stash separate `light` / `dark` presets that
  override the base config when pi's active theme matches. Boot-time
  resolution walks `themeKind` (manual pin) → project
  `<cwd>/.pi/settings.json` → global `~/.pi/agent/settings.json` →
  `COLORFGBG` heuristic → `"dark"`. Theme name classification mirrors
  pi's `isLightTheme()` (literal name match against `"light"`); pin
  `themeKind` for custom light themes. Replacement is shallow at the top
  level; `prefixStyle` swaps as a whole.
- **Live theme reactivity.** The patched render now reads
  `ctx.ui.theme.name` from pi's `ExtensionContext` and re-derives the
  active preset whenever the kind flips. Composes transparently with
  `the-themer` (or any other extension calling `ctx.ui.setTheme()`) —
  no pi restart, no filesystem watcher, no extension-to-extension
  coupling. Cost per render: one property dereference + one strict-equal
  compare on the fast path. Manual `themeKind: "light"` / `"dark"` pins
  are honored on the live path too — a pinned config will not flip when
  pi's terminal theme changes mid-session, matching the documented
  "manual pin wins over both paths" guarantee.
- **Flip-time prefix-style warnings surface as toasts**, matching the
  existing `/bionic color` slash-command behavior. Falls back to
  `console.warn` only when reconcile fires before `session_start`.
- **Unified rejection-toast format.** Every `/bionic` rejection toast now
  follows one template: `[bionic] /bionic <subcmd>: <reason>; valid options:
  <list>`. The previous mix — parser-level `usage: /bionic color <forms>`,
  validator-level `prefixStyle.color: unrecognized color "X"`, and a
  cryptic `[...]` POSIX-repetition mark on `style` — has been replaced with
  a single shape so the language and structure match across surfaces.
  Validator warnings reframe their `prefixStyle.color:` prefix to
  `/bionic color:` so the toast cites what the user typed, not the JSONC
  config key. The `style` toast spells out the multi-token affordance
  explicitly ("one or more, space-separated") instead of `[...]`. The
  motivating case — `/bionic color off` — now reads
  `[bionic] /bionic color: unrecognized color "off"; valid options:
  <name|#hex|256:N|rgb:R,G,B|none>`, surfacing the `none` clear-sentinel
  the user couldn't recall. Config-load warnings (logged from
  `bionic.jsonc` parsing) keep their original text, since `none` is a
  slash-command sentinel and would be misleading in a config error.

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
