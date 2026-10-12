# Windows Team worktree-registry failure

Exact source 1e0272fb491db46c3b46eb03170b67bb7136d132, run 38283485176, job 114926287459, completed only four of five tasks before the seven-start allowance was exhausted. An unexpected task-003 retry followed a missing .git/worktrees/.../locked read, consuming capacity before task-004 could start. The original clean-terminal assertion remains failed.

Captured Git 2.55.0.windows.5 source has an existence-check/read TOCTOU mechanism consistent with the observed ENOENT. No filesystem trace identifies the precise unlinking process or pre/post-add call, and no physical race was reproduced. This distinguishes source-supported mechanism from a runtime causal trace.

The pre-existing working patch was unattributed to the capturing session at capture time; it was prepared by the PR maintenance Astra agent and reviewed by root. Ten isolated VM/mock controls compare extracted captured old/new read functions with mocked subprocess results; all passed. They are not the normal product Vitest suite or a real race reproduction. Later source-bound Vitest and existing-unit results must be recorded separately and must not overwrite these originals or inflate the mock count.

The original failure log, artifact, API/source snapshots, unknown working diff and mock receipts are retained with verified hashes. No product or Git change, workflow rerun or paid request was made during archival. Formal evaluation remains NOT_RUN, 0/36 and 0/9. See [summary.json](./summary.json) and [manifest.json](./manifest.json).
