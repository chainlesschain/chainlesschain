import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/evolution/skill-target-matrix-eval.js", () => ({
  evaluateSkillTargetMatrix: vi.fn(),
  verifySkillTargetMatrixEvalReceipt: vi.fn(),
}));

import {
  evaluateSkillTargetMatrix,
  verifySkillTargetMatrixEvalReceipt,
} from "../../src/lib/evolution/skill-target-matrix-eval.js";
import { createEvolutionEvalStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const plan = Object.freeze({
  tenantId: "tenant-a",
  skillId: "safe-refactor",
  planDigest: digest("plan"),
  candidateId: digest("candidate-id"),
  candidateDigest: digest("candidate"),
  baselineId: digest("baseline-id"),
  baselineReleaseDigest: digest("baseline"),
  baselineContentDigest: digest("baseline-content"),
  baselineRevision: 7,
  evalSuiteDigest: digest("suite"),
  matrixEvalPlanDigest: digest("matrix-eval-plan"),
  targetMatrixDigest: digest("matrix"),
  policyDigest: digest("policy"),
});
const planRef = Object.freeze({
  ref: "matrix-plan:release",
  digest: plan.matrixEvalPlanDigest,
});
const expectedReceipt = Object.freeze({
  matrixEvalId: "matrix-eval:release",
  tenantId: plan.tenantId,
  skillName: plan.skillId,
  candidateId: plan.candidateId,
  candidateContentDigest: plan.candidateDigest,
  baselineId: plan.baselineId,
  baselineReleaseDigest: plan.baselineReleaseDigest,
  expectedActiveContentDigest: plan.baselineContentDigest,
  expectedActiveRevision: plan.baselineRevision,
  dependencyLockDigest: digest("dependency-lock"),
  runtimeManifestDigest: digest("runtime-manifest"),
  targetMatrixRoot: plan.targetMatrixDigest,
  matrixAuthorityRoot: digest("matrix-authority"),
  planDigest: plan.matrixEvalPlanDigest,
  decision: "accepted",
});

function receipt(overrides = {}) {
  return Object.freeze({
    ...expectedReceipt,
    cellResults: [
      {
        cellId: "cell:windows-node22",
        suiteDigest: plan.evalSuiteDigest,
        policyDigest: plan.policyDigest,
      },
    ],
    receiptDigest: digest("eval-receipt"),
    issuedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  });
}

function context() {
  return Object.freeze({
    plan,
    stage: "eval",
    operationKey: digest("operation:eval"),
    inputDigest: plan.candidateDigest,
  });
}

function ledger(initial = null) {
  let stored = initial;
  return {
    port: {
      load: vi.fn(() => stored),
      commit: vi.fn((input) => {
        stored = {
          ...structuredClone(input),
          valueDigest: digest("stored-value"),
        };
        return { committed: true };
      }),
    },
  };
}

const usage = Object.freeze({ tokens: 1, cost: 0, timeMs: 1, turns: 1 });
const durability = {
  retain: vi.fn(async (value) => ({
    durable: true,
    receiptDigest: value.receiptDigest,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  evaluateSkillTargetMatrix.mockResolvedValue(receipt());
  verifySkillTargetMatrixEvalReceipt.mockImplementation(
    async (_verifier, value) => value,
  );
});

describe("Evolution release train matrix Eval stage", () => {
  it("runs, verifies and durably stores one accepted full-matrix evaluation", async () => {
    const storage = ledger();
    const stage = createEvolutionEvalStage({
      aggregator: {},
      receiptVerifier: {},
      planRef,
      expectedReceipt,
      durability,
      outputLedger: storage.port,
      usage,
    });

    await expect(stage(context())).resolves.toMatchObject({
      stage: "eval",
      outputDigest: receipt().receiptDigest,
      durable: true,
    });
    expect(evaluateSkillTargetMatrix).toHaveBeenCalledTimes(1);
    expect(verifySkillTargetMatrixEvalReceipt).toHaveBeenCalledTimes(1);
    expect(storage.port.commit).toHaveBeenCalledTimes(1);
    expect(durability.retain).toHaveBeenCalledTimes(1);
  });

  it("re-verifies a recovered matrix receipt without rerunning all cells", async () => {
    const input = context();
    const storedReceipt = receipt();
    const storage = ledger({
      planDigest: plan.planDigest,
      stage: "eval",
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: storedReceipt.receiptDigest,
      valueDigest: digest("stored-value"),
      value: storedReceipt,
    });
    const stage = createEvolutionEvalStage({
      aggregator: {},
      receiptVerifier: {},
      planRef,
      expectedReceipt,
      durability,
      outputLedger: storage.port,
      usage,
    });

    await expect(stage(input)).resolves.toMatchObject({
      outputDigest: storedReceipt.receiptDigest,
    });
    expect(evaluateSkillTargetMatrix).not.toHaveBeenCalled();
    expect(verifySkillTargetMatrixEvalReceipt).toHaveBeenCalledTimes(1);
    expect(storage.port.commit).not.toHaveBeenCalled();
  });

  it("does not persist a signed matrix receipt for another candidate", async () => {
    evaluateSkillTargetMatrix.mockResolvedValue(
      receipt({ candidateId: digest("substituted-candidate") }),
    );
    const storage = ledger();
    const stage = createEvolutionEvalStage({
      aggregator: {},
      receiptVerifier: {},
      planRef,
      expectedReceipt,
      durability,
      outputLedger: storage.port,
      usage,
    });

    await expect(stage(context())).rejects.toThrow(
      /not bound to the EvolutionPlan/u,
    );
    expect(verifySkillTargetMatrixEvalReceipt).not.toHaveBeenCalled();
    expect(storage.port.commit).not.toHaveBeenCalled();
  });
});
