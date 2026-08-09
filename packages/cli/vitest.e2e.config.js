import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ["./test/global-setup/windows-sandbox-adapter-temp-root.js"],
    setupFiles: ["./test/setup/windows-sandbox-adapter-cleanup.js"],
    testTimeout: 60000,
    hookTimeout: 30000,
    pool: "forks",
    forks: {
      singleFork: true,
    },
  },
});
