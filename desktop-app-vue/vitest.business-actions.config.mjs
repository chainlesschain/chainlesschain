import { defineConfig } from "vitest/config";

// Narrow main-process regression: actual SQLite, injected Electron UI boundary.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/main/task/__tests__/task-description-ipc.test.js",
      "src/main/task/__tests__/project-goal-ipc.test.js",
      "src/main/task/__tests__/project-goal-workflow-ipc.test.js",
      "src/main/task/__tests__/project-goal-completion-ipc.test.js",
      "src/main/task/__tests__/project-goal-monitoring-host.test.js",
      "src/main/task/__tests__/project-goal-auth-session.test.js",
      "tests/unit/ukey/ukey-ipc.test.js",
      "src/preload/__tests__/legacy-ipc-policy.test.js",
      "src/main/ipc/__tests__/ipc-sender-guard.test.js",
    ],
  },
});
