import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isRobotStartupFailure,
  captureHostDiagnostics,
  createFakeCliEnvironment,
  findPluginArchive,
  verifyModelConfigurationFixtureLedger,
  verifyWorkbenchVisibilityMetrics,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_SLA_MS,
  WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MS,
  WORKBENCH_QUIESCENCE_STABLE_PROBES,
  WORKBENCH_READINESS_CONSECUTIVE_SAMPLES,
  WORKBENCH_READINESS_MAXIMUM_SAMPLES,
  WORKBENCH_READINESS_MINIMUM_SAMPLES,
} from "./run-ui-host-journey.mjs";

function diagnosticFixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "cc-jb-capture-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sandbox = path.join(root, "sandbox");
  const capture = path.join(root, "capture");
  mkdirSync(path.join(sandbox, "IC-2024.2", "log_runIdeForUiTests"), {
    recursive: true,
  });
  mkdirSync(capture);
  writeFileSync(
    path.join(capture, "host-events.jsonl"),
    JSON.stringify({
      schema: "chainlesschain.ui-event-diagnostic/v1",
      stage: "RECEIVED",
      type: "approval_request",
    }) + "\n",
  );
  return {
    root,
    sandbox,
    capture,
    logs: path.join(sandbox, "IC-2024.2", "log_runIdeForUiTests"),
  };
}

test("host capture preserves complete original IDE log bytes and rotations", (t) => {
  const fixture = diagnosticFixture(t);
  // Exceeds the generic diagnostic text tail limit and includes non-UTF8 bytes.
  const original = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.alloc(300_000, 65),
    Buffer.from("\r\n"),
  ]);
  writeFileSync(path.join(fixture.logs, "idea.log"), original);
  writeFileSync(path.join(fixture.logs, "idea.log.1"), "previous phase\r\n");
  const result = captureHostDiagnostics(fixture.sandbox, fixture.capture);
  assert.equal(result.complete, true);
  assert.equal(result.files.length, 3);
  const entry = result.files.find((file) => file.source?.endsWith("/idea.log"));
  assert.equal(entry.originalBytes, true);
  assert.equal(entry.bytes, original.length);
  assert.deepEqual(
    readFileSync(path.join(fixture.capture, entry.path)),
    original,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.capture, "capture-status.json")))
      .complete,
    true,
  );
});

test("diagnostic write failures never report a complete capture", (t) => {
  const fixture = diagnosticFixture(t);
  writeFileSync(path.join(fixture.logs, "idea.log"), "IDE log\n");
  const result = captureHostDiagnostics(
    fixture.sandbox,
    fixture.capture,
    "[cc-ui-event-diagnostic-write-failed] stage=RENDER_FAILED failureClass=java.io.IOException",
  );
  assert.equal(result.complete, false);
  assert.deepEqual(result.failures, ["event-diagnostic-write-failed"]);
});

test("missing idea.log is retained as a capture failure rather than success", (t) => {
  const fixture = diagnosticFixture(t);
  const result = captureHostDiagnostics(fixture.sandbox, fixture.capture);
  assert.equal(result.complete, false);
  assert.deepEqual(result.failures, ["original-idea-log-capture-failed"]);
});

test("canonical recovery isolates real CLI storage outside the log worktree", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-jb-isolation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = createFakeCliEnvironment(root, {
    CC_UI_CONVERSATION_RECOVERY: "1",
  });
  const canonical = environment.CC_UI_CANONICAL_ROOT;
  t.after(() => rmSync(canonical, { recursive: true, force: true }));
  assert.ok(path.isAbsolute(canonical));
  assert.notEqual(canonical, root);
  assert.equal(environment.CHAINLESSCHAIN_HOME, path.join(canonical, "home"));
  assert.equal(
    environment.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME,
    path.join(canonical, "security"),
  );
});

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

test("binds host evidence to the requested plugin archive even when old builds remain", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-jb-archive-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldArchive = path.join(root, "chainlesschain-ide-bridge-0.4.117.zip");
  const currentArchive = path.join(
    root,
    "chainlesschain-ide-bridge-0.4.118.zip",
  );
  writeFileSync(oldArchive, "old artifact");
  assert.equal(findPluginArchive(root, "0.4.118"), null);
  writeFileSync(currentArchive, "current artifact");
  assert.equal(findPluginArchive(root, "0.4.118"), currentArchive);
  assert.throws(
    () => findPluginArchive(root, "../../0.4.118"),
    /Invalid plugin archive version/,
  );
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

test("requires actual session replacement and restart after one confirmed model save", (t) => {
  const entries = [
    {
      command: "model-probe",
      probe: "journey:model:initial-before",
      sessionId: "saved-chat",
      processId: 100,
      processInstanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      model: "deterministic-host-peer",
    },
    {
      command: "llm-configure",
      model: "ui-config-model",
      visionModel: "ui-config-vision",
    },
    ...Array.from({ length: 3 }, () => ({
      command: "config-list",
      model: "ui-config-model",
    })),
    { command: "llm-test", model: "ui-config-model" },
    {
      command: "model-probe",
      probe: "journey:model:initial-after",
      sessionId: "saved-chat",
      processId: 101,
      processInstanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      model: "ui-config-model",
      visionModel: "ui-config-vision",
    },
    {
      command: "model-probe",
      probe: "journey:model:restart",
      sessionId: "saved-chat",
      processId: 102,
      processInstanceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      model: "ui-config-model",
      visionModel: "ui-config-vision",
    },
  ].map((entry) => ({ direction: "command", ...entry }));
  const trace = writeMetrics(t, entries);
  assert.equal(
    verifyModelConfigurationFixtureLedger(trace).existingSessionReload,
    true,
  );
  for (const [reusedIndex, originalIndex] of [
    [6, 0],
    [7, 6],
  ]) {
    const reusedPid = structuredClone(entries);
    reusedPid[reusedIndex].processId = reusedPid[originalIndex].processId;
    writeFileSync(
      trace,
      reusedPid.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    assert.equal(
      verifyModelConfigurationFixtureLedger(trace).existingSessionReload,
      true,
    );
  }
  for (const mutate of [
    (copy) => {
      copy[6].processInstanceId = copy[0].processInstanceId;
    },
    (copy) => {
      copy[7].processInstanceId = copy[6].processInstanceId;
    },
    (copy) => {
      delete copy[7].processInstanceId;
    },
    (copy) => {
      copy[6].processInstanceId = "";
    },
    (copy) => {
      copy[6].sessionId = "new-chat";
    },
    (copy) => {
      copy[7].model = "unsaved-must-not-apply";
    },
    (copy) => {
      copy[7].sessionId = "different-restored-chat";
    },
    (copy) => {
      copy.push({ ...copy[1] });
    },
    (copy) => {
      copy.splice(5, 1);
    },
  ]) {
    const copy = structuredClone(entries);
    mutate(copy);
    writeFileSync(trace, copy.map((entry) => JSON.stringify(entry)).join("\n"));
    assert.throws(
      () => verifyModelConfigurationFixtureLedger(trace),
      /Model configuration evidence/,
    );
  }
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
