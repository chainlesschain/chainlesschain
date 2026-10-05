import { fileURLToPath } from "node:url";

// Main-process capability contracts do not require a renderer or native modules.
export default {
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/main/enterprise/automation/__tests__/automation-engine.test.js",
      "src/main/enterprise/low-code/__tests__/app-builder.test.js",
      "tests/unit/enterprise/scim-sync.test.js",
      "tests/unit/enterprise/scim-ipc.test.js",
      "tests/unit/enterprise/capability-ipc.test.js",
    ],
  },
  resolve: {
    alias: {
      electron: fileURLToPath(
        new URL("./tests/__mocks__/electron.ts", import.meta.url),
      ),
    },
  },
};
