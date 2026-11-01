# CLI .137 repair evidence and .138 release follow-up

Current target: **CLI 0.166.138 / SDK 0.2.17 / Open VSX 0.37.174 / JetBrains 0.4.190**. The .137 final source passed every required CLI CI and Strict Sandbox job, but its OIDC run stopped before CLI upload because an SDK test changed without a version bump. Keep the .137 tag immutable; SDK runtime output is unchanged. New exact-source matrices and SDK → CLI → IDE publication/readback remain required. [Failure and authorization records](../evidence/release138-preparation/previous-release-failure.json). No further model cohort is started; the user waived five-task success.

The following records retain the .137 candidate and authorization scope.

The user now explicitly authorizes publication irrespective of the five task results: “不论5个任务是否成功都可以先发布”. This supersedes the earlier five-of-five release prerequisite; it does not change any test result. [Authorization and limits](publication-authorization.json).

The latest repaired-engine generation and independent acceptance completed at **0/5** on execution commit `a531924f367e60b61834aa8369634d0e241697b3`, with engine/project `5f372b3aa673c30bcd03b4da9ce8907992cb3386`. All **99/99** physical requests have complete usage; unknown usage is zero. Linux and JetBrains candidate tests pass behavioral checks, but those model tasks do not terminate successfully. Historical **41/45** remains unchanged and separate. [Unmodified third-round evidence](candidate-engine3-a531924f36/README.md).

The release contains original-task retention through canonical compaction, source-expression projection under ruleset v9, focused read-delivery accounting, and the prepared IDE diagnostics persistence changes. Strict JSON, nested data, sensitive ancestors and budgets remain enforced. Local source-expression regressions passed 430/430 and mocked agent-to-OpenAI wire checks passed 2/2; these engineering results do not rescore the five tasks. [Source repair](source-expression-repair/README.md).

Remaining limits include late independent-review scheduling and omitted unproven partial source fragments. The independent-review budget follow-up is preserved separately and is not included in this release. No claim is made that all model task failures are fixed.

CLI **0.166.137**, Open VSX **0.37.174** and JetBrains **0.4.190** are still pending publication. Complete final-commit CLI CI and Strict Sandbox remain mandatory before Actions OIDC publication. CLI registry readback must succeed before IDE tags are created. Microsoft Marketplace and PC/mobile are outside this release. The temporary OpenAI secret was deleted and absence verified.

The final CI follow-up corrects two omission fixtures that used valid JavaScript trailing commas. The negative controls now use duplicate JSON keys, which remain forbidden, and an explicit positive control checks real source delivery. Read guards and production runtime code are unchanged by this follow-up.

Earlier operator records and superseded release conditions are retained in [history](HISTORY-2026-11-01.md); each raw candidate round stays separate.
