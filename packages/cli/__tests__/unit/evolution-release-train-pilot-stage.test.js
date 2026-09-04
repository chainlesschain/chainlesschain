import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createEvolutionPilotStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const plan = Object.freeze({
  tenantId: "tenant-a",
  skillId: "safe-refactor",
  planDigest: digest("plan"),
  candidateDigest: digest("candidate"),
  baselineReleaseDigest: digest("baseline"),
  rolloutPolicyDigest: digest("rollout"),
});
const reviewDigest = digest("review-decision");
const matrixDigest = digest("matrix-receipt");
const packetDigest = digest("review-packet");
const finalTransitionDigest = digest("pilot-stable-transition");

function context() {
  return Object.freeze({
    plan,
    stage: "pilot",
    operationKey: digest("operation:pilot"),
    inputDigest: reviewDigest,
  });
}

function pilot(initial = {}) {
  let started = initial.started ?? false;
  let current = {
    stage: initial.stage ?? "candidate",
    reconciliationRequired: false,
    lastTransitionReceiptDigest: initial.lastTransitionReceiptDigest ?? null,
    progressiveCanary: {
      planDigest: plan.rolloutPolicyDigest,
      stepId: initial.stepId ?? null,
    },
  };
  const api = {
    descriptor: {
      tenantId: plan.tenantId,
      skillName: plan.skillId,
      candidateDigest: plan.candidateDigest,
      baselineDigest: plan.baselineReleaseDigest,
      evalReceiptDigest: matrixDigest,
      reviewPacketDigest: packetDigest,
    },
    view: vi.fn(() => structuredClone(current)),
    snapshot: vi.fn(() => ({
      state: { activeStateDigest: started ? digest("active") : null },
    })),
    start: vi.fn(async () => {
      started = true;
      return structuredClone(current);
    }),
    approveShadow: vi.fn(async () => {
      current = {
        ...current,
        stage: "shadow",
        progressiveCanary: {
          ...current.progressiveCanary,
          stepId: "shadow",
        },
      };
      return structuredClone(current);
    }),
    advance: vi.fn(async () => {
      current =
        current.stage === "shadow"
          ? {
              ...current,
              stage: "canary",
              progressiveCanary: {
                ...current.progressiveCanary,
                stepId: "canary-10",
              },
            }
          : {
              ...current,
              stage: "active",
              lastTransitionReceiptDigest: finalTransitionDigest,
              progressiveCanary: {
                ...current.progressiveCanary,
                stepId: null,
              },
            };
      return structuredClone(current);
    }),
    reconcilePendingTransition: vi.fn(async () => structuredClone(current)),
  };
  return api;
}

function outputLedger(initialPilot = null) {
  const values = new Map([
    [
      "review",
      {
        outputDigest: reviewDigest,
        value: {
          packet: {
            packetDigest,
            evaluation: { matrixReceiptDigest: matrixDigest },
          },
          decision: { receiptDigest: reviewDigest },
        },
      },
    ],
  ]);
  if (initialPilot) values.set("pilot", initialPilot);
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

const usage = Object.freeze({ tokens: 0, cost: 0, timeMs: 10, turns: 1 });

describe("Evolution release train Pilot stage", () => {
  it("drives the persistent progressive Pilot through stable active", async () => {
    const controller = pilot();
    const outputs = outputLedger();
    const nextAdvanceInput = vi.fn(async () => ({
      gateReceipt: { receiptDigest: digest("gate") },
    }));
    const stage = createEvolutionPilotStage({
      pilot: controller,
      startRequest: {
        optedIn: true,
        tenantId: plan.tenantId,
        cohortId: "cohort:one",
      },
      approvalInput: { receiptDigest: reviewDigest },
      nextAdvanceInput,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      outputLedger: outputs,
      usage,
    });

    await expect(stage(context())).resolves.toMatchObject({
      stage: "pilot",
      outputDigest: finalTransitionDigest,
      durable: true,
    });
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.approveShadow).toHaveBeenCalledTimes(1);
    expect(controller.advance).toHaveBeenCalledTimes(2);
    expect(outputs.commit).toHaveBeenCalledTimes(1);
  });

  it("stops in a non-success pending state when the next gate is unavailable", async () => {
    const controller = pilot();
    const outputs = outputLedger();
    const stage = createEvolutionPilotStage({
      pilot: controller,
      startRequest: {
        optedIn: true,
        tenantId: plan.tenantId,
        cohortId: "cohort:one",
      },
      approvalInput: { receiptDigest: reviewDigest },
      nextAdvanceInput: async () => null,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      outputLedger: outputs,
      usage,
    });

    await expect(stage(context())).rejects.toMatchObject({
      code: "EVOLUTION_RELEASE_TRAIN_PILOT_PENDING",
    });
    expect(outputs.commit).not.toHaveBeenCalled();
  });

  it("recovers an already-stable controller without replaying transitions", async () => {
    const input = context();
    const controller = pilot({
      started: true,
      stage: "active",
      stepId: null,
      lastTransitionReceiptDigest: finalTransitionDigest,
    });
    const outputs = outputLedger({
      planDigest: plan.planDigest,
      stage: "pilot",
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: finalTransitionDigest,
      valueDigest: digest("stored:pilot"),
      value: controller.view(),
    });
    const stage = createEvolutionPilotStage({
      pilot: controller,
      startRequest: {},
      approvalInput: {},
      nextAdvanceInput: async () => {
        throw new Error("must not advance");
      },
      effectiveAt: "2026-09-05T00:00:00.000Z",
      outputLedger: outputs,
      usage,
    });

    await expect(stage(input)).resolves.toMatchObject({
      outputDigest: finalTransitionDigest,
    });
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.approveShadow).not.toHaveBeenCalled();
    expect(controller.advance).not.toHaveBeenCalled();
    expect(outputs.commit).not.toHaveBeenCalled();
  });
});
