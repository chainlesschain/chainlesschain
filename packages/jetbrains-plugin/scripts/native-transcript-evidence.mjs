import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";

const SIZES = [10_000, 100_000, 200_000];
const COUNT = 64;
function keys(value, expected) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
function number(value, integer = false) {
  assert.ok(Number.isFinite(value) && value >= 0);
  if (integer) assert.ok(Number.isSafeInteger(value));
}
function p95(values) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
}
function snapshot(value) {
  keys(value, [
    "selectionStart",
    "selectionEnd",
    "selectedText",
    "viewportY",
    "viewportHeight",
    "paneHeight",
    "documentLength",
    "caretPosition",
    "bottomSlop",
    "followingBottom",
  ]);
  for (const key of [
    "selectionStart",
    "selectionEnd",
    "viewportY",
    "viewportHeight",
    "paneHeight",
    "documentLength",
    "caretPosition",
    "bottomSlop",
  ])
    number(value[key], true);
  assert.ok(
    value.selectionStart <= value.selectionEnd &&
      value.selectionEnd <= value.documentLength,
  );
  assert.ok(value.caretPosition <= value.documentLength);
  assert.equal(typeof value.selectedText, "string");
  assert.equal(
    value.selectedText.length,
    value.selectionEnd - value.selectionStart,
  );
  assert.ok(value.selectedText.length <= 128);
  assert.ok(value.viewportHeight > 0 && value.paneHeight > 0);
  assert.equal(typeof value.followingBottom, "boolean");
  assert.ok(value.bottomSlop >= 24 && value.bottomSlop <= 256);
  assert.equal(
    value.followingBottom,
    value.viewportY + value.viewportHeight >=
      value.paneHeight - value.bottomSlop,
  );
}

/** Strict readback of native metrics. Valid measurement is not an SLO pass. */
export function assertNativeTranscriptEvidence(
  value,
  { processId, ideVersion } = {},
) {
  keys(value, [
    "schema",
    "profile",
    "instrumentation",
    "paintMode",
    "longTaskScope",
    "timingDomain",
    "chromiumFrames",
    "sloStatus",
    "headless",
    "readiness",
    "processId",
    "javaVersion",
    "osName",
    "osArch",
    "ideVersion",
    "ideBuild",
    "runToken",
    "startedAt",
    "finishedAt",
    "periodMs",
    "longTaskThresholdMs",
    "cases",
    "status",
  ]);
  assert.equal(value.schema, "cc-jetbrains-native-transcript/v1");
  assert.equal(value.profile, "installed-plugin-native-swing");
  assert.equal(value.instrumentation, "ui-test-reflection");
  assert.equal(value.paintMode, "visible-region-paintImmediately");
  assert.equal(value.longTaskScope, "sampled-probe-edt-tasks");
  assert.equal(value.timingDomain, "jvm-System.nanoTime");
  assert.equal(value.chromiumFrames, false);
  assert.equal(value.sloStatus, "not-evaluated");
  assert.equal(value.headless, false);
  const readyFields = [
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
  ];
  keys(value.readiness, [...readyFields, "conversationId", "documentChars"]);
  for (const field of readyFields)
    assert.equal(
      value.readiness[field],
      true,
      `native readiness missing: ${field}`,
    );
  assert.equal(typeof value.readiness.conversationId, "string");
  assert.ok(
    value.readiness.conversationId.length > 0 &&
      value.readiness.conversationId.length <= 256,
  );
  number(value.readiness.documentChars, true);
  assert.ok(
    value.readiness.documentChars > 0 &&
      value.readiness.documentChars <= 200_000,
  );
  assert.equal(value.status, "measured");
  assert.match(value.processId, /^[1-9]\d*$/u);
  if (processId !== undefined) assert.equal(value.processId, String(processId));
  for (const field of [
    "javaVersion",
    "osName",
    "osArch",
    "ideVersion",
    "ideBuild",
  ]) {
    assert.equal(typeof value[field], "string");
    assert.ok(value[field].length > 0 && value[field].length <= 128);
  }
  if (ideVersion !== undefined)
    assert.ok(
      value.ideVersion === ideVersion ||
        value.ideVersion.startsWith(`${ideVersion}.`),
    );
  assert.match(value.runToken, /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u);
  assert.ok(
    Number.isFinite(Date.parse(value.startedAt)) &&
      Number.isFinite(Date.parse(value.finishedAt)),
  );
  assert.ok(Date.parse(value.finishedAt) >= Date.parse(value.startedAt));
  assert.equal(value.periodMs, 16);
  assert.equal(value.longTaskThresholdMs, 50);
  assert.equal(value.cases.length, SIZES.length);
  const cases = value.cases.map((entry, index) => {
    keys(entry, [
      "requestedChars",
      "samples",
      "sampleCount",
      "allSamplesOnEdt",
      "allSamplesShowing",
      "followingBeforeSelection",
      "selectionBefore",
      "selectionAfter",
      "scrollBefore",
      "scrollAfter",
      "followingAfterResume",
      "streamedChars",
      "retainedChars",
      "capApplied",
      "plainBeforeFinalize",
      "finish",
    ]);
    assert.equal(entry.requestedChars, SIZES[index]);
    assert.equal(entry.sampleCount, COUNT);
    assert.equal(entry.samples.length, COUNT);
    assert.equal(entry.allSamplesOnEdt, true);
    assert.equal(entry.allSamplesShowing, true);
    let chars = 0;
    for (const [sampleIndex, sample] of entry.samples.entries()) {
      keys(sample, [
        "ordinal",
        "appendedChars",
        "updateMs",
        "paintMs",
        "intervalMs",
        "queueDelayMs",
        "taskMs",
      ]);
      assert.equal(sample.ordinal, sampleIndex + 1);
      number(sample.appendedChars, true);
      assert.equal(
        sample.appendedChars,
        Math.floor(((sampleIndex + 1) * entry.requestedChars) / COUNT) -
          Math.floor((sampleIndex * entry.requestedChars) / COUNT),
      );
      for (const field of [
        "updateMs",
        "paintMs",
        "intervalMs",
        "queueDelayMs",
        "taskMs",
      ])
        number(sample[field]);
      assert.ok(sample.taskMs >= sample.updateMs + sample.paintMs);
      assert.equal(
        sample.queueDelayMs,
        Math.max(0, sample.intervalMs - value.periodMs),
      );
      chars += sample.appendedChars;
    }
    assert.equal(chars, entry.streamedChars);
    assert.equal(entry.streamedChars, entry.requestedChars);
    number(entry.retainedChars, true);
    assert.ok(
      entry.retainedChars > 0 && entry.retainedChars <= entry.streamedChars,
      "native transcript contains unrelated content: concurrent-transcript-mutation",
    );
    assert.equal(entry.capApplied, entry.retainedChars < entry.streamedChars);
    assert.equal(typeof entry.plainBeforeFinalize, "boolean");
    for (const key of [
      "followingBeforeSelection",
      "selectionBefore",
      "selectionAfter",
      "scrollBefore",
      "scrollAfter",
      "followingAfterResume",
    ])
      snapshot(entry[key]);
    assert.equal(entry.selectionBefore.selectedText.length, 12);
    assert.equal(entry.selectionBefore.viewportY, 0);
    assert.equal(entry.scrollBefore.viewportY, 0);
    assert.equal(entry.scrollBefore.selectedText, "");
    const finish = entry.finish;
    keys(finish, [
      "activeBefore",
      "beforeLength",
      "updateMs",
      "paintMs",
      "taskMs",
      "finalizeCalls",
      "markdownParseCalls",
      "markdownParseInstrumentation",
      "activeAfter",
      "afterLength",
      "boldAfterFinalize",
    ]);
    assert.equal(finish.activeBefore, true);
    assert.equal(finish.activeAfter, false);
    assert.equal(finish.finalizeCalls, 1);
    assert.equal(finish.markdownParseCalls, null);
    assert.equal(finish.markdownParseInstrumentation, "not-instrumented");
    assert.equal(typeof finish.boldAfterFinalize, "boolean");
    for (const field of ["beforeLength", "afterLength"]) {
      number(finish[field], true);
      assert.ok(finish[field] > 0 && finish[field] <= 200_000);
    }
    for (const field of ["updateMs", "paintMs", "taskMs"])
      number(finish[field]);
    assert.ok(finish.taskMs >= finish.updateMs + finish.paintMs);
    const tasks = [
      ...entry.samples.map((sample) => sample.taskMs),
      finish.taskMs,
    ];
    return {
      requestedChars: entry.requestedChars,
      streamedChars: chars,
      retainedChars: entry.retainedChars,
      capApplied: entry.capApplied,
      sampledEdtTasks: tasks.length,
      visibleRegionPaintRequests: tasks.length,
      updateP95Ms: p95(entry.samples.map((sample) => sample.updateMs)),
      paintP95Ms: p95(entry.samples.map((sample) => sample.paintMs)),
      timerIntervalP95Ms: p95(entry.samples.map((sample) => sample.intervalMs)),
      queueDelayP95Ms: p95(entry.samples.map((sample) => sample.queueDelayMs)),
      sampledLongTaskCount: tasks.filter((duration) => duration >= 50).length,
      longestSampledTaskMs: Math.max(...tasks),
      finalizeUpdateMs: finish.updateMs,
      selectionPreserved:
        entry.selectionBefore.selectedText ===
          entry.selectionAfter.selectedText &&
        entry.selectionBefore.selectionStart ===
          entry.selectionAfter.selectionStart &&
        entry.selectionBefore.selectionEnd ===
          entry.selectionAfter.selectionEnd,
      selectionViewportPreserved:
        entry.selectionBefore.viewportY === entry.selectionAfter.viewportY,
      userScrollPreserved:
        entry.scrollBefore.viewportY === entry.scrollAfter.viewportY,
      followedBeforeSelection: entry.followingBeforeSelection.followingBottom,
      followedAfterResume: entry.followingAfterResume.followingBottom,
      streamedPlainThenStyled:
        entry.plainBeforeFinalize && finish.boldAfterFinalize,
      markdownParseCalls: null,
    };
  });
  return {
    schema: value.schema,
    processId: value.processId,
    ideVersion: value.ideVersion,
    ideBuild: value.ideBuild,
    profile: value.profile,
    paintMode: value.paintMode,
    longTaskScope: value.longTaskScope,
    sloStatus: "not-evaluated",
    cases,
  };
}

export function verifyNativeTranscriptEvidence(file, options) {
  const stat = lstatSync(file);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size < 1024 * 1024,
  );
  return assertNativeTranscriptEvidence(
    JSON.parse(readFileSync(file, "utf8")),
    options,
  );
}
