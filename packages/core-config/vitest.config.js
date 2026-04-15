import { defineConfig } from "vitest/config";
import os from "node:os";

// Auto-scale based on CPU count: cores/2, clamped to [2, 4].
// Override with CC_VITEST_MAX_FORKS env var. CI may want minForks=1 to
// keep startup latency low when only a few files run.
const maxForks = Number(
  process.env.CC_VITEST_MAX_FORKS ||
    Math.min(4, Math.max(2, Math.floor((os.cpus()?.length || 2) / 2))),
);

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { maxForks, minForks: 1 } },
  },
});
