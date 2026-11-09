# Documentation/public-channel review — 2026-11-09

Reviewed code: `c34a664f426f8ff1c026d21a25bf8d3fd2f6f959`. Independent docs worktree excludes pre-existing uncommitted CLI changes. Public runtime release identity: `4e4b421bfb42e524f071c9ad70c2a2a2ce607374` (`v-npm-0-166-145`). Deployment source is recorded separately.

| Channel             | Observed status                                                                      | Receipt                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| CLI 0.166.145       | npm latest; public archive SHA-512 matches registry integrity; OIDC workflow success | [metadata](cli.json), [download/provenance metadata](cli-download.json) |
| Session Core 0.3.27 | npm latest; public archive SHA-512 matches registry integrity                        | [metadata](session-core.json), [download](session-core-download.json)   |
| Open VSX 0.37.181   | Public archive downloaded; bundled recommendation CLI .145                           | [metadata](open-vsx.json), [download](open-vsx-download.json)           |
| JetBrains 0.4.198   | Approved/listed update 1215424; public archive downloaded                            | [metadata](jetbrains.json), [download](jetbrains-download.json)         |
| Product v5.0.3.145  | 22 public assets; internal Android binary releases excluded                          | [product metadata](products.json)                                       |

Exact-source [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/42494781968): 75 success, one skipped; [Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/42494781805): six success. See [workflow inventory](release-workflows.json), [CLI jobs](gate-42494781968.json), [sandbox jobs](gate-42494781805.json). Other workflows retain failures/cancellation; these are not described as all-green CI. Publication used existing Actions OIDC, not local publication.

This review checks archive integrity and provenance metadata, not a new cryptographic attestation verification. Official IDE artifact parity was not rerun. Archive hashes and public manifests retain the actual verification scope.

The owner explicitly reported the Open VSX 70,000+ milestone during this task. The API sampled 69,550; its unmodified response is retained. Website milestone text uses the owner-confirmed total, not a fabricated API value.

Latest main-source model-input, recovery, MCP Tasks, Memory and native-pricing evidence is summarized in [the design](../../../../design/release-runtime-update-2026-11-09.md). The original native-pricing 234 budget checks include the 81 authority checks; counts are not added together. GUI, multiplatform SLOs, real-account pricing/invoice reconciliation and formal paid admission remain open. NOT_PAID_READY / NOT_ADMITTED / HOLD remain. No model task or paid provider request was executed for this documentation update.
