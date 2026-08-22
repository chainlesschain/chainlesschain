#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");

const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const REQUIRED_FRAGMENT_FILE = "claude-code-increment-audit-fragment.json";
const ADVISORY_FRAGMENT_FILE =
  "claude-code-increment-audit-advisory-fragment.json";
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MIB = 1024 * 1024;

const AX_TRANSCRIPT_PROFILE_VERSION = "ax-transcript/v1";
const AX_TRANSCRIPT_ADVISORY_PROFILE_VERSION =
  "ax-transcript/native-at-probe/v1";

const AX_TRANSCRIPT_THRESHOLDS = Object.freeze({
  messagesPerSessionMinimum: 2_000,
  inputToPaintP99Ms: 1_000,
  scrollP99Ms: 500,
  diffPaintMs: 5_000,
  logPaintMs: 5_000,
  workbenchPaintMs: 3_000,
  nodeRssGrowthBytes: 512 * MIB,
  rendererHeapGrowthBytes: 256 * MIB,
  descriptorOrHandleGrowth: 32,
  requiredSemanticMissCount: 0,
  unnamedInteractiveControlCount: 0,
  criticalAnnouncementMissCount: 0,
  announcementDuplicateCount: 0,
  streamingTokenReplayCount: 0,
  turnHeadingMissCount: 0,
  focusRestoreFailureCount: 0,
});

const AX_TRANSCRIPT_TEST_IDS = Object.freeze([
  "packages/vscode-extension/test/host-dom-relay.test.cjs#chat HTML exposes keyboard and screen-reader semantics",
  "packages/vscode-extension/test/host-dom-relay.test.cjs#transcript announcements are classified, whitespace-normalized, and bounded",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java#transcriptExposesAStableScreenReaderNameAndDescription",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java#turnsExposeStableUserAndAssistantHeadings",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java#categorizedAnnouncementsAreDeduplicatedAndBounded",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/AccessibilityPerformanceEvidenceTest.java#measuresNativeTranscriptPaintAndSessionProjectionAtRequiredScale",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs#chromium-cdp-ax-tree-heading-keyboard-journey",
]);

const AX_TRANSCRIPT_PRODUCER_PATHS = Object.freeze([
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
  "packages/cli/scripts/ax-transcript-audit-fragment.mjs",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
  "packages/cli/__tests__/unit/ax-transcript-audit-fragment.test.js",
  "packages/cli/__tests__/unit/ide-roadmap-accessibility-performance.test.js",
  "packages/vscode-extension/src/chat/chat-html.js",
  "packages/vscode-extension/test/host-dom-relay.test.cjs",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatTranscript.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/AccessibilityPerformanceEvidenceTest.java",
]);

const INPUT_FILES = Object.freeze([
  "exact-commit.json",
  "host-environment.json",
  "assistive-technology.json",
  "keyboard-action-ledger.json",
  "accessibility-tree.json",
  "screen-reader-transcript.json",
  "focus-transition-ledger.json",
  "large-input-digests.json",
  "performance-samples.json",
  "resource-trajectory.json",
  "jetbrains-native.json",
  "outcome-observations.json",
]);

const FRAGMENT_KEYS = Object.freeze([
  "commitmentId",
  "disposition",
  "headSha",
  "measurements",
  "os",
  "outcome",
  "producerDigests",
  "profileVersion",
  "runtime",
  "schema",
  "source",
  "testIds",
  "thresholds",
]);

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalOs(value) {
  if (value === "linux") return "linux";
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "win32" || value === "windows") return "windows";
  throw new Error(`unsupported AX transcript operating system: ${value}`);
}

function assertExactKeys(value, expected, scope) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), scope);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), scope);
}

function readProducerAtHead(
  producerPath,
  headSha,
  repositoryRoot = REPOSITORY_ROOT,
) {
  return execFileSync(
    "git",
    ["cat-file", "blob", `${headSha}:${producerPath}`],
    {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 128 * MIB,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function producerDigestsAtHead({
  headSha,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
  requireWorkingTreeMatch = true,
} = {}) {
  assert.match(headSha || "", SHA_RE);
  if (requireWorkingTreeMatch) {
    execFileSync(
      "git",
      ["diff", "--quiet", headSha, "--", ...AX_TRANSCRIPT_PRODUCER_PATHS],
      { cwd: repositoryRoot, stdio: "ignore" },
    );
  }
  return Object.fromEntries(
    AX_TRANSCRIPT_PRODUCER_PATHS.map((producerPath) => {
      const committed = producerReader(producerPath, headSha, repositoryRoot);
      const committedDigest = digest(committed);
      return [producerPath, committedDigest];
    }),
  );
}

function verifyArtifactFiles(artifactDir, manifest) {
  assert.equal(
    manifest.schema,
    "chainlesschain.accessibility-performance-manifest.v1",
  );
  const documents = {};
  for (const file of INPUT_FILES) {
    const entry = manifest.files?.[file];
    assert.ok(entry, `manifest/${file}`);
    const bytes = fs.readFileSync(path.join(artifactDir, file));
    assert.equal(entry.sha256, digest(bytes), `${file}/sha256`);
    assert.equal(entry.bytes, bytes.length, `${file}/bytes`);
    documents[file] = JSON.parse(bytes.toString("utf8"));
  }
  return documents;
}

function percentileMeasurement(value) {
  return {
    samples: value.samples,
    p50Ms: value.p50Ms,
    p95Ms: value.p95Ms,
    p99Ms: value.p99Ms,
    ...(Number.isFinite(value.maxMs) ? { maxMs: value.maxMs } : {}),
  };
}

function announcementCounts(entries) {
  const categories = {
    assistantResponse: 0,
    permissionRequest: 0,
    status: 0,
    toolError: 0,
  };
  for (const entry of entries) {
    if (entry.includes("Assistant response")) categories.assistantResponse += 1;
    if (entry.includes("Permission request")) categories.permissionRequest += 1;
    if (entry.includes("Status")) categories.status += 1;
    if (entry.includes("Tool error")) categories.toolError += 1;
  }
  return categories;
}

function requiredMeasurements(documents) {
  const keyboard = documents["keyboard-action-ledger.json"];
  const accessibility = documents["accessibility-tree.json"];
  const screenReader = documents["screen-reader-transcript.json"];
  const focus = documents["focus-transition-ledger.json"];
  const large = documents["large-input-digests.json"];
  const performance = documents["performance-samples.json"];
  const resources = documents["resource-trajectory.json"];
  const jetbrains = documents["jetbrains-native.json"];
  const outcome = documents["outcome-observations.json"];
  const rendererHeap = resources.rendererHeapTrajectory.map(
    (entry) => entry.usedSize,
  );
  const nodeRssGrowthBytes =
    resources.nodeRssTrajectory[1].bytes - resources.nodeRssTrajectory[0].bytes;
  const rendererHeapGrowthBytes = Math.max(...rendererHeap) - rendererHeap[0];

  return {
    hosts: ["vscode", "jetbrains"],
    scale: {
      messagesPerSession: large.messagesPerSession,
      renderedTranscriptNodes: large.renderedTranscriptNodes,
    },
    semanticContract: {
      capture: accessibility.capture,
      nodeCount: accessibility.nodes.length,
      unnamedInteractiveControlCount:
        accessibility.unnamedInteractiveControlCount,
      requiredSemanticMissCount: accessibility.requiredSemanticMissCount,
      visualTranscriptRole: screenReader.visualTranscriptRole,
      visualTranscriptLiveRegion: screenReader.visualTranscriptLiveRegion,
      classifiedEventRegion: screenReader.classifiedEventRegion,
      turnHeadingCount: screenReader.turnHeadings.length,
      headingKeyboardActionCount: keyboard.headingActions.length,
      announcementCounts: announcementCounts(screenReader.eventAnnouncements),
      announcementDuplicateCount: screenReader.announcementDuplicateCount,
      streamingTokenReplayCount: screenReader.streamingTokenReplayCount,
      focusRestoreFailureCount: focus.focusRestoreFailureCount,
      criticalAnnouncementMissCount: outcome.criticalAnnouncementMissCount,
      turnHeadingMissCount: outcome.turnHeadingMissCount,
    },
    vscodePerformance: {
      inputToPaint: percentileMeasurement(performance.inputToPaint),
      scrollToPaint: percentileMeasurement(performance.scrollToPaint),
      diffPaintMs: performance.diffPaintMs,
      logPaintMs: performance.logPaintMs,
      workbenchPaintMs: performance.workbenchPaintMs,
      nodeRssGrowthBytes,
      rendererHeapGrowthBytes,
      descriptorOrHandleGrowth: resources.descriptorOrHandleDelta,
    },
    jetbrainsPerformance: {
      inputToPaint: percentileMeasurement(jetbrains.inputToPaint),
      scrollToPaint: percentileMeasurement(jetbrains.scrollToPaint),
      diffPaintMs: jetbrains.diffPaintMs,
      logPaintMs: jetbrains.logPaintMs,
      workbenchPaintMs: jetbrains.sessionProjectionMs,
      transcriptBounded: jetbrains.transcriptBounded,
      accessibleNamePresent: jetbrains.accessibleNamePresent,
      accessibleDescriptionPresent: jetbrains.accessibleDescriptionPresent,
      focusable: jetbrains.focusable,
    },
    automationBoundary: {
      requiredSurface:
        "product DOM/CDP AX tree, live-region event projection, Swing AccessibleContext, and keyboard focus",
      nativeAssistiveTechnologyDisposition: "advisory",
      nativeAssistiveTechnologyConsumedSemanticTree: false,
      speechAudioCaptured: false,
      speechQualityAssessed: false,
      externalManualSpeechReviewRequired: true,
    },
  };
}

function requiredOutcome(measurements) {
  const semantic = measurements.semanticContract;
  const vscode = measurements.vscodePerformance;
  const jetbrains = measurements.jetbrainsPerformance;
  const counts = semantic.announcementCounts;
  return (
    measurements.scale.messagesPerSession >=
      AX_TRANSCRIPT_THRESHOLDS.messagesPerSessionMinimum &&
    semantic.requiredSemanticMissCount === 0 &&
    semantic.unnamedInteractiveControlCount === 0 &&
    semantic.criticalAnnouncementMissCount === 0 &&
    semantic.announcementDuplicateCount === 0 &&
    semantic.streamingTokenReplayCount === 0 &&
    semantic.turnHeadingMissCount === 0 &&
    semantic.focusRestoreFailureCount === 0 &&
    semantic.turnHeadingCount >= 2 &&
    semantic.headingKeyboardActionCount >= 2 &&
    counts.assistantResponse >= 1 &&
    counts.permissionRequest >= 1 &&
    counts.status >= 1 &&
    counts.toolError >= 1 &&
    vscode.inputToPaint.p99Ms <= AX_TRANSCRIPT_THRESHOLDS.inputToPaintP99Ms &&
    vscode.scrollToPaint.p99Ms <= AX_TRANSCRIPT_THRESHOLDS.scrollP99Ms &&
    vscode.diffPaintMs <= AX_TRANSCRIPT_THRESHOLDS.diffPaintMs &&
    vscode.logPaintMs <= AX_TRANSCRIPT_THRESHOLDS.logPaintMs &&
    vscode.workbenchPaintMs <= AX_TRANSCRIPT_THRESHOLDS.workbenchPaintMs &&
    vscode.nodeRssGrowthBytes <= AX_TRANSCRIPT_THRESHOLDS.nodeRssGrowthBytes &&
    vscode.rendererHeapGrowthBytes <=
      AX_TRANSCRIPT_THRESHOLDS.rendererHeapGrowthBytes &&
    vscode.descriptorOrHandleGrowth <=
      AX_TRANSCRIPT_THRESHOLDS.descriptorOrHandleGrowth &&
    jetbrains.inputToPaint.p99Ms <=
      AX_TRANSCRIPT_THRESHOLDS.inputToPaintP99Ms &&
    jetbrains.scrollToPaint.p99Ms <= AX_TRANSCRIPT_THRESHOLDS.scrollP99Ms &&
    jetbrains.diffPaintMs <= AX_TRANSCRIPT_THRESHOLDS.diffPaintMs &&
    jetbrains.logPaintMs <= AX_TRANSCRIPT_THRESHOLDS.logPaintMs &&
    jetbrains.workbenchPaintMs <= AX_TRANSCRIPT_THRESHOLDS.workbenchPaintMs &&
    jetbrains.transcriptBounded === true &&
    jetbrains.accessibleNamePresent === true &&
    jetbrains.accessibleDescriptionPresent === true &&
    jetbrains.focusable === true
  );
}

function nativeAtMeasurements(documents) {
  const probe = documents["assistive-technology.json"];
  const screenReader = documents["screen-reader-transcript.json"];
  // The workflow really invokes Orca's version process, inspects NVDA's signed
  // executable metadata, and records VoiceOver binary presence. It does not
  // connect those technologies to the product AX tree or capture speech. Keep
  // that native observation separate from the required semantic contract.
  return {
    technology: probe.technology,
    probeScope: probe.probeScope || "unspecified",
    binaryPresent: probe.binaryPresent,
    automatedProcessProbeComplete: probe.automatedProcessProbeComplete,
    processProbeExternalManualRequired: probe.externalManualRequired,
    versionDigest: probe.versionDigest,
    nativeAssistiveTechnologyConsumedSemanticTree: false,
    speechAudioCaptured: screenReader.speechAudioCaptured,
    speechQualityAssessed: screenReader.speechQualityAssessed,
    externalManualSpeechReviewRequired:
      screenReader.externalManualSpeechReviewRequired,
  };
}

function nativeAtOutcome(os, measurements) {
  const expectedProcess = os !== "macos";
  return measurements.binaryPresent === true &&
    (!expectedProcess || measurements.automatedProcessProbeComplete === true) &&
    measurements.speechAudioCaptured === false &&
    measurements.speechQualityAssessed === false &&
    measurements.externalManualSpeechReviewRequired === true
    ? "passed"
    : "failed";
}

function sourceFromHost(host, artifactName) {
  assert.equal(host.provenance.artifactName, artifactName);
  return {
    workflowId: host.provenance.workflowRef,
    runId: host.provenance.runId,
    jobId: host.provenance.job,
    artifactName,
  };
}

function buildAxTranscriptFragments({
  documents,
  headSha,
  artifactName,
  producerDigests,
}) {
  assert.match(headSha || "", SHA_RE);
  const exact = documents["exact-commit.json"];
  const host = documents["host-environment.json"];
  assert.equal(exact.releaseCommit, headSha);
  assert.equal(exact.exactCommitBound, true);
  assert.equal(host.releaseCommit, headSha);
  const os = canonicalOs(host.operatingSystem);
  const source = sourceFromHost(host, artifactName);
  const runtime = {
    name: "node",
    version: host.nodeVersion,
    arch: host.architecture,
  };
  const measurements = requiredMeasurements(documents);
  const advisoryMeasurements = nativeAtMeasurements(documents);
  const required = {
    schema: FRAGMENT_SCHEMA,
    commitmentId: "AX-TRANSCRIPT",
    headSha,
    os,
    runtime,
    profileVersion: AX_TRANSCRIPT_PROFILE_VERSION,
    thresholds: AX_TRANSCRIPT_THRESHOLDS,
    measurements,
    testIds: [...AX_TRANSCRIPT_TEST_IDS],
    producerDigests,
    disposition: "required",
    source,
    outcome: requiredOutcome(measurements) ? "passed" : "failed",
  };
  const advisory = {
    schema: FRAGMENT_SCHEMA,
    commitmentId: "AX-TRANSCRIPT",
    headSha,
    os,
    runtime,
    profileVersion: AX_TRANSCRIPT_ADVISORY_PROFILE_VERSION,
    thresholds: {
      binaryPresent: true,
      automatedProcessProbeComplete: os !== "macos",
      speechQualityRequiredForAutomatedGate: false,
    },
    measurements: advisoryMeasurements,
    testIds: [
      `AX-TRANSCRIPT/native-at/${advisoryMeasurements.technology}/${advisoryMeasurements.probeScope}`,
    ],
    producerDigests,
    disposition: "advisory",
    source,
    outcome: nativeAtOutcome(os, advisoryMeasurements),
  };
  return { advisory, required };
}

function validateFragmentShape(fragment, disposition) {
  assertExactKeys(fragment, FRAGMENT_KEYS, `${disposition} AX fragment`);
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, "AX-TRANSCRIPT");
  assert.match(fragment.headSha || "", SHA_RE);
  assert.ok(["linux", "macos", "windows"].includes(fragment.os));
  assertExactKeys(fragment.runtime, ["arch", "name", "version"], "runtime");
  assertExactKeys(
    fragment.source,
    ["artifactName", "jobId", "runId", "workflowId"],
    "source",
  );
  assert.equal(fragment.disposition, disposition);
  assert.ok(["passed", "failed"].includes(fragment.outcome));
  assert.ok(fragment.testIds.length > 0);
  assert.deepEqual(
    Object.keys(fragment.producerDigests).sort(),
    [...AX_TRANSCRIPT_PRODUCER_PATHS].sort(),
  );
  for (const value of Object.values(fragment.producerDigests)) {
    assert.match(value, DIGEST_RE);
  }
}

function appendAxTranscriptFragments({
  artifactDir,
  releaseCommit,
  artifactName,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
  requireWorkingTreeMatch = true,
}) {
  const resolved = path.resolve(artifactDir);
  assert.equal(fs.existsSync(path.join(resolved, "failure.json")), false);
  const manifestPath = path.join(resolved, "manifest.json");
  const manifest = readJson(manifestPath);
  assert.equal(manifest.releaseCommit, releaseCommit);
  const documents = verifyArtifactFiles(resolved, manifest);
  const producerDigests = producerDigestsAtHead({
    headSha: releaseCommit,
    repositoryRoot,
    producerReader,
    requireWorkingTreeMatch,
  });
  const fragments = buildAxTranscriptFragments({
    documents,
    headSha: releaseCommit,
    artifactName,
    producerDigests,
  });
  assert.equal(
    fragments.required.outcome,
    "passed",
    "required AX transcript profile failed",
  );
  validateFragmentShape(fragments.required, "required");
  validateFragmentShape(fragments.advisory, "advisory");
  for (const [file, value] of [
    [REQUIRED_FRAGMENT_FILE, fragments.required],
    [ADVISORY_FRAGMENT_FILE, fragments.advisory],
  ]) {
    const target = path.join(resolved, file);
    writeJson(target, value);
    const bytes = fs.readFileSync(target);
    manifest.files[file] = { sha256: digest(bytes), bytes: bytes.length };
  }
  writeJson(manifestPath, manifest);
  return fragments;
}

function verifyAxTranscriptFragments({
  artifactDir,
  releaseCommit,
  artifactName,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
}) {
  const resolved = path.resolve(artifactDir);
  const manifest = readJson(path.join(resolved, "manifest.json"));
  assert.equal(manifest.releaseCommit, releaseCommit);
  const documents = verifyArtifactFiles(resolved, manifest);
  const producerDigests = producerDigestsAtHead({
    headSha: releaseCommit,
    repositoryRoot,
    producerReader,
    requireWorkingTreeMatch: false,
  });
  const expected = buildAxTranscriptFragments({
    documents,
    headSha: releaseCommit,
    artifactName,
    producerDigests,
  });
  const actual = {};
  for (const [kind, disposition, file] of [
    ["required", "required", REQUIRED_FRAGMENT_FILE],
    ["advisory", "advisory", ADVISORY_FRAGMENT_FILE],
  ]) {
    const bytes = fs.readFileSync(path.join(resolved, file));
    assert.equal(
      manifest.files?.[file]?.sha256,
      digest(bytes),
      `${file}/sha256`,
    );
    assert.equal(manifest.files?.[file]?.bytes, bytes.length, `${file}/bytes`);
    actual[kind] = JSON.parse(bytes.toString("utf8"));
    validateFragmentShape(actual[kind], disposition);
    assert.deepEqual(actual[kind], expected[kind], file);
  }
  assert.equal(actual.required.outcome, "passed");
  return {
    advisory: actual.advisory,
    advisoryDigest: digest(
      fs.readFileSync(path.join(resolved, ADVISORY_FRAGMENT_FILE)),
    ),
    required: actual.required,
    requiredDigest: digest(
      fs.readFileSync(path.join(resolved, REQUIRED_FRAGMENT_FILE)),
    ),
  };
}

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

function main() {
  const options = parseArgs(process.argv.slice(2));
  appendAxTranscriptFragments({
    artifactDir: options.artifactDir,
    releaseCommit: String(options.releaseCommit || "").toLowerCase(),
    artifactName: options.artifactName,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

export {
  ADVISORY_FRAGMENT_FILE,
  AX_TRANSCRIPT_ADVISORY_PROFILE_VERSION,
  AX_TRANSCRIPT_PRODUCER_PATHS,
  AX_TRANSCRIPT_PROFILE_VERSION,
  AX_TRANSCRIPT_TEST_IDS,
  AX_TRANSCRIPT_THRESHOLDS,
  INPUT_FILES,
  REQUIRED_FRAGMENT_FILE,
  appendAxTranscriptFragments,
  buildAxTranscriptFragments,
  canonicalOs,
  digest,
  producerDigestsAtHead,
  validateFragmentShape,
  verifyAxTranscriptFragments,
};
