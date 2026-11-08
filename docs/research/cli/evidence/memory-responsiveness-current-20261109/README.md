# Current HEAD Memory responsiveness rerun (2026-11-09)

The current local disk-backed Memory responsiveness benchmark ran counts 1,000, 10,000, and 100,000 with three samples per cache mode (`validate-disk` and `verified-memory`). All 18 measured queries acknowledged the 10 ms Stop timer, released the authority lock, and met the benchmark's 500 ms delivery/acknowledgement targets. This is a fixed Windows local benchmark with warm OS caches and no provider, IDE, cross-platform, or production SLO claim.
