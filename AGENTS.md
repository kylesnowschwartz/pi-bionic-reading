# AGENTS.md

Working agreements for AI agents (and humans) committing to this repo. Keep
the rules small, operational, and observable in the diff.

## Verification gate

Standing gate before any commit:

```bash
npm run typecheck && npm test
```

Both must pass. Refactors are not exempt. The current baseline is documented
in the most recent commit message — if a commit lands that drops the count,
that is a regression and should be reverted or fixed in the same commit.

## Dependency changes

Whenever `package.json`'s `dependencies` / `devDependencies` /
`peerDependencies` move:

1. **Use `npm install <pkg>`** (or `npm uninstall <pkg>`), not
   `npm install --no-save` or hand-edits to `package.json`. This guarantees
   `package-lock.json` updates in lockstep.
2. **`package.json` and `package-lock.json` ship in the same commit.** Verify
   with `git status` before committing — both files should appear in the
   diff. A `package.json` change without a corresponding lockfile change is
   a bug.
3. **Run the verification gate** after the install — a new dep can break
   typecheck (missing `@types/*`) or tests (transitive version skew) without
   any source change.
4. **Note the new dep in the commit message:** package name, version,
   license, and a one-line justification (size, maintenance status, why this
   one over the alternatives). Example from `4adcfad`:

   > Replaced the hand-roll with `jsonc-parser` (Microsoft, MIT, zero
   > runtime deps; the parser used by VS Code itself).

5. If the lockfile diff is larger than the dep change alone (npm sometimes
   re-resolves transitive peer deps on install), call that out in the
   commit message so reviewers don't chase phantom changes.

## CHANGELOG.md

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — the
existing `0.2.0` and `0.1.0` entries set the pattern. Rules:

1. **Every user-visible change gets a CHANGELOG entry in its release
   section.** New config fields, new slash subcommands, behaviour changes,
   bug fixes, and dep additions all qualify. Internal refactors with zero
   observable difference (e.g. moving code between files, defensive
   try-block hoists) generally do **not** — but include them if they might
   surface in error messages or commit archaeology a future user reads.
2. **Categories:** `Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` /
   `Security`. Use only the ones that apply for a given release. Group dep
   additions under `Added` with a one-line note (we don't keep a separate
   `Dependencies` heading).
3. **Entries describe what changed from the user's POV, not how.** Tie back
   to SPEC sections (`§ S4`) or commit hashes only when traceability adds
   real value.
4. **Do not edit released sections** (anything below the in-progress
   release). Released history is append-only.

## Version bumps (`package.json`)

Pre-1.0 semver convention this repo follows:

- **Minor bump** (`0.x.0` → `0.x+1.0`) — new features, additive config
  fields, new slash commands, AND breaking changes. Pre-1.0 we don't have
  a major-bump channel; breaking changes ride the minor.
- **Patch bump** (`0.x.y` → `0.x.y+1`) — bug fixes only, no new surface.

Rules:

1. **Do not bump the version in feature/fix commits.** Let the release
   commit aggregate everything since the last release.
2. **Version bump + CHANGELOG section land together** in a single
   `chore: release N.N.N` commit. Nothing else in that commit.
3. **No git tag is required** by tooling, but if you tag, use the bare
   version number (`0.3.0`, not `v0.3.0`) to match the existing
   `[0.2.0]` style in CHANGELOG.md.

## Release workflow recap

When the user says "ready to share":

1. List commits since the last release: `git log --oneline <last-tag-or-version>..HEAD`.
2. Decide the bump: any `feat:` → minor; only `fix:` / `refactor:` / `chore:`
   → patch.
3. Edit `package.json` `version` field.
4. Add a new `## [N.N.N] — YYYY` section to `CHANGELOG.md` above the
   previous release, populated from the commit list.
5. Verification gate: `npm run typecheck && npm test`.
6. One commit: `chore: release N.N.N`.
7. Optionally tag: `git tag N.N.N`.

## Out of scope (deliberately)

This file is not a coding-style guide, not a SPEC, and not a roadmap.
SPEC-shaped planning belongs in `.agent-history/` (gitignored — local
planning artifacts, not committed). User-facing docs belong in `README.md`.
