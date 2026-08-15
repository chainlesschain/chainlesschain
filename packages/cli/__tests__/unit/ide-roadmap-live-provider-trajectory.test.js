import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIVE_PROVIDER_TRAJECTORY_FAILURE_SCHEMA,
  createLiveProviderTrajectoryFailureEvidence,
  resolveLiveProviderTrajectoryProfile,
  runLiveProviderTrajectory,
  verifyLiveProviderTrajectoryEvidence,
  verifyLiveProviderTrajectoryEvidenceSet,
} from "../../scripts/ide-roadmap-live-provider-trajectory.mjs";
import { createIdeRoadmapRuntimeEvidenceDigest } from "../../scripts/verify-ide-roadmap-fixtures.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const WORKFLOW_PATH = path.join(
  REPOSITORY_ROOT,
  ".github",
  "workflows",
  "ide-roadmap-live-provider.yml",
);
const EXPECTED_EVENT_ORDER = [
  "run-started",
  "semantic-compaction:model-usage-started",
  "compaction",
  "semantic-compaction:token-usage",
  "model:model-usage-started",
  "model:token-usage",
  "tool:read_file:started",
  "tool:read_file:settled",
  "model:model-usage-started",
  "model:token-usage",
  "response-complete",
  "run-ended:complete",
];

const temporaryRoots = [];
let releaseCommit;
let loopbackEvidence;

function temporaryRoot() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-live-trajectory-test-"),
  );
  temporaryRoots.push(root);
  return root;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reseal(evidence) {
  evidence.evidenceDigest = createIdeRoadmapRuntimeEvidenceDigest(evidence);
  return evidence;
}

function expectCode(fn, code) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return error;
  }
  throw new Error(`expected ${code}`);
}

beforeAll(async () => {
  releaseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();
  loopbackEvidence = await runLiveProviderTrajectory({
    repoRoot: REPOSITORY_ROOT,
    mode: "loopback",
    runs: 2,
    releaseCommit,
    timeoutMs: 120_000,
  });
}, 180_000);

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("IDE roadmap live-provider trajectory", () => {
  it("runs two independent double-compaction trajectories through production APIs", () => {
    expect(loopbackEvidence.profile).toMatchObject({
      mode: "loopback",
      requestedRuns: 2,
      completedRuns: 2,
      manifestMinimumIndependentRuns: 100,
      manifestMatrixEligible: false,
      manifestCoverageComplete: false,
      transportAudit: {
        kind: "loopback-http",
        authorizationObserved: true,
        requestCount: 12,
        summaryCount: 4,
        toolCallCount: 4,
        finalCount: 4,
      },
    });
    expect(new Set(loopbackEvidence.runs.map((run) => run.runId)).size).toBe(2);

    for (const run of loopbackEvidence.runs) {
      expect(run.observedOutcome).toEqual({
        semanticCompactionCount: 2,
        structuredHandoffSchemaStable: true,
        frozenFactRetentionRate: 1,
        silentLossCount: 0,
        providerUsageKnown: true,
        readOnlyToolSequenceCount: 2,
        credentialLeakCount: 0,
      });
      expect(run.trajectory.cycles).toHaveLength(2);
      for (const cycle of run.trajectory.cycles) {
        expect(cycle.eventOrder).toEqual(EXPECTED_EVENT_ORDER);
        expect(cycle.retention).toMatchObject({
          retentionRate: 1,
          retainedFactCount: cycle.retention.expectedFactCount,
        });
        expect(
          Object.values(cycle.retention.missingFactIdsByField).flat(),
        ).toEqual([]);
        expect(cycle.usage.map((entry) => entry.phase)).toEqual([
          "semantic-compaction",
          "model-before-tool",
          "model-after-tool",
        ]);
        expect(cycle.tool).toMatchObject({
          name: "read_file",
          executingCount: 1,
          settledCount: 1,
          errorCount: 0,
        });
      }
    }
    expect(JSON.stringify(loopbackEvidence)).not.toContain(
      "cc-loopback-non-secret",
    );
    expect(
      verifyLiveProviderTrajectoryEvidence(loopbackEvidence, {
        repoRoot: REPOSITORY_ROOT,
        releaseCommit,
        expectedMode: "loopback",
        expectedOperatingSystem: loopbackEvidence.profile.operatingSystem,
        forbiddenSecrets: ["cc-loopback-non-secret"],
      }),
    ).toMatchObject({ runCount: 2, manifestCoverageComplete: false });
  });

  it("requires a real cloud profile and never falls back when its secret is absent", () => {
    expectCode(
      () =>
        resolveLiveProviderTrajectoryProfile({
          mode: "live",
          env: { CC_LLM_PROVIDER: "openai", CC_LLM_MODEL: "gpt-4o-mini" },
        }),
      "missing_live_provider_secret",
    );
    expectCode(
      () =>
        resolveLiveProviderTrajectoryProfile({
          mode: "live",
          env: {
            CC_LLM_PROVIDER: "ollama",
            CC_LLM_MODEL: "local",
            CC_LLM_API_KEY: "not-persisted",
          },
        }),
      "unsupported_live_provider",
    );
    const failure = createLiveProviderTrajectoryFailureEvidence({
      mode: "live",
      releaseCommit,
      code: "missing_live_provider_secret",
    });
    expect(failure).toMatchObject({
      schema: LIVE_PROVIDER_TRAJECTORY_FAILURE_SCHEMA,
      result: "failed",
      failureCode: "missing_live_provider_secret",
      rawProviderMaterialPersisted: false,
    });
    expect(JSON.stringify(failure)).not.toContain("not-persisted");
  });

  it("rejects fixture shape, noise bounds, and duplicate fact IDs before transport", async () => {
    const sourceFixture = JSON.parse(
      fs.readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "tests",
          "fixtures",
          "ide-roadmap",
          "s0-live-provider-trajectory.json",
        ),
        "utf8",
      ),
    );
    const mutations = [
      (fixture) => {
        fixture.noiseMessagesPerCycle = 55;
      },
      (fixture) => {
        fixture.cycles[0].unexpected = true;
      },
      (fixture) => {
        fixture.cycles[1].factDelta.constraints[0] =
          fixture.cycles[0].factDelta.constraints[0];
      },
    ];
    for (const mutate of mutations) {
      const root = temporaryRoot();
      const fixture = structuredClone(sourceFixture);
      mutate(fixture);
      writeJson(
        path.join(
          root,
          "tests",
          "fixtures",
          "ide-roadmap",
          "s0-live-provider-trajectory.json",
        ),
        fixture,
      );
      await expect(
        runLiveProviderTrajectory({
          repoRoot: root,
          mode: "loopback",
          runs: 1,
          releaseCommit,
          verifyHead: false,
        }),
      ).rejects.toMatchObject({ code: "fixture_invalid" });
    }
  });

  it("rejects wrong commits, fixture drift, event reordering, tool drift, and raw fields", () => {
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(loopbackEvidence, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit: "a".repeat(40),
        }),
      "release_commit_mismatch",
    );

    const fixtureDrift = structuredClone(loopbackEvidence);
    fixtureDrift.profile.fixtureDigest = `sha256:${"0".repeat(64)}`;
    reseal(fixtureDrift);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(fixtureDrift, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
        }),
      "evidence_verification_failed",
    );

    const reordered = structuredClone(loopbackEvidence);
    reordered.runs[0].trajectory.cycles[0].eventOrder.reverse();
    reseal(reordered);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(reordered, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
        }),
      "evidence_verification_failed",
    );

    const wrongTool = structuredClone(loopbackEvidence);
    wrongTool.runs[0].trajectory.cycles[0].tool.resultDigest = `sha256:${"0".repeat(64)}`;
    reseal(wrongTool);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(wrongTool, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
        }),
      "evidence_verification_failed",
    );

    const unsafe = structuredClone(loopbackEvidence);
    unsafe.profile.headers = { authorization: "Bearer trajectory-secret" };
    reseal(unsafe);
    const error = expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(unsafe, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
          forbiddenSecrets: ["trajectory-secret"],
        }),
      "evidence_verification_failed",
    );
    expect(error.message).toMatch(/forbidden|credential/);
  });

  it("rejects duplicate run IDs and missing or wrong mode/OS cells", () => {
    const duplicate = structuredClone(loopbackEvidence);
    duplicate.runs[1].runId = duplicate.runs[0].runId;
    reseal(duplicate);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidence(duplicate, {
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
        }),
      "evidence_verification_failed",
    );

    const directory = temporaryRoot();
    writeJson(path.join(directory, "loopback.json"), loopbackEvidence);
    const currentOs = loopbackEvidence.profile.operatingSystem;
    const missingOs = currentOs === "linux" ? "windows" : "linux";
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidenceSet({
          evidenceDir: directory,
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
          expectedMode: "loopback",
          expectedOperatingSystems: [currentOs, missingOs],
          minimumRunsPerOperatingSystem: 2,
        }),
      "evidence_verification_failed",
    );
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidenceSet({
          evidenceDir: directory,
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
          expectedMode: "live",
          expectedOperatingSystems: [currentOs],
          minimumRunsPerOperatingSystem: 2,
        }),
      "evidence_verification_failed",
    );
  });

  it("accepts a complete declared loopback OS set without promoting it to live evidence", () => {
    const directory = temporaryRoot();
    for (const operatingSystem of ["linux", "windows", "macos"]) {
      const document = structuredClone(loopbackEvidence);
      document.profile.operatingSystem = operatingSystem;
      for (const [index, run] of document.runs.entries()) {
        run.operatingSystem = operatingSystem;
        run.runId = `${run.runId}-${operatingSystem}-${index}`;
      }
      reseal(document);
      writeJson(path.join(directory, `${operatingSystem}.json`), document);
    }
    expect(
      verifyLiveProviderTrajectoryEvidenceSet({
        evidenceDir: directory,
        repoRoot: REPOSITORY_ROOT,
        releaseCommit,
        expectedMode: "loopback",
        expectedOperatingSystems: ["linux", "windows", "macos"],
        minimumRunsPerOperatingSystem: 2,
      }),
    ).toMatchObject({
      mode: "loopback",
      counts: { linux: 2, windows: 2, macos: 2 },
      runCount: 6,
      manifestMatrixEligible: false,
      manifestCoverageComplete: false,
    });
  });

  it("rejects duplicate run IDs across evidence files and bounded-reader overflow", () => {
    const duplicateDirectory = temporaryRoot();
    writeJson(path.join(duplicateDirectory, "one.json"), loopbackEvidence);
    writeJson(path.join(duplicateDirectory, "two.json"), loopbackEvidence);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidenceSet({
          evidenceDir: duplicateDirectory,
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
          expectedMode: "loopback",
          expectedOperatingSystems: [loopbackEvidence.profile.operatingSystem],
          minimumRunsPerOperatingSystem: 2,
        }),
      "evidence_verification_failed",
    );

    const oversizedDirectory = temporaryRoot();
    const oversized = path.join(oversizedDirectory, "oversized.json");
    fs.writeFileSync(oversized, "{}");
    fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);
    expectCode(
      () =>
        verifyLiveProviderTrajectoryEvidenceSet({
          evidenceDir: oversizedDirectory,
          repoRoot: REPOSITORY_ROOT,
          releaseCommit,
          expectedMode: "loopback",
          expectedOperatingSystems: [loopbackEvidence.profile.operatingSystem],
        }),
      "evidence_verification_failed",
    );
  });

  it("keeps real-provider execution manual/scheduled and secrets out of arguments", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(workflow).toContain('LOOPBACK_RUNS: "100"');
    expect(workflow).toContain('LIVE_PROVIDER_RUNS: "1"');
    expect(workflow).toContain(
      "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    expect(workflow).toContain("CC_LLM_API_KEY: ${{ secrets.CC_LLM_API_KEY }}");
    expect(workflow).toContain(
      "--expected-operating-systems linux,windows,macos",
    );
    expect(workflow).toContain("--expected-mode live");
    expect(workflow).toContain("without claiming the 100-run gate");
    expect(workflow).not.toMatch(/--api-key|--base-url/);

    const liveProviderJob = workflow.slice(
      workflow.indexOf("  live-provider:\n"),
      workflow.indexOf("  live-provider-verify:\n"),
    );
    const liveProviderRunStep = liveProviderJob.slice(
      liveProviderJob.indexOf(
        "      - name: Run a real-provider trajectory without fallback\n",
      ),
      liveProviderJob.indexOf(
        "      - name: Upload success or sanitized failure evidence\n",
      ),
    );
    expect(liveProviderJob).toContain(
      "      - name: Refuse a workflow-dispatch commit override",
    );
    expect(liveProviderJob).toContain(
      "REQUESTED_COMMIT: ${{ inputs.commit_sha }}",
    );
    expect(liveProviderJob).toContain(
      '"${REQUESTED_COMMIT}" != "${EVENT_COMMIT}"',
    );
    expect(liveProviderJob).toContain(
      "      - name: Verify the secretless live-provider checkout",
    );
    expect(liveProviderJob).toContain('actual_commit="$(git rev-parse HEAD)"');
    expect(liveProviderJob).toContain('"${actual_commit}" != "${GITHUB_SHA}"');
    expect(
      liveProviderJob.indexOf(
        "      - name: Refuse a workflow-dispatch commit override",
      ),
    ).toBeLessThan(
      liveProviderJob.indexOf(
        "      - name: Checkout exact trajectory candidate",
      ),
    );
    expect(
      liveProviderJob.indexOf(
        "      - name: Verify the secretless live-provider checkout",
      ),
    ).toBeLessThan(
      liveProviderJob.indexOf(
        "      - name: Run a real-provider trajectory without fallback",
      ),
    );
    expect(liveProviderJob.match(/secrets\.CC_LLM_API_KEY/g)).toHaveLength(1);
    for (const setting of [
      "CC_LLM_API_KEY: ${{ secrets.CC_LLM_API_KEY }}",
      "CC_LLM_PROVIDER: ${{ vars.CC_LLM_PROVIDER }}",
      "CC_LLM_MODEL: ${{ vars.CC_LLM_MODEL }}",
    ]) {
      expect(liveProviderRunStep).toContain(setting);
      expect(liveProviderJob.split(setting)).toHaveLength(2);
    }
    expect(
      liveProviderJob.slice(0, liveProviderJob.indexOf(liveProviderRunStep)),
    ).not.toContain("secrets.CC_LLM_API_KEY");

    const loopbackJob = workflow.slice(
      workflow.indexOf("  loopback:\n"),
      workflow.indexOf("  loopback-aggregate:\n"),
    );
    expect(loopbackJob).not.toContain("secrets.CC_LLM_API_KEY");
    expect(loopbackJob).toContain("--mode loopback");
  });
});
