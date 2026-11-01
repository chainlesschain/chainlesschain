# Exact-release CI fixture follow-up

CLI CI on a531924f367e60b61834aa8369634d0e241697b3 found two old omission fixtures using valid JavaScript trailing commas. Under the repaired source-expression rules these must be delivered, so the fixtures no longer exercised omission. Their negative inputs now use duplicate JSON keys, which remain forbidden. A positive control confirms valid trailing-comma source is delivered and its exact span counted. Production read guards and source-expression rules are unchanged.

The focused suite passes **36/36**. This is supplementary engineering validation; the final release commit still requires the complete Linux, Windows and macOS CLI CI and Strict Sandbox matrices.

The user explicitly waived the five-task success prerequisite. Third-round model acceptance remains 0/5; historical 41/45 remains separate. Review-budget follow-up code is deferred, backed up outside this release tree and not included here.
