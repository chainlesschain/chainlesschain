# Current-main Volcengine project-goal task boundary (2026-11-09)

The live runner was extended with a restricted `--output-dir` so a current-main run cannot overwrite the historical evidence directory. Using the authorized key only through the process environment, the first synthetic task scenario failed **before provider dispatch**: `dispatchAttempts` is `0`, and the runner stopped after one case. The runner intentionally withholds raw errors, so the receipt records `LIVE_CHECK_FAILED` without claiming a provider or model failure.

This is failure-localization evidence for the current desktop model-ingress/fixture boundary. It is not task acceptance; the independent real-provider task matrix remains open, and no provider request was admitted in this run.

The pre-dispatch boundary was independently reproduced: Node 22.20.0 reported `ERR_DLOPEN_FAILED` because the installed `better-sqlite3` binary used Node module ABI 137 while Node 22 requires ABI 127. The same fixture under Node 24.12.0 admitted the provider task matrix and passed 2/2. This distinguishes a local runtime/fixture incompatibility from provider or task failure without persisting raw errors.
