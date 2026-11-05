# CLI 0.166.142 / DMM release record

Checked 2026-11-05. Session Core **0.3.25**, CLI **0.166.142**, Open VSX
**0.37.178** and JetBrains **0.4.195** are verified public. JetBrains update
1212436 is approved, listed and downloadable; all 626 original payload files,
including nested JAR entries, match the official build. Container metadata is
excluded from payload comparison; [archive hashes and proof](jetbrains.json)
remain explicit.
PC/mobile **v5.0.3.145** is in preparation, not yet published.

npm authentication uses the existing GitHub Actions OIDC Trusted Publishing
workflow only. Required child packages were published and verified before CLI,
and the CLI was verified before IDE uploads.

Immutable npm and IDE source: `b78cf0af8c8b0491189465773b148ac77c332222`.
[PR #534](https://github.com/chainlesschain/chainlesschain/pull/534) was merged
without changing that source SHA. Later product and documentation commits do not
replace these immutable package identities.

| Stage                                          | Result                                                | Official evidence                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI CI, all configured OSes                    | 75 successful, 1 optional dry-run skipped             | [41880645485, attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/41880645485)                                                                                      |
| CLI Strict Sandbox                             | 6/6 successful                                        | [41869752122](https://github.com/chainlesschain/chainlesschain/actions/runs/41869752122)                                                                                                 |
| npm OIDC publication                           | successful, children before CLI                       | [41887211826, attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/41887211826)                                                                                      |
| Independent public bytes and signed provenance | successful, byte-identical                            | [41950556751](https://github.com/chainlesschain/chainlesschain/actions/runs/41950556751), [readback](chainlesschain-npm-readback.json), [provenance](chainlesschain-npm-provenance.json) |
| Open VSX                                       | public payload verified by publishing job             | [41950792178](https://github.com/chainlesschain/chainlesschain/actions/runs/41950792178)                                                                                                 |
| JetBrains                                      | public, approved; all626 original payload files match | [41950791667](https://github.com/chainlesschain/chainlesschain/actions/runs/41950791667), [readback](jetbrains.json)                                                                     |
| IDE ARM64 hosts                                | 11/11 successful                                      | [41869752695, attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/41869752695)                                                                                      |

Publisher child-source and installation receipts are under [publisher/](publisher/).
The registry install uses `--ignore-scripts`; it does not establish full native,
postinstall or device execution. Initial CI attempts could not acquire macOS
hosted runners. The first npm attempt correctly stopped before publication;
successful retries preserved the exact source and all configured platforms.

On 2026-11-05 the user explicitly instructed: “JetBrains 审核没那么快 可以先发布客户端”.
For **product v5.0.3.145 / CLI 0.166.142 / JetBrains 0.4.195** only, the product
gate verifies the completed successful official workflow and upload step at
source `b78cf0af8c8b0491189465773b148ac77c332222`, tag `ide-jetbrains-v0.4.195`,
run `41950791667`, without requiring completed Marketplace review. Public CLI,
Open VSX, npm source parity and all client build/artifact checks remain required.
The receipt distinguishes `uploaded-review-pending-authorized` from publicly ready.

Android hydration uses the tooling's audited **20260711** donor binding; the
rollover copies other assets from current **20261102-2**. The initial request
using 20261102-2 as hydration donor failed its fixed policy check before packaging.
The corrected [refresh run 41955110058](https://github.com/chainlesschain/chainlesschain/actions/runs/41955110058)
succeeded. Its [bundle metadata](android-cli-bundle.json) binds CLI .142 to source
B above; the downloaded 98,872,600-byte archive has SHA-256
`730977d96b8fe41242999f0a3abafad8914bc1e9698860c70b009905eec8be08`.
The runtime stays Node 26.2.0 / ABI 147. The immutable
[internal binaries 20261105](https://github.com/chainlesschain/chainlesschain/releases/tag/internal-binaries-android-v20261105)
was published with 27 verified assets by
[rollover run 41956430883](https://github.com/chainlesschain/chainlesschain/actions/runs/41956430883).
Its remote CLI asset digest matches the hash above. Android pins that release and
increments bootstrap `USR_VERSION` from 88 to 89. The five local release-check
files passed 65 tests, including the scoped upload authority, exact product
checkout, complete asset verification, hydration and rollover metadata contracts.
Public client receipts will be added after publication. Native history requires
newer desktop sources; product144
does not establish coverage of this native workflow. Microsoft Marketplace remains
deferred. No additional paid model-task retest was performed.

Local preparation passed 93 tests across five files, JetBrains metadata checks,
public IDE capability-manifest checks and command registry/help/completion checks.
The independent [DMM-08 engineering batch](../../../agents/evidence/dmm-delivery-assistant-2026-11-04/README.md)
passed 245 tests with one POSIX-only skip on Windows. Historical batches are not
summed with these results. These are not release-commit CI evidence.

Feature scope: separately authorized goal observations, a transactional retained
event journal and signed cursor, durable one-page replay/checkpoint modes,
explicit IDE recovery and a data-only combined delivery scenario. Native approval
remains authoritative. Replay is at least once; records and description edits do
not establish goal completion. Real GUI and business-effect acceptance remain
separate from package publication.
