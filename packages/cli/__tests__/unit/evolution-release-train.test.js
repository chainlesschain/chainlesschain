import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_RELEASE_TRAIN_STAGES,
  assessEvolutionCandidateTrigger,
  createEvolutionPlan,
  createEvolutionReleaseTrain,
  createEvolutionReleaseTrainStateStore,
  createEvolutionTrainStageReceipt,
} from "../../src/lib/evolution/evolution-release-train.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function planInput(overrides = {}) {
  return {
    tenantId: "tenant-a",
    skillId: "skill-a",
    gitCommit: "a".repeat(40),
    baselineReleaseDigest: D("baseline"),
    baselineId: D("baseline-id"),
    baselineContentDigest: D("baseline-content"),
    baselineRevision: 1,
    candidateId: D("candidate-id"),
    candidateDigest: D("candidate"),
    wikiRevisionDigest: D("wiki"),
    evalSuiteDigest: D("eval"),
    matrixEvalPlanDigest: D("matrix-eval-plan"),
    targetMatrixDigest: D("matrix"),
    riskTier: "low",
    rolloutPolicyDigest: D("rollout"),
    metricPolicyDigest: D("metrics"),
    permissionManifestDigest: D("permissions"),
    policyDigest: D("policy"),
    requestedCapabilityDigests: [D("read")],
    baselineCapabilityDigests: [D("read"), D("write-candidate")],
    rootBudget: { tokens: 1_000, cost: 10, timeMs: 60_000, turns: 20 },
    expiresAt: "2030-01-01T00:00:00.000Z",
    triggerDigest: D("trigger"),
    ...overrides,
  };
}

function memoryStore() {
  const states = new Map();
  const receipts = new Map();
  return createEvolutionReleaseTrainStateStore({
    load: async (planDigest) => states.get(planDigest) ?? null,
    loadReceipt: async (receiptDigest) => receipts.get(receiptDigest) ?? null,
    compareAndSet: async ({
      planDigest,
      expectedStateDigest,
      receipt,
      nextState,
    }) => {
      const current = states.get(planDigest) ?? null;
      if ((current?.stateDigest ?? null) !== expectedStateDigest) {
        return { durable: false, stateDigest: null, receiptDigest: null };
      }
      receipts.set(receipt.receiptDigest, receipt);
      states.set(planDigest, nextState);
      return {
        durable: true,
        stateDigest: nextState.stateDigest,
        receiptDigest: receipt.receiptDigest,
      };
    },
  });
}

function stageAdapters(spies = {}) {
  return Object.fromEntries(
    EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [
      stage,
      (context) => {
        spies[stage]?.(context);
        return createEvolutionTrainStageReceipt({
          planDigest: context.plan.planDigest,
          stage,
          operationKey: context.operationKey,
          inputDigest: context.inputDigest,
          outputDigest: D(`${context.plan.planDigest}-${stage}`),
          accepted: true,
          durable: true,
          usage: { tokens: 10, cost: 0.1, timeMs: 100, turns: 1 },
        });
      },
    ]),
  );
}

describe("EvolutionReleaseTrain", () => {
  it("binds one Skill and rejects capability increases in the canonical plan", () => {
    const plan = createEvolutionPlan(planInput());
    expect(plan.skillId).toBe("skill-a");
    expect(plan.planDigest).toMatch(/^sha256:/u);

    expect(() =>
      createEvolutionPlan(
        planInput({
          requestedCapabilityDigests: [D("read"), D("network")],
        }),
      ),
    ).toThrow("cannot increase Skill capabilities");
  });

  it("triggers only on attributable repeated evidence for one Skill", () => {
    const failure = (eventId, failureClass = "procedure") => ({
      eventId,
      skillId: "skill-a",
      kind: "procedure-failure",
      failureClass,
      attributionReceiptDigest: D(eventId),
    });
    const result = assessEvolutionCandidateTrigger({
      events: [
        failure("provider", "provider"),
        failure("failure-1"),
        failure("failure-2"),
        failure("failure-3"),
      ],
    });
    expect(result).toMatchObject({
      eligible: true,
      reason: "procedure-failure",
      skillId: "skill-a",
      evidenceIds: ["failure-1", "failure-2", "failure-3"],
    });
    expect(result.evidenceDigest).toMatch(/^sha256:/u);

    expect(
      assessEvolutionCandidateTrigger({
        events: [failure("noise-1", "mcp"), failure("noise-2", "sandbox")],
      }),
    ).toMatchObject({ eligible: false, reason: "needs-evidence" });
  });

  it("runs the complete fixed lineage and resumes without repeating side effects", async () => {
    const plan = createEvolutionPlan(planInput());
    const store = memoryStore();
    const spies = Object.fromEntries(
      EVOLUTION_RELEASE_TRAIN_STAGES.map((stage) => [stage, vi.fn()]),
    );
    const stages = stageAdapters(spies);
    const first = createEvolutionReleaseTrain({
      plan,
      stateStore: store,
      stages,
      clock: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });
    const completed = await first.run();
    expect(completed.state.status).toBe("complete");
    expect(completed.receipts).toHaveLength(8);
    expect(completed.state.usage).toEqual({
      tokens: 80,
      cost: 0.7999999999999999,
      timeMs: 800,
      turns: 8,
    });
    for (const stage of EVOLUTION_RELEASE_TRAIN_STAGES) {
      expect(spies[stage]).toHaveBeenCalledTimes(1);
    }

    const reopened = createEvolutionReleaseTrain({
      plan,
      stateStore: store,
      stages,
      clock: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });
    const recovered = await reopened.run();
    expect(recovered.state.stateDigest).toBe(completed.state.stateDigest);
    for (const stage of EVOLUTION_RELEASE_TRAIN_STAGES) {
      expect(spies[stage]).toHaveBeenCalledTimes(1);
    }
  });

  it("never reaches promotion when any earlier durable receipt is missing", async () => {
    const plan = createEvolutionPlan(planInput());
    const promotion = vi.fn();
    const stages = stageAdapters({ promotion });
    stages.review = () => null;
    const train = createEvolutionReleaseTrain({
      plan,
      stateStore: memoryStore(),
      stages,
      clock: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });

    await expect(train.run()).rejects.toThrow(
      "review did not return a canonical receipt",
    );
    expect(promotion).not.toHaveBeenCalled();
  });

  it("stops before the next stage when the root budget would be exceeded", async () => {
    const plan = createEvolutionPlan(
      planInput({
        rootBudget: { tokens: 15, cost: 10, timeMs: 60_000, turns: 20 },
      }),
    );
    const propose = vi.fn();
    const candidate = vi.fn();
    const stages = stageAdapters({ propose, candidate });
    const train = createEvolutionReleaseTrain({
      plan,
      stateStore: memoryStore(),
      stages,
      clock: () => Date.parse("2029-01-01T00:00:00.000Z"),
    });

    await expect(train.run()).rejects.toThrow("root budget exceeded: tokens");
    expect(propose).toHaveBeenCalledTimes(1);
    expect(candidate).not.toHaveBeenCalled();
  });
});
