import { createProgressiveCanaryWatchdogFileStore } from "../../../src/lib/evolution/progressive-canary-watchdog-file-store.js";

const [rootDir, planDigest, hostId] = process.argv.slice(2);
const store = await createProgressiveCanaryWatchdogFileStore({
  rootDir,
  planDigest,
  hostId,
});
process.once("message", async (binding) => {
  try {
    const result = await store.incidentStore.reserve(binding);
    process.send({ type: "result", pid: process.pid, result }, () =>
      process.disconnect(),
    );
  } catch (error) {
    process.send({ type: "error", message: error.message }, () =>
      process.disconnect(),
    );
    process.exitCode = 1;
  }
});
process.send({ type: "ready", pid: process.pid });
