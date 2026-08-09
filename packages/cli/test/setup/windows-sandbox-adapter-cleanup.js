import { afterAll } from "vitest";
import { installWindowsSandboxAdapterTestCleanup } from "../helpers/windows-sandbox-adapter-cleanup.js";

if (process.platform === "win32") {
  const { resetWindowsSandboxAdapterCache } =
    await import("../../src/lib/process-execution-broker/platform-sandbox.js");
  installWindowsSandboxAdapterTestCleanup({
    registerAfterAll: afterAll,
    reset: resetWindowsSandboxAdapterCache,
  });
}
