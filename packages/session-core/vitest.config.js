import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    pool: "forks",
    forks: { maxForks: 2, minForks: 1 },
  },
});
