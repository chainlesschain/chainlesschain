import { defineConfig } from "vitest/config";
import os from "node:os";

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
