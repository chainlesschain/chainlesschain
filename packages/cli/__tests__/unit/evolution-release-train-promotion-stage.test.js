import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createEvolutionPromotionStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const plan = Object.freeze({
  tenantId: "tenant-a",
  skillId: "safe-refactor",
  planDigest: digest("plan"),
  candidateId: digest("candidate-id"),
  candidateDigest: digest("candidate-content"),
  baselineReleaseDigest: digest("baseline-release"),
  baselineRevision: 3,
});
const evalDigest = digest("matrix-eval");
const reviewDigest = digest("human-review");
const pilotDigest = digest("pilot-stable");
const releaseDigest = digest("release");

function context() {
  return Object.freeze({
    plan,
    stage: "promotion",
    operationKey: digest("operation:promotion"),
    inputDigest: pilotDigest,
  });
}

function outputLedger(initialPromotion = null) {
  const values = new Map([
    [
      "eval",
      {
        outputDigest: evalDigest,
        value: { receiptDigest: evalDigest },
      },
    ],
    [
      "review",
      {
        outputDigest: reviewDigest,
        value: { decision: { receiptDigest: reviewDigest } },
      },
    ],
    [
      "pilot",
      {
        outputDigest: pilotDigest,
        value: {
          stage: "active",
          progressiveCanary: { stepId: null },
        },
      },
    ],
  ]);
  if (initialPromotion) values.set("promotion", initialPromotion);
  return {
    load: vi.fn(({ stage }) => values.get(stage) ?? null),
    commit: vi.fn((input) => {
      values.set(input.stage, {
        ...structuredClone(input),
        valueDigest: digest(`stored:${input.stage}`),
      });
      return { committed: true };
    }),
  };
}

function registry({ promoted = false } = {}) {
  let state = {
    tenantId: plan.tenantId,
    skillName: plan.skillId,
    revision: promoted ? plan.baselineRevision + 1 : plan.baselineRevision,
    activeReleaseDigest: promoted ? releaseDigest : plan.baselineReleaseDigest,
  };
  const releases = new Map([
    [
      plan.baselineReleaseDigest,
      {
        tenantId: plan.tenantId,
        skillName: plan.skillId,
        releaseDigest: plan.baselineReleaseDigest,
        candidateId: digest("baseline-candidate"),
        contentDigest: digest("baseline-content"),
      },
    ],
    [
      releaseDigest,
      {
        tenantId: plan.tenantId,
        skillName: plan.skillId,
        releaseDigest,
        candidateId: plan.candidateId,
        contentDigest: plan.candidateDigest,
      },
    ],
  ]);
  return {
    port: {
      readState: vi.fn(() => structuredClone(state)),
      readRelease: vi.fn((value) => structuredClone(releases.get(value))),
    },
    promote: () => {
      state = {
        ...state,
        revision: plan.baselineRevision + 1,
        activeReleaseDigest: releaseDigest,
      };
      return {
        release: structuredClone(releases.get(releaseDigest)),
        matrixBinding: { matrixReceiptDigest: evalDigest },
        reviewBinding: { reviewReceiptDigest: reviewDigest },
      };
    },
  };
}

const usage = Object.freeze({ tokens: 0, cost: 0, timeMs: 5, turns: 1 });

describe("Evolution release train Promotion stage", () => {
  it("uses the evaluated human-reviewed controller and verifies active pointer", async () => {
    const releases = registry();
    const controller = {
      promoteEvaluated: vi.fn(async () => releases.promote()),
    };
    const outputs = outputLedger();
    const stage = createEvolutionPromotionStage({
      controller,
      releaseRegistry: releases.port,
      promotionInput: { candidateId: plan.candidateId },
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(context())).resolves.toMatchObject({
      stage: "promotion",
      outputDigest: releaseDigest,
      durable: true,
    });
    expect(controller.promoteEvaluated).toHaveBeenCalledTimes(1);
    expect(outputs.commit).toHaveBeenCalledTimes(1);
  });

  it("recovers from the active ReleaseRegistry without consuming authority twice", async () => {
    const input = context();
    const releases = registry({ promoted: true });
    const controller = { promoteEvaluated: vi.fn() };
    const outputs = outputLedger({
      planDigest: plan.planDigest,
      stage: "promotion",
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: releaseDigest,
      valueDigest: digest("stored:promotion"),
      value: {},
    });
    const stage = createEvolutionPromotionStage({
      controller,
      releaseRegistry: releases.port,
      promotionInput: { candidateId: plan.candidateId },
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(input)).resolves.toMatchObject({
      outputDigest: releaseDigest,
    });
    expect(controller.promoteEvaluated).not.toHaveBeenCalled();
    expect(outputs.commit).not.toHaveBeenCalled();
  });

  it("does not mutate when stable Pilot evidence is absent", async () => {
    const releases = registry();
    const controller = { promoteEvaluated: vi.fn() };
    const outputs = outputLedger();
    outputs.load.mockImplementation(({ stage }) =>
      stage === "pilot" ? null : outputLedger().load({ stage }),
    );
    const stage = createEvolutionPromotionStage({
      controller,
      releaseRegistry: releases.port,
      promotionInput: { candidateId: plan.candidateId },
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(context())).rejects.toThrow(
      /stable authorized release train/u,
    );
    expect(controller.promoteEvaluated).not.toHaveBeenCalled();
  });
});
