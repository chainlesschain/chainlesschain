#!/usr/bin/env node
/** Explicit operator diagnostic; never runs a provider or a candidate suite. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runWindowsNativeEvaluatorCapabilities } from "../src/lib/process-execution-broker/windows-native-evaluator-capabilities.js";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: "string" },
      "wall-time-ms": { type: "string" },
      "probe-timeout-ms": { type: "string" },
      "confirm-native": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Probe ESM, workers and real child stdio/IPC in seven separate one-use zero-capability AppContainers/Jobs. No model or review task execution.\n--confirm-native --output NEW_ABSOLUTE_DIR [--wall-time-ms 15000 --probe-timeout-ms 1200]\nThe wall-time limit applies to each Job. A timeout continues only after confirmed cleanup and evidence validation. Exit 0 means complete diagnostic capture, including blocked probes; it does not mean full review readiness. Exit 2 means incomplete native diagnostic; incomplete stages are retained with their reason and bounded progress evidence. Each probe has its own evidence subdirectory.",
    );
    return 0;
  }
  if (
    values["confirm-native"] !== true ||
    !values.output ||
    !path.isAbsolute(values.output)
  )
    throw new Error(
      "--confirm-native and a new absolute --output directory are required",
    );
  const report = await runWindowsNativeEvaluatorCapabilities({
    evidenceDirectory: values.output,
    ...(values["wall-time-ms"] !== undefined
      ? { wallTimeMs: Number(values["wall-time-ms"]) }
      : {}),
    ...(values["probe-timeout-ms"] !== undefined
      ? { probeTimeoutMs: Number(values["probe-timeout-ms"]) }
      : {}),
  });
  console.log(
    JSON.stringify({
      schema: report.schema,
      diagnosticCompleted: report.diagnosticCompleted,
      fullReviewPackAssessed: false,
      formalSample: false,
      providerAssessed: false,
      capabilities: report.validation?.capabilities ?? {},
      probeResults: report.validation?.probeResults ?? [],
      attemptedProbes: report.runs.length,
      stoppedAfter: report.stoppedAfter ?? null,
      stageRetained: report.stageRetained,
      retentionReason: report.retentionReason ?? null,
      failureKind: report.failureKind ?? null,
      lastPhase: report.validation?.journal?.lastPhase ?? null,
      output: values.output,
    }),
  );
  return report.diagnosticCompleted ? 0 : 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Native capability diagnostic rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
