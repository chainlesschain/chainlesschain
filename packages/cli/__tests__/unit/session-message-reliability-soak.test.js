import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORMAL_MINIMUM_DURATION_SECONDS,
  SESSION_MESSAGE_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
  SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA,
  SESSION_MESSAGE_RELIABILITY_SMOKE_AGGREGATE_SCHEMA,
  resolveSessionMessageReliabilityProfile,
  runSessionMessageReliabilitySoak,
  validateSessionMessageReliabilityEvidence,
  verifySessionMessageReliabilityEvidenceSet,
} from "../../scripts/session-message-reliability-soak.mjs";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const RELEASE_COMMIT = "a".repeat(40);
const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sign(value) {
  const copy = structuredClone(value);
  delete copy.evidenceDigest;
  value.evidenceDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(copy)), "utf8")
    .digest("hex")}`;
  return value;
}

function totals(cycles) {
  return {
    cycles,
    outOfOrderHolds: cycles,
    orderedRecoveries: cycles,
    processingRedeliveries: cycles,
    processedSettlements: cycles,
    poisonRedeliveries: cycles,
    poisonDeadLetters: cycles,
    idempotentAckReplays: cycles * 2,
    postRestartReplays: 0,
    duplicateEffects: 0,
    lostMessages: 0,
    custodyProbes: 30,
    custodyRecoveries: 30,
    custodyEffects: 30,
    custodyDuplicateEffects: 0,
    maxReceiptCount: 3_600,
    maxHistoryMessages: 0,
    maxStateBytes: 2_000_000,
    invariantViolations: 0,
  };
}

function formalEvidence(operatingSystem) {
  const cycles = 1_800;
  return sign({
    schema: SESSION_MESSAGE_RELIABILITY_SOAK_SCHEMA,
    status: "passed",
    releaseCommit: RELEASE_COMMIT,
    headSha: RELEASE_COMMIT,
    expectedSha: RELEASE_COMMIT,
    exactShaVerified: true,
    qualifyingEvidence: true,
    startedAt: "2026-08-29T00:00:00.000Z",
    completedAt: "2026-08-29T00:30:01.000Z",
    checkpointedAt: "2026-08-29T00:30:00.000Z",
    continuousDurationSeconds: 1_800.1,
    source: {
      clean: true,
      changeCount: 0,
      finalClean: true,
      finalChangeCount: 0,
    },
    runner: { operatingSystem },
    execution: {
      provider: "github-actions",
      repository: "chainlesschain/chainlesschain",
      workflow: "CLI Reliability Soak",
      eventName: "workflow_dispatch",
      runId: "33193061862",
      runAttempt: 1,
      controlPlaneSha: RELEASE_COMMIT,
    },
    profile: {
      mode: "formal",
      durationSeconds: 1_800,
      cycleIntervalMs: 1_000,
      custodyIntervalCycles: 60,
      checkpointIntervalSeconds: 30,
    },
    longOffline: {
      admissions: 1,
      checks: cycles + 1,
      falseDeliveries: 0,
      heldDurationSeconds: 1_800.05,
      recovered: 1,
      processed: 1,
    },
    totals: totals(cycles),
    observations: {},
    cycleDigest: `sha256:${"b".repeat(64)}`,
    violations: [],
  });
}

describe("session-message temporal reliability soak", () => {
  it("freezes a thirty-minute formal duration floor", () => {
    expect(
      resolveSessionMessageReliabilityProfile({
        CC_SESSION_MESSAGE_SOAK_MODE: "formal",
        CC_SESSION_MESSAGE_SOAK_DURATION_SECONDS: "1",
        CC_SESSION_MESSAGE_SOAK_CYCLE_INTERVAL_MS: "1",
      }),
    ).toMatchObject({
      mode: "formal",
      durationSeconds: FORMAL_MINIMUM_DURATION_SECONDS,
      cycleIntervalMs: 250,
    });
  });

  it(
    "runs real offline, reorder, poison, restart and custody recovery cycles",
    { timeout: 20_000 },
    async () => {
      const workingDirectory = temporaryDirectory("cc-session-soak-test-");
      const output = join(
        temporaryDirectory("cc-session-soak-output-"),
        "result.json",
      );
      const report = await runSessionMessageReliabilitySoak({
        env: {
          CC_SESSION_MESSAGE_SOAK_MODE: "smoke",
          CC_SESSION_MESSAGE_SOAK_DURATION_SECONDS: "1",
          CC_SESSION_MESSAGE_SOAK_CYCLE_INTERVAL_MS: "250",
          CC_SESSION_MESSAGE_SOAK_CUSTODY_INTERVAL_CYCLES: "100",
          CC_SESSION_MESSAGE_SOAK_EXPECTED_SHA: RELEASE_COMMIT,
          CC_SESSION_MESSAGE_SOAK_WORKFLOW_SHA: RELEASE_COMMIT,
        },
        output,
        workingDirectory,
        sourceProvider: () => ({ headSha: RELEASE_COMMIT, changes: [] }),
      });

      expect(report).toMatchObject({
        status: "passed",
        qualifyingEvidence: false,
        longOffline: {
          admissions: 1,
          falseDeliveries: 0,
          recovered: 1,
          processed: 1,
        },
        totals: {
          custodyProbes: 1,
          custodyRecoveries: 1,
          custodyEffects: 1,
          custodyDuplicateEffects: 0,
          postRestartReplays: 0,
          duplicateEffects: 0,
          lostMessages: 0,
          maxHistoryMessages: 0,
          invariantViolations: 0,
        },
      });
      expect(report.totals.cycles).toBeGreaterThanOrEqual(1);
      expect(report.continuousDurationSeconds).toBeGreaterThanOrEqual(1);
      expect(readFileSync(output, "utf8")).toContain('"status": "passed"');
    },
  );

  it("rejects a forged passing result with an offline delivery", () => {
    const evidence = formalEvidence("linux");
    evidence.longOffline.falseDeliveries = 1;
    sign(evidence);
    expect(() =>
      validateSessionMessageReliabilityEvidence(evidence, {
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/long-offline recovery/u);
  });

  it("aggregates exactly one Linux, macOS and Windows formal artifact", () => {
    const directory = temporaryDirectory("cc-session-soak-evidence-");
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      // The verifier deliberately walks the artifact directories recursively.
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(formalEvidence(operatingSystem)),
      );
    }
    const aggregate = verifySessionMessageReliabilityEvidenceSet({
      evidenceDir: directory,
      releaseCommit: RELEASE_COMMIT,
    });
    expect(aggregate).toMatchObject({
      schema: SESSION_MESSAGE_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
      status: "passed",
      qualifyingEvidence: true,
      releaseGateEligible: true,
      totals: {
        cycles: 5_400,
        lostMessages: 0,
        duplicateEffects: 0,
        custodyDuplicateEffects: 0,
        invariantViolations: 0,
      },
      invariants: { completePlatformMatrix: true },
    });
  });

  it("keeps PR smoke aggregation explicitly non-qualifying", () => {
    const directory = temporaryDirectory("cc-session-soak-smoke-");
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      const evidence = formalEvidence(operatingSystem);
      evidence.profile.mode = "smoke";
      evidence.profile.durationSeconds = 1;
      evidence.continuousDurationSeconds = 1.1;
      evidence.longOffline.heldDurationSeconds = 1.05;
      evidence.qualifyingEvidence = false;
      sign(evidence);
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(evidence),
      );
    }
    const aggregate = verifySessionMessageReliabilityEvidenceSet({
      evidenceDir: directory,
      releaseCommit: RELEASE_COMMIT,
      allowSmoke: true,
    });
    expect(aggregate).toMatchObject({
      schema: SESSION_MESSAGE_RELIABILITY_SMOKE_AGGREGATE_SCHEMA,
      status: "non_qualifying_smoke_passed",
      qualifyingEvidence: false,
      releaseGateEligible: false,
    });
  });
});

describe("session-message temporal workflow contract", () => {
  it("binds the temporal soak and aggregate to the existing three-OS gate", () => {
    const rootPackage = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
    );
    const cliPackage = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, "packages/cli/package.json"), "utf8"),
    );
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, ".github/workflows/cli-reliability-soak.yml"),
      "utf8",
    );
    expect(
      rootPackage.scripts["test:cli-session-message-reliability-soak"],
    ).toBe("node packages/cli/scripts/session-message-reliability-soak.mjs");
    expect(cliPackage.scripts["test:session-message-reliability-soak"]).toBe(
      "node scripts/session-message-reliability-soak.mjs",
    );
    expect(workflow).toContain("CC_SESSION_MESSAGE_SOAK_MODE:");
    expect(workflow).toContain("CC_SESSION_MESSAGE_SOAK_DURATION_SECONDS:");
    expect(workflow).toContain('options: ["all", "session-message"]');
    expect(workflow).toContain("inputs.component == 'session-message'");
    expect(workflow).toContain("test:cli-session-message-reliability-soak");
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain("--allow-smoke");
    expect(workflow).toContain("session-message-reliability-aggregate.json");
  });
});
