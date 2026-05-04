import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
      // poolMatchGlobs below routes mtc-federation-governance-*-cli files
      // to the threads pool. Cap threads to a single worker so the three
      // split files run serially — they each spawn dozens of CLI children
      // and contend for ports / fork slots when run in parallel.
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 30000,
    hookTimeout: 120000,
    // Per-file pool override: route the long subprocess-heavy MTC federation
    // governance suites through worker_threads instead of forks. They spawn
    // dozens of `node bin/chainlesschain.js` children whose cumulative
    // wall-time blows past the birpc 60s onTaskUpdate heartbeat in a forks
    // pool (issue #4) — threads share memory with main, so the heartbeat
    // RPCs round-trip far quicker and don't time out. Tracked in vitest
    // upstream as #8297, fixed in v4.0.0; we are pinned to ^3.1.1.
    poolMatchGlobs: [["**/mtc-federation-governance-*-cli.test.js", "threads"]],
  },
});
