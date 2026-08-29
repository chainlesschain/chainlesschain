import { fileURLToPath } from "node:url";

export default {
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/main/context-memory/__tests__/*.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-ipc-v3.test.js",
      "src/main/ai-engine/code-agent/__tests__/coding-agent-production-surface.test.js",
    ],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
  resolve: {
    alias: {
      electron: fileURLToPath(
        new URL("./tests/__mocks__/electron.ts", import.meta.url),
      ),
    },
  },
  server: {
    deps: {
      inline: [/src\/main\/.*/],
    },
  },
};
