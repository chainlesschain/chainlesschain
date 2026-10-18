import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
// Optional isolated test dependencies; ordinary workspace installs need no env.
const runtime = process.env.CC_BOARD_RENDERER_RUNTIME;
const require = createRequire(
  runtime ? path.join(runtime, "package.json") : import.meta.url,
);
const { default: vue } = await import(
  pathToFileURL(require.resolve("@vitejs/plugin-vue"))
);
const alias = [{ find: "@", replacement: path.join(root, "src/renderer") }];
if (runtime) {
  for (const [name, entry] of [
    ["vue", "vue/dist/vue.runtime.esm-bundler.js"],
    ["pinia", "pinia/dist/pinia.mjs"],
    ["vue-router", "vue-router/dist/vue-router.mjs"],
    ["dayjs", "dayjs/dayjs.min.js"],
    ["@vue/test-utils", "@vue/test-utils/dist/vue-test-utils.esm-bundler.mjs"],
  ])
    alias.push({
      find: new RegExp(`^${name}$`),
      replacement: path.join(runtime, "node_modules", entry),
    });
  // These modules are mocked by the route tests. Resolve them without installing
  // the full design system in an isolated renderer test runtime.
  alias.push({
    find: /^ant-design-vue$/,
    replacement: path.join(
      root,
      "src/renderer/pages/tasks/__tests__/notification-ant-stub.js",
    ),
  });
  alias.push({
    find: /^@ant-design\/icons-vue$/,
    replacement: path.join(
      root,
      "src/renderer/pages/tasks/__tests__/notification-icons-stub.js",
    ),
  });
}

export default {
  root,
  plugins: [vue()],
  resolve: { alias },
  test: {
    environment: "happy-dom",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/renderer/stores/__tests__/task-notifications.test.ts",
      "src/renderer/stores/__tests__/taskBoard.reports.test.ts",
      "src/renderer/stores/__tests__/taskBoard.controlled-update.test.ts",
      "src/renderer/stores/__tests__/goal-notifications.test.ts",
      "src/renderer/stores/__tests__/social.test.ts",
      "src/renderer/components/common/__tests__/task-notification-list.test.ts",
      "src/renderer/components/common/__tests__/goal-notification-list.test.ts",
      "src/renderer/pages/tasks/__tests__/task-notice-route.test.ts",
      "src/renderer/components/task/__tests__/board-attachments.test.ts",
      "src/renderer/components/task/__tests__/board-task-editor.test.ts",
      "src/renderer/components/task/__tests__/board-task-creator.test.ts",
      "src/renderer/components/task/__tests__/task-report-summary.test.ts",
      "src/renderer/components/task/__tests__/task-reports-panel.test.ts",
      "src/renderer/shell/__tests__/task-reports-panel-summary.test.ts",
    ],
  },
};
