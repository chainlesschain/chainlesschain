# CLI .143 / IDE local compute release

User authorized CLI and IDE publication on 2026-11-06. This is the release-stage
ledger; engineering tests do not replace the exact-source GitHub Actions gates.

Checked 2026-11-06: Session Core **0.3.26**, CLI **0.166.143**, Open VSX
**0.37.179** and JetBrains **0.4.196** are verified public. Both IDEs recommend
CLI **0.166.143**. JetBrains update **1213983** is approved, listed and
downloadable; all **627** original payload files match the official build.

| Stage              | Version                                                                   | Current result                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact source       | [PR #537 head](https://github.com/chainlesschain/chainlesschain/pull/537) | `3fa3a4b258bbcb60b23b4298cec375661ad6f410`; immutable tag `v-npm-0-166-143`                                                                                                                     |
| CLI CI             | All configured Linux, Windows, macOS jobs                                 | [76/76 jobs passed](https://github.com/chainlesschain/chainlesschain/actions/runs/42165323545), latest attempt read back in full                                                                |
| CLI Strict Sandbox | All configured Linux, Windows, macOS jobs                                 | [6/6 jobs passed](https://github.com/chainlesschain/chainlesschain/actions/runs/42165323541), latest attempt read back in full                                                                  |
| Required child     | `@chainlesschain/session-core@0.3.26`                                     | Published; Actions verified registry bytes, signed provenance and downstream registry-only dependency installation                                                                              |
| CLI                | `chainlesschain@0.166.143`                                                | [Actions OIDC publication successful](https://github.com/chainlesschain/chainlesschain/actions/runs/42229842358); public archive independently downloaded and byte-identical                    |
| Open VSX           | `0.37.179`                                                                | [Publication successful](https://github.com/chainlesschain/chainlesschain/actions/runs/42232718846); listed, latest and downloadable; public VSIX byte-identical to the official artifact       |
| JetBrains          | `0.4.196`                                                                 | [Publication successful](https://github.com/chainlesschain/chainlesschain/actions/runs/42232726964); approved, listed and downloadable; all 627 original payload files match the official build |

The existing `npm-publish.yml` workflow uses tokenless GitHub Actions OIDC,
publishes changed child packages, reads them back and verifies dependency
installation before publishing the immutable CLI tarball. IDE tag workflows
start only after public CLI verification. No npm tokens or local publication.

The complete latest-attempt gate readback is preserved in
[exact-source-gates.json](exact-source-gates.json). The production tag was created
only after all 82 gate jobs passed for that exact commit. The separately cancelled
legacy `CI Tests` macOS unit job is outside these two release matrices; no partial
CLI CI or Strict Sandbox result was accepted.

The independently downloaded public CLI archive has SHA-256
`e90a70a3ceedddcdd4033446977b8a4e5b4ebe2258af9b118ac0927fb3a96231`, matching
the immutable Actions artifact. Its package metadata pins Session Core 0.3.26.
See [CLI registry readback](cli-registry.json),
[child registry readback](session-core-registry.json) and
[independent signed readback workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/42232498566).
Both IDE tags point to the same exact source and were created only after the
successful CLI publication, public dependency installation and signed provenance
verification. Microsoft Marketplace publication is not part of this release.

The independent readback workflow completed successfully at the same source;
[byte identity](chainlesschain-npm-readback.json) and
[signed provenance](chainlesschain-npm-provenance.json) are retained alongside
the [publisher child/install receipts](publisher/). PR #537 was merged as
`248e5b3f3f36467c1972d8aa0a094e29e44fd331`; that merge does not replace the
immutable package source above.

Open VSX independent [public readback](open-vsx.json) verified exact version
0.37.179, latest listing and downloadability. Both the official VSIX and public
download have SHA-256
`ebc575984f75beb1b006b57b9b84dd001fb5c771d20ece1ff0b46313b818f090`.
JetBrains upload was accepted after all six real-host cells, browser aggregates,
unit/compatibility checks and paired public CLI installation passed. Its
[Marketplace readback](jetbrains-marketplace.json) now confirms approval and
public listing. The [public archive comparison](jetbrains.json) downloaded update
1213983 and verified all 627 original payload files, including decompressed
nested JAR entries, against official workflow artifact
`chainlesschain-ide-jetbrains-1`. ZIP container metadata is excluded from payload
comparison; both complete archive hashes remain explicit in the receipt.

Both IDE publishing workflows completed successfully at the immutable source;
the [Open VSX run](ide-open-vsx-workflow.json),
[JetBrains run](ide-jetbrains-workflow.json) and
[paired public CLI install receipts](ide-cli-prerequisites/) preserve that
result. JetBrains' post-publish check initially reported the permitted pending
review state. The later independent Marketplace and archive readbacks above
establish public approval and payload parity separately from the green upload.

Both IDEs add a separate local OpenAI-compatible platform option, optional
platform keys, explicit HTTP confirmation and atomic CLI save/readback. CLI
setup also isolates credentials when changing to a keyless endpoint. Goal
creation request files/v6 pending proposals and the admitted 0.3.0 scenario
require matching desktop source and separate native confirmation; this release
does not publish PC/mobile clients.

The preceding engineering batch passed 374 focused regressions and 22 local
checks. Two synthetic real Volcengine drafts used 1,176 tokens, with unknown
cost. LEXDATA discovery failed twice, with the second reporting `ECONNRESET`;
actual LEXDATA inference, real IDE/Electron GUI and independent business-effect
acceptance remain unverified. See [engineering evidence](../../../agents/evidence/dmm-volcengine-live-2026-11-06/README.md).

Source-audit and complete-suite failure details are preserved in [rejected-candidate-34c6bb.json](rejected-candidate-34c6bb.json). The refreshed source review passed 89 candidates with no stale/unclassified files and no paid/runtime admission. Its 19 audit tests passed. Five corrected CLI fixture files passed 134 assertions with one POSIX-only skip on Windows; the full desktop business boundary config passed 365 assertions. VS Code passed 333 unit assertions; JetBrains passed 1,449 smoke assertions and 1,023 JUnit assertions, with three skipped. These overlapping local scopes are supplementary, not release gates.

The dc5475 source passed its remote source build/audit but failed the separate
Ubuntu desktop model-protocol check: 20 tests passed and 15 were cancelled after
an unguarded health request reached the protocol mock. Fixture initialization,
exact brand-rejection assertions and request accounting are corrected; see
[rejected-candidate-dc5475.json](rejected-candidate-dc5475.json). Official Node
22.23.4 passed the complete 36-test protocol/recovery scope, followed by the
strengthened 17-test OpenAI scope and two exact-brand/health regressions. Restoring
lazy fixture initialization makes the regression fail as expected. Host lifecycle
and onboarding helpers passed 28 tests with three POSIX-only skips on Windows.
The 27667d candidate then passed the remote Ubuntu model-protocol check and all
six Strict Sandbox jobs, but macOS onboarding exposed an expired port-phase
deadline after its eight UI cases and owned-process cleanup had passed. The
caller now starts a separate bounded port-release phase after process cleanup,
as in the existing capture diagnostic, still capped by the overall journey
deadline. All six port lifecycle tests passed; see
[rejected-candidate-27667d.json](rejected-candidate-27667d.json). A new complete
remote candidate matrix was required and subsequently passed in full at
`3fa3a4b258bbcb60b23b4298cec375661ad6f410`, as recorded above.
