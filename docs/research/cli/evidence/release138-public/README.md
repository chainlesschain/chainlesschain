# CLI 0.166.138 / IDE publication evidence

Release source: `e42ea07b6da7ab2c3eb709002448b32d5fedf535`. The user explicitly waived five-task success before publication; exact-source release gates and registry verification remain required.

| Component | Version | Verified state | Authority |
| --- | --- | --- | --- |
| Agent SDK | 0.2.17 | Public bytes and signed provenance verified before CLI | [Official OIDC run](https://github.com/chainlesschain/chainlesschain/actions/runs/41313099948) |
| CLI | 0.166.138 | Public registry bytes, clean installation/startup and signed provenance verified | [Official OIDC run](https://github.com/chainlesschain/chainlesschain/actions/runs/41313099948) |
| Open VSX | 0.37.174 | Tagged publication workflow succeeded, including public VSIX verification | [Tagged run](https://github.com/chainlesschain/chainlesschain/actions/runs/41316653600) |
| JetBrains | 0.4.191 | uploaded; awaiting Marketplace approval/listing | [Tagged run](https://github.com/chainlesschain/chainlesschain/actions/runs/41327724484) |

Install `npm i -g chainlesschain@0.166.138 --registry https://registry.npmjs.org`, restart the chat host, then run `cc --version` and `cc doctor`. Both new IDE versions recommend CLI 0.166.138. Microsoft Marketplace remains deferred; PC/mobile remain independent. Kernel stays 0.1.11.

The exact source passed [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/41303563843) (75 required jobs successful; one optional PR dry-run skipped) and [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/41303563747) (6/6) on the configured Linux, Windows and macOS matrix. [Prepublication checks](./prepublication-gates.json) retain the source binding, upstream verification and authorization digest.

[Official public proof](./cli-official-public-proof.json) records the completed OIDC workflow and successful SDK/CLI registry/provenance/readback steps. Its uploaded `chainlesschain-npm-readback-e42ea07b6da7ab2c3eb709002448b32d5fedf535` artifact contains the public readback receipts. The cached publish-job status predates final cleanup; the overall run and all required publication/readback steps are successful. This is the official independent registry readback, performed within the OIDC workflow, and does not depend on a second standalone dispatch. Immutable .137 stopped before CLI upload at the SDK source-tree guard; its tag was retained. SDK 0.2.17 repairs whole-tree source alignment without changing its generated runtime bytes.

The latest recorded .137 cohort remains **0/5** end-to-end; .138 ran **no new model cohort**. Historical cumulative acceptance remains **41/45**; the separate focused image follow-up remains **0/1**. Independent candidate engineering checks are not counted as successful model tasks. Remaining review-scheduling, partial-source and generated-assertion limitations are preserved. [Original model results](../../verify01-openai-137/README.md).

[Machine-readable publication status](./publication.json).

JetBrains .191 uses its own exact source `ef13d5238e2b3e4c4571e48e820d0eb31a3107b2`, merged to main and bound to immutable tag `ide-jetbrains-v0.4.191`. Its source differs from the CLI release only in five JetBrains files. The earlier [.190 workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/41320640806) failed JUnit before upload because the test retained CLI 0.166.135 while runtime metadata recommended 0.166.138. The original tag is preserved. The repair verifies fallback, equal and newer upgrade targets using the configured recommendation, while independent release-metadata checks bind that recommendation to Gradle properties. [Failure record](./jetbrains190-failure.json) · [Focused JUnit control](./jetbrains191-focused-junit.json). Local JDK 17 reported a restricted-filesystem JAR-close diagnostic after compiling classes; actual focused JUnit execution was 8/8, original control 7/8. Full JDK 21 cloud JUnit and all IDE host gates are authoritative for publication.

Concurrent main changes are preserved: commit [`2e97ce3d79`](https://github.com/chainlesschain/chainlesschain/commit/2e97ce3d797bfdc03aba59834734da2a916b8774) applies host-model policy to standalone WebSocket model turns. It follows the published CLI source and awaits its own exact-source CLI CI / Strict Sandbox and OIDC release. It is not included in CLI 0.166.138.
