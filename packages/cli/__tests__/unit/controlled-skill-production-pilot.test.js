import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  CONTROLLED_SKILL_PILOT_ERROR,
  CONTROLLED_SKILL_PILOT_STAGE,
  ControlledSkillProductionPilot,
} from "../../src/lib/evolution/controlled-skill-production-pilot.js";
import {
  createProgressiveCanaryAssignmentAuthority,
  createProgressiveCanaryGateAuthority,
  createProgressiveCanaryPlan,
} from "../../src/lib/evolution/statistical-progressive-canary.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const H = (value) =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

function descriptor(overrides = {}) {
  return {
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    skillName: "focused-skill",
    candidateDigest: D("candidate"),
    baselineDigest: D("baseline"),
    evalReceiptDigest: D("eval"),
    whyEvidenceDigest: D("why"),
    candidateDiffDigest: D("candidate-diff"),
    permissionDiffDigest: D("permission-diff"),
    beforeEvaluationDigest: D("before"),
    afterEvaluationDigest: D("after"),
    reviewPacketDigest: D("review"),
    cohort: {
      id: "cohort-a",
      optInRequired: true,
      maxSubjects: 3,
      canaryPercent: 100,
    },
    observation: {
      minSamples: 2,
      minWindowMs: 100,
      maxWindowMs: 1_000,
    },
    thresholds: {
      minAdoptionRate: 0.5,
      minSuccessDelta: 0.5,
      maxCostDelta: 0,
      maxUserRevisionRate: 0.25,
      maxMisPromotionRate: 0,
      maxRollbackRate: 0,
      maxSecurityEvents: 0,
    },
    ...overrides,
  };
}

function harness(overrides = {}) {
  let active = { release: "baseline", revision: 1 };
  const committed = [];
  const ports = {
    readActiveState: vi.fn(async () => active),
    verifyApproval: vi.fn(async ({ descriptor: fixed, descriptorDigest }) => ({
      authenticated: true,
      durable: true,
      automated: false,
      tenantId: fixed.tenantId,
      pilotId: fixed.pilotId,
      packetDigest: fixed.reviewPacketDigest,
      descriptorDigest,
      decision: "approved",
      receiptDigest: D("approval"),
    })),
    verifyObservation: vi.fn(async (input) => ({
      authenticated: true,
      durable: true,
      tenantId: input.descriptor.tenantId,
      pilotId: input.descriptor.pilotId,
      cohortId: input.descriptor.cohort.id,
      stage: input.stage,
      subjectDigest: input.subjectDigest,
      assignmentReceiptDigest: input.assignmentReceiptDigest,
      receiptDigest: input.receiptDigest,
      optedIn: input.optedIn,
      adopted: input.adopted,
      baselineSuccess: input.baselineSuccess,
      candidateSuccess: input.candidateSuccess,
      baselineCostUsd: input.baselineCostUsd,
      candidateCostUsd: input.candidateCostUsd,
      userRevised: input.userRevised,
      misPromotion: input.misPromotion,
      rolledBack: input.rolledBack,
      securityEvents: input.securityEvents,
      observedAt: input.observedAt,
    })),
    verifyRestore: vi.fn(({ restore }) => ({
      ...restore,
      authenticated: true,
      durable: true,
    })),
    transitionStage: vi.fn(async ({ request, requestDigest }) => {
      if (["active", "rolled-back"].includes(request.to)) {
        active = { release: request.to, revision: request.requestedAt + 2 };
      }
      return {
        authenticated: true,
        durable: true,
        descriptorDigest: request.descriptorDigest,
        requestDigest,
        from: request.from,
        to: request.to,
        receiptDigest: D(`transition:${request.from}:${request.to}`),
        activeStateDigest: H(active),
      };
    }),
    commitState: vi.fn(async (input) => {
      committed.push(structuredClone(input));
      return {
        authenticated: true,
        durable: true,
        descriptorDigest: input.state.descriptorDigest,
        revision: input.state.revision,
        stateDigest: input.stateDigest,
        eventDigest: input.eventDigest,
      };
    }),
    ...overrides,
  };
  return {
    ports,
    committed,
    setActive(value) {
      active = value;
    },
  };
}

function observation(index, overrides = {}) {
  return {
    subjectDigest: D(`subject-${index}`),
    assignmentReceiptDigest: D(`assignment-${index}`),
    receiptDigest: D(`observation-${index}`),
    optedIn: true,
    adopted: true,
    baselineSuccess: false,
    candidateSuccess: true,
    baselineCostUsd: 1,
    candidateCostUsd: 0.5,
    userRevised: false,
    misPromotion: false,
    rolledBack: false,
    securityEvents: 0,
    observedAt: 0,
    ...overrides,
  };
}

function progressiveHarness() {
  const plan = createProgressiveCanaryPlan({
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    skillName: "focused-skill",
    candidateDigest: D("candidate"),
    baselineDigest: D("baseline"),
    riskTier: "medium",
    assignmentSaltDigest: D("assignment-salt"),
    assignmentAuthority: {
      id: "traffic-authority",
      revision: 1,
      handlerDigest: D("traffic-handler"),
    },
    gateAuthority: {
      id: "gate-authority",
      revision: 1,
      handlerDigest: D("gate-handler"),
    },
    steps: [
      {
        id: "shadow",
        stage: "shadow",
        trafficPercent: 0,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 1_000,
      },
      {
        id: "canary-10",
        stage: "canary",
        trafficPercent: 10,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 1_000,
      },
      {
        id: "canary-50",
        stage: "canary",
        trafficPercent: 50,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 1_000,
      },
      {
        id: "probation",
        stage: "active-probation",
        trafficPercent: 100,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 1_000,
      },
    ],
    thresholds: {
      confidence: 0.95,
      bootstrapSamples: 1_000,
      minQualityDeltaLowerBound: 0,
      maxMeanCostDelta: 0,
      maxP95LatencyRatio: 1,
      maxP99LatencyRatio: 1,
      maxMeanToolCallDelta: 0,
    },
  });
  const sign = (secret, payload) =>
    createHmac("sha256", secret).update(canonical(payload)).digest("base64url");
  const attestation = (secret) => async (payload) => {
    const issuedAt = new Date(900).toISOString();
    const expiresAt = new Date(2_000).toISOString();
    return {
      issuedAt,
      expiresAt,
      signature: sign(secret, { ...payload, issuedAt, expiresAt }),
    };
  };
  const trafficSecret = "traffic-secret";
  const traffic = createProgressiveCanaryAssignmentAuthority({
    plan,
    now: () => 1_000,
    attestor: attestation(trafficSecret),
    verifier: async ({ payload, signature }) =>
      signature === sign(trafficSecret, payload),
  });
  const gateSecret = "gate-secret";
  const gate = createProgressiveCanaryGateAuthority({
    plan,
    assignmentAuthority: traffic,
    now: () => 1_000,
    attestor: attestation(gateSecret),
    verifier: async ({ payload, signature }) =>
      signature === sign(gateSecret, payload),
  });
  return { plan, traffic, gate };
}

async function progressiveGateReceipt({ traffic, gate }, stepId) {
  let assignmentReceipt;
  let subjectDigest;
  for (let index = 0; index < 10_000; index += 1) {
    subjectDigest = D(`${stepId}:subject:${index}`);
    assignmentReceipt = await traffic.assign({ stepId, subjectDigest });
    if (assignmentReceipt.assigned) break;
  }
  if (!assignmentReceipt?.assigned) throw new Error("no assigned test subject");
  return gate.evaluate({
    stepId,
    stepStartedAt: 0,
    observedAt: 1,
    observations: [
      {
        subjectDigest,
        assignmentReceipt,
        outcomeReceiptDigest: D(`${stepId}:outcome`),
        observedAt: 1,
        baselineSuccess: false,
        candidateSuccess: true,
        baselineCost: 1,
        candidateCost: 1,
        baselineLatencyMs: 100,
        candidateLatencyMs: 100,
        baselineToolCalls: 1,
        candidateToolCalls: 1,
        securityEvents: 0,
        permissionEvents: 0,
      },
    ],
  });
}

async function shadowPilot({ nowRef = { value: 0 }, h = harness() } = {}) {
  const pilot = new ControlledSkillProductionPilot({
    descriptor: descriptor(),
    ports: h.ports,
    now: () => nowRef.value,
  });
  await pilot.start({
    optedIn: true,
    tenantId: "tenant-a",
    cohortId: "cohort-a",
  });
  await pilot.approveShadow({ approvalRef: "approval:1" });
  return { pilot, h, nowRef };
}

describe("ControlledSkillProductionPilot", () => {
  it("requires exact tenant/cohort opt-in before any durable state exists", async () => {
    const h = harness();
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
    });
    await expect(
      pilot.start({
        optedIn: false,
        tenantId: "tenant-a",
        cohortId: "cohort-a",
      }),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
    });
    expect(h.ports.readActiveState).not.toHaveBeenCalled();
    expect(h.ports.commitState).not.toHaveBeenCalled();
  });

  it("requires a durable non-automated approval before shadow", async () => {
    const h = harness({
      verifyApproval: vi.fn(
        async ({ descriptor: fixed, descriptorDigest }) => ({
          authenticated: true,
          durable: true,
          automated: true,
          tenantId: fixed.tenantId,
          pilotId: fixed.pilotId,
          packetDigest: fixed.reviewPacketDigest,
          descriptorDigest,
          decision: "approved",
          receiptDigest: D("approval"),
        }),
      ),
    });
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await expect(pilot.approveShadow({})).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.REVIEW_REQUIRED,
    });
    expect(pilot.view().stage).toBe(CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE);
    expect(h.ports.transitionStage).not.toHaveBeenCalled();
  });

  it("enforces the preregistered window and metrics through shadow, canary, and active", async () => {
    const nowRef = { value: 0 };
    const { pilot, h } = await shadowPilot({ nowRef });
    await pilot.recordObservation(observation(1));
    nowRef.value = 50;
    await expect(pilot.advance()).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED,
      failures: expect.arrayContaining(["min_samples", "min_window"]),
    });
    await pilot.recordObservation(observation(2, { observedAt: 50 }));
    nowRef.value = 100;
    expect((await pilot.advance()).stage).toBe(
      CONTROLLED_SKILL_PILOT_STAGE.CANARY,
    );

    await pilot.recordObservation(
      observation(1, {
        receiptDigest: D("canary-observation-1"),
        observedAt: 100,
      }),
    );
    await pilot.recordObservation(
      observation(2, {
        receiptDigest: D("canary-observation-2"),
        observedAt: 100,
      }),
    );
    nowRef.value = 200;
    const active = await pilot.advance();
    expect(active.stage).toBe(CONTROLLED_SKILL_PILOT_STAGE.ACTIVE);
    expect(active.metrics).toMatchObject({
      current: { samples: 0, securityEvents: 0 },
      shadow: { samples: 2, successDelta: 1 },
      canary: { samples: 2, successDelta: 1 },
    });
    expect(
      h.ports.transitionStage.mock.calls.map(([call]) => call.request.to),
    ).toEqual(["shadow", "canary", "active"]);
    expect(
      h.committed.every(
        (entry) => entry.event.stateDigest === entry.stateDigest,
      ),
    ).toBe(true);
  });

  it("deduplicates an identical subject receipt and rejects replacement", async () => {
    const { pilot, h } = await shadowPilot();
    const first = observation(1);
    await pilot.recordObservation(first);
    const commits = h.ports.commitState.mock.calls.length;
    await pilot.recordObservation(first);
    expect(h.ports.commitState).toHaveBeenCalledTimes(commits);
    await expect(
      pilot.recordObservation({ ...first, receiptDigest: D("replacement") }),
    ).rejects.toMatchObject({ code: CONTROLLED_SKILL_PILOT_ERROR.INVALID });
  });

  it("never admits non-opted-in observations or an unbounded cohort", async () => {
    expect(
      () =>
        new ControlledSkillProductionPilot({
          descriptor: descriptor({
            cohort: {
              id: "cohort-a",
              optInRequired: false,
              maxSubjects: 3,
              canaryPercent: 10,
            },
          }),
          ports: harness().ports,
        }),
    ).toThrow("explicit opt-in");
    const { pilot } = await shadowPilot();
    await expect(
      pilot.recordObservation(observation(1, { optedIn: false })),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
    });
    await expect(
      pilot.recordObservation(observation(2, { observedAt: 1 })),
    ).rejects.toMatchObject({ code: CONTROLLED_SKILL_PILOT_ERROR.INVALID });
  });

  it("keeps canary subjects bound to their authenticated shadow assignment", async () => {
    const nowRef = { value: 0 };
    const { pilot } = await shadowPilot({ nowRef });
    await pilot.recordObservation(observation(1));
    await pilot.recordObservation(observation(2));
    nowRef.value = 100;
    await pilot.advance();
    await expect(
      pilot.recordObservation(observation(3, { observedAt: 100 })),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
    });
    await expect(
      pilot.recordObservation(
        observation(1, {
          assignmentReceiptDigest: D("reassigned"),
          receiptDigest: D("canary-reassigned"),
          observedAt: 100,
        }),
      ),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
    });
  });

  it("enforces the preregistered canary traffic ceiling", async () => {
    const nowRef = { value: 0 };
    const limitedDescriptor = descriptor({
      cohort: {
        id: "cohort-a",
        optInRequired: true,
        maxSubjects: 3,
        canaryPercent: 34,
      },
    });
    const h = harness();
    const pilot = new ControlledSkillProductionPilot({
      descriptor: limitedDescriptor,
      ports: h.ports,
      now: () => nowRef.value,
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await pilot.approveShadow({});
    await pilot.recordObservation(observation(1));
    await pilot.recordObservation(observation(2));
    await pilot.recordObservation(observation(3));
    nowRef.value = 100;
    await pilot.advance();
    await pilot.recordObservation(
      observation(1, {
        receiptDigest: D("canary-observation-1"),
        observedAt: 100,
      }),
    );
    await pilot.recordObservation(
      observation(2, {
        receiptDigest: D("canary-observation-2"),
        observedAt: 100,
      }),
    );
    await expect(
      pilot.recordObservation(
        observation(3, {
          receiptDigest: D("canary-observation-3"),
          observedAt: 100,
        }),
      ),
    ).rejects.toMatchObject({ code: CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED });
  });

  it("blocks expansion on security, revision, mis-promotion, rollback, and cost exits", async () => {
    const nowRef = { value: 100 };
    const { pilot } = await shadowPilot({ nowRef });
    await pilot.recordObservation(
      observation(1, {
        observedAt: 100,
        baselineSuccess: true,
        candidateSuccess: false,
        candidateCostUsd: 2,
        userRevised: true,
        misPromotion: true,
        rolledBack: true,
        securityEvents: 1,
      }),
    );
    await pilot.recordObservation(observation(2, { observedAt: 100 }));
    nowRef.value = 200;
    await expect(pilot.advance()).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED,
      failures: expect.arrayContaining([
        "success_delta",
        "cost_delta",
        "user_revision_rate",
        "mis_promotion_rate",
        "rollback_rate",
        "security_events",
      ]),
    });
    expect(pilot.view().stage).toBe(CONTROLLED_SKILL_PILOT_STAGE.SHADOW);
  });

  it("detects out-of-band active mutation before a rollout transition commits", async () => {
    const h = harness();
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    h.setActive({ release: "attacker", revision: 2 });
    await expect(pilot.approveShadow({})).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.ACTIVE_DRIFT,
    });
    expect(h.ports.transitionStage).not.toHaveBeenCalled();
  });

  it("uses the kill switch to issue an authenticated rollback and blocks observations", async () => {
    const { pilot, h } = await shadowPilot();
    const result = await pilot.engageKillSwitch({
      reasonDigest: D("incident"),
    });
    expect(result).toMatchObject({ stage: "rolled-back", killSwitch: true });
    expect(h.ports.transitionStage.mock.calls.at(-1)[0].request).toMatchObject({
      from: "shadow",
      to: "rolled-back",
      evidence: { reasonDigest: D("incident"), emergency: true },
    });
    await expect(pilot.recordObservation(observation(1))).rejects.toMatchObject(
      {
        code: CONTROLLED_SKILL_PILOT_ERROR.INVALID,
      },
    );
  });

  it("does not change local state without exact durable persistence or authority ack", async () => {
    const persistence = harness({
      commitState: vi.fn(async () => ({
        authenticated: false,
        durable: false,
      })),
    });
    const first = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: persistence.ports,
    });
    await expect(
      first.start({
        optedIn: true,
        tenantId: "tenant-a",
        cohortId: "cohort-a",
      }),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
    });
    expect(first.view()).toMatchObject({ revision: 0, stage: "candidate" });

    const authority = harness({
      transitionStage: vi.fn(async () => ({ durable: true })),
    });
    const second = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: authority.ports,
    });
    await second.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await expect(second.approveShadow({})).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.AUTHORITY_FAILED,
    });
    expect(second.view().stage).toBe("candidate");
    expect(second.view().reconciliationRequired).toBe(true);
  });

  it("reconciles the exact prepared transition after a final-state crash", async () => {
    let commits = 0;
    const commitState = vi.fn(async (input) => {
      commits += 1;
      if (commits === 3) return { authenticated: false, durable: false };
      return {
        authenticated: true,
        durable: true,
        descriptorDigest: input.state.descriptorDigest,
        revision: input.state.revision,
        stateDigest: input.stateDigest,
        eventDigest: input.eventDigest,
      };
    });
    const h = harness({ commitState });
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await expect(pilot.approveShadow({})).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
    });
    expect(pilot.view()).toMatchObject({
      stage: "candidate",
      reconciliationRequired: true,
    });
    const firstRequest = h.ports.transitionStage.mock.calls[0][0];
    const recovered = await pilot.reconcilePendingTransition();
    expect(recovered).toMatchObject({
      stage: "shadow",
      reconciliationRequired: false,
    });
    expect(h.ports.transitionStage).toHaveBeenCalledTimes(2);
    expect(h.ports.transitionStage.mock.calls[1][0]).toEqual(firstRequest);
  });

  it("restores only an authenticated descriptor-bound state snapshot", async () => {
    const { pilot, h, nowRef } = await shadowPilot();
    await pilot.recordObservation(observation(1));
    const snapshot = pilot.snapshot();
    const restored = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
      now: () => nowRef.value,
      restore: snapshot,
    });
    expect(restored.view()).toEqual(pilot.view());
    expect(
      () =>
        new ControlledSkillProductionPilot({
          descriptor: descriptor(),
          ports: h.ports,
          restore: { ...snapshot, stateDigest: D("tampered") },
        }),
    ).toThrowError(
      expect.objectContaining({
        code: CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
      }),
    );
  });

  it("uses signed progressive gate receipts for shadow through active probation", async () => {
    const progressive = progressiveHarness();
    const h = harness();
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
      now: () => 1,
      progressiveCanary: {
        plan: progressive.plan,
        gateAuthority: progressive.gate,
      },
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await pilot.approveShadow({});

    for (const [stepId, expectedStage, expectedStepId] of [
      ["shadow", "canary", "canary-10"],
      ["canary-10", "canary", "canary-50"],
      ["canary-50", "active-probation", "probation"],
      ["probation", "active", null],
    ]) {
      const gateReceipt = await progressiveGateReceipt(progressive, stepId);
      const view = await pilot.advance({ gateReceipt });
      expect(view.stage).toBe(expectedStage);
      expect(view.progressiveCanary.stepId).toBe(expectedStepId);
    }

    expect(pilot.view().progressiveCanary.gateReceiptDigests).toHaveLength(4);
    expect(
      h.ports.transitionStage.mock.calls.map(([{ request }]) => [
        request.from,
        request.to,
      ]),
    ).toEqual([
      ["candidate", "shadow"],
      ["shadow", "canary"],
      ["canary", "canary"],
      ["canary", "active-probation"],
      ["active-probation", "active"],
    ]);
  });

  it("rejects unverified reports and legacy observations in progressive mode", async () => {
    const progressive = progressiveHarness();
    const h = harness();
    const pilot = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
      progressiveCanary: {
        plan: progressive.plan,
        gateAuthority: progressive.gate,
      },
    });
    await pilot.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await pilot.approveShadow({});

    await expect(pilot.recordObservation(observation(1))).rejects.toMatchObject(
      {
        code: CONTROLLED_SKILL_PILOT_ERROR.INVALID,
      },
    );
    const receipt = await progressiveGateReceipt(progressive, "shadow");
    await expect(
      pilot.advance({
        gateReceipt: { ...receipt, reportDigest: D("substituted") },
      }),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED,
    });
    expect(pilot.view()).toMatchObject({
      stage: "shadow",
      progressiveCanary: { stepId: "shadow", gateReceiptDigests: [] },
    });
  });

  it("restores progressive state and continues from the exact next step", async () => {
    const progressive = progressiveHarness();
    const h = harness();
    const first = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
      now: () => 1,
      progressiveCanary: {
        plan: progressive.plan,
        gateAuthority: progressive.gate,
      },
    });
    await first.start({
      optedIn: true,
      tenantId: "tenant-a",
      cohortId: "cohort-a",
    });
    await first.approveShadow({});
    await first.advance({
      gateReceipt: await progressiveGateReceipt(progressive, "shadow"),
    });

    const restored = new ControlledSkillProductionPilot({
      descriptor: descriptor(),
      ports: h.ports,
      now: () => 1,
      restore: first.snapshot(),
      progressiveCanary: {
        plan: progressive.plan,
        gateAuthority: progressive.gate,
      },
    });
    expect(restored.view()).toEqual(first.view());
    await restored.advance({
      gateReceipt: await progressiveGateReceipt(progressive, "canary-10"),
    });
    expect(restored.view()).toMatchObject({
      stage: "canary",
      progressiveCanary: {
        stepId: "canary-50",
        gateReceiptDigests: expect.any(Array),
      },
    });
    expect(restored.view().progressiveCanary.gateReceiptDigests).toHaveLength(
      2,
    );

    const incoherent = structuredClone(first.snapshot());
    incoherent.state.progressiveStepId = "probation";
    incoherent.stateDigest = H(incoherent.state);
    expect(
      () =>
        new ControlledSkillProductionPilot({
          descriptor: descriptor(),
          ports: h.ports,
          restore: incoherent,
          progressiveCanary: {
            plan: progressive.plan,
            gateAuthority: progressive.gate,
          },
        }),
    ).toThrowError(
      expect.objectContaining({
        code: CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
      }),
    );
  });
});
