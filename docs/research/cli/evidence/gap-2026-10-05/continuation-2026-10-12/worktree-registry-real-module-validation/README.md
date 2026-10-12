# Real-module worktree registry validation with source drift

The recorded Vitest run passed 62 tests: 52 existing worktree tests and 10 new registry-read retry tests. This run imports real public modules and uses real temporary Git fixtures with selected subprocess fault injection; it remains supplementary local evidence, not a naturally reproduced Git race or a final-SHA release gate. The earlier extracted-function mock 10 are separate and are not included in this count.

Twelve source snapshots were captured. Eleven remained stable; the new test file changed from 00ab223f34e10f776a60855772e63c9e5f0fc6b15c0c7205a5bbbd8fd1bb7cf9 to 83921b021049893fa6f5ef561a3b782dcd2b2ab4a7ef242cdbd7bb580b480a57 during the run. A before snapshot is not a module-loader timestamp. Therefore the reported 10-test pass does not validate the final changed test bytes. The changed file requires one separate isolated hash-bound run; these receipts do not claim that rerun completed and do not require replaying the unchanged 52 tests.

Original stdout/stderr, reporter, process receipts, before/during/after source manifests, 12 initial snapshots and the changed snapshot are preserved. Full temp/fixture Git directories and Vite cache are excluded. Working HEAD changed from f116ef0f76492e127141f6ad4a514bf719987cf9 to ce0165e041e7115efd2c9254db1c73a0cc6164f0; no whole-tree source-binding claim is made.

Formal evaluation remains NOT_RUN, 0/36 and 0/9. No source, Git or provider action was performed by archival. See [summary.json](./summary.json) and [manifest.json](./manifest.json).
