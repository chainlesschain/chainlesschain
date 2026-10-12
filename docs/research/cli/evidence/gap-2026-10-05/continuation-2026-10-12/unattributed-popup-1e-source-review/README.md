# Unattributed popup source review and local validation

Candidate 1e0272fb491db46c3b46eb03170b67bb7136d132 is reviewed separately from baseline 0c148cf927507280760dc91ab00db17c30588c01. Authorship remains unattributed. The change is UNPROVEN as a repair of the original popup failure; the successful 0c target-host result is not transferred to 1e.

All three local attempts are preserved: first, 5 existing diagnostics tests with 4 setup failures under system Temp; second, an init-script BOM failure before tasks; third, a writable workspace temp directory and 5 tests passing with zero failures/errors/skips. The first attempt performed Java compilation and the third reused up-to-date compilation. These are repeated executions of 5 existing cases, not 10 unique tests; they do not cover the added delayed handoff/currentness behavior.

Before/after receipts bind four reviewed source files to 1e. The recorded working HEAD advanced to 94da231; these receipts do not bind the whole tree or authorize the unknown change. Full raw logs, results, invocations, source receipts, JUnit/report files and source-review evidence are archived; disposable build/classes/tmp trees are omitted. No source, branch or release-helper identity was changed.

Formal evaluation remains NOT_RUN, 0/36 tasks and 0/9 first-run observations. This archive is not release approval. Duplicate source bytes are marked in the manifest and do not count as additional tests. See [summary.json](./summary.json) and [manifest.json](./manifest.json).
