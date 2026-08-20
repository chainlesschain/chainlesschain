import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROFILE,
  REQUIRED_FILES,
  summarizeSamples,
  validateAtProbe,
} from "../../scripts/ide-roadmap-accessibility-performance.mjs";
import { verifyCell } from "../../scripts/verify-ide-roadmap-accessibility-performance.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const roots = [];

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
    "jetbrains-native.json": jetbrainsEvidence(),
    "outcome-observations.json": {
      success: true,
      keyboardUnreachableActionCount: 0,
      keyboardTrapCount: 0,
      invisibleFocusCount: 0,
      focusRestoreFailureCount: 0,
      unnamedInteractiveControlCount: 0,
      criticalAnnouncementMissCount: 0,
      unboundedTranscriptGrowthCount: 0,
      silentDiffOrLogTruncationCount: 0,
      uiHangCount: 0,
      credentialLeakCount: 0,
      orphanProcessCount: 0,
      pageErrorCount: 0,
      requiredMeasurementsComplete: true,
      exactCommitBound: true,
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
  return { directory, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("P2-4 accessibility/performance matrix", () => {
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
    expect(workflow).toContain("host-dom-relay.test.cjs");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("needs.accessibility-performance.result");
  });

  it("rehashes the complete zero-failure producer cell", () => {
    const { directory, provenance } = createCell();
    expect(
      verifyCell(directory, {
        suffix: "linux",
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({ suffix: "linux" });
    fs.appendFileSync(path.join(directory, "performance-samples.json"), " ");
    expect(() =>
      verifyCell(directory, {
        suffix: "linux",
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toThrow();
  });
});
