import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_WORKFLOW_PATH,
  DIAGNOSTIC_PRODUCER_PATHS,
  DIAGNOSTICS_PROFILE,
  PROFILE,
  REQUIRED_FILES,
  summarizeSamples,
  validateAtProbe,
  verifyAccessibilityWorkflowAuthority,
} from "../../scripts/ide-roadmap-accessibility-performance.mjs";
import { appendAxTranscriptFragments } from "../../scripts/ax-transcript-audit-fragment.mjs";
import { verifyCell } from "../../scripts/verify-ide-roadmap-accessibility-performance.mjs";
import {
  SOURCE_PATHS as INPUT_PERFORMANCE_SOURCE_PATHS,
  THRESHOLDS as INPUT_PERFORMANCE_THRESHOLDS,
} from "../../scripts/ide-input-performance-profile.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const roots = [];
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(directory, file, value) {
  fs.writeFileSync(path.join(directory, file), `${JSON.stringify(value)}\n`);
}

function jetbrainsEvidence() {
  const percentile = { samples: 100, p50Ms: 1, p95Ms: 2, p99Ms: 3 };
  return {
    schema: "chainlesschain.jetbrains-accessibility-performance.v1",
    measurementSurface: "headless-swing-product-components",
    messageCount: 2_000,
    diffBytes: 16 * 1024 * 1024,
    logBytes: 64 * 1024 * 1024,
    sessionCount: 128,
    renderedChars: 200_000,
    transcriptBounded: true,
    diffMarkerVisible: true,
    logMarkerVisible: true,
    accessibleNamePresent: true,
    accessibleDescriptionPresent: true,
    focusable: true,
    sessionProjectionComplete: true,
    inputToPaint: percentile,
    scrollToPaint: percentile,
    inputToPaintSamplesMs: Array(100).fill(1),
    scrollToPaintSamplesMs: Array(100).fill(1),
    diffPaintMs: 10,
    logPaintMs: 20,
    sessionProjectionMs: 1,
    heapBeforeBytes: 1_000,
    heapAfterBytes: 2_000,
    openFileDescriptorCount: 10,
    javaVersion: "21.0.1",
    javaArch: "x64",
    diagnosticsScaleRequired: diagnosticsProfile("jetbrains"),
    diagnosticsScaleAdvisory: null,
  };
}

function diagnosticsProfile(host) {
  return {
    host,
    disposition: "required",
    inputCount: DIAGNOSTICS_PROFILE.requiredCount,
    maxDiagnostics: DIAGNOSTICS_PROFILE.requiredCount,
    publishedCount: DIAGNOSTICS_PROFILE.requiredCount,
    truncatedCount: 0,
    lostCount: 0,
    duplicateCount: 0,
    staleVersionCount: 0,
    canceledGenerationCount: 20,
    stableSnapshot: {
      samples: DIAGNOSTICS_PROFILE.requiredSamples,
      p50Ms: 10,
      p95Ms: 20,
      p99Ms: 25,
      maxMs: 30,
    },
    ...(host === "vscode"
      ? {
          eventLoopMaxMs: 5,
          nodeRssGrowthBytes: 1_000,
          nodeHeapGrowthBytes: 500,
          rendererHeapGrowthBytes: 0,
          rendererHeapMeasurement:
            "chromium-product-journey-peak-minus-baseline",
          snapshotDigest: DIGEST,
        }
      : { maxWorkSliceMs: 5, edtMaxMs: 0, heapGrowthBytes: 1_000 }),
  };
}

function inputPerformanceEvidence(provenance) {
  const measurement = {
    pathCount: 100_000,
    consecutiveQueries: 20,
    rapidQueries: 20,
    samplesMs: Array(20).fill(1),
    p50Ms: 1,
    p95Ms: 1,
    p99Ms: 1,
    maxCandidates: 200,
    workspaceRevision: 2,
    queryGeneration: 40,
    cancellationCount: 19,
    discardedQueryCount: 19,
    deniedPathCount: 2,
    staleCommitCount: 0,
    leakCount: 0,
    contentReadCount: 0,
    symbolObserved: true,
    workspaceTrustEnforced: true,
  };
  const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
  const producerDigests = Object.fromEntries(
    INPUT_PERFORMANCE_SOURCE_PATHS.map((sourcePath) => {
      const bytes = fs.readFileSync(path.join(repositoryRoot, sourcePath));
      return [sourcePath, digest(bytes)];
    }),
  );
  return {
    schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
    commitmentId: "IDE-INPUT-PERF",
    headSha: COMMIT,
    os: "linux",
    runtime: {
      name: "node+java",
      version: `${process.version};21`,
      arch: process.arch,
    },
    profileVersion: "ide-input-perf/v1",
    thresholds: INPUT_PERFORMANCE_THRESHOLDS,
    measurements: { vscode: measurement, jetbrains: measurement },
    testIds: ["vscode-profile", "jetbrains-profile"],
    producerDigests,
    disposition: "required",
    source: {
      workflowId: provenance.workflowRef,
      runId: provenance.runId,
      jobId: provenance.job,
      artifactName: provenance.artifactName,
    },
    outcome: "passed",
  };
}

function createCell() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-p2-cell-"));
  roots.push(directory);
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/p2.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    job: "accessibility-performance",
    eventName: "workflow_dispatch",
    artifactName: "ide-accessibility-performance-linux-1",
  };
  const documents = {
    "exact-commit.json": {
      releaseCommit: COMMIT,
      exactCommitBound: true,
    },
    "host-environment.json": {
      releaseCommit: COMMIT,
      operatingSystem: "linux",
      architecture: "x64",
      nodeVersion: process.version,
      hosts: ["vscode", "jetbrains"],
      provenance,
    },
    "assistive-technology.json": {
      schema: "chainlesschain.assistive-technology-probe.v1",
      technology: "orca",
      binaryPresent: true,
      automatedProcessProbeComplete: true,
      externalManualRequired: false,
      speechQualityAssessed: false,
      versionDigest: DIGEST,
    },
    "keyboard-action-ledger.json": {
      actions: Array.from({ length: 6 }, (_, index) => ({ index })),
      approvalTraversal: [{ label: "Approve" }],
      headingActions: [
        {
          action: "heading-focus",
          expected: "turn-user",
          observation: { id: "turn-user", visible: true },
        },
        {
          action: "heading-focus",
          expected: "turn-assistant",
          observation: { id: "turn-assistant", visible: true },
        },
      ],
      keyboardUnreachableActionCount: 0,
      keyboardTrapCount: 0,
      invisibleFocusCount: 0,
    },
    "accessibility-tree.json": {
      capture: "chromium-cdp-full-ax-tree",
      nodes: [{ role: "log", name: "Conversation transcript" }],
      unnamedInteractiveControlCount: 0,
      requiredSemanticMissCount: 0,
    },
    "screen-reader-transcript.json": {
      capture: "semantic-live-region-and-accessible-name-projection",
      announcements: [{ role: "log", name: "Conversation transcript" }],
      eventAnnouncements: [
        "Turn 1, Status: thinking",
        "Turn 1, Tool error: run_shell failed",
        "Turn 1, Permission request: run_shell",
        "Turn 1, Permission request: denied",
        "Turn 1, Assistant response: Hello world",
        "Turn 1, Status: ready",
      ],
      visualTranscriptLiveRegion: false,
      visualTranscriptRole: "region",
      classifiedEventRegion: {
        role: "status",
        live: "polite",
        atomic: "true",
      },
      announcementDuplicateCount: 0,
      streamingTokenReplayCount: 0,
      turnHeadings: ["Turn 1, User message", "Turn 1, Assistant response"],
      speechAudioCaptured: false,
      speechQualityAssessed: false,
      externalManualSpeechReviewRequired: true,
    },
    "focus-transition-ledger.json": {
      transitions: Array.from({ length: 6 }, (_, index) => ({ index })),
      focusRestoreFailureCount: 0,
    },
    "large-input-digests.json": {
      messagesPerSession: 2_000,
      renderedTranscriptNodes: 800,
      transcriptNodeLimit: 800,
      diffBytes: 16 * 1024 * 1024,
      diffDigest: DIGEST,
      logBytes: 64 * 1024 * 1024,
      logDigest: DIGEST,
      sessionCount: 128,
      workbenchSessionLimit: 256,
      diffMarkerVisible: true,
      logMarkerVisible: true,
      diffHeadTailVisible: true,
      logHeadTailVisible: true,
      credentialVisible: false,
      fullCommandVisible: false,
    },
    "performance-samples.json": {
      inputToPaint: { samples: 100, p50Ms: 1, p95Ms: 2, p99Ms: 3, maxMs: 4 },
      scrollToPaint: { samples: 100, p50Ms: 1, p95Ms: 2, p99Ms: 3, maxMs: 4 },
      diffPaintMs: 10,
      logPaintMs: 20,
      workbenchPaintMs: 5,
      thresholds: PROFILE.thresholds,
      thresholdViolations: [],
    },
    "resource-trajectory.json": {
      nodeRssTrajectory: [
        { stage: "before", bytes: 1_000 },
        { stage: "after", bytes: 2_000 },
      ],
      rendererHeapTrajectory: [
        { stage: "before", usedSize: 1_000 },
        { stage: "after", usedSize: 2_000 },
        { stage: "large", usedSize: 3_000 },
        { stage: "workbench", usedSize: 2_500 },
      ],
      descriptorOrHandleDelta: 1,
      orphanProcessCount: 0,
    },
    "diagnostics-scale.json": {
      schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
      commitmentId: "DIAG-SCALE",
      headSha: COMMIT,
      os: "linux",
      runtime: { name: "node+java", version: "v22;21", arch: "x64" },
      profileVersion: DIAGNOSTICS_PROFILE.profileVersion,
      thresholds: DIAGNOSTICS_PROFILE.thresholds,
      measurements: {
        profiles: [
          diagnosticsProfile("vscode"),
          diagnosticsProfile("jetbrains"),
        ],
      },
      testIds: [
        "DIAG-SCALE/vscode-10k-stable-snapshot",
        "DIAG-SCALE/jetbrains-10k-stable-snapshot",
      ],
      producerDigests: Object.fromEntries(
        DIAGNOSTIC_PRODUCER_PATHS.map((sourcePath) => [
          sourcePath,
          digest(fs.readFileSync(path.join(REPOSITORY_ROOT, sourcePath))),
        ]),
      ),
      disposition: "required",
      source: {
        workflowId: provenance.workflowRef,
        runId: provenance.runId,
        jobId: provenance.job,
        artifactName: provenance.artifactName,
      },
      outcome: "passed",
    },
    "jetbrains-native.json": jetbrainsEvidence(),
    "ide-input-performance.json": inputPerformanceEvidence(provenance),
    "outcome-observations.json": {
      success: true,
      keyboardUnreachableActionCount: 0,
      keyboardTrapCount: 0,
      invisibleFocusCount: 0,
      focusRestoreFailureCount: 0,
      unnamedInteractiveControlCount: 0,
      criticalAnnouncementMissCount: 0,
      announcementDuplicateCount: 0,
      streamingTokenReplayCount: 0,
      turnHeadingMissCount: 0,
      unboundedTranscriptGrowthCount: 0,
      silentDiffOrLogTruncationCount: 0,
      uiHangCount: 0,
      credentialLeakCount: 0,
      orphanProcessCount: 0,
      pageErrorCount: 0,
      requiredMeasurementsComplete: true,
      exactCommitBound: true,
      ideInputPerformanceRequiredPassed: true,
      manualSpeechQualityPending: true,
      continuousEightHourHostSoakPending: true,
    },
  };
  for (const [file, value] of Object.entries(documents)) {
    writeJson(directory, file, value);
  }
  const files = Object.fromEntries(
    REQUIRED_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(directory, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(directory, "manifest.json", {
    schema: "chainlesschain.accessibility-performance-manifest.v1",
    releaseCommit: COMMIT,
    operatingSystem: "linux",
    files,
  });
  const producerReader = () => Buffer.from("exact AX producer fixture");
  appendAxTranscriptFragments({
    artifactDir: directory,
    releaseCommit: COMMIT,
    artifactName: provenance.artifactName,
    producerReader,
    requireWorkingTreeMatch: false,
  });
  return { directory, producerReader, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("P2-4 accessibility/performance matrix", () => {
  it("binds the executed workflow bytes to the exact release commit", () => {
    const workflowSha = "c".repeat(40);
    const workflowRef =
      `owner/repo/${ACCESSIBILITY_WORKFLOW_PATH}@refs/heads/feature`;
    const matchingReader = () => Buffer.from("identical workflow bytes");

    expect(
      verifyAccessibilityWorkflowAuthority({
        releaseCommit: COMMIT,
        workflowSha,
        workflowRef,
        required: true,
        githubActions: "true",
        producerReader: matchingReader,
      }),
    ).toMatch(/^sha256:/u);

    expect(() =>
      verifyAccessibilityWorkflowAuthority({
        releaseCommit: COMMIT,
        workflowSha,
        workflowRef,
        required: true,
        githubActions: "true",
        producerReader: (commit) => Buffer.from(commit),
      }),
    ).toThrow(/workflow bytes differ/u);
  });

  it("rejects required workflow provenance outside GitHub Actions", () => {
    expect(() =>
      verifyAccessibilityWorkflowAuthority({
        releaseCommit: COMMIT,
        workflowSha: "c".repeat(40),
        workflowRef:
          `owner/repo/${ACCESSIBILITY_WORKFLOW_PATH}@refs/heads/feature`,
        required: true,
        githubActions: "false",
        producerReader: () => Buffer.from("same"),
      }),
    ).toThrow(/must run in Actions/u);
  });

  it("fixes the exact automated scale and percentile requirements", () => {
    expect(PROFILE).toMatchObject({
      messagesPerSession: 2_000,
      diffBytes: 16 * 1024 * 1024,
      logBytes: 64 * 1024 * 1024,
      sessionCount: 128,
      transcriptPaintSamples: 100,
      scrollPaintSamples: 100,
    });
    expect(summarizeSamples([4, 1, 3, 2])).toMatchObject({
      samples: 4,
      p50Ms: 2,
      p95Ms: 4,
      p99Ms: 4,
    });
  });

  it("keeps VoiceOver speech manual while requiring automated Orca/NVDA probes", () => {
    expect(() =>
      validateAtProbe(
        {
          schema: "chainlesschain.assistive-technology-probe.v1",
          technology: "orca",
          binaryPresent: true,
          automatedProcessProbeComplete: false,
          externalManualRequired: false,
          speechQualityAssessed: false,
          versionDigest: DIGEST,
        },
        "linux",
      ),
    ).toThrow();
    expect(
      validateAtProbe(
        {
          schema: "chainlesschain.assistive-technology-probe.v1",
          technology: "voiceover",
          binaryPresent: true,
          automatedProcessProbeComplete: false,
          externalManualRequired: true,
          speechQualityAssessed: false,
          versionDigest: DIGEST,
        },
        "darwin",
      ),
    ).toMatchObject({ technology: "voiceover" });
  });

  it("declares three OS, both IDEs, failure upload, and fail-closed aggregate", () => {
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-accessibility-performance.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("ubuntu-24.04");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("windows-2025");
    expect(workflow).toContain("AccessibilityPerformanceEvidenceTest");
    expect(workflow).toContain("DiagnosticsSnapshotSchedulerTest");
    expect(workflow).toContain("vscode-ext-diagnostics-scheduler.test.js");
    expect(workflow).toContain("host-dom-relay.test.cjs");
    expect(workflow).toContain(
      "npm install --include=optional --ignore-scripts --no-package-lock --no-save --prefix packages/cli",
    );
    expect(workflow).not.toMatch(/npm install[^\n]*--omit=optional/u);
    expect(workflow).toContain(
      "npm install --ignore-scripts --no-package-lock --no-save --prefix packages/cli playwright@1.61.1",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("needs.accessibility-performance.result");
    expect(workflow).toContain("ax-transcript-audit-fragment.mjs");
    expect(workflow).toContain("--fragment-output-dir");
    expect(workflow).toContain("accessibility-performance-aggregate/fragments");
  });

  it("rehashes the complete zero-failure producer cell", () => {
    const { directory, producerReader, provenance } = createCell();
    expect(
      verifyCell(directory, {
        suffix: "linux",
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
        producerReader,
      }),
    ).toMatchObject({ suffix: "linux" });
    fs.appendFileSync(path.join(directory, "performance-samples.json"), " ");
    expect(() =>
      verifyCell(directory, {
        suffix: "linux",
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
        producerReader,
      }),
    ).toThrow();
  });
});
