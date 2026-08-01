#!/usr/bin/env node

// Keep the executable's static graph phase-0 only. runCli loads the process
// broker, telemetry, Event Runtime and one selected command after it has ruled
// out lightweight --version/help requests.
import { runCli } from "../src/lazy-dispatch.js";

runCli(process.argv).catch(async (error) => {
  const { reportFatal } = await import("../src/lib/fatal-handler.js");
  reportFatal(error);
});
