# Current-HEAD cross-entry projection checks (2026-11-09)

The current `main` commit `99c8a598a0c6553f1273e365d90b557943c7a82f` passed the available deterministic model-input projection checks:

- CLI: four model-input/source-mapping suites, **52/52**.
- VS Code: `test/model-input-diagnostics.test.cjs`, **10/10**.

Both suites validate bounded allowlisted fields, session ownership, source mappings, stale-result rejection and command argument safety. This is local projection evidence only. JetBrains Gradle tests could not start because the local single-use Gradle daemon cannot accept localhost connections, so this artifact does not claim a live three-entry runtime or a complete IDE/desktop journey.
