# `changelog/` — per-version drafts

This directory holds **per-version draft files** that get merged into the
top-level `CHANGELOG.md` at release time.

The main `CHANGELOG.md` at the repo root remains the authoritative,
chronologically-ordered, human-readable changelog. It is **not generated** — it
still gets edited directly for small/quick entries. This directory exists for
the (common) case where multiple sessions are concurrently preparing release
notes, where editing the same monolithic `CHANGELOG.md` triggers the lint-staged
unstaged-window race (trap #10).

## Convention

For each release, the author drops a small file here:

```
changelog/vX.Y.Z.N.md
```

The file format mirrors the main CHANGELOG entry structure:

```markdown
## [vX.Y.Z.N] - YYYY-MM-DD — <one-line type(scope): subject>

> <Optional pull-quote summarizing why this release exists.>

### <Section like "Fix" / "Added" / "Changed">

- Detail bullet
- Detail bullet (`commit-sha`)

### Bundled

- `commit-msg-title` (`commit-sha`)
```

That's it. The file is the prose-prepared draft, no metadata, no frontmatter.

## Merging into `CHANGELOG.md`

```bash
node scripts/changelog-merge.js
```

Reads every `changelog/v*.md` file, sorts by version (newest first), inserts
each at the right position in `CHANGELOG.md`, then deletes the drafts.
Idempotent: running it with no draft files is a no-op. Designed to run as a
release-pipeline step, but also safe to run locally before a manual merge.

## Why not generate `CHANGELOG.md` entirely from `changelog/`?

The repo has 2300+ lines of pre-existing `CHANGELOG.md` history. Migrating
that wholesale would lose hand-curated cross-references and pull-quotes. The
per-version drafts pattern only governs *new* releases.

## Race-immune editing

Authoring a new entry under `changelog/` instead of editing the monolithic
`CHANGELOG.md` directly closes the trap #10 unstaged-window race:

- Each session works on its own file (`changelog/v5.0.3.97.md`,
  `changelog/v5.0.3.98.md`, …) — zero filename collision
- New file is `git add`'d immediately on creation by `scripts/changelog-add.js`
  — zero unstaged window for lint-staged to sweep
- The monolithic merge happens at release time, once, by one process
