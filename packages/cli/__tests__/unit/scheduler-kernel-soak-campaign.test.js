import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAMPAIGN_SCHEMA,
  verifySchedulerSoakCampaignEvidenceSet,
} from "../../scripts/scheduler-kernel-soak-campaign.mjs";

const RELEASE_COMMIT = "1".repeat(40);
const CONTROL_PLANE_SHA = "2".repeat(40);
const VERIFIER_SHA = "3".repeat(40);
const SEED = 42;
const CAMPAIGN = "scheduler-72h-release-candidate";
const BASE_TIME = Date.parse("2026-08-01T00:00:00.000Z");
const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/scheduler-kernel-soak-campaign.mjs", import.meta.url),
);
const OPERATING_SYSTEMS = ["linux", "macos", "windows"];

let temporaryRoot;

afterEach(() => {
  if (temporaryRoot) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

function root() {
  temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "scheduler-soak-campaign-test-"),
  );
  return temporaryRoot;
}

function formalProfile() {
  return {
    mode: "formal",
    durationSeconds: 7_200,
    rounds: 100,
    steadyOccurrencesPerRound: 10,
    steadyStateOccurrences: 1_000,
    leaseMs: 1_000,
    pollMs: 50,
    checkpointIntervalSeconds: 30,
    cleanupDeadlineMs: 10_000,
    maxRssGrowthMb: 128,
    maxResourceGrowth: 8,
    executionDelayMs: 50,
    heartbeatDelayMs: 1_500,
  };
}

function timestamp(hour) {
  return new Date(BASE_TIME + hour * 3_600_000).toISOString();
}

function aggregate(index, startHour = index * 24) {
  const startedAt = timestamp(startHour);
  const completedAt = timestamp(startHour + 2);
  const runId = String(31_150_275_109 + index);
  const runAttempt = 1;
  return {
    schema: "chainlesschain.scheduler-kernel-soak-aggregate.v1",
    result: "passed",
    releaseCommit: RELEASE_COMMIT,
    seed: SEED,
    campaign: CAMPAIGN,
    verifiedAt: completedAt,
    startedAt,
    completedAt,
    continuousDurationSeconds: 7_200,
    operatingSystems: [...OPERATING_SYSTEMS],
    profile: formalProfile(),
    totals: {
      rounds: 300,
      steadyOccurrences: 3_000,
      hardKills: 600,
      effects: 3_603,
    },
    execution: {
      provider: "github-actions",
      repository: "chainlesschain/chainlesschain",
      workflow: "CLI Scheduler Kernel Soak",
      eventName: "schedule",
      runId,
      runAttempt,
      controlPlaneSha: CONTROL_PLANE_SHA,
      runUrl: `https://github.com/chainlesschain/chainlesschain/actions/runs/${runId}/attempts/${runAttempt}`,
    },
    sourceRun: {
      id: runId,
      attempt: runAttempt,
      eventName: "schedule",
      headSha: CONTROL_PLANE_SHA,
      workflowPath: ".github/workflows/cli-scheduler-soak.yml",
      url: `https://github.com/chainlesschain/chainlesschain/actions/runs/${runId}`,
      createdAt: startedAt,
      runStartedAt: startedAt,
      updatedAt: completedAt,
    },
    sourceArtifacts: ["Linux", "Windows", "macOS"].map(
      (operatingSystem, artifactIndex) => ({
        id: 9_200_204_550 + index * 3 + artifactIndex,
        name: `cli-scheduler-soak-${operatingSystem}-${RELEASE_COMMIT}-${runAttempt}`,
        sizeInBytes: 4_096 + artifactIndex,
        digest: `sha256:${(index + artifactIndex + 20)
          .toString(16)
          .padStart(64, "0")}`,
        expired: false,
        archiveDownloadUrl: `https://api.github.com/repos/chainlesschain/chainlesschain/actions/artifacts/${9_200_204_550 + index * 3 + artifactIndex}/zip`,
        createdAt: completedAt,
        expiresAt: timestamp(startHour + 2 + 24 * 90),
      }),
    ),
    evidence: OPERATING_SYSTEMS.map((operatingSystem, osIndex) => ({
      file: `scheduler-soak-${operatingSystem}.json`,
      operatingSystem,
      sha256: (index + osIndex + 10).toString(16).padStart(64, "0"),
      startedAt,
      completedAt,
    })),
  };
}

function writeAggregate(directory, relativeFile, value, compact = false) {
  const target = path.join(directory, relativeFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (value.schema === "chainlesschain.scheduler-kernel-soak-aggregate.v1") {
    const rawDirectory = path.join(path.dirname(target), "raw");
    fs.mkdirSync(rawDirectory, { recursive: true });
    for (const evidence of value.evidence) {
      const rawFile = path.join(rawDirectory, evidence.file);
      fs.writeFileSync(
        rawFile,
        `${JSON.stringify({ schema: "fixture.raw", runId: value.execution.runId, operatingSystem: evidence.operatingSystem })}\n`,
        "utf8",
      );
      evidence.sha256 = createHash("sha256")
        .update(fs.readFileSync(rawFile))
        .digest("hex");
    }
  }
  fs.writeFileSync(
    target,
    `${JSON.stringify(value, null, compact ? undefined : 2)}\n`,
    "utf8",
  );
  return target;
}

function writeCampaign(directory, startHours = [0, 24, 48, 72]) {
  return startHours.map((startHour, index) =>
    writeAggregate(
      directory,
      `segment-${index}/aggregate-${index}.json`,
      aggregate(index, startHour),
    ),
  );
}

function verifyOptions(directory, output) {
  return {
    evidenceDir: directory,
    releaseCommit: RELEASE_COMMIT,
    seed: SEED,
    campaign: CAMPAIGN,
    minimumObservationHours: 72,
    minimumSegments: 4,
    maximumGapHours: 30,
    output,
    verifier: {
      provider: "github-actions",
      repository: "chainlesschain/chainlesschain",
      workflow: "CLI Scheduler Kernel Soak Campaign",
      workflowRef:
        "chainlesschain/chainlesschain/.github/workflows/cli-scheduler-soak-campaign.yml@refs/heads/main",
      ref: "refs/heads/main",
      eventName: "workflow_dispatch",
      runId: "31159999999",
      runAttempt: 1,
      controlPlaneSha: VERIFIER_SHA,
      sourceCommit: VERIFIER_SHA,
      runUrl:
        "https://github.com/chainlesschain/chainlesschain/actions/runs/31159999999/attempts/1",
    },
  };
}

describe("scheduler kernel long-soak campaign verifier", () => {
  it("recursively verifies, deduplicates by run ID, and hashes every aggregate", () => {
    const directory = root();
    const files = writeCampaign(directory);
    writeAggregate(
      directory,
      "duplicate/nested/aggregate-copy.json",
      aggregate(0, 0),
      true,
    );
    writeAggregate(directory, "ignored-result.json", {
      schema: "chainlesschain.scheduler-kernel-soak.v1",
    });
    const output = path.join(directory, "campaign-evidence.json");

    const result = verifySchedulerSoakCampaignEvidenceSet(
      verifyOptions(directory, output),
    );

    expect(result).toMatchObject({
      schema: CAMPAIGN_SCHEMA,
      result: "passed",
      releaseCommit: RELEASE_COMMIT,
      controlPlaneSha: CONTROL_PLANE_SHA,
      seed: SEED,
      campaign: CAMPAIGN,
      verifier: {
        controlPlaneSha: VERIFIER_SHA,
        sourceCommit: VERIFIER_SHA,
      },
      observation: {
        firstStartedAt: timestamp(0),
        lastStartedAt: timestamp(72),
        lastCompletedAt: timestamp(74),
        hours: 72,
        endToEndHours: 74,
        maximumObservedStartGapHours: 24,
      },
      totals: {
        discoveredAggregates: 5,
        uniqueSegments: 4,
        deduplicatedAggregates: 1,
        operatingSystemExecutions: 12,
      },
    });
    expect(result.segments).toHaveLength(4);
    expect(result.sourceAggregates).toHaveLength(5);
    expect(
      result.sourceAggregates.every((entry) =>
        /^[0-9a-f]{64}$/u.test(entry.sha256),
      ),
    ).toBe(true);
    expect(
      result.sourceAggregates.filter((entry) => entry.selected),
    ).toHaveLength(4);
    expect(
      result.sourceAggregates.every((entry) =>
        fs.existsSync(path.join(directory, entry.file)),
      ),
    ).toBe(true);
    expect(result.segments[1].aggregate.sha256).toBe(
      createHash("sha256").update(fs.readFileSync(files[1])).digest("hex"),
    );
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual(result);
  });

  it("rejects too few unique segments and conflicting duplicate run IDs", () => {
    const directory = root();
    writeCampaign(directory, [0, 24, 72]);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/at least 4 unique segments/u);

    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    writeCampaign(directory);
    const conflicting = aggregate(0, 0);
    conflicting.verifiedAt = timestamp(3);
    writeAggregate(directory, "conflict/aggregate.json", conflicting);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/conflicting.+execution\.runId 31150275109/u);
  });

  it("requires one formal exact-identity profile and three OSes per segment", () => {
    const directory = root();
    writeCampaign(directory);
    const mismatched = aggregate(2, 48);
    mismatched.execution.controlPlaneSha = "3".repeat(40);
    mismatched.sourceRun.headSha = "3".repeat(40);
    writeAggregate(directory, "segment-2/aggregate-2.json", mismatched);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/control-plane SHAs differ/u);

    mismatched.execution.controlPlaneSha = CONTROL_PLANE_SHA;
    mismatched.profile.mode = "smoke";
    writeAggregate(directory, "segment-2/aggregate-2.json", mismatched);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/formal profile/u);

    const invalidMatrix = aggregate(2, 48);
    invalidMatrix.evidence[2].operatingSystem = "linux";
    writeAggregate(directory, "segment-2/aggregate-2.json", invalidMatrix);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/evidence must contain exactly linux, macos, and windows/u);
  });

  it("enforces the 72-hour observation floor and 30-hour start-gap ceiling", () => {
    const directory = root();
    writeCampaign(directory, [0, 20, 40, 60]);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/observation is 60\.000h/u);

    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    writeCampaign(directory, [0, 31, 55, 72]);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/start gap is 31\.000h/u);
  });

  it("rejects forged aggregate envelopes and inconsistent execution provenance", () => {
    const directory = root();
    writeCampaign(directory);
    const forgedEnvelope = aggregate(2, 48);
    forgedEnvelope.startedAt = timestamp(47);
    forgedEnvelope.continuousDurationSeconds = 10_800;
    forgedEnvelope.sourceRun.createdAt = timestamp(47);
    forgedEnvelope.sourceRun.runStartedAt = timestamp(47);
    writeAggregate(directory, "segment-2/aggregate-2.json", forgedEnvelope);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/exactly envelope/u);

    const mismatchedProvider = aggregate(2, 48);
    mismatchedProvider.execution.repository = "foreign/example";
    mismatchedProvider.execution.runUrl =
      "https://github.com/foreign/example/actions/runs/31150275111/attempts/1";
    mismatchedProvider.sourceRun.url =
      "https://github.com/foreign/example/actions/runs/31150275111";
    for (const artifact of mismatchedProvider.sourceArtifacts) {
      artifact.archiveDownloadUrl = artifact.archiveDownloadUrl.replace(
        "/repos/chainlesschain/chainlesschain/",
        "/repos/foreign/example/",
      );
    }
    writeAggregate(directory, "segment-2/aggregate-2.json", mismatchedProvider);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/execution provenance differs/u);
  });

  it("requires authoritative run, artifact, and finalizer provenance", () => {
    const directory = root();
    writeCampaign(directory);
    const outsideRun = aggregate(2, 48);
    outsideRun.sourceRun.updatedAt = timestamp(49);
    writeAggregate(directory, "segment-2/aggregate-2.json", outsideRun);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/outside the authoritative source run/u);

    const invalidArtifact = aggregate(2, 48);
    invalidArtifact.sourceArtifacts[0].digest = `sha256:${"f".repeat(63)}`;
    writeAggregate(directory, "segment-2/aggregate-2.json", invalidArtifact);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/artifact digest must be SHA-256/u);

    const validAggregate = aggregate(2, 48);
    writeAggregate(directory, "segment-2/aggregate-2.json", validAggregate);
    fs.appendFileSync(
      path.join(directory, "segment-2/raw", validAggregate.evidence[0].file),
      "tampered\n",
    );
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet(verifyOptions(directory)),
    ).toThrow(/bundled raw evidence hash does not match/u);

    writeAggregate(directory, "segment-2/aggregate-2.json", aggregate(2, 48));
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet({
        ...verifyOptions(directory),
        verifier: {
          ...verifyOptions(directory).verifier,
          sourceCommit: "4".repeat(40),
        },
      }),
    ).toThrow(/source commit must equal its control-plane SHA/u);
  });

  it("runs as a dependency-free CLI and rejects policy weakening", () => {
    const directory = root();
    writeCampaign(directory);
    const output = path.join(directory, "cli-campaign-evidence.json");
    const stdout = execFileSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--evidence-dir",
        directory,
        "--release-commit",
        RELEASE_COMMIT,
        "--seed",
        String(SEED),
        "--campaign",
        CAMPAIGN,
        "--minimum-observation-hours",
        "72",
        "--minimum-segments",
        "4",
        "--maximum-gap-hours",
        "30",
        "--output",
        output,
        "--verifier-repository",
        "chainlesschain/chainlesschain",
        "--verifier-workflow",
        "CLI Scheduler Kernel Soak Campaign",
        "--verifier-workflow-ref",
        "chainlesschain/chainlesschain/.github/workflows/cli-scheduler-soak-campaign.yml@refs/heads/main",
        "--verifier-ref",
        "refs/heads/main",
        "--verifier-event-name",
        "workflow_dispatch",
        "--verifier-run-id",
        "31159999999",
        "--verifier-run-attempt",
        "1",
        "--verifier-control-plane-sha",
        VERIFIER_SHA,
        "--verifier-source-commit",
        VERIFIER_SHA,
        "--verifier-run-url",
        "https://github.com/chainlesschain/chainlesschain/actions/runs/31159999999/attempts/1",
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout)).toMatchObject({ result: "passed", segments: 4 });
    expect(JSON.parse(fs.readFileSync(output, "utf8")).schema).toBe(
      CAMPAIGN_SCHEMA,
    );
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet({
        ...verifyOptions(directory),
        minimumObservationHours: 71,
      }),
    ).toThrow(/at least 72/u);
    expect(() =>
      verifySchedulerSoakCampaignEvidenceSet({
        ...verifyOptions(directory),
        maximumGapHours: 31,
      }),
    ).toThrow(/at most 30/u);
  });
});
