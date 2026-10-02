import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNativeTranscriptEvidence,
  verifyNativeTranscriptEvidence,
} from "./native-transcript-evidence.mjs";

// Synthetic documents validate the verifier only; never host performance evidence.
function fixture() {
  const snapshot = (selected = false) => ({
    selectionStart: selected ? 20 : 0,
    selectionEnd: selected ? 32 : 0,
    selectedText: selected ? "abcdefghijkl" : "",
    viewportY: 0,
    viewportHeight: 400,
    paneHeight: 800,
    documentLength: 1000,
    caretPosition: selected ? 32 : 0,
    bottomSlop: 24,
    followingBottom: false,
  });
  return {
    schema: "cc-jetbrains-native-transcript/v1",
    profile: "installed-plugin-native-swing",
    instrumentation: "ui-test-reflection",
    paintMode: "visible-region-paintImmediately",
    longTaskScope: "sampled-probe-edt-tasks",
    timingDomain: "jvm-System.nanoTime",
    chromiumFrames: false,
    sloStatus: "not-evaluated",
    headless: false,
    readiness: {
      initialProbesStarted: true,
      fixtureVersionObserved: true,
      onboardingObserved: true,
      draftReady: true,
      inputEditable: true,
      historyIdle: true,
      turnIdle: true,
      sessionAbsent: true,
      paneShowing: true,
      ready: true,
      conversationId: "isolated-probe-tab",
      documentChars: 115,
    },
    processId: "42",
    javaVersion: "21.0.8",
    osName: "Test OS",
    osArch: "amd64",
    ideVersion: "2024.2.4",
    ideBuild: "IC-242.1",
    runToken: "abcdef00-0000-4000-8000-000000000000",
    startedAt: "2026-10-03T01:00:00.000Z",
    finishedAt: "2026-10-03T01:00:10.000Z",
    periodMs: 16,
    longTaskThresholdMs: 50,
    status: "measured",
    cases: [10_000, 100_000, 200_000].map((requestedChars) => ({
      requestedChars,
      sampleCount: 64,
      allSamplesOnEdt: true,
      allSamplesShowing: true,
      samples: Array.from({ length: 64 }, (_, i) => ({
        ordinal: i + 1,
        appendedChars:
          Math.floor(((i + 1) * requestedChars) / 64) -
          Math.floor((i * requestedChars) / 64),
        updateMs: 2,
        paintMs: 3,
        taskMs: i === 63 ? 60 : 6,
        intervalMs: 20,
        queueDelayMs: 4,
      })),
      followingBeforeSelection: snapshot(),
      selectionBefore: snapshot(true),
      selectionAfter: snapshot(true),
      scrollBefore: snapshot(),
      scrollAfter: snapshot(),
      followingAfterResume: snapshot(),
      streamedChars: requestedChars,
      retainedChars: requestedChars - 32,
      capApplied: true,
      plainBeforeFinalize: true,
      finish: {
        activeBefore: true,
        beforeLength: requestedChars,
        updateMs: 15,
        paintMs: 5,
        taskMs: 30,
        finalizeCalls: 1,
        markdownParseCalls: null,
        markdownParseInstrumentation: "not-instrumented",
        activeAfter: false,
        afterLength: requestedChars - 200,
        boldAfterFinalize: true,
      },
    })),
  };
}

test("recomputes native timing metrics from strict disk readback without granting an SLO pass", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-native-metrics-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "metrics.json");
  writeFileSync(file, JSON.stringify(fixture()));
  const result = verifyNativeTranscriptEvidence(file, {
    processId: 42,
    ideVersion: "2024.2",
  });
  assert.equal(result.sloStatus, "not-evaluated");
  assert.equal(result.longTaskScope, "sampled-probe-edt-tasks");
  for (const value of result.cases) {
    assert.equal(value.updateP95Ms, 2);
    assert.equal(value.paintP95Ms, 3);
    assert.equal(value.timerIntervalP95Ms, 20);
    assert.equal(value.queueDelayP95Ms, 4);
    assert.equal(value.sampledLongTaskCount, 1);
    assert.equal(value.longestSampledTaskMs, 60);
    assert.equal(value.sampledEdtTasks, 65);
    assert.equal(value.visibleRegionPaintRequests, 65);
    assert.equal(value.selectionPreserved, true);
    assert.equal(value.markdownParseCalls, null);
  }
});

test("rejects wrong-host, headless, incomplete, reordered, forged and unsafe metrics", () => {
  const mutations = [
    (v) => {
      v.headless = true;
    },
    (v) => {
      v.chromiumFrames = true;
    },
    (v) => {
      v.profile = "headless-swing-unit";
    },
    (v) => {
      v.sloStatus = "passed";
    },
    (v) => {
      v.apiKey = "forbidden";
    },
    (v) => {
      v.cases.pop();
    },
    (v) => {
      v.cases.reverse();
    },
    (v) => {
      v.cases[0].samples.pop();
    },
    (v) => {
      v.cases[0].samples.reverse();
    },
    (v) => {
      v.cases[0].allSamplesOnEdt = false;
    },
    (v) => {
      v.cases[0].allSamplesShowing = false;
    },
    (v) => {
      v.cases[0].samples[0].paintMs = "3";
    },
    (v) => {
      v.cases[0].samples[0].taskMs = -1;
    },
    (v) => {
      v.cases[0].samples[0].queueDelayMs = 0;
    },
    (v) => {
      v.cases[0].samples[0].appendedChars++;
    },
    (v) => {
      v.cases[0].finish.markdownParseCalls = 1;
    },
    (v) => {
      v.cases[0].finish.finalizeCalls = 2;
    },
    (v) => {
      v.cases[0].selectionBefore.selectedText = "";
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertNativeTranscriptEvidence(value));
  }
  assert.throws(() =>
    assertNativeTranscriptEvidence(fixture(), { processId: "41" }),
  );
  assert.throws(() =>
    assertNativeTranscriptEvidence(fixture(), { ideVersion: "2025.2" }),
  );
});

test("retains measured selection and scroll regressions as failures of behavior, not lost observations", () => {
  const value = fixture();
  value.cases[0].selectionAfter.selectedText = "";
  value.cases[0].selectionAfter.selectionEnd =
    value.cases[0].selectionAfter.selectionStart;
  value.cases[0].selectionAfter.viewportY = 30;
  value.cases[0].scrollAfter.viewportY = 40;
  const result = assertNativeTranscriptEvidence(value);
  assert.equal(result.cases[0].selectionPreserved, false);
  assert.equal(result.cases[0].selectionViewportPreserved, false);
  assert.equal(result.cases[0].userScrollPreserved, false);
  assert.equal(result.sloStatus, "not-evaluated");
});

test("rejects the observed 115-character onboarding interference instead of accepting contaminated timing", () => {
  const value = fixture();
  value.cases[0].retainedChars = value.cases[0].streamedChars + 115;
  assert.throws(
    () => assertNativeTranscriptEvidence(value),
    /concurrent-transcript-mutation/u,
  );
});

test("requires observed initialization and idle state before any native measurement", () => {
  for (const key of [
    "initialProbesStarted",
    "fixtureVersionObserved",
    "onboardingObserved",
    "draftReady",
    "inputEditable",
    "historyIdle",
    "turnIdle",
    "sessionAbsent",
    "paneShowing",
    "ready",
  ]) {
    const value = fixture();
    value.readiness[key] = false;
    assert.throws(
      () => assertNativeTranscriptEvidence(value),
      /native readiness missing/u,
    );
  }
  const value = fixture();
  delete value.readiness;
  assert.throws(() => assertNativeTranscriptEvidence(value));
});
