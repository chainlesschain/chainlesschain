# chainlesschain CLI

Command-line interface for installing, configuring, and managing [ChainlessChain](https://www.chainlesschain.com), including the coding agent, governed tools, sessions, memory, and IDE integrations.

<!-- release138-current:start -->

## CLI 0.166.138 — verified public release

CLI **0.166.138** and upstream Agent SDK **0.2.17** are published through GitHub Actions OIDC. Install `npm i -g chainlesschain@0.166.138 --registry https://registry.npmjs.org`, restart `cc ui` and IDE chat hosts, then run `cc --version` and `cc doctor`. Open VSX **0.37.174** publication succeeded. JetBrains **0.4.191** is uploaded and awaiting Marketplace approval/listing. Both new IDE versions recommend CLI **0.166.138**.

This release preserves recovery when source content was omitted from a model request and retains the original user task across canonical compaction, tool tails and persistent sessions. Only exact source spans selected for a provider count as historical read coverage. Repeated delivery failures stop with an explicit limitation.

Exact release source `e42ea07b6da7ab2c3eb709002448b32d5fedf535` passed all 75 required CLI CI jobs (one optional PR dry-run skipped) and all 6 Strict Sandbox jobs across the configured Linux, Windows and macOS matrix. The official [OIDC workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/41313099948) independently downloaded the public SDK/CLI, verified immutable package bytes and signed provenance, and installed/started the CLI before IDE release tags were created. SDK 0.2.17 aligns its full source tree with provenance; SDK runtime output is unchanged.

The latest recorded .137 model cohort remains **0/5** end-to-end; CLI .138 has not started another model cohort. Historical cumulative acceptance remains **41/45**, and the separate image follow-up remains **0/1**. The user waived five-task success as a publication prerequisite. Remaining limits include late independent-review scheduling, omitted unproven partial source fragments and incomplete or incorrect generated assertions. Engineering checks and publication add no model task acceptance. Kernel stays **0.1.11**; Microsoft Marketplace and PC/mobile are outside this release.

[Publication evidence](../../docs/research/cli/evidence/release138-public/README.md) · [Open VSX release](https://github.com/chainlesschain/chainlesschain/actions/runs/41316653600) · [Recorded model results](../../docs/research/cli/verify01-openai-137/README.md).

Main also contains the later standalone WebSocket host-model-policy repair (`2e97ce3d79`), awaiting its own fully validated CLI release. The published CLI 0.166.138 remains bound to its verified release source.

<!-- release138-current:end -->

## CLI 0.166.136 — previous public repair

Install with `npm i -g chainlesschain@0.166.136 --registry https://registry.npmjs.org`, restart the chat host, then run `cc --version` and `cc doctor`. This release repairs full-history session forks and preserves independent plugin/MCP restrictions through background restore. Malformed policy values fail before normalization or customization loading.

Exact source `539e4da6ef89e5142a3f3bb90e2d6123c6afb15e` passed all 76 CLI CI jobs and all 6 Strict Sandbox jobs. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/41206368406) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/41241946884) verified immutable bytes and signed provenance. Existing Open VSX **0.37.173** and the verified JetBrains **0.4.189** Actions build remain the test pairing; their recommendation metadata still says CLI **0.166.135**. JetBrains is now approved and public; both JAR payloads match the official build, with different ZIP container hashes. Kernel stays **0.1.11**; Microsoft Marketplace and PC/mobile remain outside this release.

The six-task historical retest stays **1/6**, cumulative **40/45**. Engineering regressions are separate from model acceptance; only the five remaining failures are selected for the next round. [Publication evidence](../../docs/research/cli/evidence/release136-public/README.md).

The .136 five-sample retest accepted **1/5** (verify-19), cumulative **41/45**. A separate published-source engineering replay passed 86 baseline cases and 20 fixture-adapted candidate cases, rejected the three history/profile mutants, and reproduced the failures when removing the corresponding repairs. The focused image follow-up accepted 0/1: its pixel boundary improved, but metadata-only changes remain uncovered. A separate read-delivery guard repair passes 109 engineering regressions and is not yet published. [Separate replay evidence](../../docs/research/cli/verify01-openai-136/release-replay-539e4da6ef/README.md). These engineering results do not rescore the frozen benchmark.

## CLI 0.166.135 — verified preceding release

This release recovers genuine OpenAI Responses JSON disconnects before accepted output, bounds stalled requests, and settles completed streaming responses without waiting for socket EOF. It preserves empty tool allowlists across resume and rejects malformed saved permission, sandbox and budget settings. HTTP/provider failures, cancellation, usage persistence and incomplete tool-call replay protections remain authoritative.

Install with `npm i -g chainlesschain@0.166.135 --registry https://registry.npmjs.org`, restart the chat host, then run `cc --version` and `cc doctor`. Public Open VSX **0.37.173** recommends CLI **0.166.135**. JetBrains **0.4.189** recommends the same CLI and has been uploaded after passing all release gates, but awaits Marketplace approval/listing. Current public JetBrains **0.4.188** retains its CLI **0.166.133** recommendation; Kernel stays **0.1.11**. Check the [release guide](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html) for channel publication status. Microsoft Marketplace and PC/mobile releases are outside this release scope.

Exact CLI source `82aa6d703a8695721a7ccf0793a435853bc2bbf2` passed all 76 CLI CI jobs and all 6 Strict Sandbox jobs. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/41168880872) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/41169921448) verified registry bytes, provenance and direct child dependencies. [Component-specific publication evidence](../../docs/research/cli/evidence/release135-public/publication.json).

The preceding OpenAI native cohort accepted **39/45** tasks. Runtime regression tests and this release do not change that historical result or establish formal paid/native production admission.

A subsequent user-authorized retest used this public CLI, Open VSX 0.37.173 and the verified JetBrains 0.4.189 Actions build without waiting for Marketplace review. Only the six previously failed samples were rerun: **1/6** passed (`verify-26`), with **5** still failing independent acceptance. The cross-version cumulative result is **40/45**, not a new full 45-task success rate. All 100 upstream calls have complete usage; token-only estimate **$5.880530**, invoice unknown. The temporary task secret was deleted. [Targeted report](../../docs/research/cli/verify01-openai-135/retest-six-99b93fc209/REPORT.md).

## CLI 0.166.133 — verified preceding release

CLI **0.166.133** is published on npm. It preserves required empty OpenAI Responses reasoning summaries, applies the self-evolution switch to all model-owning `cc ui` entry points, and supports explicitly configured OpenAI-compatible local/LAN platforms through `custom`, with optional credentials and unchanged endpoint/model aliases. It also exposes canonical allowed mutation paths in provider tool schemas while retaining execution-time scope and file-identity checks. Controlled regressions and release gates do not establish live-platform task acceptance.

Install with `npm i -g chainlesschain@0.166.133 --registry https://registry.npmjs.org`, restart the chat host, then run `cc --version` and `cc doctor`. Companion Open VSX **0.37.171** / JetBrains **0.4.188** are public and recommend this CLI; their original payloads match the official artifacts. Kernel stays **0.1.11**. Exact source `2eb0c5b1e048509362f9d980f94acee55c2ffa9f` passed Linux, Windows and macOS CLI CI / CLI Strict Sandbox. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/41073612529) and [independent readback](https://github.com/chainlesschain/chainlesschain/actions/runs/41075409835) verified immutable package bytes and signed provenance. Consult the [current release guide](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html) for IDE channel availability. Microsoft Marketplace and PC/mobile releases are outside this release scope.

## CLI 0.166.132 — verified public baseline before this source revision

Install: `npm i -g chainlesschain@0.166.132 --registry https://registry.npmjs.org`. Public Open VSX **0.37.170** and approved JetBrains **0.4.187** recommend this CLI; Kernel **0.1.11** is verified upstream. Restart the chat host, then run `cc --version` and `cc doctor`.

This release stops tool execution on truncated responses and permits one replan when complete usage is recorded and budget remains. Recovery preserves the original task, including through role combination, asynchronous recall and readContext continuation. Filtered or incomplete terminal responses and missing task context stop with a clear failure. No independent IDE UI change is included.

Release source: [772fcdbda85bcf91df95bfced5b476dcf4c74614](https://github.com/chainlesschain/chainlesschain/commit/772fcdbda85bcf91df95bfced5b476dcf4c74614). Exact-source [validation gates](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/gates.json), [OIDC publication run](https://github.com/chainlesschain/chainlesschain/actions/runs/40985169005), [official artifact](https://github.com/chainlesschain/chainlesschain/actions/runs/40985169005/artifacts/12946249806), [independent readback run](https://github.com/chainlesschain/chainlesschain/actions/runs/40986625203), and [public CLI readback](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/cli.json) identify this public package. [Three-package publication evidence](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/publication.json).

At historical source `abbe13ad3658ff9e2e100989a4cfefc409d9261c`, the combined local suite actually ran **456 tests across 18 files + 10 real CLI tests across 3 files**, with no skips. Subsequent fixture and native-preflight repairs compared the selected runtime components byte for byte; release source `772fcdbda85bcf91df95bfced5b476dcf4c74614` did **not** repeat that combined local suite. [Component scope evidence](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-native-preflight-2026-10-30/review.json) and the release source's [cloud gates](https://github.com/chainlesschain/chainlesschain/blob/0d57ebfea919ae941a36a1f11a9ee10964722120/docs/research/cli/evidence/release132-public/gates.json) retain this distinction. Failed source `40753f179a3dc18760bd64a754b28a46ba718f57` and the earlier superseded `7f8ef64b4bd8b429f97d2e121c440143ed7ddf3b` remain historical; their successful checks do not transfer to this release.

Automatic acceptance remains **34/45**, with **11** unfinished; **3 assisted deliveries** are recorded separately and are not added to that total. The original broker **403** and Memory cold SLO remain unresolved. Publication adds no task acceptance or paid/native admission: **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain. Microsoft Marketplace remains deferred. PC/mobile **v5.0.3.143** remain independent.

## CLI 0.166.131 — previous public release (2026-10-29)

Install: `npm i -g chainlesschain@0.166.131 --registry https://registry.npmjs.org`. Kernel **0.1.11** was published first. Restart the chat host, then run `cc --version` and `cc doctor`. Public Open VSX **0.37.169** / JetBrains **0.4.186** both recommend CLI **0.166.131**; their downloaded packages match the official CI payloads. Microsoft Marketplace is deferred.

This release includes explicit independent Goal `verify:` checks, Memory directory identity and cancellation fixes, MCP subtask and late-connection isolation, Skills download cancellation, rule refresh around compaction, temporary-worktree lifetime fixes and updated Terra capability/billing contracts. Exact-source three-OS CLI / Strict / Kernel checks passed. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/40862685540) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/40866417524) verified immutable package bytes and signed provenance. [Publication evidence](../../docs/research/cli/evidence/release131-public/publication.json).

Cumulative accepted tasks remain **34/45**, with **11** unfinished. Full Memory SLO, semantic quality and both IDE journeys remain separate acceptance work; the current native generation driver does not automatically use `verify:`. **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain. PC/mobile retain their independent **v5.0.3.143** release. Older notes below retain their historical scope.

[.131 upgrade guide](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-29-131.html) · [Runtime design](https://design.chainlesschain.com/release-runtime-update-2026-10-29-131.html).

## CLI 0.166.130 — previous public release (2026-10-29)

Install the verified public package with `npm i -g chainlesschain@0.166.130 --registry https://registry.npmjs.org`. Public Open VSX **0.37.168** and approved JetBrains **0.4.185** both recommend `.130`; restart the chat host and run `cc --version` and `cc doctor`. Microsoft Marketplace remains unpublished; use Open VSX or its versioned VSIX.

Model Goal review shares the author request budgets, cancellation and output limits, and binds completion evidence to current workspace bytes. Unknown usage, incomplete workspace coverage and external changes prevent a completion claim. The release also repairs the digest-bound security test map and audit checkout performance without changing assertions or required gates.

Immutable source `f3015e799624b81af564aaaa1b7701c0a5c70e26` passed complete Linux, Windows and macOS CLI CI (**72/72 jobs**) and Strict Sandbox. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/40798105505) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/40799988792) verified registry bytes against CI, signed provenance and ten direct child pins; all thirteen workflow-required child packages were verified public before publication. Both IDEs have successful tagged release gates and verified public downloads at the same source. [Publication evidence](../../docs/research/cli/evidence/release130-public/publication.json) · [Current upgrade guide](../../docs-site/docs/chainlesschain/agent-platform-release.md).

Public `.130` pins `@chainlesschain/context-memory-kernel@0.1.10`. Later main-branch kernel `0.1.11`, independent `verify:` Goal checks, Memory disk cancellation/cache changes and Terra capability/billing work are unreleased and require a separate release with child publication and fresh exact-source gates.

Historical cumulative accepted deliverables remain **34/45** (ordinary **27/36**, first-run **7/9**), with **11** unfinished. The frozen formal evaluation remains **NOT_RUN (0/36, 0/9)**. Publication and CI add no task acceptance; **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain. [Actual completion table](../../docs/research/cli/verify01-36-plus-9-task-list.md). PC/mobile remain on the separate **v5.0.3.143** release. The versioned notes below retain their historical scope.

## CLI 0.166.129 — change review and Codex compatibility (public, 2026-10-29)

This release adds isolated hermetic change-review context and a shared experimental Codex App Server support manifest with versioned three-platform probes. Install the verified public package with `npm i -g chainlesschain@0.166.129 --registry https://registry.npmjs.org`. Public Open VSX **0.37.167** and JetBrains **0.4.184** both recommend `.129`; restart the chat host and check `cc --version` and `cc doctor` after upgrading. Microsoft Marketplace is deferred and remains unpublished; use Open VSX or the versioned VSIX for VS Code.

Exact CLI source `fd8a21637ab188dae0c777442d312ae85d420a9b` passed complete Linux, Windows and macOS CLI CI and Strict Sandbox. [OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/40693655894) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/40723568902) verified registry bytes against the immutable CI artifact, signed provenance and ten direct child pins. Both IDEs have their own exact-source gates at `800e9cc99711f9f02eb3bbd78eb14600406bdba5` and verified public downloads; JetBrains is approved and listed. [Publication evidence](../../docs/research/cli/evidence/release129-public/publication.json).

Child pins are unchanged; experimental routing and `--review-changes` remain off by default. Cumulative accepted deliverables are **34/45**, with **11** unfinished (ordinary **27/36**, first-run **7/9**); this is not a `.129` single-version success rate. **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain. Independent `verify:` Goal checks, the subsequent Memory disk/cache fixes and Terra profile/cache billing are main-branch work, not part of `.129`. PC/mobile remain on the separate **v5.0.3.143** release. [Historical .129 upgrade guide](../../docs-site/docs/chainlesschain/cli-ide-update-2026-10-29.md) · [Current task status](../../docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md). The dated release notes below retain their historical scope.

Read-only Git inspections such as `status`, `diff`, `log`, `show` and `rev-parse` now skip workspace snapshots in IDE and CLI agent sessions. Mutations and commands with explicit output files or external drivers retain checkpoints. Conversation persistence and permission checks remain active; end-to-end latency still depends on the repository, model and tools.

## CLI 0.166.128 — verification and discovery (public, 2026-10-28)

This release adds evidence-based goal evaluation, visible checkpoint persistence failures, multilingual MCP / Skills discovery, opt-in compact MCP catalogs and reduced Memory index merging. The full internal tool inventory and execution permissions remain enforced. Compact catalogs use `mcp.toolSearch.catalogMode: "compact"`; the default remains `stubs`. Synthetic token and latency measurements do not establish real billing or task-quality gains.

It also adds explicit `cc agent -p "task" --review-changes` for one completion-review opportunity after successful write/edit tool changes. Inspection and repairs use the same remaining request, permission and cost budgets; incomplete usage blocks additional review. This mode publishes final text only, including when partial messages were requested. It is off by default, supports headless and stream-json input, and does not claim test or native acceptance success.

Install the verified public CLI: `npm i -g chainlesschain@0.166.128 --registry https://registry.npmjs.org`. Open VSX **0.37.166** and JetBrains **0.4.183** are public and recommend `.128`. Their exact-source release gates and public artifact readback passed; the VSIX matches CI byte for byte, and every original JetBrains ZIP payload entry matches. Child package pins are unchanged. [Release progress](../../docs/research/cli-ide-release128-progress-2026-10-27.md).

Exact source `dfa158e36171e347a40e23356c2ed7bd04e0c061` passed complete Linux, Windows and macOS CLI CI and Strict Sandbox. [GitHub Actions OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/40552876222) and [independent public readback](https://github.com/chainlesschain/chainlesschain/actions/runs/40556529770) passed: registry bytes match the immutable CI artifact, with signed provenance and ten direct child pins verified. [Publication evidence](../../docs/research/cli/evidence/release128-public/publication.json). Mobile and PC [v5.0.3.143](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.143) is public from frozen source `036d2b8be2048c98e56e917c93380f169e6a9d7b`; five platform builds, all 22 public assets and three desktop updater metadata sets are verified in [Release 40565272034](https://github.com/chainlesschain/chainlesschain/actions/runs/40565272034). Microsoft Marketplace remains unpublished; cumulative task acceptance **32/45**, **13** unfinished, and **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain.

## Current command and configuration references

The current [Agent reference](https://docs.chainlesschain.com/chainlesschain/cli-agent.html) covers optional delivery review and Goal recovery. [IDE configuration](https://docs.chainlesschain.com/chainlesschain/ide-plugin.html) documents conversation model overrides and unreadable configuration. [MCP Tool Search](https://docs.chainlesschain.com/chainlesschain/cli-tool-search.html), [Skills](https://docs.chainlesschain.com/chainlesschain/cli-skill.html), and [Memory](https://docs.chainlesschain.com/chainlesschain/cli-memory.html) describe discovery, defaults and query limits. Published behavior follows its frozen release source. Post-release main d9f2511b95 adds explicit review forwarding to evaluation drivers; its campaign is PREPARED_NOT_DISPATCHED and adds no independent acceptance.

## CLI 0.166.127 — optional self-evolution (2026-10-27)

完整中文说明见[CLI 与 IDE 自进化开关配置](../../docs/cli/SELF_EVOLUTION_CONFIGURATION.md)，包括默认行为、配置优先级、界面入口与生效时机。

Ordinary Agent, `ask`, `chat` and `cc ui` use self-evolution only when enabled. Fresh installations and older automatically created local profiles default to off. In the user `config.json` (`~/.chainlesschain/config.json`, or the selected `CHAINLESSCHAIN_HOME`), use:

```json
{ "evolution": { "enabled": false } }
```

Run `cc config set evolution.enabled true` to opt in, or `cc config set evolution.enabled false` to switch off. `cc evolution deployment enable` initializes the local signed runtime when needed; `cc evolution deployment disable` turns it off and retains deployment data. `cc evolution deployment status --json` reports the effective state. An explicit `false` also overrides inherited deployment environment variables; explicitly supplied external/managed deployments remain opt-ins when this setting is absent.

The **Skill 自进化配置** page in `cc ui`, VS Code and JetBrains shares this setting. Since CLI **0.166.133**, `cc ui` Chat, Agent, Quick Ask, streaming and Personal Data Hub model requests re-read it for each new request, including existing UI sessions. Stop and restart already running terminal or IDE Agent sessions to apply changes there. Switching off leaves ordinary chat, tool permissions and sandbox policy available. Enabled deployments still enforce their signatures and evidence validation; automatic candidate promotion remains `HOLD`. RRSI evaluation modules are part of the CLI evolution code, but this switch does not itself start a full RRSI campaign or publish learned candidates.

Install this release with `npm i -g chainlesschain@0.166.127 --registry https://registry.npmjs.org`. Paired public IDE versions are Open VSX / VS Code **0.37.165** and JetBrains **0.4.182**. Their exact-source release gates and public archive readback passed; Microsoft Marketplace remains unpublished. Child package pins are unchanged. The preceding **0.166.126** JSON recovery-summary repair addresses host-truncated retained context; the same error code can also report other invalid original evidence. Exact-source Linux, Windows and macOS CLI CI and Strict Sandbox passed; GitHub Actions OIDC publication and public package readback are complete. Mobile and PC release [`v5.0.3.142`](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.142) is public from frozen source `c9881a2b710cf49f0ad3d63673e0998ecc608514`; automatic promotion remains `HOLD`.

## CLI 0.166.126 (public, 2026-10-26)

Fixes `Agent model JSON text is malformed or ambiguous` after reading a worklog or retaining a long tool result. Host-created recovery excerpts now preserve complete JSON values or explicitly omit an unsafe excerpt instead of passing a character-cut fragment to the next model turn. The fix covers file and remote-read summaries, task checkpoints, worklog context, legacy-session restart and handoff. Canonical session history remains unchanged; omitted source excerpts do not count as visible file content.

Install: `npm i -g chainlesschain@0.166.126 --registry https://registry.npmjs.org`. Restart the IDE chat host, then check `cc --version` and `cc doctor`. Public Open VSX **0.37.163** recommends CLI **0.166.125**; existing JetBrains **0.4.179** recommends CLI **0.166.123**. Child versions are unchanged, including Session Core **0.3.24**.

Published through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40332695884) from exact source `1b848f7e265737b73e6f8ac99f0aeaf9ea5dadbe`. Linux, Windows and macOS **CLI CI** and **CLI Strict Sandbox** passed; the public archive matches the immutable CI artifact, and signed provenance and ten direct child pins are verified. [Publication evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release126-public/publication.json). One macOS E2E shard was rerun after GitHub could not allocate a hosted runner; its tests passed without source changes.

Original malformed/duplicate JSON still fails closed; credential/PII redaction and decoding budgets remain enforced. This is a CLI repair, with no native release or new live model-task acceptance. The separate [Open VSX 0.37.163 release](https://github.com/chainlesschain/chainlesschain/actions/runs/40351653016) passed three-OS browser evidence, host and Remote SSH gates; its public VSIX matches the immutable CI artifact byte for byte. [IDE readback evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release126-public/open-vsx.json). Microsoft Marketplace remains unpublished. Cumulative acceptance remains **32/45**, with **13** unfinished; **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain.

## CLI 0.166.125 (public, 2026-10-26)

Fixes Agent Run termination after successful Python `run_code` calls containing list unpacking such as `["git", *args]`. The next model request can project the completed tool history. Versioned v8 projection also recognizes bounded JavaScript spread, object unpacking and unary/binary expressions in known code fields and supported code fences. Strict tool argument JSON, nested malformed/duplicate JSON checks, redaction and shared budgets remain enforced; v7 evidence remains verifiable.

CLI **0.166.125** is public through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40274009347) at source `4285a55c2f4dfb0c0eddb7cb8f63fc73f2ff1a2b`. Exact-source Linux, Windows and macOS CLI CI and CLI Strict Sandbox passed. The public npm archive matches the immutable CI artifact byte for byte; registry integrity, signed provenance, ten direct child pins and the offline changelog identity were verified. [Publication evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release125-public/publication.json).

Install: `npm i -g chainlesschain@0.166.125 --registry https://registry.npmjs.org`. Restart the IDE chat host, then check `cc --version` and `cc doctor`. Current public IDEs are Open VSX **0.37.162** / JetBrains **0.4.179**, whose recommendation remains CLI **0.166.123**. This release updates the CLI only; child pins remain unchanged, including Session Core **0.3.24**.

New source expressions with preceding sensitive names or opaque template context remain rejected conservatively. This is a targeted compatibility fix, not a general Python/JavaScript parser. No new live model-task acceptance is claimed: cumulative acceptance remains **32/45**, with **13** unfinished; **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain.

Candidate `.124` was stopped before publication because its committed offline changelog did not match the canonical release notes. Its immutable tag is retained; `.125` includes the regenerated changelog and passed fresh exact-source release gates.

## CLI 0.166.123 (public, 2026-10-26)

This release addresses inherited `fable[1m]` model settings overriding a configured non-Anthropic provider, Windows model-turn preparation latency, and Python formatted-string tool evidence being rejected as ambiguous JSON. It pins Session Core **0.3.24**. The GitHub Actions OIDC release workflow requires exact-source Linux, Windows and macOS CLI CI and CLI Strict Sandbox, publishes and verifies Session Core first, and verifies the public CLI archive before reporting publication success.

CLI **0.166.123** is public through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40251206428), at source `8096acf1ec0bc5e7b25810f5cc08128ba90aca3b`. Exact-source three-OS gates, public archive bytes, signed provenance and ten direct child dependency pins are verified. [Publication evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release123-public/publication.json).

Install: `npm i -g chainlesschain@0.166.123 --registry https://registry.npmjs.org`. Existing IDE pairing remains VS Code **0.37.161** / JetBrains **0.4.178**, which still recommend CLI **0.166.121**; no IDE or native-client release is included. Acceptance remains **32/45**, with **13** unfinished; **NOT_PAID_READY**, **NOT_ADMITTED** and **HOLD** remain. Candidate **0.166.122** was stopped by CI before publication; its immutable source tag is retained. The preceding verified public release and its evidence are recorded below.

## CLI 0.166.121 (public, 2026-10-26)

Fixes Evolution ingress rejecting ordinary display text as malformed JSON: numeric status, progress and percentages, dates and timestamps, Git hashes and ranges, version links, simple wiki links, numeric regex ranges and unquoted Shell tests. Standalone non-sensitive quoted prose labels are also supported. ANSI terminal controls no longer cause JSON parsing errors; existing injection quarantine still applies. JSON validation, credential/PII redaction and projection budgets remain enforced. Versioned projection rules preserve historical evidence verification.

Sensitive assignments with primitive-looking prefixes or concatenated strings fail closed instead of redacting only the first token and exposing a suffix.

CLI **0.166.121** is public through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/40225573887). Source `4a7e5adc5e6a241434ecfa906a272e34b5ea6d2a` passed CLI CI and CLI Strict Sandbox on Linux, Windows and macOS. Public npm archive integrity, signed provenance, packaged fix sources and public child dependency pins have been verified. A separate public registry install with `--ignore-scripts` verified the CLI archive, ten direct child pins, `cc --version` and the static `cc agent --capabilities` manifest. [Publication evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release121-public/publication.json).

This release retains Session Core **0.3.23** and Agent SDK **0.2.16**. The new pairing is VS Code **0.37.161** / JetBrains **0.4.178**, both recommending CLI **0.166.121**. [Open VSX 0.37.161](https://github.com/chainlesschain/chainlesschain/actions/runs/40227329131) is public and its downloaded VSIX matches the immutable CI candidate, including CLI recommendation 0.166.121. [JetBrains 0.4.178 publication](https://github.com/chainlesschain/chainlesschain/actions/runs/40227329241) is approved and publicly listed; its downloaded ZIP identity and CLI recommendation are verified. Every candidate inner JAR entry matches the public package with no added entries; raw ZIP bytes differ. The preceding pairing is VS Code **0.37.160** / JetBrains **0.4.177**. No new live model-task acceptance was run: cumulative acceptance remains **32/45**, with **13** unfinished; **NOT_PAID_READY**, **NOT_ADMITTED** and automatic promotion **HOLD** remain. Microsoft Marketplace remains unpublished.

Install: `npm i -g chainlesschain@0.166.121 --registry https://registry.npmjs.org`, restart the IDE chat host, then run `cc --version` and `cc doctor`.

## Previous CLI 0.166.118

This version follows Session Core **0.3.23** and Agent SDK **0.2.16** and pairs with VS Code **0.37.160** and JetBrains **0.4.177**. It includes the Web Panel DOMPurify security patch, input delivery and Windows draft recovery fixes, project-instruction code fence handling, bounded long-session index reuse, typed Evidence storage and native Windows ACL startup. Native ACL startup covers the original runtime filesystem adapter as well as default Node storage; custom filesystem operations keep their explicit dependency boundary. Compact index reuse spans typed stores within the existing memory budget, and default artifact reads avoid duplicate physical reads while retaining full identity and digest checks. IDE input receipts remain separate from conversation replay, so completed tools can settle without falsely reporting a concurrent session revision. Long-session retention preserves completed results, runtime message identity and historical recovery lineage. It preserves redacted transport receipts for future native task retests. Releases require the exact-source Linux, Windows and macOS Actions gates. Required order: child npm packages → CLI → IDE extensions → mobile / PC clients, verifying public artifacts at each stage.

Long-session recovery shares one authenticated history and ledger-frontier read. Fixed local signing keys use bounded verification reuse; stored bytes, current artifact authority and the final frontier remain freshly checked.

Unexpected session ownership loss and failed incoming evidence storage return explicit terminal errors. Normal cancellation remains supported. Index aliases and authenticated directory scopes reduce repeated history work while retaining fresh bytes, complete identity checks and the existing authority and memory limits.

Evolution witness, manifest catalog and head files receive explicit Windows owner and ACL repair before durable readback, including files created by elevated tokens. Directory checks retain their existing behavior.

Install this version after its npm release is available:

```bash
npm i -g chainlesschain@0.166.118 --registry https://registry.npmjs.org
cc --version
cc doctor
```

Cumulative 36+9 acceptance is **32/45** across versions, with **13** unfinished; no new model-task acceptance is claimed for this version. Formal paid readiness, native admission and automatic promotion retain their separate gates. The sections below preserve the preceding public-release evidence and limitations.

## Previous CLI 0.166.117

[Upgrade guide](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-23.html) · [Image budgets and session recovery](https://docs.chainlesschain.com/chainlesschain/agent-input-and-recovery.html) · [Runtime design](https://design.chainlesschain.com/release-runtime-update-2026-10-23.html)

CLI **0.166.117** was published through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/39845469661) and its public archive integrity, signed provenance and independent registry-only install have been verified. It fixes Python/JavaScript code literals being rejected as malformed JSON at Evolution ingress and persists completed tool rounds before error exits terminate the Agent Run. Genuine JSON checks and projection budgets remain enforced. The exact source commit passed the complete Linux, Windows and macOS CLI CI and Strict Sandbox gates. [Publication evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release117-public/publication.json).

Image transport has a separate byte budget: up to eight images and 20 MiB per message, with 40 MiB of images across one model request. Base64 bytes do not consume the 1 MiB text-input budget. Vision token planning uses a separate per-image reserve; provider usage receipts determine actual consumption. Text byte pressure triggers canonical compaction before the bounded projection ceiling. Large tool outputs retain complete JSON values or an explicit omission notice, so truncation does not corrupt the next model request.

These image admission ceilings remain subject to the durable session format's **16 MiB per event** limit, including JSON and base64 overhead. This release preserves that existing storage contract; it does not promise that a 20 MiB binary image fits in a durable event. The model-visible text projection is bounded to **896 KiB**, with capacity reserved for its signed record metadata. A protected current user request that exceeds a hard limit must be reduced before continuing.

Large image context bundles use private, session-scoped references during durable compaction. Back up and migrate the session bundle directory together with its JSONL history; copying JSONL alone does not copy referenced images. Persistent bundles require a live saved session and are never created as a fallback for unsaved or ephemeral sessions.

```bash
npm i -g chainlesschain@0.166.117 --registry https://registry.npmjs.org
cc --version
cc doctor
```

The preceding CLI **0.166.115** was published through [GitHub Actions OIDC](https://github.com/chainlesschain/chainlesschain/actions/runs/39791145970). It fixes undefined tool-evidence fields; the code-literal ingress regression is addressed in .117. Candidate .116 was not published after source/public child-package drift was detected. This release aligns Session Core **0.3.22** and Personal Data Hub **0.4.66** before CLI publication.

Open VSX **0.37.159** is public and its download verified; JetBrains **0.4.176** is approved and its public download verified. Both recommend CLI **0.166.117**. The unpublished IDE .158/.175 candidates were retired after preflight found a stale Doctor recommendation test; their immutable tags are retained. The fully verified historical IDE pairing and release limits below are retained.

### Intermediate .114 release (2026-10-22)

CLI **0.166.114** and Open VSX **0.37.156** were published and their public archives verified. CLI .114 improves Quick Ask but still has the Agent tool-evidence JSON error fixed by .117. Its installation command is `npm i -g chainlesschain@0.166.114 --registry https://registry.npmjs.org`. JetBrains **0.4.173** was uploaded before cancellation; public approval and download have not been verified. CLI **0.166.113** was not published after its macOS gate failed on a temporary-path alias assertion. The last completely verified three-channel pairing is recorded below.

## Historical package version and IDE pairing (.112)

<!-- release112-status -->

Checked on **2026-10-22**: npm CLI **0.166.112**, Open VSX **0.37.155** and JetBrains Marketplace **0.4.172** are public and downloadable. Both IDE artifacts recommend CLI **0.166.112**.

npm publication used GitHub Actions OIDC from source `35a2508d156152a61d74fbf8135fcfa1225fe235` ([publish run](https://github.com/chainlesschain/chainlesschain/actions/runs/39661868416)); all 71 CLI CI jobs and all 5 Strict Sandbox jobs passed on that exact source. The public tarball integrity and npm provenance source/run binding were read back. Session Core **0.3.21** was available before CLI publication.

The IDE tags `ide-vscode-v0.37.155` and `ide-jetbrains-v0.4.172` point to `ae27ef6dfc8cf1e45bf084030816b02c77dc2a34`. [Open VSX publication](https://github.com/chainlesschain/chainlesschain/actions/runs/39673804362) passed. [JetBrains publication, attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/39676899944/attempts/2) passed after one bounded macOS 2024.2 rerun; the original performance failure is retained. JetBrains now reports `approve=true`, `listed=true`, `hidden=false`. Both public IDE archives were downloaded and their embedded version and CLI pairing checked. [Public readback evidence](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release112-public/publication.json).

CLI 0.166.112 retains generated signing-key paths for explicit Evolution test deployments and the provider routing fixes prepared in 0.166.111. Gemini Quick Ask and chat use its native API; the Gemini agent and Hub compatibility clients use `/v1beta/openai`. Anthropic uses native Messages APIs, while OpenAI-compatible providers use `/chat/completions`. Provider overrides resolve their own endpoint, model and credentials. Ollama base URLs normalize an optional `/v1` suffix, and first-use local Quick Ask initializes its user-scoped signed host. Session Core 0.3.21 supplies the Windows extended-path ACL fix.

Install the verified public CLI with `npm i -g chainlesschain@0.166.112 --registry https://registry.npmjs.org`. Pair it with Open VSX **0.37.155** or JetBrains **0.4.172**, then restart the IDE chat host and run Doctor.

No new model-task retest was run for this release; local Ollama model validation is left to the user after upgrading. Historical cross-version accepted deliveries remain **31/45** (**26/36** ordinary, **5/9** first-run), with **14** unaccepted. This is not a .112 single-round success rate. **NOT_PAID_READY**, **NOT_ADMITTED** and automatic promotion **HOLD** remain. Microsoft VS Code Marketplace remains unpublished; stock VS Code users can install the public Open VSX VSIX. Native product **v5.0.3.140** is a separate release; desktop integration requires matching builds, authorization and native confirmation.

### Verified public snapshot (2026-10-20, before .108 publication)

Checked on 2026-10-20: npm CLI **0.166.107**, Session Core **0.3.20**, Open VSX **0.37.152** and JetBrains **0.4.169** are public. Both IDEs recommend CLI `.107`. CLI release source is `6775d7a2de`; IDE source is `94429fada4`. Complete release gates and public artifact readback passed. The historical `.105/.150/.167` retest collected **20/20** generation and independent acceptance records and added **6** passes. Cumulative cross-version accepted deliveries are **31/45** (**26/36** ordinary, **5/9** first-run), with **14** unaccepted. This release has no new model task retest; cumulative coverage is not a .107 single-round success rate. Microsoft Marketplace remains unpublished.

The snapshot installation command was `npm i -g chainlesschain@0.166.107 --registry https://registry.npmjs.org`. After upgrading, restart the IDE chat host and run Doctor. The original completed round used CLI `.104`, Open VSX `.149` and JetBrains `.166`; it does not establish `.105` task acceptance. [Current upgrade guide](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-20.html).

## Goal draft capabilities (public CLI .108)

Public CLI .108 includes the goal catalogs and authorized panels, offline description request export, online pending drafts and receipt reconciliation introduced by development snapshot `f21eac547e`. Session Core 0.3.20 supplies the required public exports. IDE and desktop integration require matching builds; pending suggestions still require desktop preview and native confirmation. See the [goal draft guide](https://docs.chainlesschain.com/chainlesschain/goal-drafts-current.html).

## Release snapshot (2026-10-12, historical)

Source candidate **0.166.100** pairs with VS Code **0.37.144** and JetBrains
**0.4.162**. It bounds cancellable Retry-After waits at 60 seconds, preserves
terminal failures and prevents replay after visible streaming output. Chat
forwards token callbacks and request options correctly. Evaluation tooling
rechecks formal windows, saved bindings and modified documentation baselines.

The candidate is unpublished. Publication requires the final commit’s complete
GitHub Actions release gates and OIDC child-package verification; IDE publication
follows public CLI availability. Child versions remain unchanged and require
public-byte, source-tree and provenance checks before reuse.

### Published pairing at the 2026-10-12 snapshot

Public npm is **chainlesschain@0.166.99**, with Agent SDK **0.2.14**, Session
Core **0.3.19**, Personal Data Hub **0.4.64** and Context/Memory Kernel **0.1.9**.
Open VSX **0.37.143** and JetBrains **0.4.161** recommend that CLI; public
artifacts and the original exact-source release receipts have been read back.

Windows native review requires separate admission. Public .105 task retesting has collected 20/20 records; cumulative accepted delivery coverage is 31/45 across versions, with 14 still unaccepted.
The original macOS needs-input performance failure and all unfinished native,
durable, human, billing and long-term acceptance remain separately recorded.

### Linux process ownership recovery (public 0.166.91)

```bash
cc agent process-ownership status --json
cc agent process-ownership recover <execution-id> --timeout-ms 5000 --json
```

Recovery verifies the exact persisted cgroup, stops it, and clears quarantine only after confirmed cleanup. It never resumes the task; Windows/macOS reject this Linux-specific operation. Windows native evaluation keeps wall-time, capability/admission and failed-cleanup evidence; diagnostics and CLI release checks do not qualify a formal effect experiment.

### Memory pagination (public 0.166.88)

Requires canonical memory mode; legacy/shadow rejects paging and does not migrate automatically. Back up and arrange the supported canonical cutover first.

```bash
cc memory show --page --category work --limit 20 --json
cc memory show --cursor "<nextCursor>" --category work --limit 20 --json
```

Pages contain `entries` and `nextCursor` (`null` at the end). Keep category and limit unchanged. Writes, changed filters, or a different store cause `CONTEXT_MEMORY_CURSOR_INVALID`; restart from page one. Ordinary `show --json` returns an array. Older readers reject indexed v2 descriptors; stop old writers and use a compatible snapshot for downgrade. [Memory usage](https://docs.chainlesschain.com/chainlesschain/cli-memory.html).

### Reviewed project evaluation (public 0.166.88)

`cc eval --suite verify01` requires pinned plan/review digests, an exact project checkout, and independently reviewed setup/check scripts outside the project. `--samples` keeps the fixed 36+9 denominator; unselected samples remain missing. Raw output and full diffs are retained with `--evidence-dir`. `--trend --strict` requires complete, comparable, recent evidence. Track formal sample status in the current campaign evidence; capture/import, fixtures, and dry runs are not formal observations. [Evaluation guide](https://docs.chainlesschain.com/chainlesschain/cli-eval.html).

### Recovery and acceptance scope

Explicit Linux durable permissions require administrator provisioning. Cross-process/Worker revocation polls every 100 ms; stop receipts follow successful cleanup. Identified cgroup2 survivors are cleaned before new admission, without replaying the original command. Identity drift or persistence failure keeps admission closed. Windows/macOS durable recovery, formal billing, human accessibility, and long-duration SLOs remain open; automatic active Skill promotion stays HOLD. Historical six-target unsigned native validation is not signed candidate publication. [Current design](https://design.chainlesschain.com/agent-runtime-update-2026-10-05.html).

## Quick Start

Install the CLI version published by this release:

```bash
npm install -g chainlesschain@0.166.132 --registry https://registry.npmjs.org
chainlesschain setup
```

After installation, four equivalent commands are available:

| Command          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `chainlesschain` | Full name                                                         |
| `cc`             | Shortest alias, recommended for daily use                         |
| `clc`            | ChainLessChain abbreviation, avoids `cc` conflict with C compiler |
| `clchain`        | chainlesschain abbreviation, easy to recognize                    |

```bash
cc setup       # equivalent to: chainlesschain setup
clchain start  # equivalent to: chainlesschain start

# In a terminal, no subcommand starts the coding agent
cc

# Piped input runs one non-interactive agent turn
git diff | cc
```

## Offline PM effect evidence (0.166.73)

The CLI package includes `scripts/pm-exploration-effect.mjs` for offline plan,
report, and frozen cohort slot preparation and verification. The workflow can
recheck signed Eval receipts, preserve unresolved observations from missing or
rejected runs, and total signed execution usage. Save the plan and slot
manifest digests independently before collection; matching digests alone do
not prove preregistration time or complete launch coverage.

These artifacts do not authorize promotion or Pilot. Target-environment PM/Pilot
outcomes, full preparation and provider costs, and complete launch coverage
still require independent validation.

## Long-running tasks and bounded recovery (0.166.71)

Since version 0.166.26, the CLI automatically continues repeated large-file
requests from an unread region, including after context compaction. Actual character coverage
prevents a read of the tail from being mistaken for a complete scan. A changed
file resets coverage; explicit small-range reviews remain available for editing.
During task recovery, a known target may be read with an explicit offset and a
limit of at most 80 lines; this does not admit a new whole-file scan.

Large Markdown/text documents return a sampled heading/task-marker index and
a small initial preview. The index survives compaction as source data, allowing
the model to locate relevant work without rescanning the entire document.
At EOF, a repeated scan returns a lightweight use-findings response. After two
no-progress batches, one model request omits read_file to encourage a concrete
action or search; normal reading resumes on the following turn. Searches do not
clear a reading loop. A model that ignores recovery for six no-progress batches
still fails explicitly rather than claiming the task is complete.

Recovery-paused calls are runtime control results, not file or remote tool
observations. They do not advance those tools' duplicate/failure counters, and
a one-request pause really expires on the next request. They still count as
global no-progress model attempts, so an ignored recovery cannot run forever.
This prevents recovery paths from feeding their own denials back into a
self-sustaining loop while preserving both task and six-real-attempt backstops.
During global task recovery, a known repeated remote target remains available
under its narrower remote guard; unrelated remote discovery stays paused.

Interactive streamed Agent sessions have no implicit 50-model-call ceiling.
Explicit turn, environment, cost and session budgets still apply. Unattended
runs retain the default cap; use `cc agent -p "your task" --max-turns 100` to
set an explicit limit. VS Code extension 0.37.109 provides
`chainlesschain.chat.maxTurns`: 0 follows the interactive default, and a
positive integer limits each message while preserving session history.

Large-file reads return exact byte/line continuation cursors, retain the latest
cursor through compaction, reuse unchanged pages and invalidate after edits.
Slow foreground commands keep persistent IDE streams and lease heartbeats
responsive. This does not remove approval, sandbox or budget boundaries.

## Open local Skill decision providers (0.166.71)

The governed Skill decision layer now supports TypeSafe Jev, local Laya, and
other services implementing the same `/v1/systemone` contract. Laya defaults to
the loopback-only endpoint `http://127.0.0.1:8000` and does not require a cloud
credential:

```powershell
cc agent --session laya-pilot-1 --decision-provider laya --decision-mode shadow -p "检查并修复单元测试"
```

Use `--decision-provider system-one` with an explicit `--decision-model` and
`--decision-base-url` for another compatible service. TypeSafe uses
`TYPESAFE_API_KEY`; authenticated local or compatible services use the separate
optional `DECISION_API_KEY`. Local provider failure never falls back to TypeSafe
and leaves the existing Skill retrieval result unchanged. These flags select the
Skill decision model only; configure the main Agent model separately.

In `0.166.72`, a local decision deadline records `provider-timeout` and unknown
usage instead of surfacing the timeout as a user cancellation. The offline
benchmark uses one-sided 95% exact binomial upper bounds for its two error
rates, so a few error-free examples cannot pass the quality check. A real-weight
Laya CPU smoke probe found that short Chinese tasks can route to English
weights when English candidate metadata dominates the state, and complete
requests can exceed the default 800 ms deadline. Keep the decision mode off
outside controlled evaluation; the smoke probe is not a quality gate.

## Governed Jev Skill decision pilot (0.166.70)

Durable, single-prompt headless sessions can opt into a TypeSafe Jev
Skill-routing experiment. Start with `shadow`: it sends only the bounded task
query and up to five already-admitted Skill summaries, then records the typed
decision without changing the existing retrieval result.

```powershell
$env:TYPESAFE_API_KEY = "<secret>"
cc agent --session jev-pilot-1 --decision-mode shadow -p "检查并修复单元测试"
```

`--decision-mode suggest` exposes a validated recommendation as additional
routing metadata, but does not replace `selectedDigest`, load a Skill, or
execute it. The default is `off`. Enabled modes require a durable session and
currently exclude interactive and `stream-json` runs. Endpoints must use HTTPS
or loopback; credential, budget, cancellation, deadline, and usage-ledger
failures remain fail-closed.

Versions 0.166.39 through 0.166.42 also treat repeated CI-log, GitHub, and
pull-request reads as one bounded investigation. Evidence survives compaction,
while recovery directs the agent toward a concrete mutation, verification, or
blocker. Explicit requests to close a targeted pull request remain explicit;
normal execution approval and one-time state verification still apply.

## Governed PM exploration evidence and recovery (introduced in 0.166.63; execution disabled)

The package now includes bounded PM Broad/Deep round contracts, a read-only
result grader, quiescent recovery snapshots, and an Evolution
Ledger/Artifact-authority adapter. Training projections exclude validation/test
tasks, private expected results, grader identity, and raw split values. A
candidate Memory advances only inside its Journal; it is not written into the
user's four-layer Memory, the active Skill tree, or the release registry.

Recovery snapshots are exported only with no active round. Restore reconstructs
the Journal from its frozen Plan, replays every Broad checkpoint, merge, Deep
checkpoint, and freeze transition, then compares all digests. A
`retention:"ledger"` artifact must resolve through its durability authority;
an intact local cache cannot turn an authority timeout or disconnect into
success. Unknown commit results are settled from authenticated Ledger/witness
history rather than retried blindly.

Version 0.166.63 adds host-enforced wall-clock/token/tool budgets and separate
Ed25519 execution, grader, merge, and evaluator receipts. A governed
Volcengine adapter accounts for provider-returned usage and estimated cost,
persists a redacted settlement through an external durability contract, and
binds it into the execution receipt and evidence bundle. A standalone business
grader reads file output or a branded Desktop outcome source instead of trusting
the Actor's self-report.

Desktop receives fixed, parameterized project/board `SELECT` queries bound to
the signed database-path and outcome-source digests. Every round verifies a
SQLite backup seal before execution, captures success or failure state after
execution, serializes rounds sharing the same database, and taints the host on
an unexplained failure. A narrow transition committer durably binds success or
failure evidence; its authenticated recovery port reconstructs the last chain
head after restart. The snapshot-backed path retains and exactly reads back the
same SQLite backup before committing the transition, but it never exposes
generic Ledger/storage authority or database bytes to renderer or IDE clients.

`readyForExecution`, `runtimeVerified`, `authenticated`, and
`qualifiesForPromotion` remain fixed at `false`. The tests use synthetic/local
durability authorities and do not qualify production keys, a remote fault
domain, workspace snapshots, atomic restore, physical power loss, or a real
Electron DID/RBAC PM journey. Explorer and automatic active-Skill promotion
remain disabled.

This release also normalizes Windows recovery temp paths, preserves live state
locks, bounds transient ACL retries, and bounds scheduler-soak leases. These
reliability changes do not widen sandbox, approval, or publication authority.

## Requirements

- **Node.js** >= 22.12.0
- **Docker** (optional, for backend services)

## Shell completion

Completion files are generated from the same command manifest as `cc --help`
and ship in the npm package under `completions/`:

```bash
# Bash
source "$(npm root -g)/chainlesschain/completions/cc.bash"

# Zsh
fpath=("$(npm root -g)/chainlesschain/completions" $fpath)
autoload -Uz compinit && compinit

# Fish
source (npm root -g)/chainlesschain/completions/cc.fish
```

```powershell
# PowerShell
. (Join-Path (npm root -g) "chainlesschain/completions/cc.ps1")
```

## Commands

> **175 top-level compatibility commands** are registered. `cc --help` shows the curated coding-agent surface; run `cc help --all` for the complete manifest-generated list and `cc help <command>` for generated command-specific help.

### Governed evolution, deployment configuration, and Skill retrieval (`0.166.71`)

The public command graph now includes digest-bound Evolution Workbench review,
encrypted governed-knowledge conflict review, and canonical Skill retrieval:

```bash
cc evolution workbench list --status pending --limit 20
cc evolution workbench compare <left-packet-digest> <right-packet-digest>
cc evolution workbench review approve <packet-digest> --reason "reviewed"
cc evolution workbench rollback <active-packet-digest> <approved-packet-digest> --reason "regression"

cc evolution knowledge conflicts --limit 20
cc evolution knowledge merge <conflict-envelope-digest> \
  --record '<canonical-merged-record-json>' --reason "manual conflict resolution"

cc skill search "browser automation" --source workspace --json
```

Workbench and knowledge mutations require a trusted deployment host. The
ordinary CLI does not synthesize reviewer identity, publication authority,
KMS/PKI, or durable receipts; without those dependencies the commands fail as
unavailable. Desktop, VS Code, and JetBrains consume bounded CLI-owned
projections and never gain an independent active-Skill writer. `skill search`
can use BM25 plus optional independently verified vector and invocation-outcome
evidence; missing or ambiguous evidence cannot be promoted into an authority
claim.

An installed CLI can receive those dependencies from a target deployment
without modifying the npm package. The preferred setup verifies and persists
both absolute paths in an owner-only profile:

```bash
# Before the managed root is issued, generate local TEST credentials for an
# existing single-file development host. Re-run after changing the host module.
cc evolution deployment init-test --module /absolute/evolution-host.mjs

# When the managed files arrive, replace TEST through an authenticated rotation.
cc evolution deployment replace-test \
  --descriptor /managed/chainlesschain/evolution-deployment.json \
  --trust-root /managed/chainlesschain/evolution-deployment-ed25519-public.pem

# A machine that never used TEST can configure the managed deployment directly.
cc evolution deployment configure \
  --descriptor /managed/chainlesschain/evolution-deployment.json \
  --trust-root /managed/chainlesschain/evolution-deployment-ed25519-public.pem
cc evolution deployment status

# Pause or resume the saved profile. Neither command enables auto-promotion.
cc evolution deployment disable
cc evolution deployment enable
```

`init-test` uses Node's built-in Ed25519 implementation and requires no OpenSSL.
It refuses to overwrite an existing managed profile or act while deployment
environment overrides are present. Its `deploymentMode: test` status is a hard
visual warning, not production KMS/PKI, witness, grader, or review authority;
automatic active promotion remains `HOLD`.
After `replace-test`, restart long-lived `cc ui`, IDE App Server, or Desktop
processes before managed-environment validation; newly started CLI commands read
the managed profile immediately.

The profile is written atomically to
`$CHAINLESSCHAIN_HOME/evolution/deployment-profile.json` (normally
`~/.chainlesschain/evolution/deployment-profile.json`). VS Code 0.37.109,
JetBrains 0.4.130, and `cc ui` use the same CLI-owned status/configure/toggle
surface. IDEs do not store governance private keys or gain review, promotion,
or release authority. Non-loopback `cc ui` configuration requires a token.

For centrally managed installations, administrators can instead set both
environment overrides. They take precedence over the saved profile:

```bash
CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR=/managed/chainlesschain/evolution-deployment.json
CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT=/managed/chainlesschain/evolution-deployment-ed25519-public.pem
```

The descriptor schema is
`chainlesschain.evolution-deployment-descriptor/v1`. It binds a monotonically
managed revision, an absolute single-file ESM deployment-module path, the
module SHA-256, trust-root SHA-256, and an allowlist containing any of
`agent`, `ask`, `chat`, `compact`, `complete`, `cowork`, `desktop`,
`evolution`, `hub`, `learning`, `marketplace`, `orchestrate`, `serve`,
`skill`, `stream`, and `ui`; its canonical payload must carry an Ed25519
signature.
The authenticated module exports
`createChainlessChainCommandDependencies({ commandName, descriptor, factories })` and
returns the command-specific branded hosts/factories. The invocation also
receives narrow built-in factory functions for the Workbench host, governed
knowledge review host, Agent evolution composition, and authenticated Skill
outcome/vector retrieval authorities as applicable, so the deployment bundle
can construct objects carrying the CLI's unforgeable brands without importing
mutable package files. The CLI executes the
verified module bytes directly, so replacing the pathname after verification
cannot change the loaded code. Partial configuration, signature/digest drift,
missing exports, or absent production authorities keeps Workbench unavailable;
there is no test-key or in-memory fallback.

Deployment configuration selects and verifies a host; it is not an automatic
evolution switch. `status` always reports automatic promotion as `HOLD`.
Candidate activation still requires deployment-owned identity, policy,
evaluation, review, Pilot/Canary, CAS, ledger, and release authority.

### Evolution 数据与 Skill 存放位置

不要把普通 CLI/项目 Skill 目录和受治理 Evolution 的不可变证据混在一起。除非
可信 deployment host 已配置并启用，否则不会创建或使用 Evolution 的 Raw、Wiki、
候选或 Active 目录；当前 `cc evolution deployment status` 是确认是否已配置的唯一
用户入口。

| 内容                                  | 实际路径 / 选择方式                                                                                                      | 说明                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deployment profile                    | `$CHAINLESSCHAIN_HOME/evolution/deployment-profile.json`（通常为 `~/.chainlesschain/evolution/deployment-profile.json`） | 仅保存已验证的 descriptor/trust-root 路径；不是 Raw、Wiki 或 Skill 内容。                                                                                                        |
| 不可变 Raw evidence                   | `<stateRootDir>/<url-encoded tenantId>/<url-encoded runId>/raw/`                                                         | `stateRootDir` 必须由已认证 deployment host 传入，**没有默认目录**。目录是 `ArtifactStore`（`index.jsonl` 和 `files/`）；其中只允许外部 encryptor 产生的密文，Raw 明文不能落盘。 |
| Wiki revision                         | 同一 scope 的 `artifacts/`，即 `<stateRootDir>/<url-encoded tenantId>/<url-encoded runId>/artifacts/`                    | 每个 Wiki revision 是不可变 artifact；其提交由同 scope 的 `ledger-events/` 中 `wiki.revision.committed` 事件和 `witness/checkpoint.json` 绑定。Wiki 不在 `raw/` 中。             |
| Candidate registry（受治理候选制品）  | 默认 `$CHAINLESSCHAIN_HOME/evolution/registry/candidates/tenants/<tenantKey>/`；可信 host 可显式替换 registry root       | `<tenantKey>` 是 tenant ID 的 domain-separated SHA-256，不是可猜测的 tenant 名。候选文件按 content digest 保存，不能直接作为 Active Skill 加载。                                 |
| `cc learning synthesize` 候选输出     | 已认证 host 必须提供绝对 `candidateOutputDir`；目录结构为 `<candidateOutputDir>/<skill-name>/1.0.0/`                     | **没有默认目录**，且必须与所有 Active roots 不重叠。未提供该目录、evaluator 或 Active roots 时命令失败关闭，不写入候选。                                                         |
| 正式/Active governed Skill            | 已认证 host 必须提供一个或多个绝对 `activeSkillsDirs`                                                                    | **没有固定默认目录，也不会从 candidate 自动复制。** 只有通过评测、审核、Pilot/Canary、CAS 和 release authority 后，部署方才可写入其 Active root。                                |
| 普通用户/项目 Skill（非自动晋级产物） | 用户层通常为 `$CHAINLESSCHAIN_HOME/skills/`；项目层为 `<projectRoot>/.chainlesschain/skills/`                            | 这是 Skill loader 的常规加载层。它们不是 Raw/Wiki 证据库，也不因文件存在就获得受治理 Active release 身份。                                                                       |

在 Windows，未覆盖 `CHAINLESSCHAIN_HOME` 时，用户层通常展开为
`C:\Users\<用户名>\.chainlesschain\...`；项目层则在当前项目的
`.chainlesschain\skills\`。管理员应把 production `stateRootDir`、候选根和
Active roots 放在 owner-only、备份受控且不位于工作区的目录，并把它们记录在受签名
deployment module 中，而不是通过普通 CLI 参数或环境变量临时指定。

### Durable governance and marketplace candidates (0.166.24)

Signed deployments can use `openEvolutionWorkbenchFileResources`,
`createEvolutionWorkbenchControlPorts` and the asynchronous
`createEvolutionWorkbenchRuntime`. Startup settles authenticated effects that
already happened and defers unexecuted review/rollback plans. Knowledge
revocation distinguishes candidate quarantine from rejection, authenticates
multi-hop cross-Wiki provenance and recovers targeted tombstone settlement.

`cc marketplace inspect/install` selects a catalog version with
`--skill-version`, pins the manifest and persists an actual candidate file.
`candidate-staged` is not activation. Rollout/revocation require the exact
current state digest and independently verified receipts. Explicit
`serve-badge` publishes one pinned, read-only, expiring Eval snapshot on
loopback by default. See [marketplace contracts](../../docs/cli/GOVERNED_SKILL_MARKETPLACE_CLI.md)
and [Workbench startup](../../docs/features/evolution-workbench/EVOLUTION_WORKBENCH_STARTUP.md).

Session Core 0.3.13 and Core DB 0.1.5 supply the public evolvable-artifact export
and normalized named SQL bindings. Production identity, PKI, witness, grader
and deployment acceptance remain operator-owned.

<!-- BEGIN GENERATED COMMAND LIFECYCLE -->
<!-- Generated by scripts/gen-command-manifest.mjs; do not edit. -->

### Compatibility namespace and command lifecycle

The registered Commander graph contains **175** top-level commands (net growth **0** against the 175-command baseline). After excluding 25 deprecated compatibility entries and adding `lab` as their recommended namespace, the recommended top-level surface contains **151** commands. `lab` is phase-0 only, not another eagerly registered command.

| Legacy entry | Replacement      | Deprecated since | Removal not before | Minimum window |
| ------------ | ---------------- | ---------------- | ------------------ | -------------- |
| `bm25`       | `lab bm25`       | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `ccron`      | `lab ccron`      | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `compt`      | `lab compt`      | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `consol`     | `lab consol`     | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `dao`        | `lab dao`        | `0.162.189`      | `0.164.0`          | 2 minor cycles |
| `evomap`     | `lab evomap`     | `0.162.189`      | `0.164.0`          | 2 minor cycles |
| `execbe`     | `lab execbe`     | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `fflag`      | `lab fflag`      | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `itbudget`   | `lab itbudget`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `mcpscaf`    | `lab mcpscaf`    | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `meminj`     | `lab meminj`     | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `orchgov`    | `lab orchgov`    | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `pdfp`       | `lab pdfp`       | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `promcomp`   | `lab promcomp`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `seshhook`   | `lab seshhook`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `seshsearch` | `lab seshsearch` | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `seshtail`   | `lab seshtail`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `seshu`      | `lab seshu`      | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `sganal`     | `lab sganal`     | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `slotfill`   | `lab slotfill`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `svccont`    | `lab svccont`    | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `tms`        | `lab tms`        | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `topiccls`   | `lab topiccls`   | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `uprof`      | `lab uprof`      | `0.162.194`      | `0.164.0`          | 2 minor cycles |
| `vcheck`     | `lab vcheck`     | `0.162.194`      | `0.164.0`          | 2 minor cycles |

Both forms route to the same lazy command registrar during the compatibility window. Legacy invocations emit their migration notice on stderr only.

<!-- END GENERATED COMMAND LIFECYCLE -->

### `chainlesschain setup`

Interactive setup wizard. Checks prerequisites, configures LLM provider, downloads the desktop binary, and optionally starts Docker services.

```bash
chainlesschain setup
chainlesschain setup --skip-download    # Skip binary download
chainlesschain setup --skip-services    # Skip Docker setup
```

### `chainlesschain start`

Launch the ChainlessChain desktop application.

```bash
chainlesschain start                    # Launch GUI app
chainlesschain start --headless         # Start backend services only (no GUI)
chainlesschain start --services         # Also start Docker services
```

### `chainlesschain stop`

Stop ChainlessChain.

```bash
chainlesschain stop                     # Stop desktop app
chainlesschain stop --services          # Stop Docker services only
chainlesschain stop --all               # Stop app + Docker services
```

### `chainlesschain status`

Show status of the desktop app, Docker services, and port availability.

```bash
chainlesschain status
chainlesschain status --json            # Fast machine-readable snapshot
chainlesschain status --deep            # Also inspect Docker Compose services
```

### `chainlesschain services <action>`

Manage Docker backend services (Ollama, Qdrant, PostgreSQL, Redis, etc.).

```bash
chainlesschain services up              # Start all services
chainlesschain services up ollama redis  # Start specific services
chainlesschain services down            # Stop all services
chainlesschain services logs            # View logs
chainlesschain services logs -f         # Follow logs
chainlesschain services pull            # Pull latest images
```

### `chainlesschain config <action>`

Manage configuration.

```bash
chainlesschain config list              # Show all config values
chainlesschain config get llm.provider  # Get a specific value
chainlesschain config set llm.provider openai
chainlesschain config set-secret llm.apiKey  # Hidden prompt; secret never enters argv
chainlesschain config validate          # Validate schema + private permissions
chainlesschain config explain llm.model # Show effective source / policy lock
chainlesschain config edit              # Open in $EDITOR
chainlesschain config reset             # Reset to defaults
```

### `chainlesschain update`

Check for and install updates.

```bash
chainlesschain update                   # Update to latest stable
chainlesschain update --check           # Check only, don't download
chainlesschain update --channel beta    # Use beta channel
chainlesschain update --channel dev     # Use dev channel
chainlesschain update --force           # Re-download even if exists
```

### `chainlesschain doctor`

Diagnose your environment.

```bash
chainlesschain doctor
```

Checks: Node.js version, npm, Docker, Docker Compose, Git, config directory, binary installation, setup status, port availability, disk space.

---

## Headless Commands

These commands work without the desktop GUI, using core packages directly.

### `chainlesschain db <action>`

Database management.

```bash
chainlesschain db init                  # Initialize the database
chainlesschain db init --path ./my.db   # Custom database path
chainlesschain db info                  # Show database info (driver, tables, size)
chainlesschain db info --json           # JSON output
chainlesschain db backup [output]       # Create backup
chainlesschain db restore <backup>      # Restore from backup
```

### `chainlesschain note <action>`

Note and knowledge base management.

```bash
chainlesschain note add "My Note" -c "Content here" -t "tag1,tag2"
chainlesschain note list                # List recent notes
chainlesschain note list --category dev --tag important
chainlesschain note show <id>           # Show note by ID prefix
chainlesschain note search "keyword"    # Full-text search
chainlesschain note delete <id>         # Soft delete
chainlesschain note history <id>        # Version history
chainlesschain note diff <id> <v1> <v2> # Diff between versions
chainlesschain note revert <id> <ver>   # Revert to a version
```

### `chainlesschain chat`

Start an interactive AI chat session with streaming output.

```bash
chainlesschain chat                     # Default: Ollama qwen2.5:7b
chainlesschain chat --model llama3      # Use different model
chainlesschain chat --provider openai  # Reads the stored credential
chainlesschain chat --agent             # Agentic mode (can read/write files)
```

Slash commands in chat: `/exit`, `/model`, `/provider`, `/clear`, `/history`, `/help`

### `chainlesschain ask <question>`

Single-shot AI question (non-interactive).

```bash
chainlesschain ask "What is WebRTC?"
chainlesschain ask "Explain this code" --model gpt-4o --provider openai
chainlesschain ask "Hello" --json       # JSON output with question/answer/model
```

### `chainlesschain llm <action>`

LLM provider management.

```bash
chainlesschain llm models               # List installed Ollama models
chainlesschain llm models --json        # JSON output
chainlesschain llm test                 # Test Ollama connectivity
chainlesschain llm test --provider openai  # Reads the stored credential
chainlesschain llm providers            # List 10 built-in LLM providers
chainlesschain llm add-provider <name>  # Add custom provider
chainlesschain llm switch <name>        # Switch active provider
```

### `chainlesschain agent` (alias: `a`)

Start an agentic AI session — the AI can read/write files, run shell commands, search the codebase, execute code (Python/Node.js/Bash with auto pip-install), and invoke 141 built-in skills.

```bash
chainlesschain agent                    # Explicit form; plain `cc` is equivalent in a TTY
chainlesschain a --model llama3         # Short alias
chainlesschain config set-secret llm.apiKey
chainlesschain agent --provider openai  # Reads the stored credential
```

Built-in tools (19): `read_file`, `write_file`, `edit_file`, `edit_file_hashed`, `notebook_edit`, `run_shell`, `check_shell`, `git`, `search_files`, `list_dir`, `run_skill`, `list_skills`, `run_code`, `spawn_sub_agent`, `web_fetch`, `web_search`, `todo_write`, `ask_user_question`, `search_sessions`

For gateways with a smaller context allowance, use `cc agent --context-window 32768 -p "your task"`. This operator-declared planning window accepts integers from 1024 to 16777216 and applies to interactive, headless and streamed sessions. It does not change the model's official capabilities, output cap or turn budget. Token planning does not guarantee a serialized request fits a gateway's byte limit; verify the actual request size for that gateway.

**Search first, then read the relevant source.** Use `web_search` with keywords when no URL is known. It returns source links and bounded snippets (`maxResults`, default 8; `maxSnippetChars`, default 2000). The configured provider is respected; `auto` selects an available API key or keyless DuckDuckGo. Captcha, authentication, rate-limit and network failures are errors, never a claim that no sources exist. Configure `.chainlesschain/config.json:webSearch` with an available provider if keyless search is blocked.

**Download once, read or search locally.** `web_fetch` downloads the page, extracts text, saves a local snapshot, and returns the first chunk (`maxChars`, default 20000). Continue with the original URL, format, `snapshotId` and returned `nextOffset` as `offset`; later reads need no network access. Pass a literal `query` with `snapshotId` to search the saved page, then pass a hit's `nextRead` arguments to `web_fetch` to inspect it. Snapshots are process-local, expire after 30 minutes, and are bounded by 32 entries / 128 MB of UTF-16 disk storage; eviction or expiry returns an explicit error. Normal process exit removes them.

```json
{"url":"https://example.com/large-document","maxChars":5000}
{"url":"https://example.com/large-document","snapshotId":"<returned-id>","offset":5000,"maxChars":5000}
{"url":"https://example.com/large-document","snapshotId":"<returned-id>","query":"error","maxMatches":10}
```

The default raw download budget is 10 MB (`maxBytes: 10000000`), separate from returned text length. Above that, text pages return a marked prefix (`downloadTruncated: true`) that can still be saved, searched and paged. Raise `maxBytes` explicitly for the missing remainder, or use a focused source/API endpoint. Incomplete downloads never enter the complete-response memory cache, and unfinished scripts/styles are excluded. `onOverflow: "error"` requires a complete download; JSON always requires completeness and remains a typed value. To page a JSON document, use `format: "text"`. `totalChars` describes only the downloaded portion after extraction, not the complete remote resource. Exceeding snapshot storage returns a clear resource-limit error; no partial result is presented as complete.

**Locate sections in long local files.** `search_files` with `path` and `pattern` streams one text file and returns line/column positions, surrounding text, and `nextRead` arguments for `read_file`. It handles huge single lines using overlapping windows, supports case sensitivity, and pages matches with `nextOffset`. Literal queries up to 2048 characters match across window boundaries. Optional `regex: true` runs in a time-limited worker over overlapping 64K windows; long cross-window regex matches are not guaranteed, so use a literal anchor and inspect the section. Credential and workspace-path guards remain enforced.

```json
{
  "path": "logs/build.log",
  "pattern": "FAIL",
  "maxMatches": 10,
  "contextChars": 150
}
```

HTTP/network failures include error codes and recovery guidance, which IDE chat displays. Repeated failed downloads or unchanged GitHub Actions logs trigger recovery after three no-progress observations and stop after six if recovery fails; the task remains incomplete. Forward snapshot pages are progress even when their text is identical. For CI investigation, retrieve a completed job's log once (for example `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs`), save it and search locally. Status queries, new jobs and changed log contents remain available.

**Agent slash commands (49 built-in)** — type `/` for TAB completion, `/help` for the in-session list. Full reference: [cli-agent-mode](https://docs.chainlesschain.com/chainlesschain/cli-agent-mode.html).

- **Session:** `/help` `/clear` `/exit` `/session` `/sessions` `/rewind` `/search` `/export` `/copy`
- **Model:** `/model` `/provider` `/think` `/ultrathink`
- **Context & memory:** `/context` `/compact` `/microcompact` `/memory` `/init` `/reindex` `/stats` `/task` `/todos` `/profile`
- **Display:** `/theme` `/vim` `/statusline` `/output-style` `/terminal-setup` `/cd` `/add-dir`
- **Tools & observability:** `/cost` `/doctor` `/status` `/release-notes` `/config` `/permissions` `/hooks` `/ide` `/mcp` `/review` `/pr-comments` `/reload-skills`
- **Autonomous & multi-agent:** `/auto` `/plan` `/cowork` `/agents` `/sub-agents` `/tasks`

Plus user macros (`.claude/commands/*.md`) and MCP prompts (`/mcp__<server>__<prompt>`). Prefixes: `!` (run shell), `#` (note to `cc.md`).

**Sub-Agent Isolation v2** (v0.43.0): Complex tasks are automatically decomposed into isolated sub-agents, each with its own namespaced memory, scoped context, and lifecycle tracking. Use `/sub-agents` inside an agent session to inspect active and completed sub-agents, token usage, and average durations.

### `chainlesschain skill <action>`

Manage and run 139 built-in AI skills across a 4-layer system: bundled < marketplace < managed (global) < workspace (project).

```bash
chainlesschain skill list               # List all skills grouped by category
chainlesschain skill list --category automation
chainlesschain skill list --category cli-direct   # CLI command skill packs
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON output
chainlesschain skill categories         # Show category breakdown
chainlesschain skill info code-review   # Detailed skill info + docs
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # Search by keyword
chainlesschain skill run code-review "Review this function..."
chainlesschain skill add my-skill       # Create custom project skill
chainlesschain skill remove my-skill    # Remove custom skill
chainlesschain skill sources            # Show skill layer paths and counts
```

#### CLI Command Skill Packs

Automatically wraps 63 CLI commands into 9 Agent-callable domain skill packs:

Since `0.162.177`, generated direct/hybrid handlers execute through a frozen,
host-scoped Process Broker facade instead of importing `child_process`. The
host owns skill/plugin provenance, command-domain allowlists remain enforced,
shell metacharacters are rejected, and a missing Broker fails closed.

```bash
chainlesschain skill sync-cli              # Generate/update all 9 CLI skill packs
chainlesschain skill sync-cli --force      # Force regenerate all packs
chainlesschain skill sync-cli --dry-run    # Preview changes without writing
chainlesschain skill sync-cli --remove     # Remove all CLI packs
chainlesschain skill sync-cli --json       # JSON output

# Run CLI commands via skill packs (Agent can call these directly)
chainlesschain skill run cli-knowledge-pack "note list"
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill run cli-infra-pack "services up"
chainlesschain skill run cli-ai-query-pack "ask what is RAG"
chainlesschain skill run cli-agent-mode-pack "agent"
chainlesschain skill run cli-web3-pack "wallet assets"
chainlesschain skill run cli-security-pack "encrypt file secret.txt"
chainlesschain skill run cli-enterprise-pack "org list"
chainlesschain skill run cli-integration-pack "mcp servers"
```

| Pack                   | Mode      | Commands                                                 |
| ---------------------- | --------- | -------------------------------------------------------- |
| `cli-knowledge-pack`   | direct    | note, search, memory, session, import, export            |
| `cli-identity-pack`    | direct    | did, auth, audit                                         |
| `cli-infra-pack`       | direct    | setup, start, stop, status, services, config, doctor, db |
| `cli-ai-query-pack`    | llm-query | ask, llm, instinct, tokens                               |
| `cli-agent-mode-pack`  | agent     | agent, chat, cowork                                      |
| `cli-web3-pack`        | direct    | wallet, p2p, sync, did                                   |
| `cli-security-pack`    | direct    | encrypt, decrypt, audit, pqc                             |
| `cli-enterprise-pack`  | direct    | org, plugin, lowcode, compliance                         |
| `cli-integration-pack` | hybrid    | mcp, browse, cli-anything, serve, ui                     |

---

## Phase 1: AI Intelligence Layer

### `chainlesschain search <query>`

BM25 hybrid keyword search across notes.

```bash
chainlesschain search "machine learning"
chainlesschain search "API design" --mode bm25 --top-k 10
chainlesschain search "security" --json
```

### `chainlesschain tokens <action>`

Token usage tracking and cost analysis.

```bash
chainlesschain tokens show              # Current usage summary
chainlesschain tokens breakdown         # Per-model breakdown
chainlesschain tokens recent            # Recent usage entries
chainlesschain tokens cache             # Cache hit/miss stats
```

### `chainlesschain memory <action>`

Persistent memory management.

```bash
chainlesschain memory show              # Show all memories
chainlesschain memory add "Always use TypeScript"
chainlesschain memory search "coding"   # Search memories
chainlesschain memory delete <id>       # Delete by ID prefix
chainlesschain memory daily             # Today's daily note
chainlesschain memory file              # Show memory file path
```

### `chainlesschain session <action>`

Session persistence and management.

```bash
chainlesschain session list             # List saved sessions
chainlesschain session show <id>        # Show session details
chainlesschain session resume <id>      # Resume a session
chainlesschain session export <id>      # Export as Markdown
chainlesschain session delete <id>      # Delete a session
chainlesschain session location compare # Local/WSL/SSH/Container/Cloud catalog
chainlesschain session location handoff <id> <target> --facts <facts.json>
chainlesschain session location attest <id> <target> \
  --facts <facts.json> --profile <target-profile.json> --json
chainlesschain session location resume <id> <target> \
  --facts <facts.json> --profile <target-profile.json> \
  --expected-target-facts-digest sha256:<digest>
chainlesschain session location result-pack <id> \
  --result-id <id> --summary <summary.txt> --diff <result.diff> \
  --artifact application/json=<artifact.json> --json
chainlesschain session location result-verify <id> \
  --bundle <returned-bundle.json> --expected-handoff-id sha256:<digest>
chainlesschain session location result-collect <id> <target> \
  --facts <facts.json> --profile <target-profile.json> \
  --expected-target-facts-digest sha256:<digest> \
  --expected-handoff-id sha256:<digest> --request-id <stable-id> \
  --result-id <id> \
  --summary <target-summary.txt> --diff <target-result.diff> --json
chainlesschain session budget status <id>
chainlesschain session budget receipts <id> --json
```

Target attestation and resume support configured WSL, SSH, and existing
Container hosts. The launcher invokes only fixed ChainlessChain commands. SSH
requires a digest-pinned `known_hosts` file, uses strict host-key checking, and
materializes the verified bytes into a private temporary authority file for the
actual invocation. Resume re-runs the ambient host probe, verifies the accepted
stable facts digest, then handles the declared session-store mode. A
`replicated` profile streams the source's locked, verified transcript bytes to
the fixed target-side `session location receive` command; the target validates
strict UTF-8, a 64 MiB boundary, transcript structure/hash chain, exact byte
digest, head hash, and event count before atomic publication and creation of
its own sidecar and machine-local anti-rollback witness. It never replaces a
divergent or tombstoned target session, while an exact retry is idempotent. A
`shared` profile performs no copy. Both modes re-read the target's canonical
authority and revalidate that the source session head has not advanced before
the fixed `session resume` invocation. This is whole-revision transfer, not
incremental/bidirectional synchronization or a cross-host writer fence;
remote network/sandbox policy and disconnect/reconnect durability remain
unattested.

After a replicated target session has produced work, `result-pack` can bind
the actual bounded summary, diff, artifact, and evidence bytes to that
session's verified location-handoff authority. Every payload is included as
canonical base64 with its byte count and SHA-256; all input files must be
regular single-link files inside the session's declared data boundary. Copy
the JSON bundle back through an approved transport, then run `result-verify`
on the source. Verification rehashes every returned byte and succeeds only
while the source session still has the predecessor head/count accepted by the
handoff. Its receipt is content-free and explicitly reports `applied=false`:
this command does not patch the source worktree, import artifacts, fence two
hosts, or make transport/disconnect claims.

`result-collect` removes the manual-copy step for configured WSL, SSH, and
Container profiles. It re-attests stable target facts, invokes only the fixed
target-side `result-pack` argv through the existing strict launcher, accepts a
bounded JSON response, then revalidates the source predecessor a second time
before appending one CAS-bound, content-free settlement event and returning the
bundle. The stable request id is bound to the exact profile, handoff, result,
paths, and item list. If the caller loses the first response, an exact retry
reads the canonical settlement before loading handoff facts or running another
target command. That recovery proves which bundle was accepted but cannot
recreate bytes from a legacy v1 settlement. New collections first publish the
canonical bundle into the owner-only, content-addressed
`execution-location-results` store, re-read and rehash the stored bytes, then
bind that deterministic storage receipt into settlement v2. An exact retry can
therefore return the verified bundle without another target command. The store
uses no-replace publication, file fsync, and directory fsync where supported;
it is local explicit-delete storage, not WORM retention. Result collection
still does not provide a distributed writer fence, Cloud transport, or
automatic source application.

### Artifact access, deletion, and TTL cleanup settlement

The repository candidate adds explicit, content-free audit and recovery for
managed ArtifactStore bytes:

```bash
chainlesschain artifacts access <id> --client cli --action open \
  --access-id <stable-id> --json
chainlesschain artifacts remove <id> --client cli \
  --deletion-id <stable-id> --json
chainlesschain artifacts clean --client cli \
  --cleanup-id <stable-batch-id> --json
chainlesschain artifacts access-log --json
chainlesschain artifacts deletion-log --json
chainlesschain artifacts cleanup-log --cleanup <stable-batch-id> --json
```

`artifacts clean` freezes the expired rows once under the ArtifactStore index
lock. Its prepared event binds the cleanup id, cutoff, exact item list, scope
digest, deterministic per-item deletion ids, and pre-cleanup index generation.
Each item then uses the same prepared/terminal managed-copy deletion protocol as
an explicit remove. The batch terminal is written only after every selected
managed path is absent. An exact cleanup-id retry replays the frozen scope,
recovers already-settled items without selecting newly expired rows, and returns
the same terminal summary after response loss. A partial failure remains a
prepared batch whose item deletion events identify settled and pending work.

These receipts prove removal of the managed directory entries only. They do not
claim secure erasure of external hardlinks, downloads, backups, snapshots, or
viewer caches; the local JSONL ledgers are not WORM or an off-box transparency
log. These commands are included in the current exact-gated
`chainlesschain@0.166.71` release, but a local receipt still does not prove
off-box retention or secure erasure outside the managed store.

Durable budget recovery stores a canonical local receipt for each operator
adjudication. Ordinary budget status shows only chain and coverage metadata;
`budget receipts` is the explicit detailed reader for provider/model/token
records. These receipts are local evidence, not provider billing readback or
WORM retention.

---

## Phase 2: Knowledge & Content Management

### `chainlesschain import <format>`

Import knowledge from external sources.

```bash
chainlesschain import markdown ./docs   # Import markdown directory
chainlesschain import evernote backup.enex  # Import Evernote ENEX
chainlesschain import notion ./export   # Import Notion export
chainlesschain import pdf document.pdf  # Import PDF text
```

### `chainlesschain export <format>`

Export knowledge base.

```bash
chainlesschain export markdown -o ./output  # Export as Markdown files
chainlesschain export site -o ./site        # Export as static HTML site
```

### `chainlesschain git <action>`

Git integration for knowledge versioning.

```bash
chainlesschain git status               # Show git status
chainlesschain git init                 # Initialize git repo
chainlesschain git auto-commit          # Auto-commit all changes
chainlesschain git hooks                # Install pre-commit hooks
chainlesschain git history-analyze      # Analyze repo history
```

### Note Versioning

```bash
chainlesschain note history <id>        # Show version history
chainlesschain note diff <id> <v1> <v2> # Diff between versions
chainlesschain note revert <id> <ver>   # Revert to version
```

---

## Phase 3: MCP & External Integration

### `chainlesschain mcp <action>`

MCP (Model Context Protocol) server management.

```bash
chainlesschain mcp servers              # List configured servers
chainlesschain mcp add <name> -c <cmd>  # Add a server
chainlesschain mcp remove <name>        # Remove a server
chainlesschain mcp connect <name>       # Connect to server
chainlesschain mcp disconnect <name>    # Disconnect
chainlesschain mcp tools                # List available tools
chainlesschain mcp call <server> <tool> # Call a tool
```

### `chainlesschain browse <action>`

Browser automation (headless fetch-based).

```bash
chainlesschain browse fetch <url>       # Fetch page content
chainlesschain browse scrape <url> -s "h2"  # Scrape CSS selector
chainlesschain browse screenshot <url>  # Take screenshot (requires playwright)
```

### `chainlesschain instinct <action>`

Instinct learning — tracks user preferences over time.

```bash
chainlesschain instinct show            # Show learned instincts
chainlesschain instinct categories      # List 6 instinct categories
chainlesschain instinct prompt          # Generate system prompt from instincts
chainlesschain instinct delete <id>     # Delete an instinct
chainlesschain instinct reset           # Clear all instincts
chainlesschain instinct decay           # Decay old instincts
```

---

## Phase 4: Security & Identity

### `chainlesschain did <action>`

DID identity management (Ed25519).

```bash
chainlesschain did create --label "My Identity"
chainlesschain did list
chainlesschain did show <did>
chainlesschain did sign <did> "message"
chainlesschain did verify <did> "message" <signature>
chainlesschain did export <did>
chainlesschain did set-default <did>
chainlesschain did delete <did>
```

### `chainlesschain encrypt / decrypt`

AES-256-GCM file encryption.

```bash
chainlesschain encrypt file <input> -o <output>
chainlesschain encrypt db
chainlesschain encrypt info <file>
chainlesschain encrypt status
chainlesschain decrypt file <input> -o <output>
chainlesschain decrypt db
```

### `chainlesschain auth <action>`

RBAC permission engine.

```bash
chainlesschain auth roles                          # List roles
chainlesschain auth create-role <name>             # Create custom role
chainlesschain auth grant <user> <role>            # Assign role
chainlesschain auth check <user> <scope>           # Check permission
chainlesschain auth permissions <user>             # List user permissions
chainlesschain auth scopes                         # List all 26 scopes
```

### `chainlesschain audit <action>`

Audit logging and compliance.

```bash
chainlesschain audit log                           # Recent events
chainlesschain audit search --type security        # Search by type
chainlesschain audit stats                         # Statistics
chainlesschain audit export --format json          # Export logs
chainlesschain audit purge --before 90             # Purge old logs
chainlesschain audit types                         # List event types
```

---

## Phase 5: P2P, Blockchain & Enterprise

### `chainlesschain p2p <action>`

Peer-to-peer messaging and device pairing.

```bash
chainlesschain p2p status                          # P2P network status
chainlesschain p2p peers                           # List known peers
chainlesschain p2p send <peer-id> "message"        # Send message
chainlesschain p2p inbox                           # View inbox
chainlesschain p2p pair <device-name>              # Pair a device
chainlesschain p2p devices                         # List paired devices
chainlesschain p2p unpair <device-id>              # Unpair a device
```

### `chainlesschain sync <action>`

File and knowledge synchronization.

```bash
chainlesschain sync status                         # Sync status
chainlesschain sync push                           # Push local changes
chainlesschain sync pull                           # Pull remote changes
chainlesschain sync conflicts                      # List conflicts
chainlesschain sync resolve <id> --strategy local  # Resolve conflict
chainlesschain sync log                            # Sync history
chainlesschain sync clear                          # Clear sync state
```

### `chainlesschain wallet <action>`

Digital wallet and asset management.

```bash
chainlesschain wallet create --name "My Wallet"    # Create wallet
chainlesschain wallet list                         # List wallets
chainlesschain wallet balance <address>            # Check balance
chainlesschain wallet set-default <address>        # Set default wallet
chainlesschain wallet delete <address>             # Delete wallet
chainlesschain wallet asset <address> <type> <name> # Create asset
chainlesschain wallet assets [address]             # List assets
chainlesschain wallet transfer <asset-id> <to>     # Transfer asset
chainlesschain wallet history [address]            # Transaction history
chainlesschain wallet summary                      # Overall summary
```

### `chainlesschain org <action>`

Organization management and workflows.

```bash
chainlesschain org create <name>                   # Create organization
chainlesschain org list                            # List organizations
chainlesschain org show <id>                       # Organization details
chainlesschain org delete <id>                     # Delete organization
chainlesschain org invite <org-id> <user-id>       # Invite member
chainlesschain org members <org-id>                # List members
chainlesschain org team-create <org-id> <name>     # Create team
chainlesschain org teams <org-id>                  # List teams
chainlesschain org approval-submit <org-id> <title> # Submit approval
chainlesschain org approvals <org-id>              # List approvals
chainlesschain org approve <request-id>            # Approve request
chainlesschain org reject <request-id>             # Reject request
```

### `chainlesschain plugin <action>`

Plugin marketplace management.

```bash
chainlesschain plugin list                         # List installed plugins
chainlesschain plugin install <name> --version <v> # Install plugin
chainlesschain plugin remove <name>                # Remove plugin
chainlesschain plugin enable <name>                # Enable plugin
chainlesschain plugin disable <name>               # Disable plugin
chainlesschain plugin update <name> --version <v>  # Update plugin
chainlesschain plugin info <name>                  # Plugin details
chainlesschain plugin search <query>               # Search registry
chainlesschain plugin registry                     # List all registry plugins
chainlesschain plugin summary                      # Installation summary
chainlesschain plugin installed --all-scopes       # Physical inventory + effective authority
chainlesschain plugin transaction <name> --scope project --json
                                                    # Inspect redacted durable transaction authority
chainlesschain plugin recover <name> --scope project --action rollback
                                                    # Recover a transaction after its owner dies
chainlesschain plugin provenance-plan <name> --scope project --version 1.0.0 --metadata source.json
                                                    # Emit exact bytes for an external Ed25519 signature
chainlesschain plugin provenance-migrate <name> --scope project --version 1.0.0 --attestation signed.json --expected-signer-sha256 <hex> --yes
                                                    # Backfill one legacy install without replacing payload bytes
chainlesschain plugin catalog --registry https://plugins.example/index.json --offline --registry-digest https://plugins.example/index.json=<sha256>
                                                    # Review one exact immutable cached registry document without network
chainlesschain plugin add <name> --registry https://plugins.example/index.json --proxy http://proxy.example:8080 --ca-file enterprise-ca.pem
                                                    # Private registry through an explicit proxy and appended custom CA
chainlesschain plugin browse --registry https://plugins.example/index.json --pac-file enterprise.pac
                                                    # Resolve PROXY/HTTPS/DIRECT in a bounded, terminable PAC worker
```

When enabling, disabling, uninstalling, or replacing a scoped plugin would
switch the effective `local > project > user` source, review `plugin impact`
and pass `--allow-source-switch` explicitly. Semantic SBOM downgrades remain
blocked even with that approval.

Plugin lifecycle mutation holds one same-user, same-name OS coordinator across
`user`, `project`, and `local` scopes. Add/upgrade keeps that owner through
validation, consent, finalize, or rollback, while the journal binds the exact
target scope and workspace context. Enable/disable records the exact prior and
intended marker bytes before publication. Version uninstall quarantines the
immutable version before publishing its pointer/marker fallback, while
whole-name uninstall quarantines the complete name directory before physical
collection. Each can therefore be explicitly finalized or rolled back after a
process crash. Ordinary commands never steal an abandoned owner. Inspect it
with `plugin transaction`, then use `plugin recover` only after the recorded
process has died. `--force-owner` overrides a live or cross-host owner and
therefore requires external operator adjudication; it is not automatic
stale-lock cleanup.

Legacy provenance migration is explicit and non-overwriting. The plan binds the
installed name, version, scope, canonical path, complete payload digest, source
metadata, and issuance time. Sign the decoded `signingPayloadBase64` bytes with
an Ed25519 key, then supply an attestation containing `authority`,
`publicKeyPem`, and `signatureBase64`. Apply requires the exact SPKI fingerprint
and `--yes`; managed trusted-key policy is also enforced when configured. The
signed record is checked on every strict provenance read and participates in
the same crash-recoverable lifecycle journal. It proves the reviewed migration
authority only—it does not invent Marketplace publisher identity. Existing
provenance and installs with a component-SBOM signature lock must be reinstalled
instead of rewritten.

An organization can require registry publisher identity with managed settings:

```json
{
  "requireTrustedPluginPublishers": true,
  "trustedPluginPublishers": [
    {
      "trustRootId": "acme-marketplace-2026",
      "publisherId": "tools-team",
      "organizationId": "acme",
      "pluginNames": ["@acme/reviewer"],
      "registryOrigins": ["https://plugins.acme.example"],
      "signingKeySha256": ["<ed25519-spki-sha256>"],
      "notBefore": "2026-01-01T00:00:00.000Z",
      "notAfter": "2027-01-01T00:00:00.000Z"
    }
  ],
  "revokedPluginPublisherKeys": []
}
```

The registry entry must declare matching `publisher.id` and
`publisher.organizationId`, and the mapped key must cryptographically verify
the installed manifest. The persisted authority is re-evaluated against the
current managed policy on strict read and runtime admission; adding the key to
`revokedPluginPublisherKeys` fails closed immediately. This direct managed
binding does not by itself provide an external transparency service.

Remote registry documents are capped at 4 MiB and cached immutably by complete
URL plus document SHA-256. `--offline` never opens a network transport; an
unpinned URL with multiple valid cached revisions is rejected as ambiguous, so
use repeatable `--registry-digest <url=sha256>` pins. Remote signature, public
key, and SBOM documents use their existing bounded digest-addressed cache. For
`plugin add` and `plugin upgrade`, a successful online Git materialization is
also copied into an immutable source-package cache only when the registry binds
both the manifest digest and a repository-defined semantic payload SBOM. An
offline replay recomputes both anchors before installation; payload or cache
authority tampering, symlinks, hard-linked payload files, and exact cache misses
fail closed. Registries without that full payload anchor
must reference an existing local plugin directory for offline use and are not
silently treated as cacheable.

Private registries support `--proxy`, a bounded local `--pac-file`, and an
appended `--ca-file`; the dedicated environment equivalents are
`CC_PLUGIN_REGISTRY_PROXY`, `CC_PLUGIN_REGISTRY_PAC_FILE`, and
`CC_PLUGIN_REGISTRY_CA_FILE`. Proxy credentials are removed from persisted
authority, while the sanitized proxy origin, PAC SHA-256, and CA SHA-256 are
bound into the catalog/provenance record. PAC execution uses QuickJS in a
resource-limited worker with a hard timeout. Proxy URL and PAC are mutually
exclusive, PAC supports `PROXY`, `HTTP`, `HTTPS`, and `DIRECT`, and ambient
`HTTP_PROXY`/`HTTPS_PROXY` values are not silently adopted.

---

## Project Initialization & Collaboration

### `chainlesschain init`

Initialize a new ChainlessChain project with a `.chainlesschain/` directory, workspace skills, and an optional AI persona.

```bash
chainlesschain init                                         # Interactive template selection
chainlesschain init --bare                                  # Minimal project structure
chainlesschain init --template code-project --yes           # Software project (code-review, refactor, unit-test)
chainlesschain init --template data-science --yes           # Data science / ML project
chainlesschain init --template devops --yes                 # DevOps / infrastructure project
chainlesschain init --template medical-triage --yes         # Medical triage assistant (with Persona)
chainlesschain init --template agriculture-expert --yes     # Agriculture expert (with Persona)
chainlesschain init --template general-assistant --yes      # General-purpose assistant (with Persona)
chainlesschain init --template ai-media-creator --yes       # AI media creator (ComfyUI/AnimateDiff/TTS)
chainlesschain init --template ai-doc-creator --yes         # AI doc creator (LibreOffice/pandoc/doc-edit)
chainlesschain init --template empty --yes                  # Bare project
```

#### AI Media Creator Template (`ai-media-creator`)

Generates 3 workspace skills for AI image/video/audio creation:

```bash
chainlesschain skill run comfyui-image "a sunset over mountains, oil painting style"
chainlesschain skill run comfyui-video '{"prompt":"a cat walking","workflow":"workflows/animatediff.json"}'
chainlesschain skill run audio-gen "你好，欢迎使用 ChainlessChain"
```

| Skill           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `comfyui-image` | ComfyUI REST API image generation (txt2img/img2img, custom workflows) |
| `comfyui-video` | ComfyUI + AnimateDiff video generation (requires workflow JSON)       |
| `audio-gen`     | AI TTS: auto-selects edge-tts → piper-tts → ElevenLabs → OpenAI       |

Also creates a `workflows/` directory with README for saving ComfyUI workflow JSON files.

#### AI Doc Creator Template (`ai-doc-creator`)

Generates 3 workspace skills for AI document creation and editing:

```bash
chainlesschain skill run doc-generate "2026年技术趋势分析报告"
chainlesschain skill run doc-generate '{"topic":"项目方案","format":"docx","style":"proposal"}'
chainlesschain skill run libre-convert "report.docx"
chainlesschain skill run libre-convert '{"input_file":"slides.pptx","format":"pdf"}'
chainlesschain skill run doc-edit '{"input_file":"report.md","instruction":"优化摘要部分"}'
chainlesschain skill run doc-edit '{"input_file":"data.xlsx","instruction":"首字母大写"}'
```

| Skill           | Description                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc-generate`  | AI-generated structured documents: md/html/docx/pdf, 4 styles (report/proposal/manual/readme)                                                     |
| `libre-convert` | LibreOffice headless conversion: docx/pdf/html/odt/pptx/xlsx/png                                                                                  |
| `doc-edit`      | AI edit existing docs: md/txt/html (direct LLM), docx (pandoc/soffice), xlsx (openpyxl, formulas preserved), pptx (python-pptx, charts preserved) |

Requirements: `winget install pandoc` (for docx), `winget install LibreOffice.LibreOffice` (for PDF/format conversion).

Also creates a `templates/` directory with README for document templates.

### `chainlesschain pack`

Package a ChainlessChain project into a standalone executable (single-file, no Node.js required) for macOS / Windows / Linux. Includes `--project` mode for embedding a specific project's skills, persona, and allowed-command whitelist directly into the binary.

```bash
chainlesschain pack                                    # Pack current dir as a generic CLI binary
chainlesschain pack --project                          # Project mode: bake current project's skills/persona into the binary
chainlesschain pack --project --name myproject         # Override output binary name
chainlesschain pack --platform win-x64                 # Target Windows x64 (default: host platform)
chainlesschain pack --platform darwin-arm64            # Target macOS Apple Silicon
chainlesschain pack --platform linux-x64               # Target Linux x64
chainlesschain pack --dry-run                          # Print effective config without building
chainlesschain pack check-update                       # Probe OTA manifest for a newer pack on this channel
```

**Project mode** (`--project`) bakes the following into the executable at build time:

- `.chainlesschain/skills/**` — project-local skills, loaded via `CC_PROJECT_ROOT` at runtime
- `.chainlesschain/persona.json` — auto-applied project persona (name / role / behavior)
- `commander.allowedCommands` whitelist — only the subcommands the project actually uses
- Sanitized project name (kebab-case) as the default binary name + manifest sidecar (`<binary>.manifest.json`) with a signed descriptor

**OTA check-update** reads the pack's baked channel + version, fetches the configured manifest URL, and reports whether a newer build is available (no auto-download — download/install is a separate workflow).

### `chainlesschain persona <action>`

Manage the AI persona for the current project (set by `init` templates or manually).

```bash
chainlesschain persona show                              # Show current project persona
chainlesschain persona set --name "Bot" --role "Helper" # Set persona name and role
chainlesschain persona set -b "Always respond in English" # Add behavior constraint
chainlesschain persona set --tools-disabled run_shell   # Disable specific tools
chainlesschain persona reset                             # Remove persona, restore default
```

### `chainlesschain cowork <action>`

Multi-agent collaboration for code review and analysis.

```bash
chainlesschain cowork debate <file>                    # Multi-perspective code review
chainlesschain cowork compare <prompt>                 # A/B solution comparison
chainlesschain cowork analyze <path>                   # Code analysis (style/knowledge-graph/decisions)
chainlesschain cowork status                           # Show cowork status
```

### Web Cowork: Daily Task Collaboration (v0.46.0)

Web-based daily task collaboration via the `/#/cowork` page. Powered by SubAgentContext + agentLoop, with 11 task templates covering common daily tasks. Prioritizes open-source CLI tools (ffmpeg, pandoc, ImageMagick, Tesseract, etc.) via cli-anything bridge, with automatic tool installation (winget > choco > pip > npm).

**11 Task Templates**:

| Template ID       | Name         | Category  | Accepts Files |
| ----------------- | ------------ | --------- | ------------- |
| `doc-convert`     | 文档格式转换 | document  | ✅            |
| `media-process`   | 音视频处理   | media     | ✅            |
| `data-analysis`   | 数据分析     | data      | ✅            |
| `web-research`    | 网络调研     | research  | ❌            |
| `image-process`   | 图片处理     | image     | ✅            |
| `code-helper`     | 代码辅助     | code      | ✅            |
| `code_review`     | 代码评审     | code      | ✅            |
| `system-admin`    | 系统管理     | system    | ❌            |
| `file-organize`   | 文件整理     | file      | ✅            |
| `network-tools`   | 网络工具     | network   | ❌            |
| `learning-assist` | 学习辅助     | education | ✅            |

**Usage**: Navigate to `http://127.0.0.1:18810/#/cowork` after starting `chainlesschain ui`. Select a template or use free mode, describe your task, and optionally attach files.

**WebSocket Protocol**:

```
→ { type: "cowork-task", templateId: "doc-convert", userMessage: "转换PDF", files: [] }
← { type: "cowork:started", templateId: "doc-convert" }
← { type: "cowork:done", taskId, status, templateName, summary, artifacts, toolsUsed, iterationCount }
```

**Key files**: `src/lib/cowork-task-templates.js` (11 templates), `src/lib/cowork-task-runner.js` (pipeline), `src/gateways/ws/action-protocol.js` (WS handler). **Tests**: 79+ (57 unit + 11 integration + 11 E2E).

### Cowork Workflow Editor (v0.47.0, N1)

Form-based Cowork Workflow editor at `/#/workflow` in the Web Panel. Create, edit, run, and export multi-step Cowork DAG workflows — each step invokes a Cowork task with placeholder substitution (`${step.<id>.summary}`) from upstream step outputs. Client-side DFS cycle detection mirrors the backend `validateWorkflow` guard.

The CLI can also generate a model-proposed definition without granting it
write authority. `draft` emits a secret-scanned, digest-bound
`pending-review` JSON artifact; `review` requires a human to repeat that exact
digest before an accepted definition enters the immutable version store.
Generation and review provenance remain inside the saved definition, while the
runtime continues to declare durable pause/resume and post-resume exactly-once
as unsupported.

```bash
chainlesschain cowork workflow draft "Review a release" --provider ollama > workflow-draft.json
chainlesschain cowork workflow review workflow-draft.json \
  --expected-draft-digest sha256:<digest> --reviewer <identity> --accept
```

Accepted or hand-authored versioned definitions can opt into the bounded-parallel
durable runtime. Every concurrently scheduled dispatch group is persisted as one
atomic effect batch before any provider call. Each step/iteration/attempt keeps
its own stable effect identity plus batch identity, index, and size. A second
persisted marker distinguishes a requested-but-not-dispatched effect from one
whose provider call may have started. If a provider throws or its settlement
response is lost, the run becomes `blocked` and will not replay an outcome-
unknown effect until an operator supplies a bounded result file at the exact
runtime revision and in the recorded recovery order.

```bash
chainlesschain cowork workflow run <workflow-id> \
  --execution-authority-session <session-id> --durable-run-id <run-id>
chainlesschain cowork workflow runtime-status <run-id> --json
chainlesschain cowork workflow runtime-pause <run-id> --expected-revision <n>
chainlesschain cowork workflow runtime-resume <run-id> --expected-revision <n>
chainlesschain cowork workflow runtime-stop <run-id> --expected-revision <n>
chainlesschain cowork workflow runtime-reconcile <run-id> <effect-id> <result.json> \
  --expected-revision <n>
```

The durable runtime accepts `maxParallel` only within the digest-bound admission,
the workflow budget, and the hard 64-effect batch limit. A pause remains
`pause_requested` until every already-requested parallel provider has physically
settled; an unknown outcome keeps the run blocked. Multi-effect reconciliation
is ordered by the persisted batch sequence, and the run becomes `ready` only
after every outcome-unknown pending effect is settled. Retry and timeout steps
use attempt-scoped effect identities: an explicit failed result may advance to
the next attempt, a timeout before dispatch is recorded as
`runtime-not-dispatched`, a late completed result is accepted without retry,
and a late unknown outcome blocks. A crash with no dispatch marker may safely
resume that same effect; a persisted dispatch marker requires provider return
or reconciliation. Reconciliation is an explicit operator assertion about an
outcome-unknown provider call, not an automatic retry or a third-party receipt.

For a durable workflow effect, the production Cowork runner now validates the
canonical `sha256:` effect identity before constructing a child agent and locks
that identity into the child loop. Each ordinary model turn and each automatic
semantic-compaction provider query derives a source-separated, stable
`ccwf_...` request identity. Injected compaction adapters receive the same
frozen binding context. The OpenAI transport sends that value as
`X-Client-Request-Id` only for the official `https://api.openai.com` origin and
retains a bounded receipt only when OpenAI returns an `x-request-id` header or
response object ID; a custom OpenAI-compatible gateway receives no official
contract claim. Workflow-bound turns disable
transparent streaming retries and cross-provider fallback so one durable model
boundary cannot hide another physical provider attempt. The child records a
`cc-provider-request-attempt/v1` boundary before every bound transport; a
completed Cowork result matches each returned receipt to the exact provider,
call, source, sequence and client request ID. A normal-model or
semantic-compaction provider exception,
invalid receipt, unknown compaction usage, or post-provider compaction
settlement failure is propagated to the outer durable runtime as an unknown
outcome; it is never downgraded to an ordinary failed task that step retry could
replay. These identifiers are
explicitly `trace-only`: they do not provide native provider idempotency or an
independently readable receipt, and unsupported providers return no receipt.
Nested tool/MCP/external-system effects remain outside this provider-call
receipt slice.

The dynamic runtime also installs synchronous durable-call observers around the
Cowork child. Before each bound provider or directly dispatched tool call can
continue to transport, the runtime appends a bounded `started` row under the
pending outer effect with the exact provider request or child-effect identity.
When a provider returns a trace receipt, a second synchronous observer validates
its effect owner, provider, call, request source, sequence, client request ID,
and trace-only semantics, then stores only the bounded provider request/response
IDs and receipt timestamp while the call is still `started`. The terminal
callback later persists `completed`, `failed`, or `outcome_unknown`
independently of the eventual Cowork result and refuses a settlement-carried
receipt that was not identically prewritten. A successful provider settlement
also normalizes the provider-reported input, output, cache-read, and cache-creation
token counts into the same durable row and binds their digest into the settlement
lineage. Counts are bounded non-negative integers; proxies, accessors, conflicting
aliases, and later usage-row tamper fail closed. The start row also captures the
validated provider/model and, when the built-in public-list table has a match, a
version-digested USD pricing snapshot. Successful usage settlement derives a
componentized `estimatedUsd` from that durable snapshot and binds its digest into
the settlement lineage. A mismatched settlement model or later pricing/cost
rewrite fails closed; unmatched models remain unpriced, while a priced local
provider keeps a real zero estimate. These are estimates, not provider-reported
charges: `reportedUsd` remains `null`. A crash after provider response
but before usage settlement therefore leaves an independently readable started
row with the receipt and an explicitly missing usage settlement, instead of
relying on a completed-result projection. This also holds for descendant provider
calls; neither the receipt nor the token counts are independently readable from
the provider. Explicit outer effect reconciliation preserves any prewritten
receipt while marking still-started rows as operator reconciled, but does not
invent provider usage or turn trace-only request identities into third-party
idempotency.
Spawned sub-agents and isolated skills inherit the already-persisted parent
tool child-effect as their workflow owner. Their internal provider/tool calls
therefore enter the same store with a verified owner chain; an orphan or
rewritten owner fails closed, and descendant unknown outcomes prevent normal
outer provider-return settlement.
For the managed `publish_artifact` tool, terminal settlement additionally reads
the canonical ArtifactStore index row, requires an exact match with the returned
public metadata, and rehashes the copied bytes before persisting a readback digest
on the call. Forged metadata, missing/changed stored bytes, or partial removal of
the readback schema fail closed. The readback is visible before the outer Cowork task
returns, but it proves only the store copy at settlement time: the current store
is mutable and TTL-cleanable, so immutable retention and later byte availability
remain unproven. Arbitrary `result.artifacts` arrays stay digest-only observations.

`runtime-status --json` also returns a digest-bound `observability` projection.
It exposes effect/result lineage, provider-return/operator-reconciled/runtime-
not-dispatched settlement counts, provider dispatch and timeout timestamps,
request-to-settlement wall time, durable-call-derived trace-only provider
request attempts and receipts (including pending/crashed calls), durable-call-
derived nested-tool attempt/settlement lineage, the independently persisted
durable-call status/digest projection plus its provider-receipt count and bounded
receipt IDs, durable-call-derived provider token totals and per-call lineage,
durable-pricing-snapshot USD estimates and their per-call lineage, the separately
labeled Cowork-result heuristic estimate, ArtifactStore index/byte readbacks for
managed `publish_artifact` calls, and digest-only task-result artifact/checkpoint
references. Token, cost, and artifact-readback projections keep reported, priced,
and verified records separate from pending, outcome-unknown, operator-reconciled,
and legacy calls; they never substitute the
heuristic token estimate or a guessed price for missing provider data. Receipt
projection rejects an effect/provider/call/source/request mismatch or any claim of
idempotency/independent readback, ignores conflicting outer-result receipt
arrays when durable call rows exist while exposing a disagreement gap, and
reports a gap for every valid attempt with no matching provider receipt.
Pre-durable-call states remain readable
through an explicitly counted legacy task-result fallback that adds its own gap.
The projection is intentionally
`complete: false` and lists every missing authority: provider-reported USD billing,
native provider idempotency, independent provider usage/receipt readback, and
checkpoint readback plus immutable/current ArtifactStore retention remain
unavailable. Pre-usage/pricing/artifact-readback-schema calls stay readable with
explicit unavailable/incomplete/legacy gaps. Managed
nested tool attempts and
terminal settlements no
longer depend on those payload projections: started calls are crash-visible,
conflicting outer-result arrays produce a disagreement gap, and pre-durable-call
states use an explicit legacy fallback. MCP calls bind the
same outer/child effect tuple into the canonical session ledger before
transport and report persisted start/settlement facts. Any workflow-bound
nested outcome-unknown result or post-boundary tool exception blocks the outer
effect for reconciliation instead of becoming an ordinary failed task. The
runtime-owned provider/tool call rows are independently readable from a
pending or crashed run, including calls directly owned by spawned sub-agents
and isolated skills. Hook/checkpoint and unmanaged artifact side effects, native
third-party idempotency, and provider-side receipt lookup remain open.

**WS protocol**: `workflow-list` / `workflow-get` / `workflow-save` / `workflow-remove` / `workflow-run` (streams `workflow:started` / `step-start` / `step-complete` / `workflow:done`).

**Key files**: `src/gateways/ws/action-protocol.js` (5 handlers), `src/lib/cowork-workflow.js` (CRUD + `executeWorkflow`), `src/lib/dynamic-workflow-draft.js` (model proposal + human review authority), `src/lib/dynamic-workflow-runtime.js` (atomic parallel durable effect protocol), `packages/web-panel/src/stores/workflow.js` (Pinia store + `validateLocal`), `packages/web-panel/src/views/WorkflowEditor.vue`. **Governed CLI regression**: 593 tests across draft/review, durable runtime, façade, DAG, WebSocket, admission, provider/tool/descendant call binding, durable provider receipt/token settlement, durable pricing-snapshot cost estimates, ArtifactStore settlement readback, and MCP ledger coverage; the original editor slice retains its 39 backend/frontend/integration/E2E tests.

> Vue Flow visual canvas (drag-to-connect, branch rendering) is planned as M2.

---

## Phase 6: AI Core (Hooks, Workflow, Memory, A2A)

### `chainlesschain hook <action>`

Event hook management for extensibility.

```bash
chainlesschain hook list                               # List registered hooks
chainlesschain hook add --event PreToolUse --type sync --command "echo check"
chainlesschain hook remove <id>                        # Remove a hook
chainlesschain hook run PreToolUse                     # Execute hooks for event
chainlesschain hook stats                              # Hook execution statistics
```

### `chainlesschain workflow <action>`

DAG-based workflow orchestration engine.

```bash
chainlesschain workflow create --name "pipeline" --stages '[...]'
chainlesschain workflow list                           # List workflows
chainlesschain workflow run <id>                       # Execute workflow
chainlesschain workflow status <id>                    # Check workflow status
chainlesschain workflow templates                      # List 5 built-in templates
```

### `chainlesschain hmemory <action>`

Hierarchical memory system (working → short-term → long-term).

```bash
chainlesschain hmemory store "fact" --importance 0.8   # Store memory
chainlesschain hmemory recall --layer long-term        # Recall memories
chainlesschain hmemory consolidate                     # Promote memories across layers
chainlesschain hmemory stats                           # Memory statistics
```

### `chainlesschain a2a <action>`

Agent-to-Agent protocol for multi-agent collaboration.

```bash
chainlesschain a2a register --name "agent1" --capabilities '["code"]'
chainlesschain a2a list                                # List registered agents
chainlesschain a2a discover --capability code          # Find agents by capability
chainlesschain a2a submit <agent> "task"               # Submit task to agent
chainlesschain a2a status <task-id>                    # Check task status
```

---

## Phase 7: Security & Evolution

### `chainlesschain sandbox <action>`

Secure sandbox execution environment.

```bash
chainlesschain sandbox create --name "test"            # Create sandbox
chainlesschain sandbox list                            # List sandboxes
chainlesschain sandbox exec <id> "command"             # Execute in sandbox
chainlesschain sandbox audit <id>                      # View audit log
chainlesschain sandbox destroy <id>                    # Destroy sandbox
```

### `chainlesschain evolution <action>` (metrics plus trusted-host governance; not model training)

The legacy subcommands provide capability assessment, formula-metric records,
and diagnostics; they do not train model weights or mutate active Skills.
Since `0.166.21`, the `workbench` and `knowledge` namespaces can submit exact human
review, rollback, and knowledge-merge decisions only through an injected,
branded deployment host. They never fall back to client-owned authority.

```bash
chainlesschain evolution assess code-generation 0.85             # Assess capability
chainlesschain evolution record-model-metrics model-1 --data '[]' # Formula estimate only
chainlesschain evolution record-training-metrics-v2 \
  --strategy replay --data-size 10 --loss-before .5 --loss-after .4
chainlesschain evolution stats                                    # Recorded metrics
chainlesschain evolution deployment status                        # Effective profile and signature status
chainlesschain evolution deployment init-test --module /absolute/evolution-host.mjs
chainlesschain evolution deployment replace-test \
  --descriptor /absolute/managed-deployment.json --trust-root /absolute/managed-public.pem
chainlesschain evolution deployment configure \
  --descriptor /absolute/deployment.json --trust-root /absolute/public.pem
chainlesschain evolution workbench list --status pending          # Trusted host required
chainlesschain evolution knowledge conflicts --limit 20           # Redacted summaries
```

### `chainlesschain learning <action>`

Learning-record loop — tracks execution trajectories, records reflection, and can attempt governed Skill candidates from successful patterns. Candidate synthesis fails unavailable unless the required LLM, candidate registry, and evaluator are configured; it never writes an active Skill directly.

```bash
chainlesschain learning stats                          # Learning loop statistics overview
chainlesschain learning stats --json                   # JSON output
chainlesschain learning trajectories                   # Recent 20 execution trajectories
chainlesschain learning trajectories -n 50             # Specify count
chainlesschain learning trajectories --session <id>    # Filter by session
chainlesschain learning trajectories --json            # JSON output
chainlesschain learning reflect                        # Manual self-reflection trigger
chainlesschain learning reflect --json                 # JSON reflection report
chainlesschain learning synthesize                     # Attempt a governed Skill candidate (unavailable without required dependencies)
chainlesschain learning synthesize --json              # JSON output
chainlesschain learning cleanup                        # Clean up trajectories older than 90 days
chainlesschain learning cleanup --days 30              # Custom retention period
chainlesschain learning cleanup --json                 # JSON output
```

**Core modules** (6 active files in `src/lib/learning/`):

| Module               | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| **TrajectoryStore**  | Records complete execution trajectories (intent → tool chain → result → response)    |
| **OutcomeFeedback**  | Auto-scoring + user feedback + correction detection (Chinese & English)              |
| **SkillSynthesizer** | Extracts reusable patterns from complex successful trajectories into SKILL.md        |
| **SkillImprover**    | Three improvement triggers: error repair, user correction, better trajectory compare |
| **ReflectionEngine** | Periodic self-review with tool stats, score trends, error-prone tool identification  |
| **LearningTables**   | SQLite schema creation for trajectories, tags, and improvement logs                  |

The former `LearningHooks` shim was never wired into the REPL or headless
runtimes and bypassed the authenticated evidence path, so it has been retired.
Automatic Agent evidence is accepted only through a host-owned evolution
ingress; the learning tables remain an explicit query, maintenance, and
candidate-input surface.

---

## Phase 8: Blockchain & Enterprise Analytics

### `chainlesschain economy <action>`

Agent economy and micropayment system.

```bash
chainlesschain economy pay <from> <to> 100             # Agent micropayment
chainlesschain economy balance <agent>                  # Check balance
chainlesschain economy market list                      # Browse resource market
chainlesschain economy nft mint <agent>                 # Mint contribution NFT
```

### `chainlesschain zkp <action>`

Zero-Knowledge Proof engine.

```bash
chainlesschain zkp compile --name "age-proof"          # Compile ZKP circuit
chainlesschain zkp prove <circuit> --witness '{}'      # Generate proof
chainlesschain zkp verify <circuit> <proof>            # Verify proof
chainlesschain zkp list                                # List circuits
```

### `chainlesschain bi <action>`

Business Intelligence with natural language queries.

```bash
chainlesschain bi query "show monthly revenue"         # NL→SQL query
chainlesschain bi dashboard create --name "KPI"        # Create dashboard
chainlesschain bi dashboard list                       # List dashboards
chainlesschain bi anomaly --metric sales               # Z-score anomaly detection
```

---

## Phase 9: Low-Code Platform

### `chainlesschain lowcode <action>`

Visual low-code application builder.

```bash
chainlesschain lowcode create --name "app1"            # Create app
chainlesschain lowcode list                            # List apps
chainlesschain lowcode components                      # List 15+ components
chainlesschain lowcode preview <id>                    # Preview app
chainlesschain lowcode publish <id>                    # Publish app
```

---

## EvoMap Gene Exchange Protocol

### `chainlesschain evomap <action>`

Gene exchange protocol for sharing AI capabilities across instances.

```bash
chainlesschain evomap search "tool name"               # Search genes on hub
chainlesschain evomap download <gene-id>                # Download gene
chainlesschain evomap publish --name "my-gene"          # Publish gene to hub
chainlesschain evomap list                              # List local genes
chainlesschain evomap hubs                              # List available hubs
chainlesschain evomap federation list-hubs              # List federated hubs
chainlesschain evomap federation sync <hub>             # Sync genes with hub
chainlesschain evomap federation pressure               # Pressure analytics report
chainlesschain evomap gov propose "title"               # Governance proposal
chainlesschain evomap gov vote <id> for                 # Vote on proposal
chainlesschain evomap gov dashboard                     # Governance dashboard
```

---

## DAO Governance

### `chainlesschain dao <action>`

Decentralized governance with quadratic voting.

```bash
chainlesschain dao propose "title"                      # Create DAO proposal
chainlesschain dao vote <id> for                        # Vote (quadratic voting)
chainlesschain dao delegate <from> <to>                 # Delegate voting power
chainlesschain dao execute <id>                         # Execute passed proposal
chainlesschain dao treasury                             # Show treasury balance
chainlesschain dao stats                                # Governance statistics
```

---

## Phase 8: Security & Compliance

### `chainlesschain compliance <action>`

Compliance evidence collection and reporting (GDPR, SOC2, HIPAA).

```bash
chainlesschain compliance evidence gdpr                 # Collect compliance evidence
chainlesschain compliance report soc2                   # Generate compliance report
chainlesschain compliance classify "text"               # Classify data sensitivity
chainlesschain compliance scan hipaa                    # Scan compliance posture
```

### `chainlesschain dlp <action>`

Data Loss Prevention (DLP) content scanning and policy management.

```bash
chainlesschain dlp scan "content"                       # DLP content scanning
chainlesschain dlp incidents                            # List DLP incidents
chainlesschain dlp policy create --name "rule"          # Create DLP policy
```

### `chainlesschain siem <action>`

Security Information and Event Management (SIEM) integration.

```bash
chainlesschain siem targets                             # List SIEM targets
chainlesschain siem add-target splunk_hec <url>         # Add SIEM export target
chainlesschain siem export <target-id>                  # Export logs to SIEM
```

### `chainlesschain pqc <action>`

Post-Quantum Cryptography key management and migration.

```bash
chainlesschain pqc keys                                 # List PQC keys
chainlesschain pqc generate ML-KEM-768                  # Generate PQC key pair
chainlesschain pqc migration-status                     # PQC migration status
chainlesschain pqc migrate "plan" ML-KEM-768            # Execute PQC migration
```

---

## Phase 8: Communication Bridges

### `chainlesschain nostr <action>`

Nostr protocol bridge for decentralized social messaging.

```bash
chainlesschain nostr relays                             # List Nostr relays
chainlesschain nostr publish "Hello"                    # Publish Nostr event
chainlesschain nostr keygen                             # Generate Nostr keypair
chainlesschain nostr map-did <did> <pubkey>             # Map DID to Nostr
```

### `chainlesschain matrix <action>`

Matrix protocol bridge for federated messaging.

```bash
chainlesschain matrix login                             # Login to Matrix
chainlesschain matrix rooms                             # List Matrix rooms
chainlesschain matrix send <room> "message"             # Send Matrix message
```

### `chainlesschain scim <action>`

SCIM protocol for enterprise user provisioning.

```bash
chainlesschain scim users list                          # List SCIM users
chainlesschain scim users create --name "user"          # Create SCIM user
chainlesschain scim sync <connector-id>                 # Trigger SCIM sync
```

---

## Phase 8: Infrastructure & Hardening

### `chainlesschain terraform <action>`

Infrastructure-as-Code workspace management.

```bash
chainlesschain terraform workspaces                     # List Terraform workspaces
chainlesschain terraform create "prod"                  # Create workspace
chainlesschain terraform plan <workspace-id>            # Run Terraform plan
```

### `chainlesschain hardening <action>`

Security hardening and performance baseline management.

```bash
chainlesschain hardening baseline collect "v1"          # Collect performance baseline
chainlesschain hardening baseline compare <id>          # Compare baseline (regression)
chainlesschain hardening audit run "quarterly"          # Run security audit
```

---

## Phase 8: Social Platform

### `chainlesschain social <action>`

Decentralized social networking features.

```bash
chainlesschain social contact add "Alice"               # Add a contact
chainlesschain social contact list                      # List contacts
chainlesschain social friend add <contact-id>           # Send friend request
chainlesschain social post publish "Hello"              # Publish a post
chainlesschain social chat send <user> "msg"            # Send chat message
chainlesschain social stats                             # Social statistics
```

---

## CLI-Anything: Agent-Native Software Integration

### `chainlesschain cli-anything <action>`

Discover and register external CLI tools as ChainlessChain skills.

Since `0.162.177`, generated CLI-Anything handlers parse input into literal
argv and call the host Process Broker with `shell:false`. Unsafe shell
characters, unmatched quotes, and execution without an injected Broker are
rejected before the external tool starts.

```bash
chainlesschain cli-anything doctor                      # Check Python + CLI-Anything environment
chainlesschain cli-anything scan                        # Scan PATH for cli-anything-* tools
chainlesschain cli-anything register <name>             # Register tool as ChainlessChain skill
chainlesschain cli-anything list                        # List registered tools
chainlesschain cli-anything remove <name>               # Remove registered tool
```

---

## Sub-Agent Isolation v2

Introduced in v0.43.0: complex agent tasks are automatically decomposed into isolated **sub-agents**, each running in its own sandboxed context — namespaced memory, scoped context engineering, and full lifecycle tracking.

### Architecture

| Component                  | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `SubAgentRegistry`         | Singleton registry tracking active/completed sub-agents with stats       |
| `NamespacedMemory`         | Per-sub-agent memory namespace, isolated from main session               |
| `ScopedContextEngineering` | Context window scoped to each sub-agent's task                           |
| `SubAgentContext`          | Execution context carrying role, task, iteration count, and token budget |

### Agent Slash Commands

Inside a `chainlesschain agent` session:

```
/sub-agents     Show active sub-agents, completed history, token usage, and avg duration
```

### How It Works

When the agent encounters a complex multi-step task, it spawns one or more sub-agents:

```
Main Agent
├── SubAgent [analyzer]  — reads codebase, writes findings to namespaced memory
├── SubAgent [planner]   — reads findings, proposes implementation plan
└── SubAgent [executor]  — implements plan with isolated context
```

Each sub-agent:

- Has its own memory namespace (no cross-contamination with other sub-agents)
- Carries a scoped context slice (not the full conversation history)
- Is registered with `SubAgentRegistry` for observability
- Reports back to the main agent upon completion

### Example Output of `/sub-agents`

```
Sub-Agent Registry:
  Active: 1  Completed: 3  Tokens: 4821  Avg Duration: 1243ms

  Active Sub-Agents:
    sa-7f3a [executor] Implement the authentication module (iter: 2)

  Recent History (last 10):
    ✓ sa-1a2b [analyzer] Analyzed 12 files, found 3 issues
    ✓ sa-3c4d [planner] Generated 5-step implementation plan
    ✗ sa-5e6f [executor] Failed: missing dependency crypto-utils
```

---

## WebSocket Server Interface

### `chainlesschain serve`

Start a WebSocket server for external tool integration, enabling real-time bidirectional communication with the CLI engine.

```bash
chainlesschain serve                                    # Start WebSocket server (port 18800)
chainlesschain serve --port 9000                        # Custom port
chainlesschain serve --token <secret>                   # Enable token auth
chainlesschain serve --allow-remote --token <secret>    # Allow remote + auth
chainlesschain serve --project /path/to/project         # Default project root for sessions
```

**Session Protocol** (v0.43.0): WebSocket clients can create stateful agent/chat sessions via `session-create`, send messages via `session-message`, resume previous sessions via `session-resume`, and manage sessions via `session-list`/`session-close`. Supports `slash-command` for in-session commands and `session-answer` for interactive Q&A (SlotFiller/Planner).

### Canonical CC App Server

The canonical Thread/Turn/Item JSON-RPC server uses stdio by default:

```bash
chainlesschain serve --app-server
```

The logical RolloutStore contract is independent of its physical adapter.
JSONL remains the default; SQLite can be selected without changing the App
Server protocol:

```bash
# Hash-chained JSONL directory
chainlesschain serve --app-server \
  --app-server-store jsonl --app-server-state-path /var/lib/cc/rollouts

# SQLite database file
chainlesschain serve --app-server \
  --app-server-store sqlite --app-server-state-path /var/lib/cc/rollouts.sqlite

# Equivalent environment configuration for hosts
CHAINLESSCHAIN_ROLLOUT_STORE=sqlite \
CHAINLESSCHAIN_ROLLOUT_STORE_PATH=/var/lib/cc/rollouts.sqlite \
chainlesschain serve --app-server
```

Use the restartable migration command before changing an existing deployment.
It performs a dry run unless `--apply` is explicit, preserves canonical event
hashes, resumes from a matching target prefix, and refuses divergent targets:

```bash
chainlesschain serve migrate-rollouts \
  --from jsonl --from-path /var/lib/cc/rollouts \
  --to sqlite --to-path /var/lib/cc/rollouts.sqlite

chainlesschain serve migrate-rollouts \
  --from jsonl --from-path /var/lib/cc/rollouts \
  --to sqlite --to-path /var/lib/cc/rollouts.sqlite --apply
```

An experimental WebSocket transport is available at `/app-server`. It always
requires a token of at least 32 UTF-8 bytes; use
`CHAINLESSCHAIN_APP_SERVER_TOKEN` to keep the token out of the process list.
The required WebSocket subprotocol is
`chainlesschain.app-server.experimental.v1`.

```bash
# Loopback-only experimental server; set the token in the environment first
chainlesschain serve --app-server --app-server-websocket

# Non-loopback binding additionally requires explicit opt-in and TLS
chainlesschain serve --app-server --app-server-websocket \
  --host 0.0.0.0 --allow-remote \
  --app-server-tls-cert /path/to/server.crt \
  --app-server-tls-key /path/to/server.key
```

Remote bindings fail closed without TLS, a strong token, and
`--allow-remote`. The transport caps incoming requests, outgoing messages,
bytes, payload size, and connections; overload returns JSON-RPC `-32001` with
`retry_after_ms`, while a slow consumer is disconnected. Tokens in URL query
strings are not accepted. This transport remains experimental and is not a
production stability guarantee.

---

## Web Management Interface (v0.45.8)

### `chainlesschain ui`

Open a browser-based Web management interface — no extra software required. When a built Vue3 panel (`dist/`) is present it is served as static files; otherwise an embedded single-page app is used as fallback.

```bash
chainlesschain ui                       # Auto-detect mode, open browser
chainlesschain ui --port 18810          # Custom HTTP port
chainlesschain ui --ws-port 18800       # Custom WebSocket port
chainlesschain ui --no-open             # Start server without opening browser
chainlesschain ui --token <secret>      # Enable WebSocket auth token
chainlesschain ui --host 0.0.0.0        # Bind to all interfaces (remote access)
chainlesschain ui --web-panel-dir <dir> # Custom dist/ directory (auto-detected by default)
```

> **npm users**: the Vue3 panel is bundled automatically (via `prepublishOnly`) — no build step needed.
> **Source users**: run `npm run build:web-panel` once (from repo root) to build `packages/web-panel/dist/`.

**Two modes** (auto-detected based on current directory):

| Mode             | Trigger                                      | Description                                                    |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **Project mode** | Run from a directory with `.chainlesschain/` | AI automatically loads project context (rules, skills, config) |
| **Global mode**  | Run from any non-project directory           | General-purpose AI management panel                            |

**Features**: Vue3 + Ant Design Vue panel (Dashboard / Chat / Skills / Providers), streaming Markdown output, session management (new/switch/history), Agent/Chat mode toggle, slot-filling interactive dialogs, auto-reconnect (3s), Token auth.

**Ports**: HTTP 18810 (Web UI page + static assets), WebSocket 18800 (reuses `chainlesschain serve` infrastructure).

**Security**: JSON config embedded with XSS-safe Unicode escaping (`\u003c`/`\u003e`); Token auth via `--token`.

---

## AI Orchestration Layer (v0.45.4)

### `chainlesschain orchestrate`

Use ChainlessChain as an orchestration layer — automatically decompose tasks, dispatch to parallel AI coding agents (Claude Code / Codex / Gemini / OpenAI / Ollama), verify with CI/CD, and notify via Telegram / WeCom / DingTalk / Feishu.

```bash
chainlesschain orchestrate "Fix the auth bug"              # Auto-detect AI tool and run
chainlesschain orchestrate "Refactor payments" \
  --backends claude,gemini --strategy parallel-all         # Multi-backend, parallel
chainlesschain orchestrate "Add tests" \
  --ci "npm run test:unit" --retries 5                     # Custom CI + retries
chainlesschain orchestrate "task" --no-ci                  # Skip CI verification
chainlesschain orchestrate "task" --json                   # JSON output (for scripts)
chainlesschain orchestrate detect                          # Detect installed AI CLIs
chainlesschain orchestrate --status                        # Show orchestrator status
chainlesschain orchestrate --status --json                 # JSON status with backends list
chainlesschain orchestrate --webhook                       # Start IM webhook server (port 18820)
chainlesschain orchestrate --webhook --webhook-port 9090   # Custom port
```

**Routing strategies** (`--strategy`):

| Strategy       | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `round-robin`  | Weighted round-robin across all backends (default)             |
| `primary`      | Use first backend, auto-fallback on failure                    |
| `parallel-all` | Run all backends simultaneously, pick best result              |
| `by-type`      | Route by task type (`code-generation` / `analysis` / `review`) |

**Auto-detected backends**: `claude` (CLI), `codex` (CLI), `gemini` / `openai` / `anthropic` (API key env vars), `ollama` (always included as local fallback).

The external Codex backend uses `codex exec --json`. Its separate App Server
adapter remains experimental and disabled by default. The
[generated support matrix](../../docs/cli/CODEX_APP_SERVER_SUPPORT.generated.md)
distinguishes the exact experimental allowlist, configured CI probes, and
production admission. Probe configuration alone does not establish compatibility.

**Notification channels** (configured via env vars):

```bash
TELEGRAM_BOT_TOKEN=...  TELEGRAM_CHAT_ID=...    # Telegram
WECOM_WEBHOOK_URL=...                            # WeCom (企业微信)
DINGTALK_WEBHOOK_URL=...  DINGTALK_SECRET=...   # DingTalk (钉钉)
FEISHU_WEBHOOK_URL=...    FEISHU_SECRET=...     # Feishu (飞书)
```

**Incoming webhooks** — receive task commands from IM platforms:

```bash
# ChainlessChain HMAC mode (backward-compatible default)
CC_ORCHESTRATE_WEBHOOK_SECRET=replace-with-at-least-16-characters \
  chainlesschain orchestrate --webhook

# Vendor-native mode (configure only the channels you expose; an
# unconfigured channel fails closed with HTTP 503)
CC_ORCHESTRATE_DINGTALK_SECRET=... \
CC_ORCHESTRATE_FEISHU_ENCRYPT_KEY=... \
CC_ORCHESTRATE_WECOM_TOKEN=... \
CC_ORCHESTRATE_WECOM_ENCODING_AES_KEY=... \
CC_ORCHESTRATE_WECOM_RECEIVE_ID=... \
  chainlesschain orchestrate --webhook --webhook-auth-mode vendor

chainlesschain orchestrate --webhook --webhook-port 18820
# POST /wecom    (WeCom XML)
# POST /dingtalk (DingTalk JSON)
# POST /feishu   (Feishu JSON + challenge verification)
```

`vendor` mode does not fall back to the `X-CC-*` headers. It verifies
DingTalk's `timestamp`/`sign` headers, Feishu's `X-Lark-*` signature over the
raw request, and WeCom's `msg_signature` query value. Feishu and WeCom encrypted
payloads are decrypted only after signature verification; WeCom callback URL
verification is available via signed `GET /wecom`. `DINGTALK_SECRET`,
`FEISHU_ENCRYPT_KEY`, `WECOM_TOKEN`, `WECOM_ENCODING_AES_KEY`, and
`WECOM_RECEIVE_ID` remain supported aliases for the channel-specific variables.

**WebSocket integration** — trigger via `{ "type": "orchestrate", "task": "...", "cwd": "..." }`, receive real-time `orchestrate:event` progress events and final `orchestrate:done`.

---

## CLI V2 Governance Wave (iter16–iter28, 2026-04-19)

Thirteen iterations (iter16 → iter28) ported **136 Governance V2 surfaces** onto the CLI, one per underlying library module. Each surface adds a pair of state-machine-governed lifecycles on top of an existing module and ships behind `-v2`-suffixed subcommands — existing non-v2 behavior is untouched.

### Shape of a Gov V2 surface

Every surface follows the same dual-layer FSM pattern:

- **Profile lifecycle (4 states)** — one of `{paused, suspended, stale, degraded, deprecated, dormant, muted, disabled, frozen, breached, drifted}` depending on the domain, with recovery back to `active` and an `archived` terminal.
- **Action lifecycle (5 states)** — `pending → running → {completed | failed | cancelled}`, three terminals.
- **Caps** — per-surface profile/action caps (ranging 5/10 on small surfaces up to 15/30 on high-volume ones like feature-flags).
- **Auto-hooks** — `auto-<degraded>-idle` moves idle profiles into the non-active branch; `auto-fail-stuck` fails actions stuck in `running` past a TTL (30s / 60s depending on surface).
- **`*gov-gov-stats-v2`** aggregate command per surface.
- **44 V2 tests** per surface (profile FSM, action FSM, caps, hooks, stats), plus a shared `preAction` hook that prevents accidental nesting of `-v2` subcommands.

### Surface inventory by iteration

| Iter   | Gov prefix → parent command                                                                                                                                                                                    | Surfaces                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iter16 | `aud-gov-` / `kgov-` / `sbox-gov-` / `slagov-` / `strgov-` / `tfgov-` / `repgov-` / `mktgov-`                                                                                                                  | `audit`, `kg`, `sandbox`, `sla`, `stress`, `terraform`, `reputation`, `marketplace`                                                                                                                                                                                                                                                           |
| iter17 | `chatgov-` / `ccbgov-` / `cmgr-` / `learn-` / `cwwf-` / `pcgov-` / `incgov-` / `hardgov-`                                                                                                                      | `chat`, `orchestrate` (claude-code-bridge), `compliance`, `cowork` (learning + workflow), `privacy`, `incentive`, `hardening`                                                                                                                                                                                                                 |
| iter18 | `aiopsgov-` / `mmgov-` / `instgov-` / `tnsgov-` / `qntgov-` / `trustgov-` / `nlpgov-` / `percgov-`                                                                                                             | `ops`, `multimodal`, `instinct`, `tenant`, `quantize`, `trust`, `nlprog`, `perception`                                                                                                                                                                                                                                                        |
| iter19 | `cdagov-` / `cogov-` / `commgov-` / `didgov-` / `ssogov-` / `orggov-` / `scimgov-` / `syncgov-`                                                                                                                | `codegen`, `collab`, `governance`, `did`, `sso`, `org`, `scim`, `sync`                                                                                                                                                                                                                                                                        |
| iter20 | `anetgov-` / `bagov-` / `dlpgov-` / `evgov-` / `fedgov-` / `ipfsgov-` / `p2pgov-` / `walgov-`                                                                                                                  | `agent-network`, `browse`, `dlp`, `evomap`, `federation`, `ipfs`, `p2p`, `wallet`                                                                                                                                                                                                                                                             |
| iter21 | `apgov-` / `matgov-` / `nosgov-` / `bigov-` / `memgov-` / `sesgov-` / `hookgov-` / `wfgov-`                                                                                                                    | `activitypub`, `matrix`, `nostr`, `bi`, `memory`, `session`, `hook`, `workflow`                                                                                                                                                                                                                                                               |
| iter22 | `augov-` / `shgov-` / `dv2gov-` / `kexpgov-` / `kimpgov-` / `llmgov-` / `pqcgov-` / `smgov-`                                                                                                                   | `automation`, `cowork` (share), `did-v2`, `export`, `import`, `llm`, `pqc`, `social`                                                                                                                                                                                                                                                          |
| iter23 | `rcgov-` / `techgov-` / `rtgov-` / `ntgov-` / `pmgov-` / `pfgov-` / `dbevogov-` / `digov-`                                                                                                                     | `rcache`, `tech`, `runtime`, `note` (versioning), `permmem`, `fusion`, `dbevo`, `infra`                                                                                                                                                                                                                                                       |
| iter24 | `rcmdgov-` / `mcpgov-` / `ecogov-` / `sklgov-` / `toktgov-` / `devgov-` / `tigov-` / `uebgov-`                                                                                                                 | `recommend`, `mcp`, `ecosystem`, `skill`, `tokens`, `dev`, `compliance` (threat-intel + ueba)                                                                                                                                                                                                                                                 |
| iter25 | `cttgov-` / `ctmgov-` / `clibgov-` / `argov-` / `saregov-` / `todogov-` / `ebgov-` / `evfedgov-`                                                                                                               | `cowork` (task-templates + template-marketplace), `cli-anything`, `orchestrate` (agent-router), `agent` (registry + todo + exec-backend), `evomap` (federation)                                                                                                                                                                               |
| iter26 | `plannergov-` / `ctxenggov-` / `sactxgov-` / `iagov-` / `wfexgov-` / `padgov-` / `hlgov-` / `webuigov-`                                                                                                        | `planmode`, `cli-anything`, `agent` (sub-agent-context), `chat` (interaction-adapter), `workflow` (expr), `plugin` (autodiscovery), `memory` (hashline), `ui` (web-ui-server)                                                                                                                                                                 |
| iter27 | `dlgov-` / `smcpgov-` / `cmcpgov-` / `stixgov-` / `sapgov-` / `cobsgov-` / `pmgrgov-` / `wscgov-` / `evcligov-` / `poptgov-` / `scsgov-` / `smgrgov-` / `ceadgov-` / `pstrmgov-` / `cohtgov-` / `cadpgov-`     | `setup`, `skill`, `cowork` (mcp-tools / observe / observe-html / evomap-adapter / adapter), `compliance` (stix), `agent` (sub-agent-profiles), `start` (process-manager), `chat` (ws-chat-handler), `evomap` (client), `llm` (provider-options), `config` (session-core-singletons), `services` (service-manager), `stream` (provider-stream) |
| iter28 | `a2apgov-` / `acrdgov-` / `aecogov-` / `autagov-` / `ccoregov-` / `cmpmgov-` / `crchgov-` / `crygov-` / `daomgov-` / `esysgov-` / `emgrgov-` / `hmemgov-` / `infnetgov-` / `kggov-` / `pipogov-` / `pmodegov-` | `a2a`, `orchestrate` (agent-coordinator), `economy`, `agent` (autonomous-agent), `chat` (chat-core), `compliance` (compliance-manager), `crosschain`, `encrypt` (crypto-manager), `dao`, `evolution`, `evomap` (evomap-manager), `hmemory`, `inference`, `kg`, `pipeline`, `planmode` (plan-mode)                                             |

**Totals**: 136 surfaces × ~44 V2 tests ≈ **~5,984 additional CLI V2 tests** introduced in this wave.

### Typical usage

```bash
cc audit aud-gov-register-v2 --profile secops --level warn
cc audit aud-gov-activate-v2 --profile secops
cc audit aud-gov-write-start-v2 --profile secops --payload '{"evt":"login"}'
cc audit aud-gov-write-complete-v2 --action-id <id>
cc audit aud-gov-gov-stats-v2 --json
```

Every surface follows this shape — replace `aud-gov-` with the prefix from the table and `audit` with the parent command.

---

## Global Options

```bash
chainlesschain --version   # Show version
chainlesschain --help      # Show the curated command surface
chainlesschain help --all  # Show all compatibility commands
chainlesschain --verbose status # Add diagnostics on stderr
chainlesschain --quiet status   # Suppress non-error human output
```

## Configuration

Configuration is stored at `~/.chainlesschain/config.json`. The CLI creates and manages this file automatically during setup.

### Config Schema

```json
{
  "setupCompleted": true,
  "completedAt": "2026-03-11T00:00:00.000Z",
  "edition": "personal",
  "llm": {
    "provider": "ollama",
    "apiKey": null,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5:7b"
  },
  "enterprise": {
    "serverUrl": null,
    "apiKey": null,
    "tenantId": null
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": null
  },
  "update": {
    "channel": "stable",
    "autoCheck": true
  }
}
```

### Supported LLM Providers

| Provider                   | Default Model          | API Key Required   |
| -------------------------- | ---------------------- | ------------------ |
| Ollama (Local)             | qwen2.5:7b             | No                 |
| OpenAI                     | gpt-4o                 | Yes                |
| Anthropic                  | claude-opus-4-6        | Yes                |
| DeepSeek                   | deepseek-chat          | Yes                |
| DashScope (Alibaba)        | qwen-turbo             | Yes                |
| Google Gemini              | gemini-2.0-flash       | Yes                |
| Mistral AI                 | mistral-large-latest   | Yes                |
| Volcengine (火山引擎/豆包) | doubao-seed-1-6-251015 | Yes                |
| Kimi (月之暗面)            | moonshot-v1-auto       | Yes                |
| MiniMax (海螺AI)           | MiniMax-Text-01        | Yes                |
| Custom (OpenAI-compatible) | Set explicitly         | Platform-dependent |

Use `provider: "custom"` for local or LAN model platforms exposing OpenAI-compatible Chat Completions, including LM Studio, vLLM, Xinference, LocalAI, and model-routing gateways. Set the platform's API base URL (for example `http://localhost:1234/v1` or a LAN gateway's documented base path) and exact model name. Supply its API key when required; keyless endpoints are also supported. Chat, Agent, streaming, and connection tests keep that endpoint and model instead of selecting Ollama or a cloud provider.

Self-evolution is optional. With `evolution.enabled: false`, `cc ui` Chat, Agent, Quick Ask, streaming, and Personal Data Hub analysis do not require an Evolution deployment certificate. Existing sessions read the setting again on subsequent requests. Enabled deployments still require valid authentication.

## File Structure

```
~/.chainlesschain/
├── config.json        # Configuration
├── bin/               # Downloaded binaries
├── state/             # Runtime state (PID files)
├── services/          # Service configurations
├── logs/              # CLI logs
└── cache/             # Download cache
```

## Development

```bash
cd packages/cli
npm install
npm test                # Run all tests (~9,000 tests across 280+ files, incl. ~5,984 V2 governance tests from iter16–iter28)
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e        # End-to-end tests
```

### Test Coverage

The numbers below are an approximate, pre-iter16 snapshot of the unit/integration/e2e breakdown. Since iter16–iter28 added **136 V2 governance surfaces × ~44 tests ≈ ~5,984 additional CLI V2 tests**, the actual total is currently around **~9,000 tests across 280+ files** — verify with `npm test` for the authoritative count.

| Category                  | Files    | Tests      | Status          |
| ------------------------- | -------- | ---------- | --------------- |
| Unit — lib modules        | 71       | 1750+      | All passing     |
| Unit — commands           | 17       | 400+       | All passing     |
| Unit — runtime            | 1        | 6          | All passing     |
| Unit — WS sessions        | 9        | 156        | All passing     |
| Unit — Skill Packs        | 2        | 57+        | All passing     |
| Unit — AI Templates       | 2        | 130+       | All passing     |
| Unit — Web UI             | 1        | 46         | All passing     |
| Unit — Learning           | 7        | 177        | All passing     |
| Integration               | 13       | 230+       | All passing     |
| Integration — WS session  | 1        | 12         | All passing     |
| Integration — AI Handlers | 2        | 100+       | All passing     |
| Integration — Web UI      | 1        | 29         | All passing     |
| Integration — Learning    | 1        | 12         | All passing     |
| E2E                       | 15       | 260+       | All passing     |
| E2E — Skill Packs         | 1        | 23+        | All passing     |
| E2E — AI Templates        | 4        | 65+        | All passing     |
| E2E — Web UI              | 1        | 24         | All passing     |
| E2E — Learning            | 1        | 16         | All passing     |
| Core packages (external)  | —        | 118        | All passing     |
| V2 Governance (iter16–28) | 136      | ~5,984     | All passing     |
| **CLI Total (approx.)**   | **280+** | **~9,000** | **All passing** |

## Agent Power & Claude-Code Parity

Headless-agent companions: session economics, file checkpoints, permission rules, prompt macros, IDE bridging. All work without the desktop GUI.

### `chainlesschain checkpoint <action>`

Snapshot / rewind file state. Uses a git-plumbing engine (shadow commits, zero impact on your real index/worktree) inside git repos, with a copy-based fallback elsewhere. Also auto-snapshots before file-modifying tools when running `cc agent --checkpoint`.

```bash
chainlesschain checkpoint create src/ --label "before refactor"   # Snapshot paths
chainlesschain checkpoint list                                    # List checkpoints (newest first)
chainlesschain checkpoint show <id> --diff                        # Diff snapshot vs current files
chainlesschain checkpoint restore <id>                            # Rewind (alias: rewind; --dry-run, --force)
chainlesschain checkpoint delete <id>                             # Delete one checkpoint
chainlesschain checkpoint clear                                   # Delete all (per --session)
```

Common options: `-d, --dir <dir>` target directory, `-s, --session <id>` checkpoint session (git engine), `--json`.

### `chainlesschain compact <session-id>`

Compact a stored session's history offline (no LLM call) — deduplicates and compresses old messages, persisting a `compact` event so `cc agent --resume` rebuilds from the smaller context. The agent loop also auto-compacts oversized histories by default (`autoCompact: false` opts out).

```bash
chainlesschain compact <session-id>                  # Compress and persist
chainlesschain compact <session-id> --dry-run        # Preview the reduction without writing
chainlesschain compact <session-id> --max-tokens 4000 --max-messages 30
chainlesschain compact <session-id> --json
```

### `chainlesschain cost [id]`

Estimated $ cost from recorded token usage — per-session, or a global rollup when the ID is omitted. Prices are configurable via `llm.pricing` in `~/.chainlesschain/config.json`.

```bash
chainlesschain cost                       # Global rollup across sessions
chainlesschain cost <session-id>          # One session
chainlesschain cost --limit 200 --json    # Cap rollup size, JSON output
```

### `chainlesschain context [id]`

Context-window token breakdown for a session (Claude-Code `/context` parity). Defaults to the most-recent headless session.

```bash
chainlesschain context                            # Most recent session
chainlesschain context <session-id> --model gpt-4o --provider openai
chainlesschain context --json
```

### `chainlesschain loop [parts...]`

Repeatedly run an agent prompt or a `-- <command>` on a fixed interval — a self-driving retry/watch loop.

```bash
chainlesschain loop "fix failing tests" --every 5m --until-exit-zero
chainlesschain loop --every 30s -- npm run test:unit       # Command mode
chainlesschain loop "check deploy" -n 10 --until "DONE"    # Stop on regex match
chainlesschain loop "triage" --dynamic                     # Self-paced via [[loop:next]] / [[loop:stop]]
chainlesschain loop "nightly sweep" --save nightly         # Persist; later: --resume nightly
```

Options: `--every <dur>` (30s / 5m / 1.5h), `-n, --max-iterations <n>`, `--until-exit-zero`, `--until <regex>`, `--dynamic`, `--save [id]`, `--resume <id>`, `--json`. Unknown flags pass through to the wrapped agent/command.

### `chainlesschain review [effort]`

Diff-first code review of your working changes (Claude-Code `/code-review` parity). Reviews the working tree by default; scope it to staged changes, a branch base, or an explicit revision range.

```bash
chainlesschain review                                  # Review working changes (effort: medium)
chainlesschain review high --paths src/                # Higher effort, limited to paths
chainlesschain review --staged                         # Staged changes only
chainlesschain review --base main                      # This branch vs a base ref
chainlesschain review --fix                            # Apply fixes to the working tree (auto-checkpointed)
chainlesschain review --security                       # Security-focused (/security-review parity)
chainlesschain review --simplify                       # Cleanup-only, no bug hunt (/simplify parity)
chainlesschain review --comment                        # Post findings as inline PR comments (via gh)
```

Options: `-e, --effort <low|medium|high>`, `--range <A..B>`, `--no-untracked`, `--no-checkpoint`, `--model`/`--provider`/`--base-url`/`--api-key`, `--max-turns <n>`, `--dry-run`, `--json`.

### `chainlesschain insights [id]`

Analyze a session — turns, tools used, errors, duration, and token usage + cost. Defaults to the most-recent session when the ID is omitted.

```bash
chainlesschain insights                  # Most recent session
chainlesschain insights <session-id>     # One session
chainlesschain insights --json           # JSON output
```

### `chainlesschain terminal-setup`

Bind **Shift+Enter** to a REPL newline in your terminal (Claude-Code parity). Prints the manual steps by default, or writes the VS Code keybinding with `--apply`.

```bash
chainlesschain terminal-setup            # Print binding instructions
chainlesschain terminal-setup --apply    # Write the keybinding (VS Code only)
```

### `chainlesschain goal <action>`

Cross-session persistent goals / OKRs. Bind a goal into headless runs with `cc agent -p --goal <id>` (add `--goal-assess` for a run-end LLM progress assessment).

```bash
chainlesschain goal set "Ship the v2 importer" --title importer   # Create (alias: add)
chainlesschain goal list --status active                          # List goals
chainlesschain goal show <id>                                     # Full detail
chainlesschain goal kr add <id> "100 tests green" --target 100    # Add key result
chainlesschain goal kr set <id> <krId> --current 80               # Update key result
chainlesschain goal progress <id> --pct 60 --note "parser done"   # Record progress
chainlesschain goal link <id> [sessionId]                         # Attach a session
chainlesschain goal pause|resume|close|abandon <id>               # Lifecycle
chainlesschain goal rm <id>                                       # Delete (alias: delete)
```

The catalog, panels and draft workflows below describe source snapshot
`f21eac547e`, not public CLI .106. Use matching local builds for development;
the new Session Core exports require a child-package release first. Evidence paths
below refer to that development snapshot.

```bash
chainlesschain goal catalog --limit 20 --json                     # Bounded selection metadata
chainlesschain goal panels <id> --plugin goal-progress-viewer --scope project --json
```

`goal panels` reads an explicitly selected standalone CLI goal through trusted,
consented declarative plugins. The included `goal-progress-viewer` shows the
objective and lifecycle status as a text snapshot. From a repository checkout:

```bash
cc plugin add packages/cli/src/lib/plugin-runtime/examples/goal-progress-viewer --scope project --json
cc plugin trust goal-progress-viewer --scope project
cc plugin consent goal-progress-viewer --scope project --grant --json
cc goal panels <id> --plugin goal-progress-viewer --scope project
```

VS Code and JetBrains expose **CLI goal panels…** in the plugin manager. Select
a goal from the native paged picker, or choose **Enter goal ID…**. The picker uses
`goal catalog --json`; its opaque `nextCursor` continues with `--after <cursor>`.
Each fresh page inspects at most 20 candidate files, reports invalid sources and
names, and returns only bounded metadata. Directories with more than 2,048 entries
require manual ID selection. The chosen catalog store is pinned with
`goal panels <id> --expected-store <storeId>` before the source is read again.
These commands require matching working-tree CLI/IDE builds; older CLIs retain
the manual-ID path when catalog discovery is unavailable.

Refresh or a new read checks current source and plugin authorization. Standalone
goals provide objective/status snapshots. Historical project risk and receipt
summaries require the separate desktop evidence connection below. The broader
`project-delivery-assistant` example still requires a project host adapter.

The working-tree SDK now shares its proposal contract with Session Core's native
pending-draft queue. A trusted-host SQLite integration verifies source and
admission checks, idempotency and revocation; the CLI still has no authenticated
live project write entry. The desktop's separately consented built-in delivery
draft rule is not an installed CLI plugin or the full `project-delivery-assistant`.
The trusted desktop host can now explicitly convert a persisted draft into one
native preview/intent, then use the existing native confirmation and receipt
flow. Conversion IDs survive restart and lost responses; revocation blocks
pending previews and writes through ordinary intent APIs too. The plugin SDK
still submits pending suggestions only. This conversion change is unreleased
and grants no CLI/IDE project write authority.

The working tree now also supports an explicitly authorized **read-only desktop
connection**. In the desktop project goal area, choose **连接 CLI / IDE 目标摘要**
and approve the native dialog. Save a new file in the preselected private
`goal-connections` directory under desktop user data, then use that file:

```powershell
cc goal catalog --connection "<connection-file>" --json
cc goal panels <goal-id> --connection "<connection-file>" --expected-store <store-id> --plugin goal-progress-viewer --scope project --json
```

Both IDE plugin managers offer **Open desktop goal connection…** in the goal
picker. This grants holders of the private connection file access to one goal's
objective, active status and version for at most 15 minutes. Windows DACL or Unix
owner-only directory/file permissions are verified before writing credentials.
Mutual HMAC checks bind each fresh nonce to the exact response; the secret is
never sent over HTTP or included in CLI output. Stop, logout, navigation,
database/identity changes, goal revision, expiry or project ownership/status
changes invalidate access. Reads still check installed-plugin trust, consent and
policy. These are snapshots; refresh reads again. Restart requires a new native
approval. This summary connection exposes objective/status/version only.
The connection file contains a temporary secret and must remain private. This
bridge and its IDE entry points are unreleased working-tree changes.

To read historical risk checks and native action receipts, choose **另行授权风险与回执摘要**
in the desktop goal area and approve the separate native dialog. This creates a
new evidence connection; existing summary files retain their original scope.
Install and separately trust/consent the declarative evidence viewer:

```powershell
cc plugin add packages/cli/src/lib/plugin-runtime/examples/goal-evidence-viewer --scope project --json
cc plugin trust goal-evidence-viewer --scope project
cc plugin consent goal-evidence-viewer --scope project --grant --json
cc goal catalog --connection "<evidence-connection-file>" --json
cc goal panels <goal-id> --connection "<evidence-connection-file>" --expected-store <store-id> --plugin goal-evidence-viewer --scope project --json
```

Both IDEs use the same native connection-file picker. The `goal.evidence` panel
requires `panel:goal.evidence` consent and an evidence connection. It displays the
latest recorded native check, including insufficient-data/unknown results, and
metadata for the latest 20 real action receipts (showing at most five IDs in text).
Missing storage is reported as unavailable. All results are historical; they do
not establish current risk or goal completion. Running actions remain unresolved.
The read path performs no initialization, recovery or usage settlement and
exposes no task bodies, previews or approval evidence. Summary-only plugins
cannot read evidence fields. Project writes and event subscriptions remain
unavailable through either connection. The complete `project-delivery-assistant`
example still requires those additional host capabilities.

The working tree also supports **request-file handoff** for task descriptions.
Install the proposal-only example and explicitly trust/consent it:

```powershell
cc plugin add packages/cli/src/lib/plugin-runtime/examples/goal-description-drafter --scope project --json
cc plugin trust goal-description-drafter --scope project
cc plugin consent goal-description-drafter --scope project --grant --json
cc goal catalog --connection "<connection-file>" --json
cc goal draft-request <goal-id> --connection "<connection-file>" --expected-store <store-id> --plugin goal-description-drafter --scope project --source <native-proposal-id> --request-id <stable-request-id> --title "Follow up delivery risk" --description-file "<utf8-text-file>" --out "<new-request-file.json>" --json
```

First allow task-description suggestions on the desktop goal and run a current
risk check. Copy an exact proposal ID from **采纳外部任务说明请求** in the goal
actions area. Proposed description files are limited to 8192 UTF-8 bytes;
the request envelope is limited to 16 KiB. Export requires current plugin trust,
capability consent, policy and a live summary/evidence connection, and refuses
to overwrite an existing output. It exports a request, without saving a native
draft or modifying a task. VS Code and JetBrains expose **Export goal draft
request…** in their plugin managers; connection, description and output paths
come from native pickers.

On the desktop, choose **选择文件并原生采纳**, inspect the full proposed description,
then explicitly adopt it as your own pending draft. Plugin labels in the file
are untrusted metadata; the content digest is not plugin authentication. Native
adoption is separate from CLI plugin trust: disabling that plugin does not revoke
an already adopted request. Use **撤销此份采纳** for that record. Adoption and
pending insertion commit together; duplicates return the same record, changed
content under the same request identity conflicts, and revoked requests cannot
be revived by reimport. To recover a lost response, reimport the same file.
A saved request with a changed source is still reported as saved and unavailable.
Native preview and a second explicit native confirmation remain required before
task modification. Revoking adoption invalidates pending previews; it does not
undo completed task changes. No versions have been published for this flow.

The working tree additionally supports a separately authorized **online pending
draft connection**. Export an access request for the same installed/trusted/
consented proposal-only plugin:

```powershell
cc goal draft-access --plugin goal-description-drafter --scope project --out "<new-access.json>" --json
# Desktop: choose “另行授权在线待审草稿连接”, select that access request,
# then confirm and save a new private connection file.
cc goal draft-sources <goal-id> --connection "<draft-connection.json>" --plugin goal-description-drafter --scope project --expected-store <store-id> --json
cc goal draft-send <goal-id> --connection "<draft-connection.json>" --plugin goal-description-drafter --scope project --expected-store <store-id> --source <selected-native-proposal-id> --request-id <stable-id> --title "Follow up delivery risk" --description-file "<utf8-text-file>" --record "<new-submission-record.json>" --json
cc goal draft-receipt <goal-id> --connection "<draft-connection.json>" --plugin goal-description-drafter --scope project --expected-store <store-id> --record "<submission-record.json>" --json
```

`draft-sources` scans at most 20 native sources; pass `--after <nextCursor>` for
the next page. No task bodies or approvals are exported. The v3 connection is
separate from summary/evidence connections and cannot prepare or execute tasks.
The label in its access request does not authenticate plugin code. A current
native grant binds the actor, project goal, full plugin identity, declaration
digest and authorization epoch. CLI trust and native authorization are separate.

`--record` is required: an immutable, body-free reference is created and fsynced
before the submission POST. Keep it even if the IDE closes or a response is lost.
`saved` means a pending draft was saved; `unknown` requires receipt lookup.
`not-found` only means no receipt was found at lookup time: a late submission
may still complete. Sending with an existing identical record only queries its
receipt and never automatically resubmits. Changed content conflicts with the
record. Receipt lookup does not require the original risk source to remain fresh.
If the connection expires, reconnect the same unchanged native grant; a revoked
or replaced authorization cannot query through its old epoch. Native history
remains the fallback when the grant or local plugin admission has changed.

VS Code and JetBrains provide **Export online draft access…**, **Submit pending
draft…** and **Look up draft receipt…** with native connection/source/body/record
pickers. On the desktop, **在线来源授权与待审草稿** lists saved counts and allows
review, native preview and explicit source revocation. Disconnecting preserves
saved drafts and the grant across application restarts. Revoking the source
invalidates its old drafts and pending previews; completed task receipts remain.
Actual changes require a current preview and separate native confirmation.
Event subscriptions, the complete delivery assistant and real GUI acceptance
remain open. See local implementation evidence (`../../docs/research/agents/evidence/dmm-cli-online-drafts-2026-10-18/README.md`).

### `chainlesschain permissions <action>` (alias: `perms`)

Inspect / dry-run / edit `.claude/settings.json` permission rules (`allow` / `ask` / `deny`, `Tool(glob)` syntax, deny > ask > allow). Used by `cc agent --settings`.

```bash
chainlesschain permissions list                            # Merged rules + their source files
chainlesschain permissions test Bash "git push origin"     # Dry-run: which rule matches?
chainlesschain permissions add deny "Read(./.env*)"        # Append a rule
chainlesschain permissions add allow "Bash(npm test:*)" --local   # .claude/settings.local.json
chainlesschain permissions add ask "WebFetch(domain:*)" --user    # ~/.claude/settings.json
```

Options: `--json`, `--settings <file>` to merge an explicit settings file.

### `chainlesschain output-style <action>`

List / show agent output-style personas (`.claude/output-styles/*.md` + built-ins) layered onto the system prompt. Select with `cc agent --output-style <name>` or `outputStyle` in settings.json.

```bash
chainlesschain output-style list                 # Default action (alias: ls)
chainlesschain output-style show explanatory     # Metadata + body
chainlesschain output-style new my-style --description "Terse reviewer"
chainlesschain output-style new my-style --personal   # ~/.claude/output-styles
```

### `chainlesschain statusline <action>`

Preview / show the `.claude/settings.json` `statusLine` command (REPL renders it before each prompt; a built-in context-usage line is shown when no custom command is configured).

```bash
chainlesschain statusline preview            # Render once (default action)
chainlesschain statusline preview --model opus
chainlesschain statusline show               # Resolved statusLine config
```

### `chainlesschain command <action>` (alias: `cmd`)

User-defined slash-command macros (`.claude/commands/*.md` and `.chainlesschain/commands/`) — reusable prompt templates with `$ARGUMENTS`/`$1-9`, `` !`bash` `` and `@file` expansion.

```bash
chainlesschain command list                        # Discovered macros (alias: ls)
chainlesschain command show <name>                 # Metadata + template body
chainlesschain command run <name> [args...]        # Expand + run headlessly
chainlesschain command run <name> --print-prompt   # Show expanded prompt only
chainlesschain command new <name> --description "Review a PR"
chainlesschain command new <name> --claude         # Claude-Code-portable location
```

`run` options: `--no-bang`, `--output-format text|json|stream-json`, `--model`, `--permission-mode`.

### `chainlesschain ide <action>`

Inspect IDE bridge discovery — how `cc agent` auto-connects to an editor MCP server (VS Code / JetBrains extensions) via `CHAINLESSCHAIN_IDE_PORT` or `~/.chainlesschain/ide/*.json` lockfiles. Force / disable with `cc agent --ide` / `--no-ide`.

```bash
chainlesschain ide list       # Live IDE lockfiles (advertised editor MCP servers)
chainlesschain ide status     # Server `cc agent` would connect to right now
chainlesschain ide doctor     # Explain why discovery did / didn't pick a server
```

All subcommands accept `--json` (tokens redacted); `status`/`doctor` accept `--ide` to force selection outside an IDE terminal.

### `chainlesschain decrypt <action>`

Decrypt files encrypted by `chainlesschain encrypt` (AES-256-GCM), and disable database encryption tracking.

```bash
chainlesschain decrypt file secret.txt.enc -o secret.txt   # -p/--password to skip prompt
chainlesschain decrypt db --force                          # Disable DB encryption tracking
```

### `chainlesschain stream <prompt>`

Stream a single prompt through the session-core StreamRouter, emitting NDJSON events on stdout — useful for piping LLM output into other tools.

```bash
chainlesschain stream "Summarize this repo"                # NDJSON events
chainlesschain stream "Hello" --text                       # Concatenated final text only
chainlesschain stream "Hi" --provider openai --model gpt-4o  # Reads the stored credential
```

Options: `--model`, `--provider` (default `ollama`), `--base-url`, `--api-key`, `--text`.

---

## Device & Data

Personal Data Hub, mobile pairing, and on-device bridges.

### `chainlesschain hub <action>`

Personal Data Hub — local vault + adapters + AnalysisEngine on this machine. Ingest your own platform data, then query it in natural language.

```bash
chainlesschain hub ask "How much did I spend on travel?"   # NL question over the vault
chainlesschain hub retrieve-context "topic"                # RAG context retrieval
chainlesschain hub stats                                   # Row counts + adapters + paths
chainlesschain hub health                                  # vault / llm / kgSink / ragSink
chainlesschain hub readiness                               # Adapter readiness report
chainlesschain hub sync-adapter <name>                     # Run one adapter's ingest
chainlesschain hub sync-all                                # Run all adapters in series
chainlesschain hub bilibili-adb-sync                       # Per-platform PC-ADB collectors
chainlesschain hub search "keyword"                        # FTS5 vault search + facets
chainlesschain hub query-events                            # Filtered event query
chainlesschain hub export                                  # Export vault data
chainlesschain hub aichat list                             # AIChat vendor sub-group (login/probe/register/health)
chainlesschain hub derivation-status --json                 # Durable KG/RAG delivery status
chainlesschain hub retry-derivations --limit 100 --json      # Retry latest source revisions (limit 1-1000)
chainlesschain hub derivation-state event <id> --json       # Source revision + index receipts, without payload
chainlesschain hub delete-entity event <id> --confirm --json # Delete normalized entity and queue index removal
chainlesschain hub derivation-consumers --state retired --kind ephemeral --json # Inspect retired generations
chainlesschain hub prune-derivations --consumer <id> --limit 100 --confirm --json # Bounded receipt cleanup
```

Other ADB collectors: `weibo-adb-sync`, `kuaishou-adb-sync`, `toutiao-adb-sync`, `xhs-adb-sync`, `douyin-adb-sync`. Also: `list-adapters`, `facet-counts`, `recent-audit`, `event-detail <id>`, `rederive`, `run-skill <name>`, `register-mock`, `destroy`.

The derivation commands above are working-tree additions awaiting release.
Status and retry accept optional `--adapter` and `--scope` filters. Normalized
deletion retains the raw archive, and explicit later reimport/rederivation may
restore the entity; its result separates source deletion from pending index
removal. CLI and desktop rebuild their in-memory KG/BM25 indexes for each new
runtime generation; vector storage is not currently wired. See the
[PDH projection lifecycle](../personal-data-hub/README.md#durable-kgrag-projections-working-tree-unreleased)
for recovery, authorization, and retention boundaries.
Receipt cleanup requires explicit retired ephemeral consumer IDs and
`--confirm`; running receipts with unknown outcomes and source/dependency
intents are retained. A timeout does not retire a consumer automatically.

### `chainlesschain pair <action>`

LAN pairing utilities — preflight diagnostics plus 6-digit pairing-token issuance for mobile devices.

```bash
chainlesschain pair preflight                  # Network / port diagnostics
chainlesschain pair token generate --name "My iPhone"   # Issue token (+ QR data with --json)
chainlesschain pair token list --did <did>     # List tokens
chainlesschain pair token show <code>          # Inspect one token
chainlesschain pair token revoke <code>        # Revoke a pending token
```

### `chainlesschain notification send` (alias: `notif`)

Push notifications to paired mobile devices (iPhone/Android).

```bash
chainlesschain notification send --target <device-did> --title "Build done"
chainlesschain notification send --target <did> --title "Quiet test" --body "..." --silenced
```

Options: `--type <type>` (default `app`), `--timeout <ms>` (default 10000), `--json`.

### `chainlesschain android <action>`

Android-native bridge: ContentResolver / SAF / Accessibility / Shizuku / root. Runs against a connected device's in-app bridge.

```bash
chainlesschain android caps                    # Probe available bridge capabilities
chainlesschain android contacts pull --since <ms>   # Contacts (runtime permission required)
chainlesschain android sms pull                # SMS
chainlesschain android calls pull              # Call log
chainlesschain android app list --system       # Installed packages
chainlesschain android app launch <pkg>        # Launch app
chainlesschain android app intent <pkg> <action>
chainlesschain android fs read <target>        # SAF / sandbox file read
chainlesschain android fs list <target>        # Directory listing
chainlesschain android a11y query --filter <css>    # Accessibility node tree
chainlesschain android a11y click <nodeId>     # Click a node
```

### `chainlesschain project <action>`

Manage desktop projects (shared SQLite database, syncs to mobile).

```bash
chainlesschain project init <name> --description "..."   # Create project
chainlesschain project list                              # List projects
chainlesschain project show <id>                         # Details
chainlesschain project delete <id>                       # Soft delete (--hard to remove)
chainlesschain project risk-evaluate --snapshot risk.json --json
chainlesschain project task-description-preview --snapshot description.json --json
```

The two snapshot commands are working-tree additions awaiting release. They
read a regular UTF-8 JSON file of at most 2 MiB and run locally without opening
the desktop database or calling a model. Invalid snapshots or insufficient
risk data return exit code 2; `--json` returns a structured result.

`risk-evaluate` evaluates overdue unresolved tasks and incomplete direct
dependencies using an explicit `asOf`; an empty result means these rules found
no matching signals. Its input is a complete selected-field snapshot:

```json
{
  "sourceSchema": "desktop.project-tasks/v1",
  "readStatus": "complete",
  "asOf": "2026-10-06T00:00:00.000Z",
  "scope": { "kind": "personal", "id": "did:key:owner" },
  "project": {
    "id": "project-1",
    "status": "active",
    "updated_at": 1791158400000
  },
  "tasks": [
    {
      "id": "task-1",
      "project_id": "project-1",
      "status": "pending",
      "due_date": 1791158400000,
      "blocked_by": [],
      "updated_at": 1791158400000
    }
  ]
}
```

The caller must establish `readStatus: "complete"` from a successful complete
read; query failures, pagination gaps, missing risk columns, and missing
dependencies must not be represented as empty data. The evaluator accepts up
to 1000 tasks and 10000 dependency edges. `desktop.project-tasks/v1` uses SQL
statuses `pending|running|completed|failed`; `desktop.task-manager/v1` uses
`pending|in_progress|completed|cancelled`. Both require the displayed fields,
with epoch-millisecond row dates and `due_date: null` when no deadline exists.
`blocked_by` may be an array or serialized JSON array. Project statuses are
`draft|active|completed|archived`. Unknown values fail closed. Output contains
rule version, input digest, and risk-specific Project/Task references; these
selected-field versions cannot serve as full-row action revisions.

`task-description-preview` accepts exactly
`{ "task": <full task SQL row>, "project": <project snapshot>, "description": <new text>, "idempotencyKey": <unique key> }`.
The project snapshot needs `id`, `user_id`, `status`, `updated_at`, and optional
`deleted`. Only pending personal tasks in draft/active projects are supported;
organization/workspace tasks are rejected. The supplied owner must be a DID,
and the output remains `authority: "unverified-snapshot"`. It returns the
bound request and before/after description for review. The CLI does not
execute this request or accept an actor/approval flag; authenticated desktop
execution must independently re-read ownership and the exact task version.

### `chainlesschain video <action>`

Video editing agent — long footage + music → montage (CutClaw-inspired): deconstruct, plan shots with an LLM, assemble via a ReAct editor loop, render with ffmpeg.

```bash
chainlesschain video edit --audio music.mp3 --instruction "fast-paced travel cut" --output out.mp4
chainlesschain video deconstruct --fps 2       # Frames + ASR + beat analysis (cached)
chainlesschain video plan --instruction "..."  # Generate shot_plan
chainlesschain video assemble --parallel --review   # Editor loop (+ VLM quality gate)
```

Notable `edit` options: `--srt` (skip ASR), `--character`, `--snap-beats`, `--ducking`, `--use-madmom`, `--concurrency <n>`, `--stream` (NDJSON progress), `--json`.

### `chainlesschain mtc <action>`

Merkle Tree Certificates — batch issuance & verification, plus Phase 3 federation MTCA (M-of-N member registry).

```bash
chainlesschain mtc batch                       # Tree + landmark + envelopes from leaves
chainlesschain mtc verify                      # Verify an envelope against a landmark
chainlesschain mtc landmark inspect            # Pretty-print a landmark file
chainlesschain mtc batch-dids                  # Batch from local DB DIDs
chainlesschain mtc batch-skills                # Batch from local CLI skills
chainlesschain mtc publish-skills              # Publish a skills batch
chainlesschain mtc serve                       # Serve landmarks/envelopes
chainlesschain mtc federation join <federation-id>
chainlesschain mtc federation status           # Registered federations + members
chainlesschain mtc federation invite <fed-id> <member-id>   # + vote / propose-revoke / rotate-key / fork / merge
```

### `chainlesschain multisig <action>`

M-of-N multi-signature proposals beyond MTC publisher_signature — per-domain policies, signature collection, finalization.

```bash
chainlesschain multisig propose <domain>       # Create proposal + sign as initiator
chainlesschain multisig sign <proposalId>      # Add a signature
chainlesschain multisig finalize <proposalId>  # Finalize once threshold reached
chainlesschain multisig list                   # List proposals
chainlesschain multisig show <proposalId>      # Detail with all signatures
chainlesschain multisig sweep                  # Expire past-deadline proposals
chainlesschain multisig policy show <domain>   # Per-domain M-of-N policy
chainlesschain multisig policy set <domain>
```

---

## Full Command Index

Every remaining top-level command not documented above, with its built-in description. Run `chainlesschain <command> --help` for subcommands and options.

| Command                        | What it does                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `activitypub` (alias `ap`)     | ActivityPub C2S bridge — actors, outbox/inbox, Follow/Create/Like/Announce                              |
| `agent-network` (alias `anet`) | Decentralized Agent Network — DID / registry / credentials / task routing (Phase 24)                    |
| `auto`                         | Alias root of `automation` (same workflow automation engine)                                            |
| `automation`                   | Workflow automation engine — 12 SaaS connectors + triggers (Phase 96)                                   |
| `codegen`                      | Code generation agent (Phase 86)                                                                        |
| `collab`                       | Collaboration governance — decisions, voting, autonomy levels, task assignment                          |
| `crosschain`                   | Cross-chain interoperability (Phase 89)                                                                 |
| `dbevo`                        | Database evolution & migration framework (Phase 80)                                                     |
| `dev`                          | Autonomous developer — dev sessions, ADRs, code review, refactor catalog                                |
| `did-v2` (alias `didv2`)       | Decentralized Identity 2.0 — W3C DID v2.0 + VP + social recovery + roaming (Phase 55)                   |
| `ecosystem` (alias `eco`)      | Plugin Ecosystem 2.0 — registry + deps + install + AI review + publish + revenue + recommend (Phase 64) |
| `federation`                   | Federation hardening system (Phase 58)                                                                  |
| `fusion`                       | Protocol fusion & AI social (Phase 72-73)                                                               |
| `governance`                   | Community governance — proposals, voting, impact analysis, prediction                                   |
| `incentive`                    | Token incentive — ledger accounts, transfers, contributions, leaderboard                                |
| `inference`                    | Decentralized inference network (Phase 67)                                                              |
| `infra`                        | Decentralized infrastructure (Phase 74-75)                                                              |
| `ipfs`                         | IPFS decentralized storage (Phase 17)                                                                   |
| `kg`                           | Knowledge graph — entities, relations, multi-hop reasoning, stats                                       |
| `marketplace`                  | Skill marketplace — publish skill services, record invocations, view stats                              |
| `multimodal` (alias `mm`)      | Multimodal collaboration (Phase 27)                                                                     |
| `nlprog`                       | Natural language programming system (Phase 28)                                                          |
| `ops`                          | Autonomous operations / AIOps                                                                           |
| `perception`                   | Multimodal perception engine (Phase 84)                                                                 |
| `perf`                         | Performance monitoring & auto-tuning (Phase 22)                                                         |
| `pipeline` (alias `pipe`)      | Development Pipeline Orchestration — 7-stage AI dev pipeline + gates + deploys (Phase 26)               |
| `privacy`                      | Privacy computing (Phase 91)                                                                            |
| `quantize`                     | Model quantization system (Phase 20)                                                                    |
| `recommend`                    | Smart content recommendation (Phase 48)                                                                 |
| `reputation` (alias `rep`)     | Reputation optimizer — observations, decay, anomaly detection, Bayesian optimization                    |
| `runtime`                      | Universal application runtime (Phase 63)                                                                |
| `sla`                          | Cross-org SLA management — contracts, metrics, violations, compensation                                 |
| `sso`                          | SSO enterprise authentication — SAML / OAuth2 / OIDC (Phase 14)                                         |
| `stress`                       | Federation stress testing — load simulation, bottleneck & capacity planning                             |
| `tech`                         | Tech Learning Engine — stack analysis, anti-pattern detection, practice store                           |
| `tenant`                       | Multi-tenant SaaS — tenants, usage metering, subscriptions, quotas                                      |
| `trust`                        | Trust & security (Phase 68-71)                                                                          |
| `autoagent`                    | Autonomous agent V2 governance (V2 governance, developer surface)                                       |
| `bm25`                         | BM25 Search V2 governance (V2 governance, developer surface)                                            |
| `ccron`                        | Cowork Cron V2 governance (V2 governance, developer surface)                                            |
| `compt`                        | Compression Telemetry V2 governance (V2 governance, developer surface)                                  |
| `consol`                       | Session Consolidator V2 governance (V2 governance, developer surface)                                   |
| `execbe`                       | Execution backend V2 governance (V2 governance, developer surface)                                      |
| `fflag`                        | Feature Flags V2 governance (V2 governance, developer surface)                                          |
| `itbudget`                     | Iteration Budget V2 governance (V2 governance, developer surface)                                       |
| `mcpscaf`                      | MCP Scaffold V2 governance (V2 governance, developer surface)                                           |
| `meminj`                       | Memory Injection V2 governance (V2 governance, developer surface)                                       |
| `orchgov`                      | Orchestrator V2 governance (V2 governance, developer surface)                                           |
| `pdfp`                         | PDF Parser V2 governance (V2 governance, developer surface)                                             |
| `perm`                         | Permission Engine V2 governance (V2 governance, developer surface)                                      |
| `permmem`                      | Permanent memory V2 — pin maturity + retention jobs (V2 governance, developer surface)                  |
| `planmode`                     | Plan Mode V2 governance (V2 governance, developer surface)                                              |
| `promcomp`                     | Prompt Compressor V2 governance (V2 governance, developer surface)                                      |
| `rcache`                       | Response cache V2 — profile maturity + refresh jobs (V2 governance, developer surface)                  |
| `router`                       | Agent router V2 governance (V2 governance, developer surface)                                           |
| `seshhook`                     | Session Hooks V2 governance (V2 governance, developer surface)                                          |
| `seshsearch`                   | Session Search V2 governance (V2 governance, developer surface)                                         |
| `seshtail`                     | Session Tail V2 governance (V2 governance, developer surface)                                           |
| `seshu`                        | Session Usage V2 governance (V2 governance, developer surface)                                          |
| `sganal`                       | Social Graph Analytics V2 governance (V2 governance, developer surface)                                 |
| `slotfill`                     | Slot Filler V2 governance (V2 governance, developer surface)                                            |
| `subagent`                     | Sub-agent registry V2 governance (V2 governance, developer surface)                                     |
| `svccont`                      | Service Container V2 governance (V2 governance, developer surface)                                      |
| `tms`                          | Task Model Selector V2 governance (V2 governance, developer surface)                                    |
| `todo`                         | Todo manager V2 governance (V2 governance, developer surface)                                           |
| `topiccls`                     | Topic Classifier V2 governance (V2 governance, developer surface)                                       |
| `uprof`                        | User Profile V2 governance (V2 governance, developer surface)                                           |
| `vcheck`                       | Version Checker V2 governance (V2 governance, developer surface)                                        |
| `webfetch`                     | Web Fetch V2 governance (V2 governance, developer surface)                                              |

Full reference: https://docs.chainlesschain.com/chainlesschain/cli.html

## Linux controlled-host permission authority

Trusted embeddings can explicitly provision and reopen durable settings and
scoped permissions through `chainlesschain/src/runtime/permission-authority-host.js`.
The host exposes pinned headless/streaming runtime entry points and official
settings/scoped writers. `cc agent controlled-host --launch <absolute-json>
--context <id> --sandbox-settings <absolute-json> --check` explicitly reopens a
pre-provisioned binding from its registered workspace. `--check` validates
identity/configuration without probing Docker or calling a model; `--prompt`
runs one task with fixed `dontAsk` after sandbox preflight. This opt-in Linux
entry does not enable automatic registration or Windows/macOS durable support.
See the [administrator setup and failure/stop-receipt contract](https://github.com/chainlesschain/chainlesschain/blob/main/docs/cli/NET02_CONTROLLED_HOST.md).

## License

MIT
