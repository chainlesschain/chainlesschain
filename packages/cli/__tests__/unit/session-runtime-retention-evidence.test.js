import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVISORY_PROFILE_VERSION,
  ADVISORY_THRESHOLDS,
  COMMITMENT_ID,
  CONTRACT_TESTS,
  FRAGMENT_SCHEMA,
  LOCAL_TEST_IDS,
  LOCAL_PROFILE_VERSION,
  PRODUCERS,
  REQUIRED_PROFILE_VERSION,
  REQUIRED_THRESHOLDS,
  TEST_IDS,
  parseArgs,
  sourceFromEnvironment,
  validateFragment,
  validateSessionScaleResult,
  verifyEvidenceSet,
} from "../../scripts/verify-session-runtime-retention.mjs";

const HEAD_SHA = "a".repeat(40);
const PRODUCER_DIGESTS = Object.fromEntries(
  PRODUCERS.map((producer, index) => [
    producer,
    `sha256:${String(index).padStart(64, "0")}`,
  ]),
);
const TEMPORARY_ROOTS = [];
const RUNNER_BY_OS = {
  linux: "ubuntu-latest",
  macos: "macos-latest",
  windows: "windows-latest",
};

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

afterEach(() => {
  while (TEMPORARY_ROOTS.length > 0) {
    rmSync(TEMPORARY_ROOTS.pop(), { recursive: true, force: true });
  }
});

function sessionScale(mode = "formal", os = "linux") {
  const formal = mode === "formal";
  const parameters = formal
    ? {
        writers: 20,
        eventsPerWriter: 1_000,
        sessionCount: 10_000,
        transcriptBytes: 1024 ** 3,
        listSamples: 25,
        resumeSamples: 15,
        coldResumeSamples: 15,
        actualKillCases: 6,
        exhaustiveCuts: true,
      }
    : {
        writers: 3,
        eventsPerWriter: 25,
        sessionCount: 250,
        transcriptBytes: 64 * 1024 ** 2,
        listSamples: 5,
        resumeSamples: 5,
        coldResumeSamples: 3,
        actualKillCases: 2,
        exhaustiveCuts: false,
      };
  const expectedProbeEvents = parameters.writers * parameters.eventsPerWriter;
  return {
    schema: "cc-cli-session-scale-result/v1",
    status: "passed",
    exactSha: HEAD_SHA,
    expectedSha: HEAD_SHA,
    trackedWorktreeDirty: false,
    gateSourcePathsExact: true,
    platform: { linux: "linux", macos: "darwin", windows: "win32" }[os],
    node: "v22.12.0",
    arch: "x64",
    parameters: {
      mode,
      ...parameters,
      thresholds: {
        profile: "uniform-v1",
        listP95Ms: 200,
        listRssMb: 100,
        resumeP95Ms: 2_000,
        resumeRssMb: 100,
        resumeMaxIoBytes: 1_048_576,
      },
    },
    scenarios: {
      concurrentAppend: {
        pass: true,
        parameters: {
          writers: parameters.writers,
          eventsPerWriter: parameters.eventsPerWriter,
        },
        expectedProbeEvents,
        observedProbeEvents: expectedProbeEvents,
        uniqueProbeEvents: expectedProbeEvents,
        chainedEvents: expectedProbeEvents + 1,
        chainStatus: "verified",
      },
      indexedList: {
        pass: true,
        fixture: {
          sessionCount: parameters.sessionCount,
          sidecarEntries: parameters.sessionCount,
        },
        samples: Array.from({ length: parameters.listSamples }, () => 12),
        p95Ms: 12,
        peakRssMb: 45,
      },
      checkpointResume: {
        pass: true,
        fixture: {
          logicalBytes: parameters.transcriptBytes,
          fullChainStatus: "verified",
          productionSidecarAnchored: true,
        },
        samples: Array.from({ length: parameters.resumeSamples }, () => 20),
        p95Ms: 20,
        peakRssMb: 48,
        maxIoBytesRead: 65_536,
        coldProcess: {
          samples: Array.from({ length: parameters.coldResumeSamples }, () => ({
            wallMs: 90,
            peakRssMb: 52,
          })),
          sampleCount: parameters.coldResumeSamples,
          p95Ms: 90,
          peakRssMb: 52,
        },
      },
      crashRepair: {
        pass: true,
        actualProcessKillsTotal: parameters.actualKillCases,
        partialRecordProcessKills: Array.from(
          { length: parameters.actualKillCases },
          () => ({ pass: true, killConfirmed: true }),
        ),
        byteCutCoverage: { exhaustive: parameters.exhaustiveCuts },
      },
    },
  };
}

function measurements(required = true) {
  const resultCount = required ? 5_000 : 160;
  const resultBytes = required ? 32 * 1024 : 4 * 1024;
  const recentResults = 32;
  return {
    mode: required ? "formal" : "smoke",
    exactHeadSources: true,
    resultCount,
    resultBytes,
    recentResults,
    releasedResults: resultCount - recentResults,
    retainedFullResults: recentResults,
    maxOldProjectionChars: 512,
    oldProjectionViolations: 0,
    projectionDigestMismatches: 0,
    recentWindowViolations: 0,
    baselineHeapBytes: 20_000_000,
    allocatedHeapBytes: 190_000_000,
    firstGcHeapBytes: 30_000_000,
    secondGcHeapBytes: 30_100_000,
    heapDeltaBytes: 10_100_000,
    gcSampleDifferenceRatio: 100_000 / 30_100_000,
    baselineRssBytes: 80_000_000,
    allocatedRssBytes: 260_000_000,
    firstGcRssBytes: 230_000_000,
    secondGcRssBytes: 230_000_000,
    durableEvidenceRecords: resultCount,
    durableEvidenceRecordLoss: 0,
    durableEvidenceSha256: `sha256:${"b".repeat(64)}`,
    maxTranscriptScanChunkBytes: 65_536,
    durableTranscriptBytes: resultCount * resultBytes + 2_000_000,
    durableTranscriptEventCount: resultCount + 2,
    durableTranscriptHeadHash: "f".repeat(64),
    durableTranscriptForwardBytesRead: resultCount * resultBytes + 2_000_000,
    durableTranscriptForwardReadCalls: 128,
    canonicalRecordBytesMaximum: 16 * 1024 * 1024,
    productRuntime: {
      surface: "packages/cli/src/runtime/agent-core.js#agentLoop",
      persistenceSurface:
        "packages/cli/src/harness/jsonl-session-store.js#appendCompactEventIfMessagesMatch/readVerifiedMessages",
      durationMs: 145,
      fixtureSeedMethod:
        "linear-canonical-jsonl-with-production-hasher-and-repair-authority",
      fixtureBuildDurationMs: 40,
      fixtureRepairDurationMs: 50,
      fixtureEventCount: resultCount + 1,
      fixtureTranscriptBytes: resultCount * resultBytes,
      fixtureHeadHash: "1".repeat(64),
      retentionEvents: 1,
      degradedEvents: 0,
      settlementCalls: 1,
      settlementTrigger: "runtime-retention",
      projectedMessageCount: resultCount,
      durableReferenceCount: resultCount - recentResults,
      durableReferenceMismatches: 0,
      durableReferenceDigest: `sha256:${"d".repeat(64)}`,
      checkpointDigest: `sha256:${"e".repeat(64)}`,
      checkpointBytes: 2_000_000,
      checkpointMessageCount: resultCount,
      checkpointDurableReferenceCount: resultCount - recentResults,
      releasedResults: resultCount - recentResults,
      savedChars: 123_456,
      resumeProjectionDigest: `sha256:${"a".repeat(64)}`,
      initialResumeForwardBytesRead: resultCount * resultBytes,
      initialResumeMessageBytesRead: resultCount * resultBytes,
      resumeForwardBytesRead: resultCount * resultBytes + 2_000_000,
      resumeMessageBytesRead: 2_000_000,
    },
    backlog: { maxMessages: 256, maxBytes: 1_048_576 },
    sessionScale: {
      available: true,
      mode: required ? "formal" : "smoke",
      platform: "linux",
      node: "v22.12.0",
      arch: "x64",
      listP95Ms: 12,
      listPeakRssMb: 45,
      resumeP95Ms: 20,
      resumePeakRssMb: 48,
      resumeMaxIoBytesRead: 65_536,
      coldResumeP95Ms: 90,
      coldResumePeakRssMb: 52,
      evidenceDigest: `sha256:${"c".repeat(64)}`,
      evidenceFile: "cli-session-scale-result.json",
    },
    contractTests: {
      status: "passed",
      files: [...CONTRACT_TESTS],
      durationMs: 250,
    },
  };
}

function fragment(required = true) {
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId: COMMITMENT_ID,
    headSha: HEAD_SHA,
    os: "linux",
    runtime: {
      name: "node",
      version: "v22.12.0",
      arch: "x64",
    },
    profileVersion: required
      ? REQUIRED_PROFILE_VERSION
      : ADVISORY_PROFILE_VERSION,
    thresholds: required ? REQUIRED_THRESHOLDS : ADVISORY_THRESHOLDS,
    measurements: measurements(required),
    testIds: [...TEST_IDS],
    producerDigests: PRODUCER_DIGESTS,
    disposition: required ? "required" : "advisory",
    source: {
      workflowId:
        "owner/repository/.github/workflows/cli-session-scale.yml@refs/heads/main",
      runId: "123456",
      jobId: "session-scale",
      artifactName: `cli-session-scale-ubuntu-latest-${HEAD_SHA}-1`,
    },
    outcome: "passed",
  };
}

function localFragment() {
  const value = fragment();
  value.disposition = "advisory";
  value.profileVersion = LOCAL_PROFILE_VERSION;
  value.measurements.mode = "local";
  value.testIds = [...LOCAL_TEST_IDS];
  return value;
}

function writeEvidenceCell(root, os, required = true, options = {}) {
  const artifactName = `cli-session-scale-${RUNNER_BY_OS[os]}-${HEAD_SHA}-1`;
  const directory = join(root, options.directoryName || artifactName);
  mkdirSync(directory, { recursive: true });
  const raw = Buffer.from(
    `${JSON.stringify(sessionScale(required ? "formal" : "smoke", os))}\n`,
  );
  const rawName = "cli-session-scale-result.json";
  writeFileSync(join(directory, rawName), raw);
  const value = fragment(required);
  value.os = os;
  value.runtime.version = "v22.12.0";
  value.source.artifactName = artifactName;
  value.measurements.sessionScale.platform = {
    linux: "linux",
    macos: "darwin",
    windows: "win32",
  }[os];
  if (options.runId) value.source.runId = options.runId;
  value.measurements.sessionScale.evidenceFile = rawName;
  value.measurements.sessionScale.evidenceDigest = sha256(raw);
  const fragmentPath = join(directory, "session-runtime-retention.json");
  writeFileSync(fragmentPath, `${JSON.stringify(value, null, 2)}\n`);
  return { artifactName, directory, fragmentPath, value };
}

describe("SESSION-RUNTIME canonical evidence", () => {
  it("accepts the locked formal fragment and product-runtime measurements", () => {
    expect(
      validateFragment(fragment(), {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toEqual(fragment());
  });

  it("keeps smoke evidence advisory and non-qualifying by default", () => {
    const advisory = fragment(false);
    expect(() =>
      validateFragment(advisory, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/advisory evidence is non-qualifying/u);
    expect(
      validateFragment(advisory, {
        headSha: HEAD_SHA,
        allowAdvisory: true,
        producerDigests: PRODUCER_DIGESTS,
      }).disposition,
    ).toBe("advisory");
  });

  it("keeps a full-size local profile advisory without smoke thresholds", () => {
    const local = localFragment();
    expect(local.thresholds).toEqual(REQUIRED_THRESHOLDS);
    expect(
      validateFragment(local, {
        headSha: HEAD_SHA,
        allowAdvisory: true,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toEqual(local);
  });

  it("fails closed on retained live-state or producer digest drift", () => {
    const unbounded = structuredClone(fragment());
    unbounded.measurements.maxOldProjectionChars = 513;
    expect(() =>
      validateFragment(unbounded, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();

    const drifted = structuredClone(fragment());
    drifted.producerDigests[PRODUCERS[0]] = `sha256:${"f".repeat(64)}`;
    expect(() =>
      validateFragment(drifted, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();

    for (const invalid of [
      Object.assign(structuredClone(fragment()), {
        headSha: "d".repeat(40),
      }),
      Object.assign(structuredClone(fragment()), {
        profileVersion: "session-runtime/retention-relaxed-v1",
      }),
      Object.assign(structuredClone(fragment()), {
        runtime: { name: "node", version: "v22.13.0", arch: "x64" },
      }),
    ]) {
      expect(() =>
        validateFragment(invalid, {
          headSha: HEAD_SHA,
          allowAdvisory: false,
          producerDigests: PRODUCER_DIGESTS,
        }),
      ).toThrow();
    }
    const relaxed = structuredClone(fragment());
    relaxed.thresholds.resultCountMinimum = 1;
    expect(() =>
      validateFragment(relaxed, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();

    const forgedHeapDelta = structuredClone(fragment());
    forgedHeapDelta.measurements.firstGcHeapBytes = 200_000_000;
    forgedHeapDelta.measurements.secondGcHeapBytes = 200_000_000;
    forgedHeapDelta.measurements.heapDeltaBytes = 0;
    forgedHeapDelta.measurements.gcSampleDifferenceRatio = 0;
    expect(() =>
      validateFragment(forgedHeapDelta, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();

    const forgedGcRatio = structuredClone(fragment());
    forgedGcRatio.measurements.firstGcHeapBytes = 30_000_000;
    forgedGcRatio.measurements.secondGcHeapBytes = 15_000_000;
    forgedGcRatio.measurements.heapDeltaBytes = 10_000_000;
    forgedGcRatio.measurements.gcSampleDifferenceRatio = 0;
    expect(() =>
      validateFragment(forgedGcRatio, {
        headSha: HEAD_SHA,
        allowAdvisory: false,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();
  });

  it("binds the existing session-scale list/resume gate to the same head", () => {
    expect(
      validateSessionScaleResult(sessionScale(), HEAD_SHA, true),
    ).toMatchObject({
      available: true,
      mode: "formal",
      listP95Ms: 12,
      resumeP95Ms: 20,
    });
    const stale = sessionScale();
    stale.exactSha = "d".repeat(40);
    expect(() => validateSessionScaleResult(stale, HEAD_SHA, true)).toThrow();
    expect(() =>
      validateSessionScaleResult(sessionScale("smoke"), HEAD_SHA, false),
    ).not.toThrow();
    expect(() =>
      validateSessionScaleResult(
        sessionScale("formal", "macos"),
        HEAD_SHA,
        true,
        false,
        {
          os: "windows",
          runtime: { version: "v22.12.0", arch: "x64" },
        },
      ),
    ).toThrow();
    const undersizedFormal = sessionScale();
    undersizedFormal.parameters.sessionCount = 250;
    expect(() =>
      validateSessionScaleResult(undersizedFormal, HEAD_SHA, true),
    ).toThrow(/below the locked formal profile/u);
  });

  it("refuses dirty formal mode at argument parsing", () => {
    expect(() => parseArgs(["--formal", "--allow-dirty"], {})).toThrow(
      /cannot allow dirty sources/u,
    );
    expect(parseArgs(["--smoke"], {})).toMatchObject({
      mode: "smoke",
      allowDirty: false,
    });
  });

  it("requires formal provenance from the exact GitHub workflow SHA", () => {
    const github = {
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW_SHA: HEAD_SHA,
      GITHUB_WORKFLOW_REF:
        "owner/repository/.github/workflows/cli-session-scale.yml@refs/heads/main",
      GITHUB_RUN_ID: "123456",
      GITHUB_JOB: "session-scale",
      CC_SESSION_RUNTIME_ARTIFACT_NAME: `cli-session-scale-ubuntu-latest-${HEAD_SHA}-1`,
      CC_SESSION_RUNTIME_RUN_ID: "999999",
    };
    expect(
      sourceFromEnvironment(github, {
        required: true,
        headSha: HEAD_SHA,
        os: "linux",
      }),
    ).toMatchObject({ runId: "123456", jobId: "session-scale" });
    expect(() =>
      sourceFromEnvironment(
        { ...github, GITHUB_ACTIONS: undefined },
        { required: true, headSha: HEAD_SHA, os: "linux" },
      ),
    ).toThrow();
    expect(() =>
      sourceFromEnvironment(
        { ...github, GITHUB_WORKFLOW_SHA: "d".repeat(40) },
        { required: true, headSha: HEAD_SHA, os: "linux" },
      ),
    ).toThrow(/exact tested head/u);
  });

  it("rehashes a complete three-OS advisory matrix and rejects raw evidence drift", () => {
    const root = mkdtempSync(join(tmpdir(), "session-runtime-evidence-test-"));
    TEMPORARY_ROOTS.push(root);
    for (const os of ["linux", "macos", "windows"]) {
      const artifactName = `cli-session-scale-${RUNNER_BY_OS[os]}-${HEAD_SHA}-1`;
      const directory = join(root, artifactName);
      mkdirSync(directory, { recursive: true });
      const raw = Buffer.from(`${JSON.stringify(sessionScale("smoke", os))}\n`);
      const rawName = "cli-session-scale-result.json";
      writeFileSync(join(directory, rawName), raw);
      const value = fragment(false);
      value.os = os;
      value.runtime.version = "v22.12.0";
      value.source.artifactName = artifactName;
      value.measurements.sessionScale.platform = {
        linux: "linux",
        macos: "darwin",
        windows: "win32",
      }[os];
      value.measurements.sessionScale.evidenceFile = rawName;
      value.measurements.sessionScale.evidenceDigest = sha256(raw);
      writeFileSync(
        join(directory, "session-runtime-retention.json"),
        `${JSON.stringify(value, null, 2)}\n`,
      );
    }
    const output = join(root, "aggregate.json");
    const dependencies = {
      currentHead: () => HEAD_SHA,
      producerState: { exact: true, producerDigests: PRODUCER_DIGESTS },
      currentEnvironment: {},
    };
    const aggregate = verifyEvidenceSet(
      {
        evidenceDir: root,
        releaseCommit: HEAD_SHA,
        allowAdvisory: true,
        output,
      },
      dependencies,
    );
    expect(aggregate).toMatchObject({
      commitmentId: COMMITMENT_ID,
      headSha: HEAD_SHA,
      disposition: "advisory",
      outcome: "passed",
      operatingSystems: ["linux", "macos", "windows"],
    });
    expect(Object.keys(aggregate.fragmentDigests).sort()).toEqual([
      "linux",
      "macos",
      "windows",
    ]);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(aggregate);

    const linuxFragmentPath = join(
      root,
      `cli-session-scale-ubuntu-latest-${HEAD_SHA}-1`,
      "session-runtime-retention.json",
    );
    const summaryDrift = JSON.parse(readFileSync(linuxFragmentPath, "utf8"));
    summaryDrift.measurements.sessionScale.listP95Ms = 13;
    writeFileSync(
      linuxFragmentPath,
      `${JSON.stringify(summaryDrift, null, 2)}\n`,
    );
    expect(() =>
      verifyEvidenceSet(
        {
          evidenceDir: root,
          releaseCommit: HEAD_SHA,
          allowAdvisory: true,
        },
        dependencies,
      ),
    ).toThrow();
    summaryDrift.measurements.sessionScale.listP95Ms = 12;
    writeFileSync(
      linuxFragmentPath,
      `${JSON.stringify(summaryDrift, null, 2)}\n`,
    );

    writeFileSync(
      join(
        root,
        `cli-session-scale-windows-latest-${HEAD_SHA}-1`,
        "cli-session-scale-result.json",
      ),
      `${JSON.stringify({ ...sessionScale("smoke", "windows"), status: "failed" })}\n`,
    );
    expect(() =>
      verifyEvidenceSet(
        {
          evidenceDir: root,
          releaseCommit: HEAD_SHA,
          allowAdvisory: true,
        },
        dependencies,
      ),
    ).toThrow(/digest drift/u);
  });

  it("accepts a required matrix and rejects missing, mixed-run, or misfiled cells", () => {
    const dependencies = {
      currentHead: () => HEAD_SHA,
      producerState: { exact: true, producerDigests: PRODUCER_DIGESTS },
      currentEnvironment: {},
    };
    const requiredRoot = mkdtempSync(
      join(tmpdir(), "session-runtime-required-test-"),
    );
    TEMPORARY_ROOTS.push(requiredRoot);
    const cells = Object.fromEntries(
      ["linux", "macos", "windows"].map((os) => [
        os,
        writeEvidenceCell(requiredRoot, os),
      ]),
    );
    expect(
      verifyEvidenceSet(
        {
          evidenceDir: requiredRoot,
          releaseCommit: HEAD_SHA,
          allowAdvisory: false,
        },
        dependencies,
      ),
    ).toMatchObject({ disposition: "required", outcome: "passed" });

    const mixedRun = structuredClone(cells.macos.value);
    mixedRun.source.runId = "654321";
    writeFileSync(
      cells.macos.fragmentPath,
      `${JSON.stringify(mixedRun, null, 2)}\n`,
    );
    expect(() =>
      verifyEvidenceSet(
        {
          evidenceDir: requiredRoot,
          releaseCommit: HEAD_SHA,
          allowAdvisory: false,
        },
        dependencies,
      ),
    ).toThrow(/runId differs/u);

    const missingRoot = mkdtempSync(
      join(tmpdir(), "session-runtime-missing-test-"),
    );
    TEMPORARY_ROOTS.push(missingRoot);
    writeEvidenceCell(missingRoot, "linux");
    writeEvidenceCell(missingRoot, "macos");
    expect(() =>
      verifyEvidenceSet(
        {
          evidenceDir: missingRoot,
          releaseCommit: HEAD_SHA,
          allowAdvisory: false,
        },
        dependencies,
      ),
    ).toThrow();

    const misfiledRoot = mkdtempSync(
      join(tmpdir(), "session-runtime-misfiled-test-"),
    );
    TEMPORARY_ROOTS.push(misfiledRoot);
    writeEvidenceCell(misfiledRoot, "linux", true, {
      directoryName: "wrong-artifact-directory",
    });
    writeEvidenceCell(misfiledRoot, "macos");
    writeEvidenceCell(misfiledRoot, "windows");
    expect(() =>
      verifyEvidenceSet(
        {
          evidenceDir: misfiledRoot,
          releaseCommit: HEAD_SHA,
          allowAdvisory: false,
        },
        dependencies,
      ),
    ).toThrow(/outside its claimed artifact/u);
  });
});
