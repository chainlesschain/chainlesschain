import { afterAll } from "vitest";
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
