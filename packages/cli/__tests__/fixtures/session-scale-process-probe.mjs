import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const output = String(process.env.CC_SESSION_SCALE_PROBE_OUTPUT || "").trim();
const started = performance.now();
let written = false;

function peakRssMb() {
  const current = process.memoryUsage().rss / (1024 * 1024);
  const lifetimeMax = process.resourceUsage().maxRSS / 1024;
  return Math.max(current, lifetimeMax);
}

function writeProbe() {
  if (written || !output) return;
  written = true;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify({
      schema: "cc-cli-session-scale-process-probe/v1",
      pid: process.pid,
      durationMs: performance.now() - started,
      peakRssMb: peakRssMb(),
    })}\n`,
    "utf8",
  );
}

process.once("beforeExit", writeProbe);
process.once("exit", writeProbe);
