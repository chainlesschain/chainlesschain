# CLI .143 / IDE local compute release

User authorized CLI and IDE publication on 2026-11-06. This is the release-stage
ledger; engineering tests do not replace the exact-source GitHub Actions gates.

| Stage              | Version                                   | Current result            |
| ------------------ | ----------------------------------------- | ------------------------- |
| Exact source       | Pending commit                            | Candidate preparation     |
| CLI CI             | All configured Linux, Windows, macOS jobs | Not yet run for candidate |
| CLI Strict Sandbox | All configured Linux, Windows, macOS jobs | Not yet run for candidate |
| Required child     | `@chainlesschain/session-core@0.3.26`     | Not published             |
| CLI                | `chainlesschain@0.166.143`                | Not published             |
| Open VSX           | `0.37.179`                                | Not published             |
| JetBrains          | `0.4.196`                                 | Not uploaded or public    |

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
