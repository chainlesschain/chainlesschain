#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROFILE,
  REQUIRED_FILES,
  validateAtProbe,
  validateJetBrainsEvidence,
} from "./ide-roadmap-accessibility-performance.mjs";

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_CELLS = Object.freeze([
  Object.freeze({ suffix: "linux", operatingSystem: "linux" }),
  Object.freeze({ suffix: "macos", operatingSystem: "darwin" }),
  Object.freeze({ suffix: "windows", operatingSystem: "win32" }),
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireZeroFields(value, fields, scope) {
  for (const field of fields) {
    assert.equal(value[field], 0, `${scope}/${field}`);
  }
}

function verifyPercentiles(value, samples, threshold, scope) {
  assert.equal(value.samples, samples, `${scope}/samples`);
  for (const field of ["p50Ms", "p95Ms", "p99Ms", "maxMs"]) {
    assert.ok(
      Number.isFinite(value[field]) && value[field] >= 0,
      `${scope}/${field}`,
    );
  }
  assert.ok(value.p50Ms <= value.p95Ms, `${scope}/p50<=p95`);
  assert.ok(value.p95Ms <= value.p99Ms, `${scope}/p95<=p99`);
  assert.ok(value.p99Ms <= value.maxMs, `${scope}/p99<=max`);
  assert.ok(value.p99Ms <= threshold, `${scope}/threshold`);
}

function verifyCell(directory, expected) {
  assert.equal(fs.existsSync(path.join(directory, "failure.json")), false);
  const manifest = readJson(path.join(directory, "manifest.json"));
  assert.equal(
    manifest.schema,
    "chainlesschain.accessibility-performance-manifest.v1",
  );
  assert.equal(manifest.releaseCommit, expected.releaseCommit);
  assert.equal(manifest.operatingSystem, expected.operatingSystem);
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    [...REQUIRED_FILES].sort(),
  );
  const documents = {};
  for (const file of REQUIRED_FILES) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(manifest.files[file].sha256, digest(bytes), file);
    assert.equal(manifest.files[file].bytes, bytes.length, file);
    documents[file] = JSON.parse(bytes.toString("utf8"));
  }

  const exact = documents["exact-commit.json"];
  assert.equal(exact.releaseCommit, expected.releaseCommit);
  assert.equal(exact.exactCommitBound, true);
  const host = documents["host-environment.json"];
  assert.equal(host.releaseCommit, expected.releaseCommit);
  assert.equal(host.operatingSystem, expected.operatingSystem);
  assert.deepEqual(host.hosts, ["vscode", "jetbrains"]);
  for (const [key, value] of Object.entries(expected.provenance)) {
    assert.equal(host.provenance[key], value, `${expected.suffix}/${key}`);
  }

  validateAtProbe(
    documents["assistive-technology.json"],
    expected.operatingSystem,
  );
  const keyboard = documents["keyboard-action-ledger.json"];
  assert.equal(keyboard.actions.length, 6);
  assert.ok(keyboard.approvalTraversal.length > 0);
  requireZeroFields(
    keyboard,
    [
      "keyboardUnreachableActionCount",
      "keyboardTrapCount",
      "invisibleFocusCount",
    ],
    "keyboard",
  );
  const accessibility = documents["accessibility-tree.json"];
  assert.equal(accessibility.capture, "chromium-cdp-full-ax-tree");
  assert.ok(accessibility.nodes.length > 0);
  assert.equal(accessibility.unnamedInteractiveControlCount, 0);
  assert.equal(accessibility.requiredSemanticMissCount, 0);
  const screenReader = documents["screen-reader-transcript.json"];
  assert.equal(
    screenReader.capture,
    "semantic-live-region-and-accessible-name-projection",
  );
  assert.ok(screenReader.announcements.length > 0);
  assert.equal(screenReader.speechAudioCaptured, false);
  assert.equal(screenReader.speechQualityAssessed, false);
  assert.equal(screenReader.externalManualSpeechReviewRequired, true);
  const focus = documents["focus-transition-ledger.json"];
  assert.equal(focus.transitions.length, 6);
  assert.equal(focus.focusRestoreFailureCount, 0);

  const large = documents["large-input-digests.json"];
  assert.equal(large.messagesPerSession, PROFILE.messagesPerSession);
  assert.equal(large.renderedTranscriptNodes, 800);
  assert.equal(large.transcriptNodeLimit, 800);
  assert.equal(large.diffBytes, PROFILE.diffBytes);
  assert.match(large.diffDigest || "", DIGEST_RE);
  assert.equal(large.logBytes, PROFILE.logBytes);
  assert.match(large.logDigest || "", DIGEST_RE);
  assert.equal(large.sessionCount, PROFILE.sessionCount);
  assert.ok(large.workbenchSessionLimit >= PROFILE.sessionCount);
  for (const field of [
    "diffMarkerVisible",
    "logMarkerVisible",
    "diffHeadTailVisible",
    "logHeadTailVisible",
  ]) {
    assert.equal(large[field], true, `large/${field}`);
  }
  assert.equal(large.credentialVisible, false);
  assert.equal(large.fullCommandVisible, false);

  const performance = documents["performance-samples.json"];
  assert.deepEqual(performance.thresholds, PROFILE.thresholds);
  assert.deepEqual(performance.thresholdViolations, []);
  verifyPercentiles(
    performance.inputToPaint,
    PROFILE.transcriptPaintSamples,
    PROFILE.thresholds.inputToPaintP99Ms,
    "input-to-paint",
  );
  verifyPercentiles(
    performance.scrollToPaint,
    PROFILE.scrollPaintSamples,
    PROFILE.thresholds.scrollP99Ms,
    "scroll-to-paint",
  );
  assert.ok(performance.diffPaintMs <= PROFILE.thresholds.diffPaintMs);
  assert.ok(performance.logPaintMs <= PROFILE.thresholds.logPaintMs);
  assert.ok(
    performance.workbenchPaintMs <= PROFILE.thresholds.workbenchPaintMs,
  );
  validateJetBrainsEvidence(documents["jetbrains-native.json"]);

  const resources = documents["resource-trajectory.json"];
  assert.equal(resources.nodeRssTrajectory.length, 2);
  assert.ok(resources.rendererHeapTrajectory.length >= 4);
  assert.ok(
    resources.nodeRssTrajectory[1].bytes -
      resources.nodeRssTrajectory[0].bytes <=
      PROFILE.thresholds.nodeRssGrowthBytes,
  );
  const rendererHeap = resources.rendererHeapTrajectory.map(
    (entry) => entry.usedSize,
  );
  assert.ok(
    Math.max(...rendererHeap) - rendererHeap[0] <=
      PROFILE.thresholds.rendererHeapGrowthBytes,
  );
  assert.ok(
    resources.descriptorOrHandleDelta <=
      PROFILE.thresholds.descriptorOrHandleGrowth,
  );
  assert.equal(resources.orphanProcessCount, 0);

  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  assert.equal(outcome.requiredMeasurementsComplete, true);
  assert.equal(outcome.exactCommitBound, true);
  assert.equal(outcome.manualSpeechQualityPending, true);
  assert.equal(outcome.continuousEightHourHostSoakPending, true);
  requireZeroFields(
    outcome,
    [
      "keyboardUnreachableActionCount",
      "keyboardTrapCount",
      "invisibleFocusCount",
      "focusRestoreFailureCount",
      "unnamedInteractiveControlCount",
      "criticalAnnouncementMissCount",
      "unboundedTranscriptGrowthCount",
      "silentDiffOrLogTruncationCount",
      "uiHangCount",
      "credentialLeakCount",
      "orphanProcessCount",
      "pageErrorCount",
    ],
    "outcome",
  );
  return {
    suffix: expected.suffix,
    operatingSystem: expected.operatingSystem,
    manifestDigest: digest(
      fs.readFileSync(path.join(directory, "manifest.json")),
    ),
    outcomeDigest: digest(
      fs.readFileSync(path.join(directory, "outcome-observations.json")),
    ),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  const shared = {
    repository: options.repository,
    workflowRef: options.workflowRef,
    workflowSha: options.workflowSha,
    runId: options.runId,
    runAttempt: options.runAttempt,
    job: "accessibility-performance",
    eventName: options.eventName,
  };
  const cells = REQUIRED_CELLS.map((cell) =>
    verifyCell(path.join(path.resolve(options.evidenceRoot), cell.suffix), {
      ...cell,
      releaseCommit: options.releaseCommit,
      provenance: {
        ...shared,
        artifactName: `ide-accessibility-performance-${cell.suffix}-${options.runAttempt}`,
      },
    }),
  );
  const output = {
    schema: "chainlesschain.accessibility-performance-aggregate.v1",
    releaseCommit: options.releaseCommit,
    exactCommitBound: true,
    requiredOperatingSystems: REQUIRED_CELLS.map(
      (cell) => cell.operatingSystem,
    ),
    requiredHosts: ["vscode", "jetbrains"],
    scale: {
      messagesPerSession: PROFILE.messagesPerSession,
      diffBytes: PROFILE.diffBytes,
      logBytes: PROFILE.logBytes,
      sessionCount: PROFILE.sessionCount,
    },
    manualExternalTail: [
      "assistive-technology-speech-quality",
      "interactive-real-device",
      "continuous-eight-hour-host-soak",
    ],
    cells,
  };
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { REQUIRED_CELLS, verifyCell };
