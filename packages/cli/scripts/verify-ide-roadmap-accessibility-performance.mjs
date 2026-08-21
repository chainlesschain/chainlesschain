#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIAGNOSTIC_PRODUCER_PATHS,
  DIAGNOSTICS_PROFILE,
  PROFILE,
  REQUIRED_FILES,
  validateAtProbe,
  validateInputPerformanceEvidence,
  validateJetBrainsEvidence,
  verifyAccessibilityWorkflowAuthority,
} from "./ide-roadmap-accessibility-performance.mjs";
import { THRESHOLDS as INPUT_PERFORMANCE_THRESHOLDS } from "./ide-input-performance-profile.mjs";
import {
  ADVISORY_FRAGMENT_FILE,
  REQUIRED_FRAGMENT_FILE,
  verifyAxTranscriptFragments,
} from "./ax-transcript-audit-fragment.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_CELLS = Object.freeze([
  Object.freeze({ suffix: "linux", operatingSystem: "linux" }),
  Object.freeze({ suffix: "macos", operatingSystem: "darwin" }),
  Object.freeze({ suffix: "windows", operatingSystem: "win32" }),
]);
const EXPECTED_MANIFEST_FILES = Object.freeze([
  ...REQUIRED_FILES,
  REQUIRED_FRAGMENT_FILE,
  ADVISORY_FRAGMENT_FILE,
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

function verifyPercentiles(
  value,
  samples,
  threshold,
  scope,
  thresholdField = "p99Ms",
) {
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
  assert.ok(value[thresholdField] <= threshold, `${scope}/threshold`);
}

function verifyRequiredDiagnosticsProfile(value, host) {
  assert.equal(value.host, host);
  assert.equal(value.disposition, "required");
  assert.equal(value.inputCount, DIAGNOSTICS_PROFILE.requiredCount);
  assert.equal(value.publishedCount, DIAGNOSTICS_PROFILE.requiredCount);
  assert.equal(value.truncatedCount, 0);
  assert.equal(value.lostCount, 0);
  assert.equal(value.duplicateCount, 0);
  assert.equal(value.staleVersionCount, 0);
  assert.ok(value.canceledGenerationCount > 0);
  verifyPercentiles(
    value.stableSnapshot,
    DIAGNOSTICS_PROFILE.requiredSamples,
    DIAGNOSTICS_PROFILE.thresholds.stableSnapshotP95Ms,
    `diagnostics/${host}/stable-snapshot`,
    "p95Ms",
  );
  if (host === "vscode") {
    assert.ok(Number.isFinite(value.eventLoopMaxMs));
  } else {
    assert.ok(Number.isFinite(value.maxWorkSliceMs));
    assert.ok(Number.isFinite(value.edtMaxMs));
  }
  const eventLoopOrEdt = Math.max(
    Number(value.eventLoopMaxMs || value.maxWorkSliceMs || 0),
    Number(value.edtMaxMs || 0),
  );
  assert.ok(
    eventLoopOrEdt <= DIAGNOSTICS_PROFILE.thresholds.eventLoopOrEdtMaxMs,
    `diagnostics/${host}/event-loop-edt`,
  );
  assert.ok(
    host !== "vscode" ||
      (Number.isFinite(value.nodeRssGrowthBytes) &&
        value.nodeRssGrowthBytes <=
          DIAGNOSTICS_PROFILE.thresholds.nodeRssGrowthBytes),
    `diagnostics/${host}/rss`,
  );
  assert.ok(
    Number.isFinite(
      host === "vscode" ? value.rendererHeapGrowthBytes : value.heapGrowthBytes,
    ) &&
      (host === "vscode"
        ? value.rendererHeapGrowthBytes
        : value.heapGrowthBytes) <=
        DIAGNOSTICS_PROFILE.thresholds.rendererHeapGrowthBytes,
    `diagnostics/${host}/heap`,
  );
  if (host === "vscode") {
    assert.ok(Number.isFinite(value.nodeHeapGrowthBytes));
    assert.equal(
      value.rendererHeapMeasurement,
      "chromium-product-journey-peak-minus-baseline",
    );
    assert.match(value.snapshotDigest || "", DIGEST_RE);
  }
}

function verifyAdvisoryDiagnosticsProfile(value, host) {
  assert.equal(value.host, host);
  assert.equal(value.disposition, "advisory");
  assert.equal(value.inputCount, DIAGNOSTICS_PROFILE.advisoryCount);
  assert.equal(value.publishedCount, DIAGNOSTICS_PROFILE.requiredCount);
  assert.equal(
    value.truncatedCount,
    DIAGNOSTICS_PROFILE.advisoryCount - DIAGNOSTICS_PROFILE.requiredCount,
  );
  assert.equal(value.lostCount, 0);
  assert.equal(value.duplicateCount, 0);
  assert.equal(value.staleVersionCount, 0);
  assert.ok(value.canceledGenerationCount > 0);
  verifyPercentiles(
    value.stableSnapshot,
    DIAGNOSTICS_PROFILE.advisorySamples,
    Number.POSITIVE_INFINITY,
    `diagnostics/${host}/advisory-stable-snapshot`,
    "p95Ms",
  );
  if (host === "vscode") {
    assert.ok(Number.isFinite(value.eventLoopMaxMs));
    assert.ok(Number.isFinite(value.nodeRssGrowthBytes));
    assert.ok(Number.isFinite(value.nodeHeapGrowthBytes));
    assert.ok(Number.isFinite(value.rendererHeapGrowthBytes));
    assert.equal(
      value.rendererHeapMeasurement,
      "chromium-product-journey-peak-minus-baseline",
    );
    assert.match(value.snapshotDigest || "", DIGEST_RE);
  } else {
    assert.ok(Number.isFinite(value.maxWorkSliceMs));
    assert.ok(Number.isFinite(value.edtMaxMs));
    assert.ok(Number.isFinite(value.heapGrowthBytes));
  }
}

function verifyDiagnosticsFragment(value, expected) {
  assert.equal(
    value.schema,
    "chainlesschain.claude-code-increment-audit-fragment.v1",
  );
  assert.equal(value.commitmentId, "DIAG-SCALE");
  assert.equal(value.headSha, expected.releaseCommit);
  assert.equal(value.os, expected.suffix);
  assert.equal(value.profileVersion, DIAGNOSTICS_PROFILE.profileVersion);
  assert.deepEqual(value.thresholds, DIAGNOSTICS_PROFILE.thresholds);
  assert.equal(value.disposition, "required");
  assert.equal(value.outcome, "passed");
  assert.equal(typeof value.runtime?.name, "string");
  assert.equal(typeof value.runtime?.version, "string");
  assert.equal(typeof value.runtime?.arch, "string");
  assert.deepEqual(value.testIds, [
    "DIAG-SCALE/vscode-10k-stable-snapshot",
    "DIAG-SCALE/jetbrains-10k-stable-snapshot",
  ]);
  assert.deepEqual(value.source, {
    workflowId: expected.provenance.workflowRef,
    runId: expected.provenance.runId,
    jobId: expected.provenance.job,
    artifactName: expected.provenance.artifactName,
  });
  assert.deepEqual(
    Object.keys(value.producerDigests || {}).sort(),
    [...DIAGNOSTIC_PRODUCER_PATHS].sort(),
  );
  for (const [sourcePath, sourceDigest] of Object.entries(
    value.producerDigests,
  )) {
    assert.match(sourceDigest, DIGEST_RE, sourcePath);
    assert.equal(
      sourceDigest,
      digest(fs.readFileSync(path.join(REPOSITORY_ROOT, sourcePath))),
      sourcePath,
    );
  }
  const profiles = value.measurements?.profiles;
  assert.ok(Array.isArray(profiles));
  for (const host of ["vscode", "jetbrains"]) {
    const profile = profiles.find(
      (candidate) =>
        candidate.host === host && candidate.disposition === "required",
    );
    assert.ok(profile, `diagnostics/${host}/required profile`);
    verifyRequiredDiagnosticsProfile(profile, host);
  }
  const advisory = profiles.filter(
    (candidate) => candidate.disposition === "advisory",
  );
  if (expected.provenance.eventName === "schedule") {
    assert.deepEqual(advisory.map((profile) => profile.host).sort(), [
      "jetbrains",
      "vscode",
    ]);
    for (const profile of advisory) {
      verifyAdvisoryDiagnosticsProfile(profile, profile.host);
    }
  } else {
    assert.equal(advisory.length, 0);
  }
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
    [...EXPECTED_MANIFEST_FILES].sort(),
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
  const axFragments = verifyAxTranscriptFragments({
    artifactDir: directory,
    releaseCommit: expected.releaseCommit,
    artifactName: expected.provenance.artifactName,
    ...(expected.repositoryRoot
      ? { repositoryRoot: expected.repositoryRoot }
      : {}),
    ...(expected.producerReader
      ? { producerReader: expected.producerReader }
      : {}),
  });

  validateAtProbe(
    documents["assistive-technology.json"],
    expected.operatingSystem,
  );
  const keyboard = documents["keyboard-action-ledger.json"];
  assert.equal(keyboard.actions.length, 6);
  assert.ok(keyboard.approvalTraversal.length > 0);
  assert.equal(keyboard.headingActions.length, 2);
  for (const heading of keyboard.headingActions) {
    assert.equal(heading.action, "heading-focus");
    assert.equal(heading.observation.id, heading.expected);
    assert.equal(heading.observation.visible, true);
  }
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
  assert.ok(screenReader.eventAnnouncements.length >= 5);
  for (const category of [
    "Assistant response",
    "Tool error",
    "Permission request",
    "Status",
  ]) {
    assert.ok(
      screenReader.eventAnnouncements.some((entry) => entry.includes(category)),
      `screen-reader/${category}`,
    );
  }
  assert.equal(screenReader.visualTranscriptLiveRegion, false);
  assert.equal(screenReader.visualTranscriptRole, "region");
  assert.deepEqual(screenReader.classifiedEventRegion, {
    role: "status",
    live: "polite",
    atomic: "true",
  });
  assert.equal(screenReader.announcementDuplicateCount, 0);
  assert.equal(screenReader.streamingTokenReplayCount, 0);
  assert.deepEqual(screenReader.turnHeadings, [
    "Turn 1, User message",
    "Turn 1, Assistant response",
  ]);
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
  validateInputPerformanceEvidence(
    documents["ide-input-performance.json"],
    expected.releaseCommit,
    expected.operatingSystem,
    {
      workflowId: expected.provenance.workflowRef,
      runId: expected.provenance.runId,
      jobId: expected.provenance.job,
      artifactName: expected.provenance.artifactName,
    },
  );

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
  verifyDiagnosticsFragment(documents["diagnostics-scale.json"], expected);

  const outcome = documents["outcome-observations.json"];
  assert.equal(outcome.success, true);
  assert.equal(outcome.requiredMeasurementsComplete, true);
  assert.equal(outcome.exactCommitBound, true);
  assert.equal(outcome.ideInputPerformanceRequiredPassed, true);
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
      "announcementDuplicateCount",
      "streamingTokenReplayCount",
      "turnHeadingMissCount",
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
    ideInputPerformanceDigest: digest(
      fs.readFileSync(path.join(directory, "ide-input-performance.json")),
    ),
    axTranscript: {
      required: axFragments.required,
      requiredDigest: axFragments.requiredDigest,
      advisory: axFragments.advisory,
      advisoryDigest: axFragments.advisoryDigest,
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assert.match(options.releaseCommit || "", SHA_RE);
  verifyAccessibilityWorkflowAuthority({
    releaseCommit: options.releaseCommit,
    workflowSha: options.workflowSha,
    workflowRef: options.workflowRef,
    required: true,
  });
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
      diagnosticsRequired: DIAGNOSTICS_PROFILE.requiredCount,
      diagnosticsAdvisory: DIAGNOSTICS_PROFILE.advisoryCount,
    },
    ideInputPerformance: {
      commitmentId: "IDE-INPUT-PERF",
      profileVersion: "ide-input-perf/v1",
      disposition: "required",
      ...INPUT_PERFORMANCE_THRESHOLDS,
    },
    manualExternalTail: [
      "assistive-technology-speech-quality",
      "interactive-real-device",
      "continuous-eight-hour-host-soak",
    ],
    cells,
  };
  const fragmentOutputDir = options.fragmentOutputDir
    ? path.resolve(options.fragmentOutputDir)
    : null;
  if (fragmentOutputDir) {
    fs.mkdirSync(fragmentOutputDir, { recursive: true });
    for (const cell of cells) {
      fs.writeFileSync(
        path.join(fragmentOutputDir, `ax-transcript-${cell.suffix}.json`),
        `${JSON.stringify(cell.axTranscript.required, null, 2)}\n`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(
          fragmentOutputDir,
          `ax-transcript-${cell.suffix}-advisory.json`,
        ),
        `${JSON.stringify(cell.axTranscript.advisory, null, 2)}\n`,
        "utf8",
      );
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(
    path.resolve(options.output),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { EXPECTED_MANIFEST_FILES, REQUIRED_CELLS, verifyCell };
