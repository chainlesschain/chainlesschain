# Accessibility/performance contract checks (2026-11-09)

Current `main` commit `c98efe3f78c3c6a359375a4d1f101576070a24ee` passed the repository accessibility/performance gate unit suite:

`npx vitest run __tests__/unit/ide-roadmap-accessibility-performance.test.js --reporter=dot`

Result: **30/30**. These are deterministic validator and contract checks for accessibility tree/transcript, focus, performance evidence, diagnostics scale and provenance. They do not constitute a real VS Code/JetBrains host accessibility run, screen-reader session, upgrade/rollback test, or current-HEAD desktop journey.
