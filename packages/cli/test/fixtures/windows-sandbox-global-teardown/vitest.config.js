import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(fixtureDirectory, "../../..");

export default defineConfig({
  root: cliRoot,
  test: {
    globals: true,
    globalSetup: [
      path.join(
        cliRoot,
        "test/fixtures/windows-sandbox-global-teardown/global-setup.js",
      ),
    ],
    include: [
      "./test/fixtures/windows-sandbox-global-teardown/contract-case.mjs",
    ],
    pool: "forks",
    forks: { singleFork: true },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
