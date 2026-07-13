import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // e2e runs under its own config (vitest.e2e.config.js: singleFork → serial),
    // because e2e files spawn real `cc` children + bind real ports. Letting them
    // into this 2-fork parallel pool causes port collisions and shared-DB
    // contention (the "[AppConfig] is not valid JSON" / "malformed" flakes).
    // A bare `vitest run` / `npm test` therefore covers unit + integration only;
    // use `npm run test:e2e` (or `test:all`) for e2e. CI shards each suite
    // separately and passes the e2e config explicitly.
    exclude: [...configDefaults.exclude, "**/__tests__/e2e/**"],
    pool: "forks",
    forks: {
      maxForks: 2,
      minForks: 1,
    },
    // 90s testTimeout: vitest 4 honors testTimeout strictly (v3's hardcoded
    // 60s birpc heartbeat used to mask anything between testTimeout and the
    // heartbeat ceiling). Subprocess-heavy integration tests — MTC federation
    // governance + audit MTC + multisig (policy→propose→sign→consume/finalize)
    // end-to-end flows spawn many sequential `cc` CLI cold-starts; under the
    // 2-fork parallel load these legitimately exceed 60s and recurringly flaked
    // (crosschain-multisig / marketplace-multisig / multisig-cli / mtc-federation
    // — all pass isolated). Raised 60000 → 90000 to cover the whole family in one
    // place (local + CI shards both run integration on this base config); the
    // per-test `it("...", fn, 90000/120000)` overrides remain as defensive docs
    // of the heaviest flows. Unit tests share this budget but are fast, so the
    // only cost is a genuinely-hung unit test failing at 90s instead of 60s.
    // See internal handbook trap #31.
    // TEMP leak-hunt (forks-pool worker-death flake): fails any file that leaves
    // a ChildProcess/non-std socket handle pinning the worker. Remove after.
    setupFiles: ["./__tests__/_leak-detector.mjs"],
    testTimeout: 90000,
    hookTimeout: 120000,
    // teardownTimeout governs how long vitest's pool waits for a worker to
    // GRACEFULLY stop before it logs "Timeout terminating <pool> worker for
    // test files X" and force-terminates it — the force path then trips an
    // unhandled "Worker exited unexpectedly" and fails the whole shard even
    // though every test passed (vitest cli-api pool: setTimeout(…,
    // teardownTimeout) racing runner.stop()). The real-subprocess + real-socket
    // suites (background-agent-supervisor / background-session-transport spawn
    // detached `node` workers and bind POSIX domain sockets / named pipes)
    // drain in <1s unloaded, but under the 2-fork parallel CI load the worker's
    // event-loop teardown (child reaping + socket close under contention) has
    // recurringly exceeded the 10s DEFAULT — the "forks-pool worker-death"
    // flake (unit shard 2/4 on ubuntu+macos). Raised 10000 → 30000, same
    // rationale as the testTimeout/hookTimeout bumps above. A genuinely hung
    // worker now surfaces at 30s instead of 10s — an acceptable trade for
    // killing a false-red shard.
    teardownTimeout: 30000,
  },
});
