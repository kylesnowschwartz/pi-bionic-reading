# pi-bionic-reading

A [pi](https://github.com/badlogic/pi-mono) extension that bolds the leading letters of each word in assistant prose, so your eye fixates on the prefix and your brain fills in the rest. The transform is display-only and never reaches the conversation context the model sees.

![bionic mode demo: toggling the extension on a sample assistant turn](./bionic-demo.gif)

## What it does

For each word in rendered assistant prose, the leading letters get wrapped in `**…**` (markdown bold):

> **Bion**ic **Read**ing **i**s **a** **n**ew **meth**od **fac**ilitating **th**e **rea**ding **proc**ess **b**y **gui**ding **th**e **eye**s **thro**ugh **te**xt **wi**th **artif**icial **fixa**tion **poin**ts.

The Markdown component's `this.text` is left untouched, so subsequent LLM turns never see the `**…**` markers. Toggling on or off mid-session does not change stored conversation state.

Code blocks, inline code spans, link URLs, autolinks, raw HTML, link reference definitions, and LaTeX math (`$…$` inline and `$$…$$` block) are preserved verbatim. Only prose gets transformed.

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

If `PI_CODING_AGENT_DIR` is set, the user-level file is read from `$PI_CODING_AGENT_DIR/bionic.jsonc` instead — next to `settings.json`, mirroring how the rest of pi treats the variable. The legacy `~/.pi/bionic.jsonc` path is kept when the variable is unset, so existing setups don't move.

```jsonc
{
  // Master switch.
  "enabled": true,

  // Fixation strength: 1 (heaviest, ~80% bold) … 5 (lightest, ~30%).
  "fixation": 3,

  // Skip words shorter than this. 1 = bold every letter; 2 = skip 1-letter words.
  "minWordLength": 2,

  // Bold every Nth word. 1 = every word, 2 = alternate, etc.
  "saccade": 1,

  // Leave heading lines verbatim instead of bolding their words.
  "skipHeadings": false,

  // Split hyphenated tokens (`react-router-dom` → `**rea**ct-**rou**ter-**d**om`)
  // into per-segment sub-words. Default false preserves English compounds
  // like `well-known`. Turn on if you read a lot of identifier-heavy prose.
  "splitHyphenated": false,

  // Bold the SUFFIX of each word instead of the prefix (toggleable live
  // via `/bionic invert`).
  "invert": false,

  // ANSI styling for the bolded prefix. Omit to use the host's default bold
  // style (typically just SGR-1, which on bright-colored fonts can be
  // invisible). All subfields are optional and combine.
  //
  //   color    : "red" / "brightWhite" / "gray" (see table below),
  //              "#ffaa00", "256:208", or "rgb:255,170,0".
  //   bold     : SGR 1 (combines with color)
  //   italic   : SGR 3
  //   underline: SGR 4
  //   dim      : SGR 2 (use alone for an inverted-contrast cue —
  //              dimmed prefix, normal-weight rest)
  //   ansi     : raw escape-sequence escape hatch — wins over the above.
  //              e.g. "\u001b[38;5;226;1m". Close is always \u001b[0m, so
  //              use only if your terminal will absorb the universal reset
  //              cleanly; the structured fields emit targeted SGR closes
  //              that preserve background color and other line-level attrs.
  //
  // Side-effect: while bionic is on, this style also applies to user-authored
  // **bold** literals in assistant messages (the override targets theme.bold).
  "prefixStyle": { "color": "red", "bold": true },

  // Hotkey to toggle bionic mode on/off. Same string format pi uses for
  // keybindings (e.g. "ctrl+x", "ctrl+q", "f6"). Set to null or "" to
  // disable. Conflicts with built-in pi shortcuts are reported and skipped.
  // Note: pi-tui only supports ctrl/shift/alt modifiers — Cmd is unreachable
  // from a TTY on macOS, so "cmd+..." bindings will not work.
  "hotkey": "ctrl+x",

  // (Prototype) Pin the active theme kind. "auto" reads pi's configured
  // theme via ctx.ui.theme.name and re-layers the matching `themes` preset
  // below on every render. Set to "light" or "dark" to override and
  // decouple your bionic style from pi's terminal theme.
  "themeKind": "auto",

  // (Prototype) Per-theme presets, applied as a final layer on top of the
  // base above when the active kind matches. Any base field can be
  // overridden; `prefixStyle` is replaced as a whole, not deep-merged.
  // Live `/bionic` commands do not write into these blocks — a theme flip
  // rebuilds from this file and clobbers any session-only tweaks.
  "themes": {
    "light": {
      "fixation": 2,
      "prefixStyle": { "color": "blue", "bold": true }
    },
    "dark": {
      "fixation": 4,
      "prefixStyle": { "color": "brightYellow", "underline": true },
      "invert": true
    }
  }
}
```

All fields are optional — delete anything you don't want to override. The values shown match the defaults except for `prefixStyle`, `themeKind`, and `themes`, which are unset by default.

### Named colors

`prefixStyle.color` (and `/bionic color <value>`) accepts these named
colors. Anything else — `purple`, `orange`, etc. — isn't part of ANSI's
named palette and is rejected; reach for `#rrggbb`, `256:N`, or `rgb:R,G,B`
if you want a color outside this set.

| Standard (SGR 30–37) | Bright (SGR 90–97)            |
| --------------------- | ------------------------------ |
| `black`               | `brightBlack` (alias: `gray`)  |
| `red`                 | `brightRed`                    |
| `green`               | `brightGreen`                  |
| `yellow`              | `brightYellow`                 |
| `blue`                | `brightBlue`                   |
| `magenta`             | `brightMagenta`                |
| `cyan`                | `brightCyan`                   |
| `white`               | `brightWhite`                  |

Names are case-sensitive in `bionic.jsonc` and on `/bionic color`
(`brightWhite`, not `BRIGHTWHITE` or `brightwhite`). The `gray` alias maps
to the same SGR code as `brightBlack`. The rejection toast for an
unrecognized name lists this set inline so you can pick a substitute
without leaving the editor.

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

The `/bionic` toast (e.g. `[bionic] enabled (fixation 3)`) is your confirmation the binding fired.

**Note on the default `ctrl+x`.** Recent pi versions bind `ctrl+x` to `app.models.clearAll` inside the model-selector overlay (opened with `Ctrl+L`). This is a *soft* conflict (`restrictOverride: false`): the runner logs `Extension shortcut conflict: 'ctrl+x' is built-in shortcut for app.models.clearAll …` at startup, then hands the binding to this extension.

## Algorithm credits

The word-bolding tables and `getBoldLength()` function in `bionic.ts` are vendored (with attribution in code and `LICENSE`) from:

- **[text-vide](https://github.com/Gumball12/text-vide)** v1.8.5, MIT, © 2022 Gumball12. The de facto open-source JS implementation of bionic-reading-style fixation. Provides the 5-level fixation tables.
- **[data-bionic-reading](https://github.com/markmead/data-bionic-reading)** v2.0.1, MIT, © 2024 Mark Mead. Source of the unicode word regex that keeps hyphenated words ("well-known") and contractions ("don't") as single tokens.

The "Bionic Reading" name is a trademark of Bionic Reading AG. This extension does not use the trademark in branding; the algorithm itself is unencumbered (text-vide [discusses this explicitly](https://github.com/Gumball12/text-vide/issues/38)).

Saccade support (bold every Nth word) is not present in either upstream and is implemented here.

## License

MIT. See [`LICENSE`](./LICENSE) for details and third-party attributions.
