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
    testTimeout: 90000,
    hookTimeout: 120000,
  },
});
