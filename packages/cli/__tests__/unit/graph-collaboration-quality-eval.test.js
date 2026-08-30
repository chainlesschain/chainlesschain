import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORMAL_PROFILE,
  FROZEN_THRESHOLDS,
  PLATFORM_SCHEMA,
  buildCandidateTasks,
  candidateCheckpointArgs,
  candidateFailureDetails,
  candidateGraphEvidence,
  createEvaluationModelEnvironment,
  enforceQualityThresholds,
  qualityEvidenceDigest,
  sealPlatformRecord,
  summarizeQualityRounds,
  validatePlatformRecord,
  verifyQualityMatrix,
} from "../../scripts/graph-collaboration-quality-eval.mjs";

const COMMIT = "a".repeat(40);
const CHALLENGE = "run-42:1:" + COMMIT;
const MAX_TOTAL_COST_USD = 100;
const PLANNED_MAX_ROUNDS = 12;
const PER_INVOCATION_CEILING_USD =
  MAX_TOTAL_COST_USD /
  (PLANNED_MAX_ROUNDS * (FORMAL_PROFILE.taskIds.length + 4));

describe("formal candidate platform isolation", () => {
  it.each(["linux", "macos"])(
    "uses worktree plus Agent checkpoint on %s without claiming process-tree containment",
    (platform) => {
      expect(candidateCheckpointArgs(platform)).toEqual([]);
    },
  );

  it("keeps the Windows Job-backed managed process checkpoint", () => {
    expect(candidateCheckpointArgs("windows")).toEqual([
      "--managed-checkpoint",
    ]);
  });

  it("rejects non-matrix platform spellings", () => {
    expect(() => candidateCheckpointArgs("darwin")).toThrow(
      /unsupported evaluation platform/u,
    );
  });

  it("uses an isolated model/config home and explicitly enables canonical Graph", () => {
    const isolationRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-quality-env-"),
    );
    const priorKey = process.env.CC_API_KEY;
    process.env.CC_API_KEY = "fixture-key";
    try {
      const environment = createEvaluationModelEnvironment(
        "openai",
        isolationRoot,
        { canonicalGraph: true },
      );
      expect(environment).toMatchObject({
        CC_API_KEY: "fixture-key",
        LLM_PROVIDER: "openai",
        CHAINLESSCHAIN_GRAPH_CLI_TEAM: "canonical",
      });
      expect(environment.CHAINLESSCHAIN_HOME).toContain(isolationRoot);
      expect(environment.HOME).toContain(isolationRoot);
      expect(environment.USERPROFILE).toContain(isolationRoot);
    } finally {
      if (priorKey == null) delete process.env.CC_API_KEY;
      else process.env.CC_API_KEY = priorKey;
      fs.rmSync(isolationRoot, { recursive: true, force: true });
    }
  });
});

describe("formal candidate Graph projection", () => {
  const canonicalProjection = () => ({
    schema: "chainlesschain.graph-trace-projection/v1",
    runId: "team:quality-run",
    revisionDigest: `sha256:${"1".repeat(64)}`,
    projectionDigest: `sha256:${"2".repeat(64)}`,
    status: "succeeded",
    attempts: [
      {
        nodeId: "task-a",
        status: "accepted",
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:01.000Z",
      },
    ],
    messageGraph: { messages: [], edges: [] },
    handoffs: [],
    criticalPath: { durationMs: 1000 },
  });

  it("evaluates the durable canonical authority rather than the Team compatibility projection", () => {
    expect(
      candidateGraphEvidence({
        graphAuthorityMode: "canonical",
        graphAuthority: canonicalProjection(),
        graphProjection: {
          schema: "chainlesschain.team-graph-projection/v1",
        },
      }),
    ).toMatchObject({
      graphRunId: "team:quality-run",
      graphProjectionDigest: `sha256:${"2".repeat(64)}`,
      graphMetrics: {
        terminalSuccess: 1,
        deadlocked: 0,
        reconciliationRequired: 0,
        messageVisibilityRate: 1,
        handoffCompletionRate: 1,
      },
    });
  });

  it("rejects a legacy or non-successful candidate authority", () => {
    expect(() =>
      candidateGraphEvidence({
        graphAuthorityMode: "legacy",
        graphAuthority: canonicalProjection(),
      }),
    ).toThrow(/canonical Graph authority/u);
    expect(() =>
      candidateGraphEvidence({
        graphAuthorityMode: "canonical",
        graphAuthority: {
          schema: "chainlesschain.team-graph-projection/v1",
          runId: "team:compatibility-projection",
          projectionDigest: `sha256:${"3".repeat(64)}`,
        },
      }),
    ).toThrow(/successful canonical projection/u);
    expect(() =>
      candidateGraphEvidence({
        graphAuthorityMode: "canonical",
        graphAuthority: {
          ...canonicalProjection(),
          status: "deadlocked",
        },
      }),
    ).toThrow(/successful canonical projection/u);
  });
});

function round(seed, overrides = {}) {
  const results = (passed, digit) =>
    FORMAL_PROFILE.taskIds.map((id, index) => ({
      id,
      pass: index < passed,
      detail: "fixture",
      outcomeDigest: `sha256:${digit.repeat(64)}`,
    }));
  const controlPassed =
    overrides.control?.passed ?? FORMAL_PROFILE.taskIds.length;
  const candidatePassed =
    overrides.candidate?.passed ?? FORMAL_PROFILE.taskIds.length;
  const controlResults =
    overrides.control?.results || results(controlPassed, "1");
  const candidateResults =
    overrides.candidate?.results || results(candidatePassed, "2");
  const control = {
    total: FORMAL_PROFILE.taskIds.length,
    passed: controlPassed,
    tokens: 1000,
    costUsd: 0.1,
    durationMs: 1000,
    unrelatedChangeRate: 0,
    unrelatedChanges: [],
    results: controlResults,
    outcomeDigest: qualityEvidenceDigest(
      controlResults.map(({ id, pass, outcomeDigest }) => ({
        id,
        pass,
        outcomeDigest,
      })),
    ),
    ...overrides.control,
  };
  const candidate = {
    total: FORMAL_PROFILE.taskIds.length,
    passed: candidatePassed,
    tokens: 1200,
    costUsd: 0.12,
    durationMs: 900,
    unrelatedChangeRate: 0,
    unrelatedChanges: [],
    results: candidateResults,
    outcomeDigest: qualityEvidenceDigest(
      candidateResults.map(({ id, pass, outcomeDigest }) => ({
        id,
        pass,
        outcomeDigest,
      })),
    ),
    graphRunId: `graph:${seed}`,
    graphProjectionDigest: `sha256:${"3".repeat(64)}`,
    graphMetrics: {
      deadlocked: 0,
      reconciliationRequired: 0,
      messageVisibilityRate: 1,
      handoffCompletionRate: 1,
    },
    ...overrides.candidate,
  };
  return {
    seed,
    behaviorEquivalent: overrides.behaviorEquivalent ?? 1,
    control,
    candidate,
  };
}

function platform(platform, index = 0, overrides = {}) {
  const rounds = overrides.rounds || [round(101), round(202), round(303)];
  const metrics = summarizeQualityRounds(rounds);
  const gate = enforceQualityThresholds(metrics);
  return sealPlatformRecord({
    schema: PLATFORM_SCHEMA,
    status: "passed",
    commitSha: COMMIT,
    challenge: CHALLENGE,
    executionId: `run:${platform}:${index}`,
    platform,
    architecture: "x64",
    node: "v22.12.0",
    provider: "openai",
    model: "gpt-5-mini",
    profile: FORMAL_PROFILE,
    thresholds: FROZEN_THRESHOLDS,
    budget: {
      ceilingUsd: MAX_TOTAL_COST_USD,
      perInvocationCeilingUsd: PER_INVOCATION_CEILING_USD,
      plannedMaxRounds: PLANNED_MAX_ROUNDS,
      controlInvocationsPerRound: FORMAL_PROFILE.taskIds.length,
      candidateAgentLimit: 4,
      observedCostUsd: metrics.controlCostUsd + metrics.candidateCostUsd,
    },
    startedAt: "2026-08-29T00:00:00.000Z",
    completedAt: "2026-08-29T00:30:00.000Z",
    durationSeconds: 1800,
    rounds,
    metrics,
    gate,
    ...overrides.record,
  });
}

describe("graph collaboration quality evidence", () => {
  it("keeps isolated candidate tasks retry-safe and reports their root failures", () => {
    expect(
      buildCandidateTasks(
        [
          {
            id: "add-function",
            description: "Add a function",
            prompt: "Implement it.",
          },
        ],
        101,
      ),
    ).toEqual([
      expect.objectContaining({
        key: "add-function",
        retrySafe: true,
        scopePaths: ["cases/add-function"],
      }),
    ]);

    expect(
      candidateFailureDetails({
        status: 1,
        signal: null,
        stdout:
          `${JSON.stringify({ type: "task:failed", key: "add-function", error: "provider overloaded: sk-abcd1234efgh5678ijkl", retry: false })}\n` +
          `${JSON.stringify({ summary: { success: false, done: true, executions: 1 } })}\n`,
        stderr: "team failed",
      }),
    ).toEqual({
      status: 1,
      signal: null,
      failures: [
        {
          key: "add-function",
          error: "provider overloaded: [REDACTED]",
          retry: false,
        },
      ],
      summary: { success: false, done: true, executions: 1 },
      stderr: "team failed",
    });
  });

  it("recomputes a passing formal platform report", () => {
    const record = platform("linux");
    expect(
      validatePlatformRecord(record, {
        commitSha: COMMIT,
        challenge: CHALLENGE,
        maxTotalCostUsd: MAX_TOTAL_COST_USD,
      }),
    ).toBe(record);
    const { evidenceDigest, ...body } = record;
    expect(evidenceDigest).toBe(qualityEvidenceDigest(body));
  });

  it("rejects a forged platform report", () => {
    const record = platform("linux");
    expect(() =>
      validatePlatformRecord(
        { ...record, durationSeconds: 9999 },
        { commitSha: COMMIT },
      ),
    ).toThrow(/digest/u);
  });

  it("rejects a threshold regression even when the report claims passed", () => {
    const rounds = [1, 2, 3].map((seed) =>
      round(seed, {
        candidate: { passed: 3 },
        behaviorEquivalent: 0,
      }),
    );
    const metrics = summarizeQualityRounds(rounds);
    expect(enforceQualityThresholds(metrics)).toMatchObject({ passed: false });
    const forged = platform("linux", 0, {
      rounds,
      record: {
        metrics,
        gate: { passed: true, failures: [] },
      },
    });
    expect(() => validatePlatformRecord(forged)).toThrow(/threshold/u);
  });

  it("rejects missing cost evidence and a forged total budget", () => {
    const missingCostRounds = [round(101), round(202), round(303)];
    missingCostRounds[0].control.costUsd = 0;
    const missingCostMetrics = summarizeQualityRounds(missingCostRounds);
    const missingCost = platform("linux", 0, {
      rounds: missingCostRounds,
      record: {
        metrics: missingCostMetrics,
        gate: enforceQualityThresholds(missingCostMetrics),
        budget: {
          ceilingUsd: MAX_TOTAL_COST_USD,
          perInvocationCeilingUsd: PER_INVOCATION_CEILING_USD,
          plannedMaxRounds: PLANNED_MAX_ROUNDS,
          controlInvocationsPerRound: FORMAL_PROFILE.taskIds.length,
          candidateAgentLimit: 4,
          observedCostUsd:
            missingCostMetrics.controlCostUsd +
            missingCostMetrics.candidateCostUsd,
        },
      },
    });
    expect(() => validatePlatformRecord(missingCost)).toThrow(/costUsd/u);

    const record = structuredClone(platform("linux"));
    delete record.evidenceDigest;
    record.budget.ceilingUsd = 1;
    expect(() => validatePlatformRecord(sealPlatformRecord(record))).toThrow(
      /budget/u,
    );
  });

  it("rejects self-reported task totals that do not match task evidence", () => {
    const record = platform("linux");
    const body = structuredClone(record);
    delete body.evidenceDigest;
    body.rounds[0].candidate.passed = FORMAL_PROFILE.taskIds.length - 1;
    body.metrics = summarizeQualityRounds(body.rounds);
    body.gate = enforceQualityThresholds(body.metrics);
    expect(() => validatePlatformRecord(sealPlatformRecord(body))).toThrow(
      /pass totals/u,
    );
  });

  it("accepts exactly one same-run record from each operating system", () => {
    const matrix = verifyQualityMatrix(
      [platform("linux"), platform("macos"), platform("windows")],
      {
        commitSha: COMMIT,
        challenge: CHALLENGE,
        maxTotalCostUsd: MAX_TOTAL_COST_USD,
      },
    );
    expect(matrix).toMatchObject({
      status: "passed",
      commitSha: COMMIT,
      platforms: ["linux", "macos", "windows"],
      gate: { passed: true },
    });
    expect(matrix.aggregateDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects mixed runs and replayed platform executions", () => {
    const linux = platform("linux");
    const macos = platform("macos");
    const windows = platform("windows");
    const mixedBody = {
      ...windows,
      challenge: "another-run",
    };
    delete mixedBody.evidenceDigest;
    expect(() =>
      verifyQualityMatrix([linux, macos, sealPlatformRecord(mixedBody)]),
    ).toThrow(/mixes|challenge/u);

    const replayBody = { ...windows, executionId: linux.executionId };
    delete replayBody.evidenceDigest;
    expect(() =>
      verifyQualityMatrix([linux, macos, sealPlatformRecord(replayBody)]),
    ).toThrow(/distinct/u);
  });

  it("keeps the workflow protected, exact-SHA, long-running, and attested", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    );
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows/graph-collaboration-quality-eval.yml"),
      "utf8",
    );
    expect(workflow).toContain("environment: graph-collaboration-quality");
    expect(workflow).toContain('test "$EXPECTED_SHA" = "$SOURCE_SHA"');
    expect(workflow).toContain("--duration-seconds 1800");
    expect(workflow).toContain("--min-rounds 3");
    expect(workflow).toContain("CC_LLM_API_KEY");
    expect(workflow).toContain("vars.CC_LLM_PROVIDER");
    expect(workflow).toContain("vars.CC_LLM_MODEL");
    expect(workflow).toContain("vars.CC_P2_3_MAX_TOTAL_COST_USD");
    expect(workflow).toContain("--max-total-cost-usd");
    expect(workflow).toContain(
      "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
    );
    expect(workflow).not.toContain("continue-on-error");
  });
});
