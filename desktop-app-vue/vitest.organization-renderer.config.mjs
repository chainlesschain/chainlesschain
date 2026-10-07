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
      "src/renderer/components/projects/__tests__/organization-project-goal-acceptance-panel.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-goal-actions-panel.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-goal-periodic-panel.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-goal-panel.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-risk-panel.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-workbench.test.ts",
      "src/renderer/components/projects/__tests__/organization-project-transfer.test.ts",
      "src/renderer/components/projects/__tests__/project-task-description-journey.test.ts",
      "src/renderer/components/projects/__tests__/project-task-description-drawer.test.ts",
    ],
  },
});
