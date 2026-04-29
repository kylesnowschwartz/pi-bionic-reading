# Changelog

All notable changes to `pi-bionic-reading` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
