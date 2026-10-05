import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/renderer/components/projects/__tests__/project-task-description-drawer.test.ts",
      "src/renderer/components/projects/__tests__/project-task-description-journey.test.ts",
    ],
  },
});
