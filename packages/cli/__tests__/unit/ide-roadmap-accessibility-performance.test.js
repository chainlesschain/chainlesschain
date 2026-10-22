import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESSIBILITY_WORKFLOW_PATH,
  createBrowserProcessTracker,
  DIAGNOSTIC_PRODUCER_PATHS,
  DIAGNOSTICS_PROFILE,
  evaluateWindowsBrowserClose,
  isObservedWithinWindow,
  killOwnedWindowsProcessTree,
  newOrObservedOwnedProcesses,
  PROFILE,
  REQUIRED_FILES,
  parseLinuxProcessStat,
  parseMacProcessLine,
  parseWindowsProcessSnapshot,
  summarizeSamples,
  validateAtProbe,
  waitForBrowserProcessesToSettle,
  verifyAccessibilityWorkflowAuthority,
} from "../../scripts/ide-roadmap-accessibility-performance.mjs";
import { appendAxTranscriptFragments } from "../../scripts/ax-transcript-audit-fragment.mjs";
import {
  appendSessionUxFragment,
  buildSessionUxNodeEvidence,
  measureSessionUxProjectionSurfaces,
} from "../../scripts/session-ux-audit-fragment.mjs";
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

function processSnapshot(records, complete = true) {
  return {
    platform: "linux",
    complete,
    errors: complete ? [] : ["snapshot-incomplete"],
    records: new Map(records.map((record) => [record.pid, record])),
  };
}

function refreshManifestEntry(directory, file) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bytes = fs.readFileSync(path.join(directory, file));
  manifest.files[file] = { sha256: digest(bytes), bytes: bytes.length };
  writeJson(directory, "manifest.json", manifest);
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

function appendSessionUxFixture(directory, provenance, producerReader) {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), "cc-p2-session-ux-"));
  roots.push(input);
  const measured = measureSessionUxProjectionSurfaces({
    stateFile: path.join(input, "session-workbench.json"),
  });
  const projectionPath = path.join(input, "projection.json");
  writeJson(input, "projection.json", measured.projection);
  const projectionBytes = fs.readFileSync(projectionPath);
  const source = {
    workflowId: provenance.workflowRef,
    runId: provenance.runId,
    jobId: provenance.job,
    artifactName: provenance.artifactName,
  };
  const nodeEvidencePath = path.join(input, "node.json");
  writeJson(
    input,
    "node.json",
    buildSessionUxNodeEvidence({
      headSha: COMMIT,
      platform: "linux",
      source,
      projectionBytes,
      projectionRevision: measured.projection.revision,
      groupRevision: measured.projection.groups.revision,
      cli: measured.cli,
      vscode: {
        ...measured.vscode,
        selectedSessionCount: 128,
        postedMoveSessionCount: 128,
        postedMoveRevisionPreserved: true,
        thinkingExpandedWhileStreaming: true,
        thinkingCollapsedAfterTool: true,
        thinkingCollapsedAfterTurnEnd: true,
        thinkingCollapseFailureCount: 0,
      },
    }),
  );
  const jetbrainsEvidencePath = path.join(input, "jetbrains.json");
  writeJson(input, "jetbrains.json", {
    schema: "chainlesschain.session-ux-jetbrains-evidence.v1",
    headSha: COMMIT,
    platform: "linux",
    javaVersion: "21.0.8",
    javaArch: "amd64",
    source,
    projectionDigest: digest(projectionBytes),
    projectionRevision: measured.projection.revision,
    groupRevision: measured.projection.groups.revision,
    measurements: {
      projectionConnected: true,
      sessionCount: 128,
      groupCount: 1,
      groupRevisionPreserved: true,
      groupedSessionCount: 128,
      focusRowCount: 1,
      pendingQuestionPreserved: true,
      settledAnswerPreserved: true,
      reasoningExpandedBeforeSettlement: true,
      reasoningCollapsedAfterSettlement: true,
      reasoningRestoredAfterToggle: true,
      thinkingCollapseFailureCount: 0,
    },
  });
  appendSessionUxFragment({
    artifactDir: directory,
    releaseCommit: COMMIT,
    artifactName: provenance.artifactName,
    projectionPath,
    nodeEvidencePath,
    jetbrainsEvidencePath,
    environment: {
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW_REF: provenance.workflowRef,
      GITHUB_RUN_ID: provenance.runId,
      GITHUB_JOB: provenance.job,
      CC_P2_ARTIFACT: provenance.artifactName,
    },
    platform: "linux",
    producerReader,
    requireWorkingTreeMatch: false,
    headReader: () => COMMIT,
  });
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
      processLifecycle: {
        schema: "chainlesschain.browser-process-lifecycle.v1",
        identityPrecision: "linux-proc-start-time-ticks",
        processTreeIdentityPrecision: "proc-parent-and-start-time",
        observationComplete: true,
        ownedDescendantIdentityComplete: true,
        rootDescendantTrackingComplete: true,
        baselineIdentityComplete: true,
        finalObservationComplete: true,
        finalObservationErrors: [],
        passed: true,
        shutdownSettled: true,
        shutdownSettleTimeoutMs: 5_000,
        shutdownSettleElapsedMs: 750,
        shutdownSettleCleanSampleCount: 3,
        browserCloseSucceeded: true,
        browserCloseTimedOut: false,
        browserServerCloseSucceeded: true,
        browserServerCloseTimedOut: false,
        browserServerKillSucceeded: false,
        browserServerKillTimedOut: false,
        rootProcessHandleObserved: true,
        rootProcessPid: 42,
        rootProcessIdentity: "42:4200",
        rootProcessRecord: {
          pid: 42,
          ppid: 1,
          pgrp: 42,
          session: 42,
          state: "S",
          name: "node",
          startIdentity: "4200",
          stage: "launched",
        },
        rootProcessExitObserved: true,
        rootProcessCloseObserved: true,
        forcedCleanupAttempted: false,
        cleanupErrorCount: 0,
        cleanupErrorDigests: [],
        observationErrors: [],
        sampleCount: 7,
        baselineBrowserProcesses: [],
        observations: [
          { stage: "initial", complete: true, browserProcessCount: 0 },
          { stage: "launched", complete: true, browserProcessCount: 0 },
          {
            stage: "shutdown-pre-close",
            complete: true,
            terminalClean: true,
            survivorCount: 0,
            browserProcessCount: 0,
          },
          {
            stage: "shutdown-settle",
            complete: true,
            terminalClean: true,
            survivorCount: 0,
            browserProcessCount: 0,
          },
          {
            stage: "shutdown-settle",
            complete: true,
            terminalClean: true,
            survivorCount: 0,
            browserProcessCount: 0,
          },
          {
            stage: "shutdown-settle",
            complete: true,
            terminalClean: true,
            survivorCount: 0,
            browserProcessCount: 0,
          },
          {
            stage: "campaign-final",
            complete: true,
            terminalClean: true,
            survivorCount: 0,
            browserProcessCount: 0,
          },
        ],
        observedNewBrowserProcesses: [],
        observedOwnedDescendantProcesses: [],
        settledBrowserProcesses: [],
        orphanProcessCount: 0,
      },
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
      browserProcessLifecyclePassed: true,
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
  appendSessionUxFixture(directory, provenance, producerReader);
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
  it("parses stable Linux and macOS process identities with state and parent", () => {
    const linuxFields = [
      "S",
      "21",
      "20",
      "19",
      ...Array(15).fill("0"),
      "12345",
    ];
    expect(
      parseLinuxProcessStat(22, `22 (chrome) ${linuxFields.join(" ")}`),
    ).toMatchObject({
      pid: 22,
      ppid: 21,
      pgrp: 20,
      session: 19,
      state: "S",
      name: "chrome",
      startIdentity: "12345",
    });
    expect(
      parseMacProcessLine(
        " 123 1 Z Mon Oct 19 09:20:30 2026 /Applications/Chromium.app/Contents/MacOS/Chromium",
      ),
    ).toMatchObject({
      pid: 123,
      ppid: 1,
      state: "Z",
      startIdentity: "Mon Oct 19 09:20:30 2026",
      name: "Chromium",
    });
  });

  it("parses Windows parent and creation identities from CIM records", () => {
    const snapshot = parseWindowsProcessSnapshot(
      JSON.stringify([
        {
          ProcessId: 52,
          ParentProcessId: 42,
          Name: "chrome.exe",
          CreationDate: "20261019102030.123456+480",
        },
      ]),
    );
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.records.get(52)).toMatchObject({
      pid: 52,
      ppid: 42,
      name: "chrome.exe",
      startIdentity: "20261019102030.123456+480",
    });
  });

  it("marks Windows process snapshots incomplete when creation identity is missing", () => {
    const snapshot = parseWindowsProcessSnapshot(
      JSON.stringify([
        {
          ProcessId: 53,
          ParentProcessId: 42,
          Name: "worker.exe",
          CreationDate: null,
        },
      ]),
    );

    expect(snapshot.records.get(53).startIdentity).toBeNull();
    expect(snapshot.errors).toEqual(["missing-win32-process-creation-time:53"]);
  });

  it("bounds Windows cleanup to the owned Playwright PID and its tree", () => {
    const execute = vi
      .fn()
      .mockReturnValue({ stdout: "", stderr: "", status: 0 });

    expect(killOwnedWindowsProcessTree(42, execute)).toEqual({
      stdout: "",
      stderr: "",
      status: 0,
    });
    expect(execute).toHaveBeenCalledWith(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", "42", "/T", "/F"],
      expect.objectContaining({
        timeout: 5_000,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("refuses Windows tree cleanup without an owned PID", () => {
    const execute = vi.fn();

    expect(() => killOwnedWindowsProcessTree(null, execute)).toThrow(
      "Cannot safely terminate Playwright without its owned root PID",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a clean root exit before accepting a Windows browser close", () => {
    const expectedDisconnect = {
      ok: false,
      error: new Error("Target page, context or browser has been closed"),
    };
    const closeEvidence = {
      closeCommandIssued: true,
      closeCommandOutcome: expectedDisconnect,
      closeEventsObservedWithinDeadline: true,
    };

    expect(
      evaluateWindowsBrowserClose({
        ...closeEvidence,
        browserProcess: { exitCode: 0, signalCode: null },
      }),
    ).toEqual({
      cleanProcessExit: true,
      expectedCloseDisconnect: true,
      succeeded: true,
    });
    expect(
      evaluateWindowsBrowserClose({
        ...closeEvidence,
        browserProcess: { exitCode: 1, signalCode: null },
      }),
    ).toEqual({
      cleanProcessExit: false,
      expectedCloseDisconnect: false,
      succeeded: false,
    });
    expect(
      evaluateWindowsBrowserClose({
        ...closeEvidence,
        browserProcess: { exitCode: null, signalCode: "SIGTERM" },
      }).succeeded,
    ).toBe(false);
  });

  it("accepts Windows close events only after the command and within its deadline", () => {
    const observer = { observed: true, observedAt: 200 };

    expect(isObservedWithinWindow(observer, true, 100, 200)).toBe(true);
    expect(isObservedWithinWindow(observer, false, 100, 200)).toBe(false);
    expect(isObservedWithinWindow(observer, true, 200, 300)).toBe(false);
    expect(
      isObservedWithinWindow({ ...observer, observedAt: 201 }, true, 100, 200),
    ).toBe(false);
  });

  it("retains a browser process identity after reparenting and reports zombies", () => {
    const baseline = processSnapshot([
      {
        pid: 10,
        ppid: 1,
        pgrp: 10,
        session: 10,
        state: "S",
        name: "chrome",
        startIdentity: "100",
      },
    ]);
    const tracker = createBrowserProcessTracker(baseline);
    tracker.observe(
      processSnapshot([
        {
          pid: 10,
          ppid: 1,
          pgrp: 10,
          session: 10,
          state: "S",
          name: "chrome",
          startIdentity: "100",
        },
        {
          pid: 30,
          ppid: 25,
          pgrp: 30,
          session: 30,
          state: "S",
          name: "chromium",
          startIdentity: "300",
        },
      ]),
      "journey",
    );
    const reparented = {
      pid: 30,
      ppid: 1,
      pgrp: 30,
      session: 30,
      state: "Z",
      name: "chromium",
      startIdentity: "300",
    };
    const finalSnapshot = processSnapshot([
      baseline.records.get(10),
      reparented,
    ]);
    tracker.observe(finalSnapshot, "shutdown-settle");

    expect(tracker.survivors(finalSnapshot)).toEqual([reparented]);
    expect([...tracker.ledger.values()][0]).toMatchObject({
      identity: "30:300",
      firstRecord: { ppid: 25, state: "S" },
      lastRecord: { ppid: 1, state: "Z" },
      ownership: "unresolved",
    });
  });

  it("excludes new descendants of an unchanged user browser from every lifecycle sample", () => {
    const userRoot = { pid: 10, ppid: 1, name: "chrome", startIdentity: "100" };
    const userChild = {
      pid: 11,
      ppid: 10,
      name: "chrome",
      startIdentity: "110",
    };
    const userGrandchild = {
      pid: 12,
      ppid: 11,
      name: "chrome",
      startIdentity: "120",
    };
    const root = { pid: 42, ppid: 1, name: "chromium", startIdentity: "420" };
    const baseline = processSnapshot([userRoot]);
    const tracker = createBrowserProcessTracker(baseline);
    tracker.setRootProcess(root.pid, root);
    tracker.observe(
      processSnapshot([userRoot, userChild, userGrandchild, root]),
      "launched",
    );
    expect([...tracker.ledger.keys()]).toEqual(["42:420"]);
    expect(
      tracker.observations.at(-1).browserProcesses.map((row) => row.pid),
    ).toEqual([42]);

    const finalSnapshot = processSnapshot([
      userRoot,
      userChild,
      userGrandchild,
    ]);
    tracker.observe(finalSnapshot, "shutdown-settle");
    expect(tracker.survivors(finalSnapshot)).toEqual([]);
    expect(tracker.observations.at(-1)).toMatchObject({
      complete: true,
      terminalClean: true,
      survivorCount: 0,
    });
    expect(
      newOrObservedOwnedProcesses(
        finalSnapshot,
        baseline,
        new Set(tracker.ledger.keys()),
        root,
      ),
    ).toEqual([]);
  });

  it("retains an owned process and its new children after reparenting under a user browser", () => {
    const userRoot = { pid: 10, ppid: 1, name: "chrome", startIdentity: "100" };
    // Even when launched beneath a baseline browser, the explicit test root
    // and all observed descendants must take precedence over that ancestry.
    const root = { pid: 42, ppid: 10, name: "chromium", startIdentity: "420" };
    const worker = { pid: 43, ppid: 42, name: "worker", startIdentity: "430" };
    const baseline = processSnapshot([userRoot]);
    const tracker = createBrowserProcessTracker(baseline);
    tracker.setRootProcess(root.pid, root);
    tracker.observe(processSnapshot([userRoot, root, worker]), "launched");
    expect([...tracker.ledger.keys()]).toEqual(["42:420"]);
    expect([...tracker.ownedDescendantLedger.keys()]).toEqual(["43:430"]);

    const reparented = { ...worker, ppid: 10 };
    const child = { pid: 44, ppid: 43, name: "chromium", startIdentity: "440" };
    const finalSnapshot = processSnapshot([userRoot, reparented, child]);
    // Check the campaign's independent classification before the child is
    // recorded, as well as the tracker's subsequent shutdown sample.
    expect(
      newOrObservedOwnedProcesses(
        finalSnapshot,
        baseline,
        new Set(["42:420", "43:430"]),
        root,
      ),
    ).toEqual([reparented, child]);
    tracker.observe(finalSnapshot, "shutdown-settle");
    expect(tracker.survivors(finalSnapshot)).toEqual([reparented, child]);
    expect(tracker.observations.at(-1).terminalClean).toBe(false);
  });

  it.each(["reused-identity", null])(
    "does not exclude descendants when a baseline browser identity becomes %s",
    (startIdentity) => {
      const userRoot = {
        pid: 10,
        ppid: 1,
        name: "chrome",
        startIdentity: "100",
      };
      const replacedRoot = { ...userRoot, startIdentity };
      const child = { pid: 11, ppid: 10, name: "chrome", startIdentity: "110" };
      const baseline = processSnapshot([userRoot]);
      const snapshot = processSnapshot([replacedRoot, child]);
      const tracker = createBrowserProcessTracker(baseline);
      tracker.observe(snapshot, "shutdown-settle");
      expect(tracker.survivors(snapshot)).toContainEqual(child);
      expect(
        newOrObservedOwnedProcesses(snapshot, baseline, new Set(), null),
      ).toContainEqual(child);
      expect(tracker.observations.at(-1).terminalClean).toBe(false);
      if (startIdentity == null) {
        expect(tracker.observationErrors).toContain(
          "process-identity-missing:10",
        );
      }
    },
  );

  it("retains non-browser descendants after the Playwright root exits", () => {
    const tracker = createBrowserProcessTracker(processSnapshot([]));
    const root = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "4200",
    };
    const browser = {
      pid: 51,
      ppid: 42,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "chrome",
      startIdentity: "5100",
    };
    const worker = {
      pid: 52,
      ppid: 51,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "5200",
    };
    tracker.setRootProcess(42, root);
    tracker.observe(processSnapshot([root, browser, worker]), "launched");

    const reparentedWorker = { ...worker, ppid: 1 };
    const finalSnapshot = processSnapshot([reparentedWorker]);
    tracker.observe(finalSnapshot, "shutdown-settle");

    expect(tracker.survivors(finalSnapshot)).toEqual([reparentedWorker]);
    expect([...tracker.ownedDescendantLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identity: "52:5200",
          firstRecord: { ...worker, stage: "launched" },
        }),
      ]),
    );
  });

  it("tracks children of a known descendant after it is reparented", () => {
    const tracker = createBrowserProcessTracker(processSnapshot([]));
    const root = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "4200",
    };
    const knownDescendant = {
      pid: 43,
      ppid: 42,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "4300",
    };
    tracker.setRootProcess(42, root);
    tracker.observe(processSnapshot([root, knownDescendant]), "journey");

    const reparentedDescendant = { ...knownDescendant, ppid: 1 };
    const newChild = {
      pid: 44,
      ppid: 43,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker-child",
      startIdentity: "4400",
    };
    const snapshot = processSnapshot([reparentedDescendant, newChild]);
    tracker.observe(snapshot, "shutdown-settle");

    expect(tracker.survivors(snapshot)).toEqual([
      reparentedDescendant,
      newChild,
    ]);
    expect([...tracker.ownedDescendantLedger.keys()]).toEqual(
      expect.arrayContaining(["43:4300", "44:4400"]),
    );
  });

  it("does not count a baseline process whose stale parent PID is reused", () => {
    const baselineRoot = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "old-root",
    };
    const baselineChild = {
      pid: 43,
      ppid: 42,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "baseline-child",
    };
    const baseline = processSnapshot([baselineRoot, baselineChild]);
    const tracker = createBrowserProcessTracker(baseline);
    const reusedRoot = {
      ...baselineRoot,
      name: "node",
      startIdentity: "new-root",
    };
    tracker.setRootProcess(42, reusedRoot);
    const snapshot = processSnapshot([reusedRoot, baselineChild]);
    tracker.observe(snapshot, "launched");

    expect(tracker.survivors(snapshot)).toEqual([]);
    expect(tracker.ownedDescendantLedger.size).toBe(0);
  });

  it("does not discard a new process when the baseline PID lacked identity", () => {
    const baselineProcess = {
      pid: 43,
      ppid: 1,
      pgrp: 43,
      session: 43,
      state: "S",
      name: "worker",
      startIdentity: null,
    };
    const baseline = processSnapshot([baselineProcess], false);
    const tracker = createBrowserProcessTracker(baseline);
    const root = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "4200",
    };
    const newWorker = { ...baselineProcess, ppid: 42, startIdentity: "4300" };
    tracker.setRootProcess(42, root);
    const snapshot = processSnapshot([root, newWorker]);
    tracker.observe(snapshot, "launched");

    expect(tracker.baselineIdentityComplete).toBe(false);
    expect(tracker.survivors(snapshot)).toEqual([newWorker]);
    expect(
      newOrObservedOwnedProcesses(snapshot, baseline, new Set(), root),
    ).toEqual([newWorker]);
  });

  it("keeps a known descendant as a survivor when a later identity is missing", () => {
    const tracker = createBrowserProcessTracker(processSnapshot([]));
    const root = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "4200",
    };
    const descendant = {
      pid: 43,
      ppid: 42,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "4300",
    };
    tracker.setRootProcess(42, root);
    tracker.observe(processSnapshot([root, descendant]), "journey");

    const identityMissing = { ...descendant, ppid: 1, startIdentity: null };
    const snapshot = processSnapshot([identityMissing], false);
    tracker.observe(snapshot, "shutdown-settle");

    expect(tracker.survivors(snapshot)).toEqual([identityMissing]);
    expect(tracker.observationErrors).toContain("snapshot-incomplete");
    expect(
      newOrObservedOwnedProcesses(
        snapshot,
        processSnapshot([]),
        new Set(["43:4300"]),
        root,
      ),
    ).toEqual([identityMissing]);
  });

  it("excludes baseline identities from the final campaign process set", () => {
    const baselineRoot = {
      pid: 42,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "node",
      startIdentity: "old-root",
    };
    const baselineChild = {
      pid: 43,
      ppid: 42,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "baseline-child",
    };
    const baseline = processSnapshot([baselineRoot, baselineChild]);
    const reusedRoot = { ...baselineRoot, startIdentity: "new-root" };
    const finalSnapshot = processSnapshot([reusedRoot, baselineChild]);

    expect(
      newOrObservedOwnedProcesses(
        finalSnapshot,
        baseline,
        new Set(),
        reusedRoot,
      ),
    ).toEqual([]);
  });

  it("finds new children of known descendants in the final campaign sample", () => {
    const baseline = processSnapshot([]);
    const reparentedDescendant = {
      pid: 43,
      ppid: 1,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker",
      startIdentity: "4300",
    };
    const newChild = {
      pid: 44,
      ppid: 43,
      pgrp: 42,
      session: 42,
      state: "S",
      name: "worker-child",
      startIdentity: "4400",
    };

    expect(
      newOrObservedOwnedProcesses(
        processSnapshot([reparentedDescendant, newChild]),
        baseline,
        new Set(["43:4300"]),
        { pid: 42, startIdentity: "4200" },
      ),
    ).toEqual([reparentedDescendant, newChild]);
  });

  it("continues tracking a browser process after its executable name changes", () => {
    const tracker = createBrowserProcessTracker(processSnapshot([]));
    tracker.observe(
      processSnapshot([
        {
          pid: 44,
          ppid: 1,
          pgrp: 44,
          session: 44,
          state: "S",
          name: "chrome",
          startIdentity: "4400",
        },
      ]),
      "journey",
    );
    const renamed = {
      pid: 44,
      ppid: 1,
      pgrp: 44,
      session: 44,
      state: "S",
      name: "worker",
      startIdentity: "4400",
    };
    const snapshot = processSnapshot([renamed]);
    tracker.observe(snapshot, "shutdown-settle");

    expect(tracker.survivors(snapshot)).toEqual([renamed]);
    expect(tracker.observations.at(-1)).toMatchObject({
      terminalClean: false,
      survivorCount: 1,
      previouslyObservedProcesses: [{ name: "worker", pid: 44 }],
    });
  });

  it("waits for transient browser shutdown but leaves persistent processes failing", async () => {
    const baseline = processSnapshot([]);
    const transient = {
      pid: 31,
      ppid: 1,
      pgrp: 31,
      session: 31,
      state: "S",
      name: "headless_shell",
      startIdentity: "310",
    };
    const transientTracker = createBrowserProcessTracker(baseline);
    const samples = [
      processSnapshot([transient]),
      processSnapshot([]),
      processSnapshot([]),
      processSnapshot([]),
    ];
    const settled = await waitForBrowserProcessesToSettle(transientTracker, {
      timeoutMs: 1_000,
      intervalMs: 1,
      stableSamples: 3,
      snapshotReader: () => samples.shift() || processSnapshot([]),
    });
    expect(settled.settled).toBe(true);
    expect(transientTracker.ledger.size).toBe(1);

    const persistentTracker = createBrowserProcessTracker(baseline);
    const blocked = await waitForBrowserProcessesToSettle(persistentTracker, {
      timeoutMs: 8,
      intervalMs: 1,
      stableSamples: 2,
      snapshotReader: () => processSnapshot([transient]),
    });
    expect(blocked.settled).toBe(false);
    expect(persistentTracker.survivors(blocked.finalSnapshot)).toHaveLength(1);
  });

  it("does not accept a clean sample that completes after the settle deadline", async () => {
    const tracker = createBrowserProcessTracker(processSnapshot([]));
    const blocked = await waitForBrowserProcessesToSettle(tracker, {
      timeoutMs: 10,
      intervalMs: 1,
      stableSamples: 1,
      wait: async () => {},
      snapshotReader: () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
        return processSnapshot([]);
      },
    });

    expect(blocked.settled).toBe(false);
    expect(blocked.sampleCount).toBe(1);
  });

  it("binds the executed workflow bytes to the exact release commit", () => {
    const workflowSha = "c".repeat(40);
    const workflowRef = `owner/repo/${ACCESSIBILITY_WORKFLOW_PATH}@refs/heads/feature`;
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
        workflowRef: `owner/repo/${ACCESSIBILITY_WORKFLOW_PATH}@refs/heads/feature`,
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
    expect(workflow).toContain("uses: ./.github/actions/setup-node-deps");
    expect(workflow).not.toMatch(/npm install[^\n]*--prefix packages\/cli/u);
    expect(workflow).toContain(
      "node node_modules/playwright/cli.js install --with-deps chromium",
    );
    expect(workflow).toContain(
      "node node_modules/playwright/cli.js install chromium",
    );
    expect(workflow).toContain("node ../../node_modules/vitest/vitest.mjs run");
    expect(workflow).toContain("--config vitest.config.js");
    expect(workflow).toContain("if: ${{ always() && !cancelled() }}");
    expect(workflow).toContain("needs.accessibility-performance.result");
    expect(workflow).toContain("ax-transcript-audit-fragment.mjs");
    expect(workflow).toContain("session-ux-audit-fragment.mjs");
    expect(workflow).toContain("--fragment-output-dir");
    expect(workflow).toContain("accessibility-performance-aggregate/fragments");
    const verifier = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../scripts/verify-ide-roadmap-accessibility-performance.mjs",
      ),
      "utf8",
    );
    for (const output of [
      "diag-scale-${cell.suffix}.json",
      "ide-input-perf-${cell.suffix}.json",
      "session-ux-${cell.suffix}.json",
      "ax-transcript-${cell.suffix}.json",
    ]) {
      expect(verifier).toContain(output);
    }
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

  it("rejects lifecycle evidence that did not settle cleanly", () => {
    const { directory, producerReader, provenance } = createCell();
    const file = "resource-trajectory.json";
    const resources = JSON.parse(
      fs.readFileSync(path.join(directory, file), "utf8"),
    );
    resources.processLifecycle.shutdownSettled = false;
    writeJson(directory, file, resources);
    refreshManifestEntry(directory, file);

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

  it("rejects fewer than three clean shutdown-settle samples", () => {
    const { directory, producerReader, provenance } = createCell();
    const file = "resource-trajectory.json";
    const resources = JSON.parse(
      fs.readFileSync(path.join(directory, file), "utf8"),
    );
    resources.processLifecycle.observations =
      resources.processLifecycle.observations.filter(
        (sample, index) => !(sample.stage === "shutdown-settle" && index === 4),
      );
    resources.processLifecycle.sampleCount =
      resources.processLifecycle.observations.length;
    resources.processLifecycle.shutdownSettleCleanSampleCount = 2;
    writeJson(directory, file, resources);
    refreshManifestEntry(directory, file);

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
