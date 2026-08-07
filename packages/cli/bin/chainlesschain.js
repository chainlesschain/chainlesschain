#!/usr/bin/env node

// Keep the executable's static graph phase-0 only. runCli loads the process
// broker, telemetry, Event Runtime and one selected command after it has ruled
// out lightweight --version/help requests.
import { runCli } from "../src/lazy-dispatch.js";
import {
  recoverPendingNativeGeneration,
  reportPendingNativeUpdateResult,
} from "../src/lib/packer/native-update-state.js";

const nativeRecovery = recoverPendingNativeGeneration();
if (nativeRecovery?.requiresRestart) {
  process.exitCode = 75;
} else {
  reportPendingNativeUpdateResult();
  runCli(process.argv).catch(async (error) => {
    const { reportFatal } = await import("../src/lib/fatal-handler.js");
    reportFatal(error);
  });
}
