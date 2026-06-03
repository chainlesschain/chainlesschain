import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
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
