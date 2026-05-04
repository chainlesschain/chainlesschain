# CI Patches

Pre-staged diffs ready to apply when a known failure mode lands.
Verified with `git apply --check` at the time they were saved; if they
ever stop applying, the underlying file has drifted and the patch needs
to be regenerated.

When a patch is applied to `main`, **delete the file from this directory
in the same commit**. Git history preserves the diff; leaving stale
already-applied files here is misleading (they no longer apply cleanly
and confuse `git apply --check`).

## How to apply

```bash
git apply .github/patches/<patch-name>.patch
git rm .github/patches/<patch-name>.patch
git -c commit.gpgsign=false commit -am "fix(ci): <message from the patch's row below>"
git push
```

(Drop the `-c commit.gpgsign=false` if signing is configured — kept here
because hooks sometimes block unsigned commits in mid-troubleshooting.)

## Available patches

| Patch | When to apply | Commit message |
|-------|---------------|----------------|
| `pin-silent-basic-in-vitest-config.patch` | Optional hardening — apply at any time. Moves `silent: true` and `reporters: ['basic']` from the CLI invocation in `_cli-test.yml` into `packages/cli/vitest.config.js` + `vitest.e2e.config.js`, then drops the redundant `--silent=true --reporter=basic` flags from the workflow. Local `npx vitest run` will then match CI behavior; the IPC-saturation guarantee is owned by the config file rather than every CLI call site. Override with `--silent=false` or `--reporter=verbose` when debugging. | `chore(ci): pin silent + basic reporter in vitest config` |
| `e2e-bump-to-8-shards.patch` | ⚠️ **PROBABLY NOT NEEDED** — CLI CI run 25320080164 (commit `c4c4f0d8a`) showed all e2e shards passing across 3 OS at the 4-shard layout. The original concern about `init-and-cowork-commands.test.js` saturating an e2e shard didn't materialize. Kept in case e2e regresses later; consider deleting if it stays green for several more runs. | `fix(ci): bump e2e shard matrix to 8 to isolate init-and-cowork heavy file` |

## Recently applied (no longer in this directory)

| Patch | Applied in | Notes |
|-------|------------|-------|
| `windows-prewarm-flaky-tests.patch` | `2d29bc615` | Pre-warm for `diagnostics.test.js` cold-start and `coding-agent-envelope-roundtrip.test.js` first-request timeout on Windows runners. |
| `integration-bump-to-8-shards.patch` | _pending commit_ | Bumped integration matrix to 8 shards. Auto-applied after CLI CI on `8fcd8f533` confirmed integration shard 4/4 RPC timeout on 2 of 3 OS (ubuntu 114s, windows 195s) while macos passed. |
