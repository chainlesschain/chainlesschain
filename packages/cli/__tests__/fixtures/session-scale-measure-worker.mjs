import { performance } from "node:perf_hooks";

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1,
  );
  return ordered[index];
}

function rssMb() {
  const current = process.memoryUsage().rss / (1024 * 1024);
  const lifetimeMax = process.resourceUsage().maxRSS / 1024;
  return Math.max(current, lifetimeMax);
}

const [operation, home, subject, samplesText, limitText] =
  process.argv.slice(2);
if (!operation || !home || !subject) {
  throw new Error(
    "usage: session-scale-measure-worker <list|resume> <home> <subject> <samples> <limit>",
  );
}

process.env.CHAINLESSCHAIN_HOME = home;
const samples = parsePositiveInteger(samplesText, "samples");
const limit = parsePositiveInteger(limitText || "10", "limit");
const store = await import("../../src/harness/jsonl-session-store.js");

function invoke() {
  if (operation === "list") {
    const rows = store.listJsonlSessions({ limit });
    if (
      rows.length !== limit ||
      new Set(rows.map((row) => row.id)).size !== limit
    ) {
      throw new Error(`list returned ${rows.length} rows, expected ${limit}`);
    }
    if (rows[0]?.id !== subject) {
      throw new Error(
        `list returned unexpected newest session ${rows[0]?.id || "<none>"}`,
      );
    }
    return { resultCount: rows.length, ioMetrics: null };
  }
  if (operation === "resume") {
    const ioMetrics = { bytesRead: 0, readCalls: 0 };
    const messages = store.rebuildMessages(subject, { ioMetrics });
    if (
      messages.length !== 2 ||
      messages[0]?.content !== "bounded summary" ||
      messages[1]?.content !== "new turn"
    ) {
      throw new Error("resume did not rebuild the compact checkpoint suffix");
    }
    return { resultCount: messages.length, ioMetrics };
  }
  throw new Error(`unsupported operation: ${operation}`);
}

// Imports, ACL checks, and filesystem caches are deliberately outside the
// measured samples. The gate measures the canonical hot session operation,
// while the CLI cold-start SLO is owned by cli-startup-benchmark.
for (let index = 0; index < 3; index += 1) invoke();
global.gc?.();

const durationsMs = [];
const ioBytesRead = [];
const ioReadCalls = [];
let peakRssMb = rssMb();
for (let index = 0; index < samples; index += 1) {
  const started = performance.now();
  const measurement = invoke();
  durationsMs.push(performance.now() - started);
  if (measurement.ioMetrics) {
    ioBytesRead.push(measurement.ioMetrics.bytesRead);
    ioReadCalls.push(measurement.ioMetrics.readCalls);
  }
  global.gc?.();
  peakRssMb = Math.max(peakRssMb, rssMb());
}

process.stdout.write(
  `${JSON.stringify({
    operation,
    measurementScope: "canonical-store-hot-process",
    samples: durationsMs,
    p95Ms: percentile(durationsMs, 95),
    peakRssMb,
    ioBytesRead,
    ioReadCalls,
    maxIoBytesRead: ioBytesRead.length ? Math.max(...ioBytesRead) : null,
    maxIoReadCalls: ioReadCalls.length ? Math.max(...ioReadCalls) : null,
  })}\n`,
);
