# Failed candidate test cancellations

Candidate `ff292775c4a032541fb50147d49dd353967be3b4` had a confirmed Windows ARM64 host failure. The original operation requested cancellation only for CLI CI 38274185415, Memory Query Index Measurement 38274511648 and CLI Background Interaction E2E 38274523267. These were non-publishing test workflows; cancellation does not establish a passed release gate.

Read-only follow-up at 2026-10-12T16:57:31.910Z:

- CLI CI 38274185415: completed / cancelled; CANCELLED_CONFIRMED.
- Memory Query Index Measurement 38274511648: completed / cancelled; CANCELLED_CONFIRMED.
- CLI Background Interaction E2E 38274523267: completed / cancelled; CANCELLED_CONFIRMED.

Original run/job responses, confirmed failure, cancellation request stdout/stderr and follow-up responses are preserved. No other run was cancelled by this archival work. A new final source SHA still requires its complete release matrices.

See [summary.json](./summary.json) and [manifest.json](./manifest.json) for source paths and compressed/original byte lengths and SHA256 hashes.
