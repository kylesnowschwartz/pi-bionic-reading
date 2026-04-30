---
description: Output plain-text case-style samples for QA-ing bionic rendering
---
You are helping QA the `pi-bionic-reading` extension. The goal is to emit a
fixed set of plain-text sentences that exercise different identifier casing
conventions and word-boundary edge cases, so the bionic transform can be
eyeballed for correct fixation bolding across them.

## Output rules

- Output the block below **verbatim as plain assistant prose** (yes, this is bold on purpose). No preamble,
  no trailing commentary, no "here you go" lines.
- Do **not** wrap the casing samples in code fences or inline code. Bionic
  skips code spans, which would defeat the test. (The trailing "What you
  should see" checklist is exempt: it uses inline code on purpose so the
  literal `**…**` markers display as text instead of being re-transformed.)
- Keep the bold section labels (`**camelCase**` etc.) — they are markdown
  emphasis, not headings, and bionic should leave them untouched while still
  fixating the sentence underneath.
- Preserve blank lines exactly as shown so each label/sample pair renders as
  its own paragraph.
- Do not paraphrase, reorder, or "improve" the samples between runs — the
  point is that the input is identical every time so visual diffs are real.

## Spec coverage map

Each labeled section below targets specific acceptance criteria from
`.agent-history/SPEC.md`. The reviewer should run `/cases`, eyeball the
rendered output, then re-run with `splitHyphenated` flipped to confirm the
kebab/Train sections change while everything else stays identical.

| Section                              | Targets                                |
| ------------------------------------ | -------------------------------------- |
| camelCase                            | S1-AC1 (lower→Upper split)             |
| PascalCase                           | S1-AC1                                 |
| Acronym-then-word boundaries         | S1-AC2 (Upper→Upper+lower split)       |
| snake_case / SCREAMING_SNAKE_CASE    | S2 (underscore stays a separator)      |
| kebab-case / Train-Case              | S3-AC2 (off) vs S3-AC3 (on)            |
| Mixed / acronym-heavy                | S1-AC2 + S2 interaction                |
| Numerics & short tokens              | S1-AC1 digit→Upper, minWordLength edge |
| Single-letter & all-caps runs        | minWordLength regression guard         |

## Output

Here are some plain-text samples across common casing conventions. Each line is a short sentence so you can eyeball how the renderer handles word boundaries, separators, and runs of caps.

**camelCase**
the quickBrownFox jumpsOver theLazyDog while parsingJsonResponse from someRemoteEndpoint.

**PascalCase**
The QuickBrownFox Jumps Over TheLazyDog While ParsingJsonResponse From SomeRemoteEndpoint.

**snake_case**
the quick_brown_fox jumps_over the_lazy_dog while parsing_json_response from some_remote_endpoint.

**SCREAMING_SNAKE_CASE**
THE QUICK_BROWN_FOX JUMPS_OVER THE_LAZY_DOG WHILE PARSING_JSON_RESPONSE FROM SOME_REMOTE_ENDPOINT.

**kebab-case**
the quick-brown-fox jumps-over the-lazy-dog while parsing-json-response from some-remote-endpoint.

**Train-Case**
The Quick-Brown-Fox Jumps-Over The-Lazy-Dog While Parsing-Json-Response From Some-Remote-Endpoint.

**dot.case**
the quick.brown.fox jumps.over the.lazy.dog while parsing.json.response from some.remote.endpoint.

**path/case**
the quick/brown/fox jumps/over the/lazy/dog while parsing/json/response from some/remote/endpoint.

**Acronym-then-word boundaries**
The XMLParser feeds the HTMLResponse, the IOError wraps the OSError, the UIComponent renders inside the URLPattern, and the JSONSerializer trails the SQLConnection.

**Mixed / acronym-heavy**
The HTTPServer returned an HTMLResponse, then the JSONParser handed off to the XMLValidator before the SQLClient hit the API.

**Sentence case (control / baseline)**
The quick brown fox jumps over the lazy dog while parsing a JSON response from some remote endpoint.

**Numerics & short tokens (edge cases)**
v2 a b c io os ok hi a1 b2c3 ipv6Address utf8Encoder base64Decode sha256Sum.

**Hyphens vs. dashes vs. underscores in one line**
auto-save_on_exit · load-config.from-disk · run_tests--watch · build:prod_v2.

**Single-letter & all-caps runs**
A B C D AAA BBB CCC URL URI UUID GUID API SDK.

**What you should see (eyeball checklist)**

With bionic on at the default fixation:

- camelCase / PascalCase: each sub-word has its own bolded prefix. `quickBrownFox` → `**qui**ck**Bro**wn**F**ox` at fixation 3 (three fixation cues, not one stretching across the whole token).
- Acronym-then-word: `XMLParser` → `**X**ML**Par**ser`. `IOError` → `**I**O**Err**or`. `HTMLResponse` → `**HT**ML**Resp**onse`. Each token produces exactly two cues, never four.
- snake_case: each segment is bolded independently, every underscore stays literal, no `_` ever appears inside `**…**`.
- kebab-case with `splitHyphenated: false` (default): hyphenated tokens are bolded as a single unit (e.g. `quick-brown-fox` → `**quick-br**own-fox` at fixation 3 — the bold prefix runs across the first hyphen).
- kebab-case with `splitHyphenated: true`: each hyphen segment gets its own cue (e.g. `quick-brown-fox` → `**qui**ck-**bro**wn-**f**ox`). Compare side-by-side by toggling the config and re-running.
- Train-Case mirrors the above: off → single cue spanning the whole token; on → one cue per segment.
- Numerics: `v2`, `a1`, `b2c3` get a single cue; `ipv6Address` → `**ip**v6**Addr**ess` and `utf8Encoder` → `**ut**f8**Enco**der` show a digit→Upper split.
- Single letters (`A`, `B`, `C`): never bolded — they're below `minWordLength: 2` and pass through verbatim. Acronym tokens of length ≥2 (`URL`, `API`, `SDK`) do get bolded.
