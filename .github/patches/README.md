# CI Patches

Pre-staged diffs ready to apply when a known failure mode lands.
Verified with `git apply --check` at the time they were saved; if they
ever stop applying, the underlying file has drifted and the patch needs
to be regenerated.

## How to apply

```bash
git apply .github/patches/<patch-name>.patch
git -c commit.gpgsign=false commit -am "fix(ci): <message from the patch's row below>"
git push
```

(Drop the `-c commit.gpgsign=false` if signing is configured — kept here
because hooks sometimes block unsigned commits in mid-troubleshooting.)

## Available patches

| Patch | When to apply | Commit message |
|-------|---------------|----------------|
| `e2e-bump-to-8-shards.patch` | CLI CI's `e2e (*, shard k/4)` jobs flake with vitest `Timeout calling onTaskUpdate` while unit/integration are green. Bumps the e2e matrix to 8 shards so `init-and-cowork-commands.test.js` (51 subprocess spawns, ~65s on Linux, longer on Windows) lands in a smaller bundle. Unit/integration unchanged. | `fix(ci): bump e2e shard matrix to 8 to isolate init-and-cowork heavy file` |
| `pin-silent-basic-in-vitest-config.patch` | Optional hardening — apply at any time. Moves `silent: true` and `reporters: ['basic']` from the CLI invocation in `_cli-test.yml` into `packages/cli/vitest.config.js` + `vitest.e2e.config.js`, then drops the redundant `--silent=true --reporter=basic` flags from the workflow. Local `npx vitest run` will then match CI behavior; the IPC-saturation guarantee is owned by the config file rather than every CLI call site. Override with `--silent=false` or `--reporter=verbose` when debugging. Smoke-tested locally: unit shard 4/4 → 4366 tests / 84s / exit 0. | `chore(ci): pin silent + basic reporter in vitest config` |
