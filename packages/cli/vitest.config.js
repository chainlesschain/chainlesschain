import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
