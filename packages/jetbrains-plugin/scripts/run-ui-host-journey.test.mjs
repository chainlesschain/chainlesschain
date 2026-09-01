import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isRobotStartupFailure,
  verifyWorkbenchVisibilityMetrics,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_SLA_MS,
  WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MS,
  WORKBENCH_QUIESCENCE_STABLE_PROBES,
  WORKBENCH_READINESS_CONSECUTIVE_SAMPLES,
  WORKBENCH_READINESS_MAXIMUM_SAMPLES,
  WORKBENCH_READINESS_MINIMUM_SAMPLES,
} from "./run-ui-host-journey.mjs";

function readinessRecords(count = WORKBENCH_READINESS_MINIMUM_SAMPLES) {
  return Array.from({ length: count }, (_, index) => ({
    host: "jetbrains",
    metric: "needs-input-readiness",
    sample: index + 1,
    minimumSampleCount: WORKBENCH_READINESS_MINIMUM_SAMPLES,
    maximumSampleCount: WORKBENCH_READINESS_MAXIMUM_SAMPLES,
    latencyMs: 500,
    thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    consecutivePassingSamples: index + 1,
    requiredConsecutivePassingSamples: WORKBENCH_READINESS_CONSECUTIVE_SAMPLES,
  }));
}

function quiescenceRecord() {
  return {
    host: "jetbrains",
    metric: "workbench-quiescence",
    state: "done",
    dispatchEnabled: true,
    replyEnabled: false,
    stableProbes: WORKBENCH_QUIESCENCE_STABLE_PROBES,
    requiredStableProbes: WORKBENCH_QUIESCENCE_STABLE_PROBES,
    probeIntervalMs: WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MS,
  };
}

function measuredRecords() {
  return Array.from(
    { length: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT },
    (_, index) => ({
      host: "jetbrains",
      metric: "needs-input-visible",
      sample: index + 1,
      sampleCount: WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
      latencyMs: 101 + index,
      thresholdMs: WORKBENCH_NEEDS_INPUT_SLA_MS,
    }),
  );
}

function writeMetrics(testContext, records) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-jb-metrics-contract-"));
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  const metricsPath = path.join(root, "workbench-metrics.jsonl");
  writeFileSync(
    metricsPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  return metricsPath;
}

test("recognizes the UI test's Remote Robot startup timeout", () => {
  const error = new Error("Gradle UI smoke test failed");
  error.processOutput =
    "robot server at http://127.0.0.1:8082 did not come up within 180s";

  assert.equal(isRobotStartupFailure(error), true);
});

test("recognizes the host driver's Remote Robot startup timeout", () => {
  assert.equal(
    isRobotStartupFailure(
      new Error("Remote Robot did not become ready within 1200000ms"),
    ),
    true,
  );
});

test("recognizes an IDE process that exits during startup", () => {
  assert.equal(
    isRobotStartupFailure(
      new Error("sandbox IDE exited before Remote Robot became ready"),
    ),
    true,
  );
});

test("does not retry a real journey assertion failure", () => {
  assert.equal(
    isRobotStartupFailure(
      new Error("expected the approval card to be visible"),
    ),
    false,
  );
});

test("requires audited readiness and quiescence before 100 SLA samples", (t) => {
  const metricsPath = writeMetrics(t, [
    ...readinessRecords(),
    quiescenceRecord(),
    ...measuredRecords(),
  ]);

  assert.deepEqual(
    {
      samples: verifyWorkbenchVisibilityMetrics(metricsPath).samples,
      p95LatencyMs: verifyWorkbenchVisibilityMetrics(metricsPath).p95LatencyMs,
      thresholdMs: verifyWorkbenchVisibilityMetrics(metricsPath).thresholdMs,
      readinessSamples:
        verifyWorkbenchVisibilityMetrics(metricsPath).readinessSamples,
      quiescenceStableProbes:
        verifyWorkbenchVisibilityMetrics(metricsPath).quiescenceStableProbes,
    },
    {
      samples: 100,
      p95LatencyMs: 195,
      thresholdMs: 2_000,
      readinessSamples: 40,
      quiescenceStableProbes: 4,
    },
  );
});

test("rejects a measurement that starts before the quiescence proof", (t) => {
  const samples = measuredRecords();
  const metricsPath = writeMetrics(t, [
    ...readinessRecords(),
    samples[0],
    quiescenceRecord(),
    ...samples.slice(1),
  ]);

  assert.throws(
    () => verifyWorkbenchVisibilityMetrics(metricsPath),
    /readiness -> quiescence -> measurement/,
  );
});

test("rejects readiness records that continue after the stable condition", (t) => {
  const metricsPath = writeMetrics(t, [
    ...readinessRecords(WORKBENCH_READINESS_MINIMUM_SAMPLES + 1),
    quiescenceRecord(),
    ...measuredRecords(),
  ]);

  assert.throws(
    () => verifyWorkbenchVisibilityMetrics(metricsPath),
    /continued after readiness/,
  );
});
