# Current HEAD Codex 0.167 native history reruns (2026-11-09)

The official Windows x64 Codex CLI 0.167.0 database scope passed on current HEAD 95a91f29ae01a11732873b7ab13c3c8f3fc6b76d. The probe verified process restart, same-second thread pagination, settings restoration, retained context after resume, and no replay of a completed request.

The strict scan-repair scope was also run on the same native binary. Its first cold ascending scan failed closed because the upstream first page exposed one of two known identities. The probe retained that failure and continued independent observations: later recency_at ascending and descending rollout scans both returned complete identities and verified pagination/order. The first cold-scan omission remains an open compatibility boundary and is not promoted by later repair observations.

The provider is a synthetic loopback fixture; real-provider admission and Linux/macOS native coverage remain open.
