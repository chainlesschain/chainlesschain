import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/main/notification/__tests__/notification-authority-ipc.test.js",
      "src/main/notification/__tests__/project-goal-notification-journey.test.js",
      "src/main/web-shell/__tests__/notification-handlers.test.js",
      "tests/unit/database/database-ipc.test.js",
    ],
  },
});
