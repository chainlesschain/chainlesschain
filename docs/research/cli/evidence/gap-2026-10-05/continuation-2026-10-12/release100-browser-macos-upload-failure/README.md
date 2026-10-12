# macOS browser evidence upload failure

At source `ff292775c4a032541fb50147d49dd353967be3b4`, Browser evidence (macos), job 114899117033 in run 38274184713, failed while uploading Workbench evidence. The original full log reports 12 files found and valid artifact name/root, followed by CreateArtifact ENOTFOUND. The observed failure is DNS name resolution; the failed hostname, retries and any transient or underlying cause are not established.

The Workbench product step succeeded. Its evidence upload failed, and the subsequent two-origin browser journey and browser-fragment upload were skipped. Those missing steps and artifacts are not counted as passed, and the release gate remains failed. No product or workflow change is included here.

All 23 supplied manifest entries are preserved with verified hashes, together with that manifest. Both selected artifact ZIPs match GitHub API digests. The Linux Workbench ZIP is contextual evidence and does not substitute for missing macOS coverage.

Access records remain distinct: job.log is the original HTTP 403 error body; run-logs.zip is an HTTP 404 error body, not a ZIP. The complete successful log is job-log-cachebust.txt; that log and both selected ZIPs were obtained using authorized require_escalated read-only execution. No HTTP 401 original was present among the supplied 23 files.

See [summary.json](./summary.json) and [manifest.json](./manifest.json). The original diagnosis is preserved as evidence; its conditional suggestions are not adopted changes or proven root causes.
