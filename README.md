# pi-bionic-reading

A [pi](https://github.com/badlogic/pi-mono) extension that bolds the leading letters of each word in assistant prose, so your eye fixates on the prefix and your brain fills in the rest. The transform is display-only and never reaches the conversation context the model sees.

## What it does

For each word in rendered assistant prose, the leading letters get wrapped in `**…**` (markdown bold):

> **Bion**ic **Read**ing **i**s **a** **n**ew **meth**od **fac**ilitating **th**e **rea**ding **proc**ess **b**y **gui**ding **th**e **eye**s **thro**ugh **te**xt **wi**th **artif**icial **fixa**tion **poin**ts.

The Markdown component's `this.text` is left untouched, so subsequent LLM turns never see the `**…**` markers. Toggling on or off mid-session does not change stored conversation state.

Code blocks, inline code spans, link URLs, autolinks, raw HTML, and link reference definitions are preserved verbatim. Only prose gets transformed.

## Status

v0.1. The implementation is a monkey-patch over `Markdown.prototype.render` from `@mariozechner/pi-tui`. It works against the current pi version with no upstream changes. The plan is to upstream a `registerTextRenderer` hook in `pi-coding-agent` so the patch is no longer needed.

## Install

```bash
pi install <path-to-this-directory>
# or add the repo to ~/.pi/agent/extension-repos.json
```

Once installed, bionic mode is on by default. Use `/bionic` to toggle it.

## Commands

| Command       | Effect                                              |
| ------------- | --------------------------------------------------- |
| `/bionic`     | Toggle on/off                                       |
| `/bionic on`  | Enable                                              |
| `/bionic off` | Disable                                             |
| `/bionic 1`   | Enable + heaviest fixation (bold ~80% of each word) |
| `/bionic 3`   | Enable + balanced (default; bold ~50%)              |
| `/bionic 5`   | Enable + lightest (bold ~30%)                       |

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
  "skipHeadings": false
}
```

All fields are optional. Defaults shown above.

## How it works

1. **On load.** The extension wraps `Markdown.prototype.render` from `@mariozechner/pi-tui`. The original method is captured and stashed on `globalThis` so reload is idempotent.
2. **On each render call.** If the master switch is on, the source markdown runs through `bionicifyMarkdown()`, a regex-driven walker that identifies forbidden character ranges (fenced code, inline code, link URLs, autolinks, raw HTML, ref-link definitions) and applies `bionicifyText()` only to the safe spans in between.
3. **Per-instance caching.** A `WeakMap` keyed on source text plus width avoids re-parsing on every redraw. The Markdown component's own cache is invalidated on every call, so toggling on or off never leaks stale output.
4. **On `session_shutdown`.** The original `render` is restored.

## Files

| File             | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `index.ts`       | Entry point. Monkey-patch, command, lifecycle.       |
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
