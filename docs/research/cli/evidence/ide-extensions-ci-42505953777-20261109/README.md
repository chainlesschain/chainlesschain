# IDE Extensions CI readback (2026-11-09)

GitHub read-only verification of IDE Extensions workflow run `42505953777` found successful JetBrains real-host jobs for Linux, Windows, and macOS across IntelliJ 2024.2 and 2025.2. Each successful host job ran deterministic chat/control/resume and canonical recovery/Stop journey steps and uploaded host evidence. Browser evidence jobs also succeeded on all three systems.

The VS Code extension host gates were skipped in this run. The evidence is bound to older commit `4e4b421bfb42e524f071c9ad70c2a2a2ce607374`, so it strengthens the historical cross-platform IDE baseline without closing current-HEAD or VS Code bridge acceptance.
