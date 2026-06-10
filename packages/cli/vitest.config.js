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
    // 60s testTimeout: vitest 4 honors testTimeout strictly (v3's hardcoded
    // 60s birpc heartbeat used to mask anything between testTimeout and the
    // heartbeat ceiling). Subprocess-heavy integration tests — MTC federation
    // governance + audit MTC end-to-end flows that spawn multiple `cc` CLI
    // children — legitimately need >30s. Setting to 60000 covers them with
    // headroom; individual tests that need more can pass `it("...", fn, 120000)`.
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
