#!/usr/bin/env node
// Real local disk/lock queries only. No provider, user Memory, or IDE process.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createDurableMemoryFixture,
  summarizeDurations,
} from "./persistent-capacity-benchmark.mjs";
import { SegmentedMemoryPort } from "../src/lib/context-memory-kernel/segmented-memory-port.js";
import { CliCanonicalMemoryService } from "../src/lib/context-memory-kernel/memory-service.js";

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function measureMemoryStop(port, { delayMs = 10 } = {}) {
  const controller = new AbortController();
  const service = new CliCanonicalMemoryService({
    runtime: { memoryPort: port },
  });
  const started = performance.now();
  let deliveredAt;
  const delivered = new Promise((resolve) => {
    setTimeout(() => {
      deliveredAt = performance.now();
      controller.abort();
      resolve();
    }, delayMs);
  });
  let outcome = "completed",
    resultCount = null;
  try {
    const page = await service.listPage({
      category: "benchmark",
      limit: 20,
      signal: controller.signal,
    });
    resultCount = page.entries.length;
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    outcome = "aborted";
  }
  const settledAt = performance.now();
  await delivered;
  assert.equal(
    fs.existsSync(`${port.filePath}.lock`),
    false,
    "settled query retained its authority lock",
  );
  return {
    outcome,
    resultCount,
    scheduledStopMs: delayMs,
    queryMs: settledAt - started,
    stopDeliveryDelayMs: Math.max(0, deliveredAt - started - delayMs),
    stopAcknowledgementMs:
      outcome === "aborted" ? Math.max(0, settledAt - deliveredAt) : null,
    completedBeforeStopDeadline:
      outcome === "completed" && settledAt - started <= delayMs,
    lockReleased: true,
  };
}

export async function runMemoryResponsivenessBenchmark({
  counts = [1000, 10000, 100000],
  samples = 11,
} = {}) {
  assert.ok(
    counts.length > 0 &&
      counts.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 100000),
  );
  assert.ok(Number.isSafeInteger(samples) && samples > 0 && samples <= 100);
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-memory-responsiveness-"));
  const sourceFiles = [
    "../src/lib/context-memory-kernel/segmented-memory-port.js",
    "../src/lib/context-memory-kernel/durable-memory-port.js",
    "../src/lib/context-memory-kernel/memory-query-index.js",
    "../src/lib/context-memory-kernel/memory-service.js",
    "../src/lib/context-memory-kernel/memory-query-control.js",
    "../src/lib/context-memory-kernel/memory-shard-snapshots.js",
    "../src/lib/context-memory-kernel/memory-query-bundle.js",
    "../src/lib/with-file-lock.js",
    "../../context-memory-kernel/lib/runtime.js",
    "./memory-query-responsiveness-benchmark.mjs",
  ];
  const sources = () =>
    Object.fromEntries(
      sourceFiles.map((name) => [
        name,
        digest(fs.readFileSync(new URL(name, import.meta.url))),
      ]),
    );
  const report = {
    schema: "chainlesschain.memory-query-responsiveness/v1",
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      osRelease: os.release(),
    },
    sourceDigests: sources(),
    samplesPerCase: samples,
    providerCalls: 0,
    scope:
      "Disk-backed canonical Memory service listing with a 10 ms host Stop timer, authority locking, index validation and selected shard validation.",
    limitations: [
      "Local fixed hardware measurement, not cross-platform admission or a native IDE Stop journey.",
      "Timers measure event-loop delivery and acknowledgement separately; OS caches are not flushed.",
      "A query that completes before the Stop deadline requires no cancellation; late successful completion is reported as a failure of responsiveness.",
    ],
    target: {
      maximumStopDeliveryDelayMs: 500,
      maximumStopAcknowledgementMs: 500,
    },
    tiers: [],
  };
  try {
    for (const count of counts) {
      const filePath = path.join(root, `authority-${count}.json`);
      const state = createDurableMemoryFixture(count);
      await new SegmentedMemoryPort({ filePath }).importSnapshot(state);
      const original = fs.readFileSync(filePath);
      const modes = {};
      for (const queryIndexCacheMode of ["validate-disk", "verified-memory"]) {
        const port = new SegmentedMemoryPort({ filePath, queryIndexCacheMode });
        await port.listPage({ category: "benchmark", limit: 20 });
        const values = [];
        for (let i = 0; i < samples; i++)
          values.push(await measureMemoryStop(port));
        assert.deepEqual(
          fs.readFileSync(filePath),
          original,
          "query cancellation changed authority generation",
        );
        modes[queryIndexCacheMode] = {
          samples: values,
          stopDeliveryDelay: summarizeDurations(
            values.map((v) => v.stopDeliveryDelayMs),
          ),
          stopAcknowledgement: summarizeDurations(
            values
              .filter((v) => v.stopAcknowledgementMs !== null)
              .map((v) => v.stopAcknowledgementMs),
          ),
          acknowledged: values.filter((v) => v.outcome === "aborted").length,
          lateSuccessfulCompletion: values.filter(
            (v) => v.outcome === "completed" && !v.completedBeforeStopDeadline,
          ).length,
          targetMet: values.every(
            (v) =>
              (v.completedBeforeStopDeadline || v.outcome === "aborted") &&
              v.stopDeliveryDelayMs <= 500 &&
              (v.stopAcknowledgementMs ?? 0) <= 500,
          ),
          authorityUnchanged: true,
        };
      }
      report.tiers.push({ count, modes });
      process.stderr.write(
        `Memory Stop ${count}: ${JSON.stringify(Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, { acknowledged: value.acknowledged, targetMet: value.targetMet, deliveryP95: value.stopDeliveryDelay.p95Ms }])))}\n`,
      );
    }
    assert.deepEqual(
      sources(),
      report.sourceDigests,
      "implementation changed during measurement",
    );
    report.targetMet = report.tiers.every((tier) =>
      Object.values(tier.modes).every((mode) => mode.targetMet),
    );
    return report;
  } finally {
    if (
      path.dirname(path.resolve(root)) !== parent ||
      !path.basename(root).startsWith("cc-memory-responsiveness-")
    )
      throw new Error("unsafe benchmark cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      counts: { type: "string", default: "1000,10000,100000" },
      samples: { type: "string", default: "11" },
      output: { type: "string" },
      "require-cancellation": { type: "boolean", default: false },
    },
  });
  const report = await runMemoryResponsivenessBenchmark({
    counts: values.counts.split(",").map(Number),
    samples: Number(values.samples),
  });
  const raw = JSON.stringify(report, null, 2) + "\n";
  if (values.output) fs.writeFileSync(values.output, raw, { flag: "wx" });
  else process.stdout.write(raw);
  if (values["require-cancellation"] && !report.targetMet) process.exitCode = 1;
}
