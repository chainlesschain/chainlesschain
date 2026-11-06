# CLI .143 / IDE local compute release

User authorized CLI and IDE publication on 2026-11-06. This is the release-stage
ledger; engineering tests do not replace the exact-source GitHub Actions gates.

| Stage              | Version                                                                   | Current result                                                                                       |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Exact source       | [PR #537 head](https://github.com/chainlesschain/chainlesschain/pull/537) | Refreshed after rejected dc5475 protocol-fixture initialization; exact new SHA in gate-progress.json |
| CLI CI             | All configured Linux, Windows, macOS jobs                                 | Fresh exact-source matrix required after fixture and diagnostic cleanup fixes                        |
| CLI Strict Sandbox | All configured Linux, Windows, macOS jobs                                 | Earlier platform results are not reused for the refreshed commit                                     |
| Required child     | `@chainlesschain/session-core@0.3.26`                                     | Not published                                                                                        |
| CLI                | `chainlesschain@0.166.143`                                                | Not published                                                                                        |
| Open VSX           | `0.37.179`                                                                | Not published                                                                                        |
| JetBrains          | `0.4.196`                                                                 | Not uploaded or public                                                                               |

The existing `npm-publish.yml` workflow uses tokenless GitHub Actions OIDC,
publishes changed child packages, reads them back and verifies dependency
installation before publishing the immutable CLI tarball. IDE tag workflows
start only after public CLI verification. No npm tokens or local publication.

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
The earlier macOS onboarding shutdown now verifies port release within the same
bounded deadline. A new complete remote candidate matrix remains required.
