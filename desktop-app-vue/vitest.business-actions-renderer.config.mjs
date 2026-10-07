import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/renderer", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/renderer/components/projects/__tests__/project-task-description-drawer.test.ts",
      "src/renderer/components/projects/__tests__/project-task-description-journey.test.ts",
      "src/renderer/components/projects/__tests__/project-risk-review-panel.test.ts",
      "src/renderer/components/projects/__tests__/project-goal-monitoring-panel.test.ts",
      "src/renderer/components/projects/__tests__/project-goal-actions-panel.test.ts",
      "src/renderer/components/projects/__tests__/project-goal-acceptance-panel.test.ts",
      "src/renderer/components/projects/__tests__/project-goal-memory-panel.test.ts",
      "src/renderer/stores/__tests__/auth.test.ts",
    ],
  },
});
