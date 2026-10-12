# Popup diagnostic local validation

Diagnostic commit `0c148cf927507280760dc91ab00db17c30588c01` was prepared on `feature/jetbrains-popup-diagnostic-20261013`. It adds diagnostic observations; the popup failure is not established as fixed and its root cause remains undetermined. This is not a release SHA, a completed release gate, or a formal evaluation sample.

The four archived Java sources match both the source receipt and exact Git commit bytes. All nine handoff artifact hashes match. The successful isolated Gradle run compiled the UI tests; its JUnit XML contains 5 tests, 0 failures, 0 errors and 0 skipped. Direct javac completed successfully. The 32 assertion calls are a static source count, not runtime instrumentation.

The first Gradle attempt failed while deleting shared test-result output; its original result/stdout/stderr are preserved. The earlier incomplete javac attempt is also retained, followed by the successful complete invocation. Local compilation used the IntelliJ 2024.2 SDK and does not validate the failing Windows ARM64 IntelliJ 2026.2.0.1 host.

The preserved working.patch, receipt and associated two source snapshots are unadopted, unattributed workspace evidence. They are not attributed to any agent and are not used as the diagnostic commit's source receipt.

The archived GitHub run/job snapshot at 2026-10-12T16:51:23.462Z shows ARM64 run 38280050578 queued for this diagnostic SHA, with 2 jobs in progress and 4 queued. No job had a failure conclusion at that observation; the run was incomplete and this is not a pass. The release requires complete checks on its eventual final source SHA.

See [summary.json](./summary.json) and [manifest.json](./manifest.json). Every gzip object records compressed and original SHA256 hashes and byte lengths. Historical failure, preflight and release archives remain separate.
