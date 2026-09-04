import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createProgressiveCanaryAssignmentAuthority,
  createProgressiveCanaryGateAuthority,
  createProgressiveCanaryPlan,
  evaluateProgressiveCanaryGate,
  nextProgressiveCanaryStage,
} from "../../src/lib/evolution/statistical-progressive-canary.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function planInput(overrides = {}) {
  return {
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    skillName: "skill-a",
    candidateDigest: D("candidate"),
    baselineDigest: D("baseline"),
    riskTier: "medium",
    assignmentSaltDigest: D("assignment-salt"),
    assignmentAuthority: {
      id: "traffic-authority-a",
      revision: 3,
      handlerDigest: D("traffic-handler"),
    },
    gateAuthority: {
      id: "gate-authority-a",
      revision: 2,
      handlerDigest: D("gate-handler"),
    },
    steps: [
      {
        id: "shadow",
        stage: "shadow",
        trafficPercent: 0,
        minSamples: 4,
        minWindowMs: 100,
        maxWindowMs: 1_000,
      },
      {
        id: "canary-50",
        stage: "canary",
        trafficPercent: 50,
        minSamples: 4,
        minWindowMs: 100,
        maxWindowMs: 1_000,
      },
      {
        id: "probation",
        stage: "active-probation",
        trafficPercent: 100,
        minSamples: 4,
        minWindowMs: 100,
        maxWindowMs: 1_000,
      },
    ],
    thresholds: {
      confidence: 0.95,
      bootstrapSamples: 1_000,
      minQualityDeltaLowerBound: 0.5,
      maxMeanCostDelta: 0,
      maxP95LatencyRatio: 1.2,
      maxP99LatencyRatio: 1.25,
      maxMeanToolCallDelta: 0,
    },
    ...overrides,
  };
}

function authority(plan, { secret = "traffic-authority-test-key" } = {}) {
  const signature = (payload) =>
    createHmac("sha256", secret).update(canonical(payload)).digest("base64url");
  return createProgressiveCanaryAssignmentAuthority({
    plan,
    now: () => 1_000,
    attestor: async (payload) => {
      const issuedAt = new Date(900).toISOString();
      const expiresAt = new Date(2_000).toISOString();
      return {
        issuedAt,
        expiresAt,
        signature: signature({ ...payload, issuedAt, expiresAt }),
      };
    },
    verifier: async ({ payload, signature: value }) =>
      value === signature(payload),
  });
}

function gateAuthority(plan, assignmentAuthority) {
  const secret = "gate-authority-test-key";
  const signature = (payload) =>
    createHmac("sha256", secret).update(canonical(payload)).digest("base64url");
  return createProgressiveCanaryGateAuthority({
    plan,
    assignmentAuthority,
    now: () => 1_000,
    attestor: async (payload) => {
      const issuedAt = new Date(900).toISOString();
      const expiresAt = new Date(2_000).toISOString();
      return {
        issuedAt,
        expiresAt,
        signature: signature({ ...payload, issuedAt, expiresAt }),
      };
    },
    verifier: async ({ payload, signature: value }) =>
      value === signature(payload),
  });
}

async function observations({ assignmentAuthority, stepId, count = 4 }) {
  const result = [];
  for (let index = 0; result.length < count && index < 1_000; index += 1) {
    const subjectDigest = D(`subject-${index}`);
    const assignmentReceipt = await assignmentAuthority.assign({
      stepId,
      subjectDigest,
    });
    if (!assignmentReceipt.assigned) continue;
    result.push({
      subjectDigest,
      assignmentReceipt,
      outcomeReceiptDigest: D(`${stepId}-outcome-${index}`),
      observedAt: 100,
      baselineSuccess: false,
      candidateSuccess: true,
      baselineCost: 1,
      candidateCost: 0.8,
      baselineLatencyMs: 100,
      candidateLatencyMs: 80,
      baselineToolCalls: 2,
      candidateToolCalls: 2,
      securityEvents: 0,
      permissionEvents: 0,
    });
  }
  if (result.length !== count) throw new Error("fixture could not fill cohort");
  return result;
}

describe("statistical progressive Canary", () => {
  it("binds a risk-specific, monotonic shadow→Canary→probation plan", () => {
    const plan = createProgressiveCanaryPlan(planInput());
    expect(plan.steps.map(({ stage }) => stage)).toEqual([
      "shadow",
      "canary",
      "active-probation",
    ]);
    expect(plan.planDigest).toMatch(/^sha256:/u);

    expect(() =>
      createProgressiveCanaryPlan(
        planInput({
          steps: [
            planInput().steps[0],
            { ...planInput().steps[1], trafficPercent: 100 },
            planInput().steps[2],
          ],
        }),
      ),
    ).toThrow("increase monotonically");
    expect(() =>
      createProgressiveCanaryPlan(
        planInput({
          steps: [
            planInput().steps[0],
            { ...planInput().steps[1], trafficPercent: 0 },
            planInput().steps[2],
          ],
        }),
      ),
    ).toThrow("increase monotonically");
  });

  it("assigns subjects by a stable server-owned bucket and verifies the signature", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    const subjectDigest = D("stable-subject");
    const first = await traffic.assign({
      stepId: "canary-50",
      subjectDigest,
    });
    const second = await traffic.assign({
      stepId: "canary-50",
      subjectDigest,
    });
    expect(second).toEqual(first);
    await expect(
      traffic.verify(first, { stepId: "canary-50", subjectDigest }),
    ).resolves.toEqual(first);
    await expect(
      traffic.verify(
        { ...first, subjectDigest: D("client-substitution") },
        { stepId: "canary-50", subjectDigest: D("client-substitution") },
      ),
    ).rejects.toThrow();
    await expect(
      traffic.verify(
        { ...first, clientClaim: "allow" },
        { stepId: "canary-50", subjectDigest },
      ),
    ).rejects.toThrow("unexpected or missing fields");
  });

  it("uses a fixed 1000-sample paired bootstrap and non-inferiority gates", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    const rows = await observations({
      assignmentAuthority: traffic,
      stepId: "probation",
    });
    const report = await evaluateProgressiveCanaryGate({
      plan,
      stepId: "probation",
      stepStartedAt: 0,
      observedAt: 100,
      observations: rows,
      assignmentAuthority: traffic,
    });

    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.metrics).toMatchObject({
      samples: 4,
      qualityDelta: 1,
      qualityDeltaConfidenceInterval: [1, 1],
      meanCostDelta: -0.19999999999999996,
      p95LatencyRatio: 0.8,
      p99LatencyRatio: 0.8,
      meanToolCallDelta: 0,
      securityEvents: 0,
      permissionEvents: 0,
    });
    expect(report.reportDigest).toMatch(/^sha256:/u);
  });

  it("stops expansion on any security or permission event", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    const rows = await observations({
      assignmentAuthority: traffic,
      stepId: "probation",
    });
    rows[0] = { ...rows[0], securityEvents: 1, permissionEvents: 1 };
    const report = await evaluateProgressiveCanaryGate({
      plan,
      stepId: "probation",
      stepStartedAt: 0,
      observedAt: 100,
      observations: rows,
      assignmentAuthority: traffic,
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining(["security_events", "permission_events"]),
    );
  });

  it("rejects client-selected subjects that the signed bucket did not assign", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    let unassigned = null;
    for (let index = 0; index < 1_000 && !unassigned; index += 1) {
      const subjectDigest = D(`unassigned-${index}`);
      const assignmentReceipt = await traffic.assign({
        stepId: "canary-50",
        subjectDigest,
      });
      if (!assignmentReceipt.assigned) {
        unassigned = {
          ...(
            await observations({
              assignmentAuthority: traffic,
              stepId: "canary-50",
              count: 1,
            })
          )[0],
          subjectDigest,
          assignmentReceipt,
        };
      }
    }
    expect(unassigned).not.toBeNull();
    await expect(
      evaluateProgressiveCanaryGate({
        plan,
        stepId: "canary-50",
        stepStartedAt: 0,
        observedAt: 100,
        observations: [unassigned],
        assignmentAuthority: traffic,
      }),
    ).rejects.toThrow("non-assigned traffic");
  });

  it("reaches stable only after the active-probation report passes", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    const rows = await observations({
      assignmentAuthority: traffic,
      stepId: "probation",
    });
    const report = await evaluateProgressiveCanaryGate({
      plan,
      stepId: "probation",
      stepStartedAt: 0,
      observedAt: 100,
      observations: rows,
      assignmentAuthority: traffic,
    });
    expect(
      nextProgressiveCanaryStage({
        plan,
        currentStepId: "probation",
        gateReport: report,
      }),
    ).toEqual({
      stage: "stable",
      stepId: null,
      priorReportDigest: report.reportDigest,
    });

    const failed = { ...report, passed: false, failures: ["security_events"] };
    expect(() =>
      nextProgressiveCanaryStage({
        plan,
        currentStepId: "probation",
        gateReport: failed,
      }),
    ).toThrow("digest mismatch");
  });

  it("attests a full gate report for durable Pilot consumption", async () => {
    const plan = createProgressiveCanaryPlan(planInput());
    const traffic = authority(plan);
    const gate = gateAuthority(plan, traffic);
    const receipt = await gate.evaluate({
      stepId: "probation",
      stepStartedAt: 0,
      observedAt: 100,
      observations: await observations({
        assignmentAuthority: traffic,
        stepId: "probation",
      }),
    });

    await expect(
      gate.verify(receipt, { stepId: "probation" }),
    ).resolves.toEqual(receipt);
    await expect(
      gate.verify(
        { ...receipt, reportDigest: D("substituted-report") },
        { stepId: "probation" },
      ),
    ).rejects.toThrow("binding");
  });

  it("rejects an assignment authority branded for another plan", () => {
    const first = createProgressiveCanaryPlan(planInput());
    const second = createProgressiveCanaryPlan(
      planInput({ candidateDigest: D("another-candidate") }),
    );
    expect(() =>
      createProgressiveCanaryGateAuthority({
        plan: second,
        assignmentAuthority: authority(first),
        attestor: async () => ({}),
        verifier: async () => true,
      }),
    ).toThrow("belongs to another plan");
  });
});
