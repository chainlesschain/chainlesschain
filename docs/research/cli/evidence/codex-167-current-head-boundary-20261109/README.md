# Codex .167 source-drift boundary (2026-11-09)

The existing `.167.0` native receipt is bound to `e55e99ca22eda1f202d516e42ef306ee9cf28af6`. Current `main` contains later changes to the Codex App Server adapter/probe/history sources, so the historical native receipt is not promoted as current-HEAD native evidence. The repository has no local `.167` binary for a rerun; current HEAD has only static compatibility verification. The exact changed paths and commits are recorded in `receipt.json`.
