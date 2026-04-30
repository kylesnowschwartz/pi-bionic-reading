# pi-bionic-reading

A [pi](https://github.com/badlogic/pi-mono) extension that bolds the leading letters of each word in assistant prose, so your eye fixates on the prefix and your brain fills in the rest. The transform is display-only and never reaches the conversation context the model sees.

![bionic mode demo: toggling the extension on a sample assistant turn](./bionic-demo.gif)

## What it does

For each word in rendered assistant prose, the leading letters get wrapped in `**…**` (markdown bold):

> **Bion**ic **Read**ing **i**s **a** **n**ew **meth**od **fac**ilitating **th**e **rea**ding **proc**ess **b**y **gui**ding **th**e **eye**s **thro**ugh **te**xt **wi**th **artif**icial **fixa**tion **poin**ts.

The Markdown component's `this.text` is left untouched, so subsequent LLM turns never see the `**…**` markers. Toggling on or off mid-session does not change stored conversation state.

Code blocks, inline code spans, link URLs, autolinks, raw HTML, and link reference definitions are preserved verbatim. Only prose gets transformed.

Identifiers in prose (`useEffect`, `XMLParser`, `snake_case`) are split on case and underscore boundaries before bolding, so each sub-word gets its own fixation cue: `**u**se**Eff**ect`, `**X**ML**Par**ser`, `**sn**ake_**ca**se`. Hyphenated tokens stay whole by default to preserve English compounds like `**well**-known`.

## Status

v0.1. The implementation is a monkey-patch over `Markdown.prototype.render` from `@mariozechner/pi-tui`. It works against the current pi version with no upstream changes. The plan is to upstream a `registerTextRenderer` hook in `pi-coding-agent` so the patch is no longer needed.

## Install

```bash
pi install <path-to-this-directory>
# or add the repo to ~/.pi/agent/extension-repos.json
```

Once installed, bionic mode is on by default. Use `/bionic` or press `Ctrl+X` (configurable) to toggle it.

## Commands

| Command                          | Effect                                              |
| -------------------------------- | --------------------------------------------------- |
| `/bionic`                        | Toggle on/off                                       |
| `/bionic toggle`                 | Toggle on/off (explicit form)                       |
| `/bionic on`                     | Enable                                              |
| `/bionic off`                    | Disable                                             |
| `/bionic 1`                      | Enable + heaviest fixation (bold ~80% of each word) |
| `/bionic 3`                      | Enable + balanced (default; bold ~50%)              |
| `/bionic 5`                      | Enable + lightest (bold ~30%)                       |
| `/bionic color <value>`          | Set prefix color: name, `#rrggbb`, `256:N`, `rgb:R,G,B` |
| `/bionic color none`             | Drop the color override; fall back to the terminal default foreground |
| `/bionic style bold`             | **Toggle** a decoration on/off (also: `dim`, `italic`, `underline`). Repeat to flip back. |
| `/bionic style bold underline`   | Toggle multiple decorations in one call (each independently)        |
| `/bionic style none`             | Force-clear all four decoration booleans                            |
| `/bionic invert`                 | Toggle suffix-bolding: bold the *end* of each word instead of the start (prototype) |
| `Ctrl+X` (hotkey)                | Toggle on/off (configurable, see below)                             |

Color and style changes apply for the rest of the session only — they do **not** write to `bionic.jsonc`. See the *Slash commands vs. file persistence* section below.

Changes apply on the next render. Type a character or wait for the next assistant turn to see the effect.

## Configuration

Create `~/.pi/bionic.jsonc` (user-level) or `<project>/.pi/bionic.jsonc` (project-level). Project values override user values.

```jsonc
{
  // Master switch
  "enabled": true,

  // Fixation strength: 1 (heaviest) … 5 (lightest)
  "fixation": 3,

  // Skip words shorter than this (1 = bold every letter; 2 = skip 1-letter words)
  "minWordLength": 2,

  // Bold every Nth word (1 = every word, 2 = alternate, etc.)
  "saccade": 1,

  // Leave heading lines verbatim instead of bolding their words
  "skipHeadings": false,

  // Split hyphenated tokens (`react-router-dom` → `**rea**ct-**rou**ter-**d**om`)
  // into per-segment sub-words. Default false to preserve English compounds
  // like `well-known`. Turn on if you read a lot of identifier-heavy prose.
  "splitHyphenated": false,

  // ANSI styling for the bolded prefix. When unset, the host's default bold
  // style is used (typically just SGR-1, which on bright-colored fonts can
  // be invisible). Set this to add a color or alternate decoration.
  //
  //   color    : named ("red", "brightWhite", "gray"…), "#rrggbb",
  //              "256:N" (0–255), or "rgb:R,G,B" (each 0–255).
  //   bold     : SGR 1 (additional, on top of color)
  //   italic   : SGR 3
  //   underline: SGR 4
  //   dim      : SGR 2
  //   ansi     : raw escape-sequence escape hatch — wins over the above.
  //              Close is always \u001b[0m. Use this only if you know your
  //              terminal will absorb the universal reset cleanly; structured
  //              fields (above) emit targeted SGR closes that preserve the
  //              host's background color and other line-level attributes.
  //
  // Side-effect: while bionic is on, this style also applies to user-authored
  // **bold** literals in assistant messages (the override targets theme.bold).
  // "prefixStyle": { "color": "red", "bold": true },


  // Hotkey to toggle bionic mode on/off. Same string format pi uses for
  // keybindings (e.g. "ctrl+x", "ctrl+q", "f6"). Set to null or "" to
  // disable. Conflicts with built-in pi shortcuts are reported and skipped.
  // Note: pi-tui only supports ctrl/shift/alt modifiers — Cmd is unreachable
  // from a TTY on macOS, so "cmd+..." bindings will not work.
  "hotkey": "ctrl+x"
}
```

All fields are optional. Defaults shown above.

### Configuration examples

Drop any of these into `~/.pi/bionic.jsonc` (user-level) or
`<project>/.pi/bionic.jsonc` (project-level). Project values override user
values; both layers merge over the defaults.

**1. Make the bionic prefix vivid red on a dark terminal:**

```jsonc
{ "prefixStyle": { "color": "red", "bold": true } }
```

**2. Use a 256-color amber that survives most palettes:**

```jsonc
{ "prefixStyle": { "color": "256:208" } }
```

**3. Truecolor hex — only works on terminals with truecolor support:**

```jsonc
{ "prefixStyle": { "color": "#ffaa00" } }
```

**4. No color, just dim the prefix — inverts the usual contrast (prefix is
the *quiet* part, rest of the word is the *loud* part):**

```jsonc
{ "prefixStyle": { "dim": true } }
```

**5. Read a lot of code-heavy assistant prose? Turn on hyphen splitting and
use a contrast-friendly color:**

```jsonc
{
  "splitHyphenated": true,
  "prefixStyle": { "color": "brightWhite", "bold": true }
}
```

**6. Lightest fixation (bold ~30%) plus underline so the cue is visible
without dominating the line:**

```jsonc
{
  "fixation": 5,
  "prefixStyle": { "underline": true }
}
```

**7. Raw ANSI escape hatch — useful if your terminal has a custom palette
you want to target precisely:**

```jsonc
{ "prefixStyle": { "ansi": "\u001b[38;5;226;1m" } }
```

### Slash commands vs. file persistence

`/bionic color`, `/bionic style`, and the toggle commands all mutate the
**active session only** — they do not write to `bionic.jsonc`. The intended
workflow is:

1. Experiment live: `/bionic color blue`, `/bionic style underline`, etc.
2. When you find a combination you like, copy it into `bionic.jsonc`.
3. Restart pi to confirm the file-based config produces the same look.

Each new pi session starts from `bionic.jsonc` afresh; whatever you typed
into the previous session does not carry over.

### Hotkey not firing?

The `/bionic` toast (e.g. `[bionic] enabled (fixation 3)`) is your confirmation the binding fired. If it doesn't appear when you press the configured key:

1. **Hard conflict with a pi built-in.** Pi's keybinding registry marks some shortcuts as non-overridable. The runner skips your binding entirely and logs a warning at extension load. Check pi's startup diagnostics after a config change.
2. **Key swallowed upstream.** Tmux leaders, terminal-emulator menu shortcuts, and macOS system shortcuts all consume keystrokes before pi's stdin sees them. `Ctrl+B` under tmux's default leader, for example, never reaches pi.
3. **Cmd-based shortcut.** pi-tui only recognises `ctrl`/`shift`/`alt` modifiers, and TTYs on macOS can't see Cmd at all. Anything starting with `cmd+` won't work.

**Note on the default `ctrl+x`.** Recent pi versions bind `ctrl+x` to `app.models.clearAll` inside the model-selector overlay (the surface you open with `Ctrl+L`). This is a *soft* conflict (`restrictOverride: false`): the runner logs `Extension shortcut conflict: 'ctrl+x' is built-in shortcut for app.models.clearAll and … Using …/index.ts.` at startup, then hands the binding to this extension. The toggle works in the editor as expected; the only effect is that pressing `Ctrl+X` inside the model selector toggles bionic instead of clearing models. If you'd rather avoid the diagnostic line and keep the model-selector default, set `"hotkey": "ctrl+\\"` (or any other free key) in `bionic.jsonc`.

## How it works

1. **On load.** The extension wraps `Markdown.prototype.render` from `@mariozechner/pi-tui`. The original method is captured and stashed on `globalThis` so reload is idempotent.
2. **On each render call.** If the master switch is on, the source markdown runs through `bionicifyMarkdown()`, a regex-driven walker that identifies forbidden character ranges (fenced code, inline code, link URLs, autolinks, raw HTML, ref-link definitions) and applies `bionicifyText()` only to the safe spans in between.
3. **Per-instance caching.** A `WeakMap` keyed on source text plus width avoids re-parsing on every redraw. The Markdown component's own cache is invalidated on every call, so toggling on or off never leaks stale output.
4. **On `session_shutdown`.** The original `render` is restored.

## Files

| File             | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `index.ts`       | Entry point. Monkey-patch, command, hotkey, lifecycle. |
| `bionic.ts`      | Word-level algorithm and fixation tables.            |
| `transform.ts`   | Markdown-aware walker and forbidden-range detection. |
| `config.ts`      | JSONC config loader (user + project merge).          |
| `test/*.test.ts` | Vitest unit tests.                                   |

## Development

```bash
npm install
npm test            # vitest run
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
```

## Algorithm credits

The word-bolding tables and `getBoldLength()` function in `bionic.ts` are vendored (with attribution in code and `LICENSE`) from:

- **[text-vide](https://github.com/Gumball12/text-vide)** v1.8.5, MIT, © 2022 Gumball12. The de facto open-source JS implementation of bionic-reading-style fixation. Provides the 5-level fixation tables.
- **[data-bionic-reading](https://github.com/markmead/data-bionic-reading)** v2.0.1, MIT, © 2024 Mark Mead. Source of the unicode word regex that keeps hyphenated words ("well-known") and contractions ("don't") as single tokens.

The "Bionic Reading" name is a trademark of Bionic Reading AG. This extension does not use the trademark in branding; the algorithm itself is unencumbered (text-vide [discusses this explicitly](https://github.com/Gumball12/text-vide/issues/38)).

Saccade support (bold every Nth word) is not present in either upstream and is implemented here.

## License

MIT. See [`LICENSE`](./LICENSE) for details and third-party attributions.
