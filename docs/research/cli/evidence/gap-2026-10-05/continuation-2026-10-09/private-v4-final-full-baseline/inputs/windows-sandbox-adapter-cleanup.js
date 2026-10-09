import { afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installWindowsSandboxAdapterTestCleanup } from "../helpers/windows-sandbox-adapter-cleanup.js";

const previousPluginTransactionHome = process.env.CC_PLUGIN_TRANSACTION_HOME;
const isolatedPluginTransactionHome = previousPluginTransactionHome
  ? null
  : fs.mkdtempSync(path.join(os.tmpdir(), "cc-vitest-plugin-locks-"));
if (isolatedPluginTransactionHome) {
  process.env.CC_PLUGIN_TRANSACTION_HOME = isolatedPluginTransactionHome;
}

// A number of command-surface tests intentionally exercise non-zero CLI
// outcomes in-process.  `process.exitCode` belongs to the worker rather than
// the individual test, so a test that does not restore it can make Vitest
// itself exit non-zero after every assertion has passed.  Keep that process
// state isolated just like the temporary plugin transaction home below.
afterEach(() => {
  process.exitCode = undefined;
});

afterAll(() => {
  if (!isolatedPluginTransactionHome) return;
  delete process.env.CC_PLUGIN_TRANSACTION_HOME;
  fs.rmSync(isolatedPluginTransactionHome, { recursive: true, force: true });
});

if (process.platform === "win32") {
  const { resetWindowsSandboxAdapterCache } =
    await import("../../src/lib/process-execution-broker/platform-sandbox.js");
  installWindowsSandboxAdapterTestCleanup({
    registerAfterAll: afterAll,
    reset: resetWindowsSandboxAdapterCache,
  });
}
