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
| `pin-silent-basic-in-vitest-config.patch` | ⚠️ **ALREADY APPLIED** (landed as `a0abf544e`). Kept for historical reference; will not re-apply because the target files already match the post-patch state. | _n/a — applied_ |
| `windows-prewarm-flaky-tests.patch` | CLI CI on Windows reports `coding-agent-envelope-roundtrip > session-create` timing out at 5s AND/OR `diagnostics.collectDoctorReport > returns report with v1 schema tag` timing out at 60s, with all OTHER tests in the same files passing in <2s. Both are cold-start issues (first WebSocket round-trip / first doctor report on a cold Windows runner). Patch adds `beforeAll` pre-warm to the diagnostics describe and bumps the first-test sendAndCorrelate timeout to 30s in the e2e file. Smoke-tested locally: full diagnostics file 14/14 tests in 11s. | `fix(test): pre-warm windows-flaky cold-start tests` |
