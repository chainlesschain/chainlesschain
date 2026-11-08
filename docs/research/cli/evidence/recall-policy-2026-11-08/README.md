# Recall policy and diagnostic Stop evidence — 2026-11-08

This archive binds a local, uncommitted source snapshot based on `7c5d559255070f9ad1e23c454a616091899c7c29`. It records the REPL recall-option fix and cancellation of waits on model-input diagnostic observers. It does not grant results to a later commit or replace prior evidence archives. The manifest identifies every archived report and the 11 selected source files by exact byte length and SHA-256.

## Results and retained failures

| Evidence                                   | Result                                 | Interpretation                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REPL baseline                              | 1 passed, 1 failed                     | With `--no-recall-memory`, three actual loopback provider requests still contained old, replacement, then replacement Memory after restart.                                                                       |
| Final verified REPL run                    | 2 passed                               | Preserved original final report; it contains test outcomes, not individual successful request receipts.                                                                                                           |
| Final recorded REPL run and JSONL receipts | 2 passed, 2 receipts                   | Default recall follows old → new → new; disabled recall contains neither marker in all three requests. Both cases verify JSONL before and after restart.                                                          |
| Diagnostic Stop baseline                   | 12 passed, 3 failed                    | Pending logical-input, request-body and formal-scope observers did not release their callers promptly on cancellation.                                                                                            |
| Intermediate diagnostic run                | 45 passed, 1 failed                    | An old snapshot-positive test expected a pre-aborted request to reach a fake transport. It was replaced with a non-aborted snapshot positive and a separate pre-aborted rejection case. This failure is retained. |
| Related suite with original PATH           | 597 passed, 2 failed                   | Existing direct Bash tests selected unavailable WSL `/bin/bash`. The original environment failure is retained.                                                                                                    |
| Final related suite                        | 23 files, 599 passed, 0 skipped        | Only this test invocation's PATH selected installed Git Bash; no machine-global configuration or existing Bash-test expectations were changed.                                                                    |
| Budget TAP                                 | 108 passed, 0 skipped                  | Includes a held final-body observer cancelled by the transport's own 2-second timeout, without relying on a caller signal. No physical dispatch occurs; reserved exposure remains unknown.                        |
| Static egress review                       | 89 classified, 78 call chains unmapped | Classification and selected source digests pass; full runtime containment remains unverified.                                                                                                                     |
| Web panel build                            | Completion recorded                    | Build output contains the completion/hash marker. Exit 0 was observed by the runner; the text log itself is not a signed exit receipt.                                                                            |

These are separate suites and reruns, with overlap; do not add their counts as unique coverage. The offline verifier checks every one of the 599 related test results, their correspondence to the 597/2 run, all 108 TAP `ok` records (including nested tests), the diagnostic boundary names, both REPL test results and actual red/green receipt contents. The TAP has 72 top-level results and 108 total tests. Original PowerShell UTF-16LE bytes are retained in gzip and decoded only for verification.

## What the tests establish

The REPL tests execute real CLI processes, Evolution, canonical Memory service/disk mutation, session persistence and provider transport against a synthetic loopback HTTP server. Each case makes two turns separated by an external delete/add, exits, then starts a new process with `--resume` for a third turn. The default case begins without a session argument; the disabled case creates an explicit session id. The production verified-transcript reader checks both persisted transcripts, which contain neither Memory marker. This demonstrates invocation recall policy and current Memory authority in these paths; it does not establish a stale legacy-body bypass, which was not reproduced.

Input `isTTY` and `setRawMode` are emulated solely to select the interactive branch. This is not an OS PTY acceptance test. The disabled flag is repeated on resume; there is no claim that the preference itself is persisted. The optional test receipt output contains synthetic markers as booleans, stages and counts, not raw prompts, credentials or full application call logs. An encrypted-database fallback warning, or its absence, does not establish encrypted SQLite installation.

Diagnostic cancellation covers held logical-input, request-body, formal-scope and late-rejection observers, plus pre-aborted requests and disabled-diagnostic compatibility. Cancellation releases the caller's wait and observes late outcomes; it does not forcibly terminate observer execution. An observer may continue its own work after cancellation. The budget timeout test preserves conservative unknown liability and prevents late dispatch rather than claiming zero incurred cost.

## Recheck offline

From the repository root:

```sh
node docs/research/cli/evidence/recall-policy-2026-11-08/verify-evidence.mjs
node docs/research/cli/evidence/recall-policy-2026-11-08/verify-evidence.mjs --check-current-sources
```

Default verification needs only this directory and Node built-ins, without executing archived source, tests, models or network calls. `--check-current-sources` additionally compares the 11 selected current files against their archived bytes; it does not require HEAD to remain the original parent after a later commit. Neither mode reruns the static scan or proves the complete dependency closure. Three static-review digest links are checked: the review catalogue and the two changed transport sources. Other classified source files are represented by the original scanner report, not independently reconstructed from this small snapshot.

No real paid-model admission, complete operating-system matrix, semantic-retrieval quality, performance SLO, production readiness, encrypted-database installation or complete dependency closure is established. Previous Memory performance results are not reassigned to this source snapshot. `paidReady` remains false.
