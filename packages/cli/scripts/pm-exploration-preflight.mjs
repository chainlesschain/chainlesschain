#!/usr/bin/env node
// Read-only diagnostics. Never launches Electron, calls a model or saves config.
import { parseArgs } from "node:util";
import {
  buildPmExplorationLaunchProfile,
  inspectPmExplorationEnvironment,
} from "../src/lib/evolution/pm-exploration-benchmark.js";

try {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      profile: { type: "boolean" },
      "max-tokens": { type: "string" },
      "max-tool-calls": { type: "string" },
      "max-wall-clock-ms": { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "PM exploration preflight (read-only; no runtime or promotion approval).\n" +
        "No options: inspect current process environment; exit 2 until a trusted host is integrated.\n" +
        "--profile --max-tokens N --max-tool-calls N --max-wall-clock-ms N: print requested launch profile; does not apply it.\n" +
        "Exit 0: help/profile generated; 1: invalid arguments; 2: runtime evidence missing.",
    );
  } else if (values.profile) {
    console.log(
      JSON.stringify(
        buildPmExplorationLaunchProfile({
          maxTokens: Number(values["max-tokens"]),
          maxToolCalls: Number(values["max-tool-calls"]),
          maxWallClockMs: Number(values["max-wall-clock-ms"]),
        }),
        null,
        2,
      ),
    );
  } else {
    if (Object.keys(values).length)
      throw new Error("budget arguments require --profile");
    console.log(JSON.stringify(inspectPmExplorationEnvironment(), null, 2));
    process.exitCode = 2;
  }
} catch {
  console.error(
    "Invalid PM preflight input; use --help. No configuration was changed.",
  );
  process.exitCode = 1;
}
