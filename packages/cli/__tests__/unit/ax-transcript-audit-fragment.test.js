import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVISORY_FRAGMENT_FILE,
  AX_TRANSCRIPT_PRODUCER_PATHS,
  AX_TRANSCRIPT_TEST_IDS,
  AX_TRANSCRIPT_THRESHOLDS,
  INPUT_FILES,
  REQUIRED_FRAGMENT_FILE,
  appendAxTranscriptFragments,
  buildAxTranscriptFragments,
  digest,
  validateFragmentShape,
  verifyAxTranscriptFragments,
} from "../../scripts/ax-transcript-audit-fragment.mjs";

const HEAD = "a".repeat(40);
const roots = [];

function percentile() {
  return { samples: 100, p50Ms: 1, p95Ms: 2, p99Ms: 3, maxMs: 4 };
}

function documents() {
  return {
    "exact-commit.json": { releaseCommit: HEAD, exactCommitBound: true },
    "host-environment.json": {
      releaseCommit: HEAD,
      operatingSystem: "linux",
      architecture: "x64",
      nodeVersion: process.version,
      hosts: ["vscode", "jetbrains"],
      provenance: {
        repository: "owner/repo",
        workflowRef:
          "owner/repo/.github/workflows/ide-roadmap-accessibility-performance.yml@refs/heads/main",
        workflowSha: HEAD,
        runId: "42",
        runAttempt: "1",
        job: "accessibility-performance",
        eventName: "workflow_dispatch",
        artifactName: "ide-accessibility-performance-linux-1",
      },
    },
    "assistive-technology.json": {
      schema: "chainlesschain.assistive-technology-probe.v1",
      technology: "orca",
      probeScope: "binary-version-process",
      binaryPresent: true,
      automatedProcessProbeComplete: true,
      externalManualRequired: false,
      speechQualityAssessed: false,
      versionDigest: `sha256:${"b".repeat(64)}`,
    },
    "keyboard-action-ledger.json": {
      actions: Array.from({ length: 6 }, (_, index) => ({ index })),
      approvalTraversal: [{ label: "Approve" }],
      headingActions: [{ index: 0 }, { index: 1 }],
      keyboardUnreachableActionCount: 0,
      keyboardTrapCount: 0,
      invisibleFocusCount: 0,
    },
    "accessibility-tree.json": {
      capture: "chromium-cdp-full-ax-tree",
      nodes: [{ role: "heading", name: "Turn 1, User message" }],
      unnamedInteractiveControlCount: 0,
      requiredSemanticMissCount: 0,
    },
    "screen-reader-transcript.json": {
      capture: "semantic-live-region-and-accessible-name-projection",
      eventAnnouncements: [
        "Turn 1, Assistant response: complete",
        "Turn 1, Permission request: npm test",
        "Turn 1, Tool error: failed",
        "Turn 1, Status: thinking",
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
    },
    "performance-samples.json": {
      inputToPaint: percentile(),
      scrollToPaint: percentile(),
      diffPaintMs: 10,
      logPaintMs: 20,
      workbenchPaintMs: 5,
    },
    "resource-trajectory.json": {
      nodeRssTrajectory: [
        { stage: "before", bytes: 1_000 },
        { stage: "after", bytes: 2_000 },
      ],
      rendererHeapTrajectory: [
        { stage: "before", usedSize: 1_000 },
        { stage: "after", usedSize: 2_000 },
      ],
      descriptorOrHandleDelta: 1,
    },
    "jetbrains-native.json": {
      inputToPaint: percentile(),
      scrollToPaint: percentile(),
      diffPaintMs: 10,
      logPaintMs: 20,
      sessionProjectionMs: 5,
      transcriptBounded: true,
      accessibleNamePresent: true,
      accessibleDescriptionPresent: true,
      focusable: true,
    },
    "outcome-observations.json": {
      criticalAnnouncementMissCount: 0,
      turnHeadingMissCount: 0,
    },
  };
}

function producerDigests() {
  return Object.fromEntries(
    AX_TRANSCRIPT_PRODUCER_PATHS.map((producerPath) => [
      producerPath,
      digest(Buffer.from("exact AX producer fixture")),
    ]),
  );
}

function writeArtifact() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-ax-transcript-fragment-"),
  );
  roots.push(directory);
  const docs = documents();
  const files = {};
  for (const file of INPUT_FILES) {
    const bytes = Buffer.from(`${JSON.stringify(docs[file])}\n`);
    fs.writeFileSync(path.join(directory, file), bytes);
    files[file] = { sha256: digest(bytes), bytes: bytes.length };
  }
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    `${JSON.stringify({
      schema: "chainlesschain.accessibility-performance-manifest.v1",
      releaseCommit: HEAD,
      operatingSystem: "linux",
      files,
    })}\n`,
  );
  return directory;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("AX-TRANSCRIPT canonical audit fragments", () => {
  it("binds real required measurements and keeps native AT speech outside the required claim", () => {
    const fragments = buildAxTranscriptFragments({
      documents: documents(),
      headSha: HEAD,
      artifactName: "ide-accessibility-performance-linux-1",
      producerDigests: producerDigests(),
    });

    expect(fragments.required).toMatchObject({
      schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
      commitmentId: "AX-TRANSCRIPT",
      headSha: HEAD,
      os: "linux",
      profileVersion: "ax-transcript/v1",
      thresholds: AX_TRANSCRIPT_THRESHOLDS,
      testIds: AX_TRANSCRIPT_TEST_IDS,
      disposition: "required",
      outcome: "passed",
      measurements: {
        automationBoundary: {
          nativeAssistiveTechnologyDisposition: "advisory",
          nativeAssistiveTechnologyConsumedSemanticTree: false,
          speechAudioCaptured: false,
          speechQualityAssessed: false,
          externalManualSpeechReviewRequired: true,
        },
      },
    });
    expect(fragments.advisory).toMatchObject({
      profileVersion: "ax-transcript/native-at-probe/v1",
      disposition: "advisory",
      outcome: "passed",
      measurements: {
        technology: "orca",
        probeScope: "binary-version-process",
        nativeAssistiveTechnologyConsumedSemanticTree: false,
        speechAudioCaptured: false,
        speechQualityAssessed: false,
        externalManualSpeechReviewRequired: true,
      },
    });
    expect(() =>
      validateFragmentShape(
        { ...fragments.advisory, disposition: "required" },
        "advisory",
      ),
    ).toThrow();
  });

  it("rehashes exact-head producers and detects a self-consistent fragment tamper", () => {
    const directory = writeArtifact();
    const producerReader = () => Buffer.from("exact AX producer fixture");
    appendAxTranscriptFragments({
      artifactDir: directory,
      releaseCommit: HEAD,
      artifactName: "ide-accessibility-performance-linux-1",
      producerReader,
      requireWorkingTreeMatch: false,
    });
    expect(
      verifyAxTranscriptFragments({
        artifactDir: directory,
        releaseCommit: HEAD,
        artifactName: "ide-accessibility-performance-linux-1",
        producerReader,
      }),
    ).toMatchObject({
      required: { disposition: "required", outcome: "passed" },
      advisory: { disposition: "advisory" },
    });

    const fragmentPath = path.join(directory, REQUIRED_FRAGMENT_FILE);
    const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
    fragment.producerDigests[AX_TRANSCRIPT_PRODUCER_PATHS[0]] =
      `sha256:${"0".repeat(64)}`;
    fs.writeFileSync(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`);
    const fragmentBytes = fs.readFileSync(fragmentPath);
    const manifestPath = path.join(directory, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files[REQUIRED_FRAGMENT_FILE] = {
      sha256: digest(fragmentBytes),
      bytes: fragmentBytes.length,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    expect(() =>
      verifyAxTranscriptFragments({
        artifactDir: directory,
        releaseCommit: HEAD,
        artifactName: "ide-accessibility-performance-linux-1",
        producerReader,
      }),
    ).toThrow();
  });

  it("integrity-binds both canonical files into the producer manifest", () => {
    const directory = writeArtifact();
    appendAxTranscriptFragments({
      artifactDir: directory,
      releaseCommit: HEAD,
      artifactName: "ide-accessibility-performance-linux-1",
      producerReader: () => Buffer.from("exact AX producer fixture"),
      requireWorkingTreeMatch: false,
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
    for (const file of [REQUIRED_FRAGMENT_FILE, ADVISORY_FRAGMENT_FILE]) {
      const bytes = fs.readFileSync(path.join(directory, file));
      expect(manifest.files[file]).toEqual({
        sha256: digest(bytes),
        bytes: bytes.length,
      });
    }
  });
});
