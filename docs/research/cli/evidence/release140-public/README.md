# CLI 0.166.140 / IDE publication evidence

Checked at 2026-11-03T11:42:31.329Z. Exact published release source: e2a91bf54332ff3d252c40ecc25c5887e0f0430d. All release tags and runtime evidence retain this source; a later documentation commit does not replace it or alter the immutable npm tarball README.

| Component | Version   | Verified status                                                                                                                                                                      |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI       | 0.166.140 | GitHub Actions OIDC, public archive bytes, signed provenance, installation/startup verified                                                                                          |
| Open VSX  | 0.37.176  | Public/listed/downloadable; VSIX byte-identical to official artifact; recommends CLI 0.166.140                                                                                       |
| JetBrains | 0.4.193   | Upload verified; awaiting Marketplace review or public indexing. Public availability is not verified. An unobserved approval is not asserted to be pending. Recommends CLI 0.166.140 |

[Publication summary](./publication-readback.json) · [Exact-source gates](./gates.json) · [CLI receipts](./cli.json) · [Open VSX receipts](./open-vsx.json) · [JetBrains receipts](./jetbrains.json). publication-readback.json records SHA-256 hashes of these four source receipt files.

## Release order and public verification

All 13 required upstream npm packages were fetched and their public archive bytes verified; all 10 direct dependencies were installed from the public registry and aligned. Their versions are reused, not republished. CLI publication followed exact-source gates; IDE publication followed verified public CLI installation.

[CLI OIDC run](https://github.com/chainlesschain/chainlesschain/actions/runs/41610020835) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/41613355537) passed. npm publish returned success at 09:42:07 UTC; the existing registry loop saw 37 unavailable polls before verifying public bytes at 09:48:33 UTC. No publish configuration changed. Public CLI SHA-256: 99e673b86c98795482b541c11d4187471d9babdd599f1c94f0ea37db9698faa9.

[Open VSX workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/41614441062) and [JetBrains workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/41614441190) identify their immutable tagged builds. JetBrains upload, approval, listing, public download and payload verification remain separate states. No update ID is invented when the public version is not visible.

## Exact-source checks and retained first failures

CLI CI passed **76/76** jobs, run 41593487500 attempt 2; CLI Strict Sandbox passed **6/6**, run 41593487785 attempt 1, across all configured operating systems. The original macOS temporary-directory cleanup ENOTEMPTY failure was retained, followed by one complete failed-shard/job retry with the original configuration. The separate root-CI PDH Windows 30-second timeout was retained and its complete job retried once successfully. Neither timeout budgets nor assertions were weakened.

JetBrains Windows / IDEA 2025.2 first failed while downloading Gradle 8.7 with HTTP 504, before IDE startup or product assertions. [Original job](https://github.com/chainlesschain/chainlesschain/actions/runs/41614441190/job/125844485801), [original artifact](https://github.com/chainlesschain/chainlesschain/actions/runs/41614441190/artifacts/13221325052), original log SHA-256 03e41f0f4d668bb8709e7d8533c5fc87a82250626ba896afb77ee26724d91048. A single [complete host-job retry](https://github.com/chainlesschain/chainlesschain/actions/runs/41614441190/job/125881031349) passed both deterministic and canonical recovery/Stop flows with the original configuration. All six OS/IDE host combinations then passed; this does not erase the original failed attempt.

The exact release source also passed **300 loopback runs**, 100 per operating system: [workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/41593487672), [aggregate artifact](https://github.com/chainlesschain/chainlesschain/actions/runs/41593487672/artifacts/13212632483), digest sha256:a59ad46e4ac519425ffb17bd15d5d8f8d1308ac644ebbabae924d3ea6ca3f72a. These runs cover **structural envelopes only**. They do not establish paid-provider/model-task acceptance and do not replace CLI CI or Strict Sandbox.

## Scoped live checks and unresolved observations

The earlier [v9 recovery check](../tool-argument-recovery-20261103/live-volcengine.json) used **5 real Volcengine requests / 6,401 tokens**. The separate [v10 recovery check](../tool-argument-recovery-20261103/live-volcengine-v10.json) used **5 requests / 6,501 tokens**, with the qualified runtime module hashes recorded separately in cli.json. These are separate scoped runs, not a combined acceptance score or a post-publication provider retest.

Historical candidate eb0fe7a8a1 hit the Windows ArtifactStore post-index integrity guard; the exact rejected subcondition remains unknown and the guard stays enforced. Its [original failure](../tool-argument-recovery-20261103/windows-eb-trajectory-attempt1-failure.json) and [complete old-source rerun](../tool-argument-recovery-20261103/windows-eb-trajectory-attempt2-aggregate.json) retain their source scope. Local composition timed out on both v10 and the earlier baseline and is not counted passing.

Historical .138 acceptance **2/4**, .137 **0/5**, and cumulative **41/45** retain separate scopes. Publication and engineering checks add no model-task acceptance.

## Independent channels

Microsoft Marketplace remains deferred. PC/mobile **v5.0.3.144** is [already independently public](../release144-public/publication.json); this follow-up does not republish clients or roll them back to .143.

The [full45 generator publication proof](./publication.json) retains its original bytes for the digest-bound Volcengine package sets. The detailed readback is preserved separately in publication-readback.json.
