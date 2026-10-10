# 2026-10-10 diagnostic and Marketplace evidence

This directory preserves two independent observations. It does not replace earlier release evidence or turn a failed scheduler attempt into a pass.

## Scheduler original failure

scheduler-original/ is an exact copy of the frozen selection for source 73f5a3550d87db724f0c539223e671fd3ea6d1e1, run 38023140779, attempt 1. The original selection manifest and its 31 files retain their bytes and SHA-256 values. Windows and the aggregate failed; Linux and macOS passed. All three original artifact ZIPs are present and matched their official size and digest.

The Windows payload records a replacement worker losing its lease at the effect-boundary renewal. It does not retain the failed replacement worker timeline or that occurrence renewal history. The root cause remains unresolved. Historical source da91e730d802b7c9dcdc075b222ecc257021e552 passed run 38012166326; that result is context and does not replace the later failure. No failed workflow was rerun for this archive.

Original selection manifest SHA-256: e8cdca7b653321bb1214523fb0c3538571b245230e7e4a6e41fdd3c97a373b4f.

## JetBrains public approval increment

marketplace/pending/ retains the original 2026-10-10T04:08:47.086Z pending observation. marketplace/approved/ retains the subsequent 2026-10-10T04:50:36.494Z ready observation for version 0.4.158, update 1190815: approved, listed, and not hidden. Both bind source da91e730d802b7c9dcdc075b222ecc257021e552 and tag workflow 38021102825.

The public plugin ZIP, source plugin ZIP, enclosing GitHub artifact ZIP, CLI prerequisite artifact, raw metadata, and original readback receipts are included. The public and source ZIP container bytes differ. All four ZIP entries, including the two directory entries, have identical uncompressed bytes; marketplace/comparison.json records an independent local recheck. marketplace/manifest.json provides original source paths, selected targets, byte counts and SHA-256 values.

This public availability observation does not assert native/durable platform acceptance, a long-duration scheduler campaign, or resolution of the separate scheduler failure. Only archived local bytes were reverified here; no fresh publication or network verification was performed.
