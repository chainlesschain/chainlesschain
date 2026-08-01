#!/usr/bin/env node
/** Cross-platform cold-process startup SLO check. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/chainlesschain.js", import.meta.url));
const startupHome = mkdtempSync(join(tmpdir(), "cc-startup-slo-"));
process.once("exit", () => {
  try {
    rmSync(startupHome, { recursive: true, force: true });
  } catch {
    // Benchmark results should not be masked by best-effort temp cleanup.
  }
});
const benchmarkEnv = {
  ...process.env,
  CHAINLESSCHAIN_HOME: startupHome,
  NODE_NO_WARNINGS: "1",
};
for (const name of [
  "CC_EVENT_RUNTIME_DURABLE",
  "CC_FORCE_CHCP",
  "DEBUG",
  "CC_DEBUG",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
]) {
  delete benchmarkEnv[name];
}
// With fewer than 20 samples a nearest-rank p95 degenerates to the single
// maximum and turns ordinary scheduler jitter into a false regression.
const samples = Math.max(5, Number(process.env.CC_STARTUP_SAMPLES) || 20);
const cases = [
  {
    name: "version",
    args: ["--version"],
    limitMs: Number(process.env.CC_STARTUP_VERSION_P95_MS) || 250,
  },
  {
    name: "root-help",
    args: ["--help"],
    limitMs: Number(process.env.CC_STARTUP_ROOT_HELP_P95_MS) || 300,
  },
  {
    name: "command-help",
    args: ["agent", "--help"],
    limitMs: Number(process.env.CC_STARTUP_COMMAND_HELP_P95_MS) || 400,
  },
  {
    name: "quick-status",
    args: ["status", "--json"],
    limitMs: Number(process.env.CC_STARTUP_STATUS_P95_MS) || 1000,
    validate: (stdout) => JSON.parse(stdout).probeMode === "quick",
  },
];

function run(entry) {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [bin, ...entry.args], {
    encoding: "utf8",
    env: benchmarkEnv,
    timeout: Math.max(5000, entry.limitMs * 4),
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(
      `${entry.name} exited ${result.status}: ${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
  if (entry.validate && !entry.validate(result.stdout)) {
    throw new Error(`${entry.name} returned an invalid payload`);
  }
  return elapsedMs;
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

const report = [];
let failed = false;
for (const entry of cases) {
  run(entry); // warm filesystem/module cache without counting the sample
  const durations = Array.from({ length: samples }, () => run(entry));
  const p95Ms = percentile95(durations);
  const passed = p95Ms <= entry.limitMs;
  failed ||= !passed;
  report.push({
    name: entry.name,
    samples,
    p95Ms: Number(p95Ms.toFixed(1)),
    limitMs: entry.limitMs,
    passed,
  });
}

process.stdout.write(
  `${JSON.stringify({ schema: "chainlesschain.startup-slo.v1", report }, null, 2)}\n`,
);
if (failed) process.exitCode = 1;
