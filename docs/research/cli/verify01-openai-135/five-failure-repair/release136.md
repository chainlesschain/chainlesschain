# CLI 0.166.136 candidate validation

Status: candidate only; no production tag or publication yet. User requires successful tests before publication.

## Scope

Includes repair commit `714053760794301496080a48b24faeac01c40429`: verified complete-history forks, background launch policy validation, independent plugin/MCP restrictions and six regression files. No historical model candidate or acceptance receipt is rewritten. The six-task independent acceptance remains 1/6, cumulative 40/45.

## Local verification (2026-10-31)

Environment: Windows x64, Node v22.22.2, Vitest v4.1.11, `packages/cli`.

- Initial six-file run: 26 passed, 2 failed. `image-pinned-handle-regression.test.js` lines 61/94 failed before the image boundary because distinct fixture inode Numbers compared equal (34902897112126030 / 38843546786075250). These exceed Number.MAX_SAFE_INTEGER. A separate temporary-file diagnostic did not reproduce a collision; it is not evidence for the original two fixture identities.
- Fix: use `statSync` / `fstatSync` with `{ bigint: true }` for fixture identity comparisons only. Keep production stat behavior and same-handle/metadata/cleanup assertions unchanged.
- `session-branch-ownership-regression`, `session-history-import-regression`, `image-pinned-handle-regression`: 3 files, 13 passed, process exit 0.
- `headless-approval-ownership-regression`, `background-launch-policy-roundtrip-regression`, `agent-customization-options`: 3 files, 15 passed, process exit 0.
- Related nine-file regression (`background-command-argv`, `background-launch-profile`, `background-turn-bootstrap`, `headless-stream-approvals`, `safe-mode`, `session-branch`, `session-history-origins`, `session-history-receipt-compatibility`, `session-transcript-history`): 155 passed, 1 skipped, 0 failures, process exit 0. All three local runs used `npx vitest run` with `--maxWorkers=3` for the post-fix runs.
- `npm run build:changelog`: exit 0. Root lockfile and CLI package version aligned at 0.166.136.

## Release gate

Publish only after the immutable candidate commit passes complete exact-SHA CLI CI and CLI Strict Sandbox. Prior repair-commit CI is not evidence for the new version commit. Use the existing `v-npm-0.166.136` tag/OIDC workflow; do not bypass tests, relax gates, or use local npm publish. Confirm the registry version, provenance/source revision and tarball after publication. Existing IDE packages are not republished by this CLI-only repair.
