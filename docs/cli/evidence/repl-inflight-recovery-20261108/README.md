# Interactive REPL interrupted model request recovery

This Windows loopback journey uses the real CLI, readline, Evolution runtime, verified JSONL writer and HTTP transport. stdin.isTTY is emulated; this is **not an OS PTY test**. No paid provider or model download is used.

The first run failed before its initial prompt (no provider request). A direct agent import diagnosed missing CLI-local Ajv 2020 dependencies in the sparse worktree. Seven junctions reuse the existing installed dependencies; versions and realpaths are recorded in dependency-fixed/environment-receipt.json. This is not a verified clean lockfile installation.

The dependency-fixed run reached the actual crash window and failed: one model call remained started after SIGKILL, a new prompt made one distinct request, and known usage increased from 15 to 30 tokens. The old request was not replayed or falsely settled. Its prompt was absent from saved history and no recovery notice was shown. Scoped observability refused the unscoped session.

The product fix projects local model-call recovery from the same verified host sample as resumed messages, without granting observabilityScope authority. Startup now identifies interrupted callIds, says usage and cost remain unknown, warns the original prompt may not have been saved, and directs the user to inspect saved history and reconcile provider usage before explicitly resubmitting. It does not insert or replay the interrupted prompt.

Product-fixed and final-review-revised E2E: each 2 passed (real journey and strict notice matcher). The old call remains unknown before/after restart, new request count is 1, old replay count is 0, known tokens remain 15 then 30, and the scoped observability API still refuses this unscoped session. Final revision: seven model-free recovery contracts passed, including cross-provider/model/source/operation identity, invalid runtime token counts, and 20,000 settled historical calls retaining only one interrupted call. Settled calls are removed; unresolved calls are capped at 100,000 with fail-closed capacity refusal. telemetryComplete describes only recorded model-call evidence; billingComplete remains false. Existing host streaming, host consistency and causal-observability suites had 43 passes and one missing-workflow failure caused by sparse checkout; after materializing .github, the single failed workflow assertion passed (6 other tests skipped, not rerun).

Full pre-dispatch user-input durability, disk-full/write-failure windows, full OS PTY behavior, encrypted database installation, complete pricing/usage telemetry, cross-platform exact-source CI, and complete review item 4.3 acceptance remain outstanding. This local recovery projection is not a tenant authorization or complete pricing projection.

Raw first-red, dependency-fixed red, and product-fixed green bytes are retained separately. manifest.json binds artifacts and current execution/test sources. Raw source identities from the initial run remain in first-red/source-manifest.json. The first red did not test recovery behavior.

Final accurate-source regression after review: all 44 existing tests passed across the three suites. Final E2E binds seven production/shared-runtime/test source files before and after the run. The three-OS session-host workflow now runs both contracts and the actual loopback REPL journey; remote results remain pending.

Run the actual journey from packages/cli:
`npx vitest run --config vitest.e2e.config.js __tests__/e2e/repl-inflight-recovery-e2e.test.js`
Use the installed Vitest executable appropriate to the checkout; CC_REPL_INFLIGHT_ARTIFACT_DIR chooses a separate retained receipt directory.

The archive verifier checks final E2E exit 0, the original two-pass/non-skipped test report, and the actual recovery receipt (SIGKILL, same verified session, unknown original call, no replay, one distinct new call, monotonic known usage, actionable notice, incomplete billing assurance and retained scoped API refusal). A scratch copy with oldProviderReplays changed to 1 and its artifact hash recomputed was rejected by the behavioral checks; the original evidence was not changed. See raw/verifier-negative-result.json.
