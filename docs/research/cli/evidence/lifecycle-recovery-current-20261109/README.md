# Current-HEAD lifecycle recovery evidence (2026-11-09)

Two offline current-HEAD integration suites passed on Windows `main` commit `eb3579908173f2f8f5da8075048c3c12b72282c0`:

- `npx vitest run --config vitest.e2e.config.js __tests__/e2e/compaction-memory-restart-e2e.test.js --reporter=dot`: 4/4.
- `npx vitest run --config vitest.config.js __tests__/integration/headless-side-effect-ledger-resume.test.js --reporter=dot`: 12/12.

The compaction suite covers independent-process Memory restart and recovery. The side-effect suite covers an interrupted dangerous operation, fail-closed ledger persistence/readback, clean completion, read-only operations, duplicate committed-effect detection, zero-duplicate correct resume, unknown background outcomes, and interaction recovery. These results close the local compaction and side-effect-idempotence sub-gates only. They do not prove dual-IDE recovery, concurrent input during restart, or a complete cross-entry task journey.
