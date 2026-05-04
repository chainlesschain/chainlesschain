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
| `e2e-bump-to-8-shards.patch` | ⚠️ **PROBABLY NOT NEEDED** — CLI CI run 25320080164 (commit `c4c4f0d8a`) showed all e2e shards passing across 3 OS at the 4-shard layout. The original concern about `init-and-cowork-commands.test.js` saturating an e2e shard didn't materialize. Kept in case e2e regresses later; consider deleting if it stays green for several more runs. | `fix(ci): bump e2e shard matrix to 8 to isolate init-and-cowork heavy file` |
| `integration-bump-to-8-shards.patch` | CLI CI's `integration (*, shard 4/4)` jobs hit `Timeout calling onTaskUpdate` on all 3 OS (ubuntu 109s, macos 136s, windows 213s — run 25320080164 on `c4c4f0d8a`). Wall-time exceeds the 60s heartbeat ceiling because shard 4 hashes to a heavy combination. Bumps the integration matrix to 8 shards (~halves per-shard wall-time). Unit/e2e unchanged. | `fix(ci): bump integration shard matrix to 8 to fix shard-4 wall-time` |
| `pin-silent-basic-in-vitest-config.patch` | ⚠️ **ALREADY APPLIED** (landed as `a0abf544e`). Kept for historical reference; will not re-apply because the target files already match the post-patch state. | _n/a — applied_ |
| `windows-prewarm-flaky-tests.patch` | ⚠️ **ALREADY APPLIED** (landed as `2d29bc615`). CLI CI on Windows reported `coding-agent-envelope-roundtrip > session-create` timing out at 5s AND/OR `diagnostics.collectDoctorReport > returns report with v1 schema tag` timing out at 60s. Cold-start: first WebSocket round-trip / first doctor report on a cold Windows runner exceeds default timeouts. Fix: `beforeAll` pre-warm in diagnostics + 30s timeout on first sendAndCorrelate in e2e. | _n/a — applied_ |
