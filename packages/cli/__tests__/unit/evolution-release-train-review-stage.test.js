import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/evolution/skill-promotion-review.js", () => ({
  buildSkillPromotionReviewPacket: vi.fn(() => packet()),
}));

import { createEvolutionReviewStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

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
  baselineRevision: 4,
});
const matrixReceiptDigest = digest("matrix-receipt");

function packet() {
  return Object.freeze({
    tenantId: plan.tenantId,
    skillName: plan.skillId,
    candidateId: plan.candidateId,
    candidateContentDigest: plan.candidateDigest,
    baselineReleaseDigest: plan.baselineReleaseDigest,
    expectedActiveRevision: plan.baselineRevision,
    evaluation: Object.freeze({ matrixReceiptDigest }),
    packetDigest: digest("review-packet"),
  });
}

function decision(receiptDigest = digest("review-decision")) {
  return Object.freeze({
    receiptDigest,
    decision: "approved",
    decidedAt: "2026-09-05T00:00:00.000Z",
  });
}

function context() {
  return Object.freeze({
    plan,
    stage: "review",
    operationKey: digest("operation:review"),
    inputDigest: matrixReceiptDigest,
  });
}

function outputLedger(initial = null) {
  let stored = initial;
  return {
    load: vi.fn(() => stored),
    commit: vi.fn((input) => {
      stored = { ...structuredClone(input), valueDigest: digest("stored") };
      return { committed: true };
    }),
  };
}

function reviewLedger(status = "approved", reviewDecision = decision()) {
  return {
    submitPacket: vi.fn(async () => ({ persisted: true })),
    listReviews: vi.fn(async () => [
      {
        packet: packet(),
        status,
        decision: status === "pending" ? null : reviewDecision,
      },
    ]),
  };
}

const usage = Object.freeze({ tokens: 0, cost: 0, timeMs: 1, turns: 1 });

beforeEach(() => vi.clearAllMocks());

describe("Evolution release train Review stage", () => {
  it("submits the exact packet and persists an approved human decision", async () => {
    const reviews = reviewLedger();
    const outputs = outputLedger();
    const stage = createEvolutionReviewStage({
      reviewLedger: reviews,
      packetInput: {},
      outputLedger: outputs,
      usage,
    });

    await expect(stage(context())).resolves.toMatchObject({
      stage: "review",
      inputDigest: matrixReceiptDigest,
      outputDigest: decision().receiptDigest,
      durable: true,
    });
    expect(reviews.submitPacket).toHaveBeenCalledTimes(1);
    expect(outputs.commit).toHaveBeenCalledTimes(1);
  });

  it("returns a non-success pending state without issuing a stage receipt", async () => {
    const reviews = reviewLedger("pending");
    const outputs = outputLedger();
    const stage = createEvolutionReviewStage({
      reviewLedger: reviews,
      packetInput: {},
      outputLedger: outputs,
      usage,
    });

    await expect(stage(context())).rejects.toMatchObject({
      code: "EVOLUTION_RELEASE_TRAIN_REVIEW_PENDING",
    });
    expect(outputs.commit).not.toHaveBeenCalled();
  });

  it("rechecks the human authority and rejects a changed recovered decision", async () => {
    const input = context();
    const original = decision();
    const outputs = outputLedger({
      planDigest: plan.planDigest,
      stage: "review",
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: original.receiptDigest,
      valueDigest: digest("stored"),
      value: { packet: packet(), decision: original },
    });
    const reviews = reviewLedger(
      "approved",
      decision(digest("substituted-decision")),
    );
    const stage = createEvolutionReviewStage({
      reviewLedger: reviews,
      packetInput: {},
      outputLedger: outputs,
      usage,
    });

    await expect(stage(input)).rejects.toThrow(
      /differs from the durable authority/u,
    );
    expect(outputs.commit).not.toHaveBeenCalled();
  });
});
