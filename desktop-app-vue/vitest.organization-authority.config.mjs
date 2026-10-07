import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/main/task/__tests__/organization-project-goal-workflow-ipc.test.js",
      "src/main/task/__tests__/organization-project-goal-periodic-ipc.test.js",
      "src/main/task/__tests__/organization-project-goal-periodic-host.test.js",
      "src/main/task/__tests__/organization-project-goal-ipc.test.js",
      "src/main/task/__tests__/organization-project-goal-host.test.js",
      "src/main/task/__tests__/project-goal-monitoring-host.test.js",
      "src/main/task/__tests__/project-goal-ipc.test.js",
      "src/main/task/__tests__/organization-project-risk-ipc.test.js",
      "src/main/task/__tests__/organization-project-authority-host.test.js",
      "src/main/task/__tests__/organization-project-ipc.test.js",
      "src/main/task/__tests__/organization-project-transfer-ipc.test.js",
      "src/preload/__tests__/legacy-ipc-policy.test.js",
      "src/main/task/__tests__/task-description-ipc.test.js",
      "src/main/permission/__tests__/approval-workflow-manager.test.js",
    ],
  },
});
