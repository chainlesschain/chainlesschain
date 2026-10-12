# Scheduler smoke scope and single diagnostic experiment

The final review approves 94da231 only as a CI smoke-profile correction, not a root-cause fix. The earlier stricter root-cause-fix admission review remains preserved here and in its original archive; it was not rewritten. This scope decision does not establish repair of the original 1000 ms failure.

One instrumented local Windows experiment used exact 1e source with the original 1000 ms lease, two rounds and eight steady occurrences. It completed in 47.7591625 seconds, with no retries and all reported invariants passing. The original CI failure was not reproduced, its underlying cause remains unknown, and no behavioral fix is proven. The 9 process traces contain 17423 recorded events and report zero dropped events; these are diagnostics, not independent test cases.

The original source.tar and 2222-file source receipt are preserved, together with scripts, observer patch, inputs, outputs, preflight failures and completed receipts, traces and dependency manifest. Independent archival verification re-read all 2222 snapshot files and 180 loaded dependency files and matched hashes; the source TAR hash also matches its receipt. Expanded source and dependency trees are not duplicated in this archive. This is byte-integrity evidence, not an entire-worktree Git-clean or hermetic dependency claim.

Formal evaluation remains NOT_RUN, 0/36 and 0/9. The eventual final release SHA still requires its complete exact-source gates. This archival step did not rerun the experiment, modify product sources, rewrite old archives or mutate Git. See [summary.json](./summary.json) and [manifest.json](./manifest.json).
