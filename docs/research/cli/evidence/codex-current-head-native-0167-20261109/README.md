# Current HEAD Codex 0.167 native rerun (2026-11-09)

The locally available official Windows x64 Codex `0.167.0` binary was rerun against current `main` commit `8c4ae22975c661813120fb728404145e848fad16` with the repository's current App Server adapter and probes. The turn scope passed completed, failed, interrupted, approval cancellation, interleaved threads, and post-admission transport loss. The database history scope passed process restart, same-second thread pagination, settings restoration, and no replay of a completed request.

The strict `scan-repair` scope remains a negative boundary: the first cold ascending rollout scan returned one of two known identities and failed closed; later repair observations were retained but did not promote the incomplete first scan. The binary and receipts are current-HEAD bound. The provider is synthetic loopback, so `realProviderAcceptance:false` and `productionAdmission:false` remain explicit.
