import { createHash, createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProgressiveCanaryObservationStore,
  createProgressiveCanaryPairedOutcomeAuthority,
  createProgressiveCanaryTrafficManifest,
  ProgressiveCanaryTrafficWorker,
} from "../../src/lib/evolution/progressive-canary-traffic-worker.js";
import {
  createProgressiveCanaryAssignmentAuthority,
  createProgressiveCanaryGateAuthority,
  createProgressiveCanaryPlan,
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

function planFixture() {
  return createProgressiveCanaryPlan({
    tenantId: "tenant-a",
    pilotId: "pilot-a",
    skillName: "skill-a",
    candidateDigest: D("candidate"),
    baselineDigest: D("baseline"),
    riskTier: "medium",
    assignmentSaltDigest: D("salt"),
    assignmentAuthority: {
      id: "assignment-a",
      revision: 1,
      handlerDigest: D("assignment-handler"),
    },
    gateAuthority: {
      id: "gate-a",
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
        maxWindowMs: 10_000,
      },
      {
        id: "canary-50",
        stage: "canary",
        trafficPercent: 50,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 10_000,
      },
      {
        id: "probation",
        stage: "active-probation",
        trafficPercent: 100,
        minSamples: 1,
        minWindowMs: 1,
        maxWindowMs: 10_000,
      },
    ],
    thresholds: {
      confidence: 0.95,
      bootstrapSamples: 1_000,
      minQualityDeltaLowerBound: 0,
      maxMeanCostDelta: 0,
      maxP95LatencyRatio: 1.2,
      maxP99LatencyRatio: 1.25,
      maxMeanToolCallDelta: 0,
    },
  });
}

function assignmentAuthority(plan) {
  const sign = (payload) =>
    createHmac("sha256", "assignment-secret")
      .update(canonical(payload))
      .digest("base64url");
  return createProgressiveCanaryAssignmentAuthority({
    plan,
    now: () => 1_000,
    attestor: async (payload) => {
      const issuedAt = new Date(900).toISOString();
      const expiresAt = new Date(2_000).toISOString();
      return {
        issuedAt,
        expiresAt,
        signature: sign({ ...payload, issuedAt, expiresAt }),
      };
    },
    verifier: async ({ payload, signature }) => signature === sign(payload),
  });
}

function trafficManifest(plan) {
  return createProgressiveCanaryTrafficManifest({
    planDigest: plan.planDigest,
    baselineRunner: {
      id: "baseline-runner",
      revision: 1,
      handlerDigest: D("baseline-handler"),
    },
    candidateRunner: {
      id: "candidate-runner",
      revision: 2,
      handlerDigest: D("candidate-handler"),
    },
    outcomeAuthority: {
      id: "outcome-authority",
      revision: 3,
      handlerDigest: D("outcome-handler"),
    },
  });
}

function arm(manifest, name, execution, overrides = {}) {
  const runner = manifest[`${name}Runner`];
  return {
    authenticated: true,
    durable: true,
    runnerId: runner.id,
    runnerRevision: runner.revision,
    handlerDigest: runner.handlerDigest,
    success: true,
    cost: name === "baseline" ? 2 : 1,
    latencyMs: name === "baseline" ? 100 : 80,
    toolCalls: 2,
    securityEvents: 0,
    permissionEvents: 0,
    resultDigest: D(`${name}:${execution.requestDigest}`),
    ...overrides,
  };
}

function outcomes(manifest, counters, overrides = {}) {
  const sign = (payload) =>
    createHmac("sha256", "outcome-secret")
      .update(canonical(payload))
      .digest("base64url");
  return createProgressiveCanaryPairedOutcomeAuthority({
    manifest,
    now: () => 1_000,
    executeBaseline: async (execution) => {
      counters.baseline += 1;
      return arm(manifest, "baseline", execution, overrides.baseline);
    },
    executeCandidate: async (execution) => {
      counters.candidate += 1;
      return arm(manifest, "candidate", execution, overrides.candidate);
    },
    verifyBaseline: async ({ execution, receipt }) =>
      receipt.resultDigest === D(`baseline:${execution.requestDigest}`),
    verifyCandidate: async ({ execution, receipt }) =>
      receipt.resultDigest === D(`candidate:${execution.requestDigest}`),
    attestor: async (payload) => sign(payload),
    verifier: async ({ payload, signature }) => signature === sign(payload),
  });
}

async function fileStore() {
  const root = await mkdtemp(join(tmpdir(), "cc-canary-observations-"));
  await mkdir(root, { recursive: true });
  const pathFor = ({ planDigest, stepId, subjectDigest }) =>
    join(
      root,
      `${D(`${planDigest}:${stepId}:${subjectDigest}`).slice(7)}.json`,
    );
  return createProgressiveCanaryObservationStore({
    async reserve(binding) {
      try {
        await writeFile(
          `${pathFor(binding)}.claim`,
          JSON.stringify({ operationDigest: binding.operationDigest }),
          { encoding: "utf8", flag: "wx" },
        );
        return {
          authenticated: true,
          durable: true,
          acquired: true,
          operationDigest: binding.operationDigest,
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const claim = JSON.parse(
          await readFile(`${pathFor(binding)}.claim`, "utf8"),
        );
        return {
          authenticated: true,
          durable: true,
          acquired: false,
          operationDigest: claim.operationDigest,
        };
      }
    },
    async commit(observation) {
      await writeFile(pathFor(observation), JSON.stringify(observation), {
        encoding: "utf8",
        flag: "wx",
      });
      return {
        authenticated: true,
        durable: true,
        operationDigest: observation.operationDigest,
        observationDigest: observation.observationDigest,
      };
    },
    async load(binding) {
      try {
        return JSON.parse(await readFile(pathFor(binding), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async list({ planDigest, stepId }) {
      const values = [];
      for (const file of (await readdir(root)).filter((name) =>
        name.endsWith(".json"),
      )) {
        const value = JSON.parse(await readFile(join(root, file), "utf8"));
        if (value.planDigest === planDigest && value.stepId === stepId)
          values.push(value);
      }
      return values;
    },
  });
}

async function fixture(overrides = {}) {
  const plan = planFixture();
  const assignment = assignmentAuthority(plan);
  const manifest = trafficManifest(plan);
  const counters = { baseline: 0, candidate: 0 };
  const outcomeAuthority = outcomes(manifest, counters, overrides);
  const observationStore = await fileStore();
  const worker = new ProgressiveCanaryTrafficWorker({
    plan,
    manifest,
    assignmentAuthority: assignment,
    outcomeAuthority,
    observationStore,
    now: () => 1_000,
  });
  return {
    plan,
    assignment,
    manifest,
    counters,
    outcomeAuthority,
    observationStore,
    worker,
  };
}

describe("progressive Canary traffic worker", () => {
  it("server-assigns and durably records one authenticated paired execution", async () => {
    const { worker, counters } = await fixture();
    const subjectDigest = D("subject-a");
    const first = await worker.process({
      stepId: "shadow",
      subjectDigest,
      request: { prompt: "same input" },
    });
    expect(first.assigned).toBe(true);
    expect(first.observation.outcomeReceipt.baseline.resultDigest).toBe(
      D(`baseline:${first.observation.requestDigest}`),
    );
    expect(first.observation.outcomeReceipt.candidate.resultDigest).toBe(
      D(`candidate:${first.observation.requestDigest}`),
    );

    const second = await worker.process({
      stepId: "shadow",
      subjectDigest,
      request: { prompt: "same input" },
    });
    expect(second.recovered).toBe(true);
    expect(second.observation.observationDigest).toBe(
      first.observation.observationDigest,
    );
    expect(counters).toEqual({ baseline: 1, candidate: 1 });
    await expect(
      worker.process({
        stepId: "shadow",
        subjectDigest,
        request: { prompt: "replacement" },
      }),
    ).rejects.toThrow("cannot replace");
  });

  it("does not execute either arm when stable server assignment excludes traffic", async () => {
    const { worker, assignment, counters } = await fixture();
    let subjectDigest;
    for (let index = 0; index < 1_000; index += 1) {
      const candidate = D(`excluded-${index}`);
      if (
        !(
          await assignment.assign({
            stepId: "canary-50",
            subjectDigest: candidate,
          })
        ).assigned
      ) {
        subjectDigest = candidate;
        break;
      }
    }
    expect(subjectDigest).toBeDefined();
    const result = await worker.process({
      stepId: "canary-50",
      subjectDigest,
      request: { prompt: "must not run" },
    });
    expect(result.assigned).toBe(false);
    expect(result.observation).toBeNull();
    expect(counters).toEqual({ baseline: 0, candidate: 0 });
  });

  it("allows only one worker to execute a concurrently reserved request", async () => {
    const {
      plan,
      assignment,
      manifest,
      counters,
      outcomeAuthority,
      observationStore,
    } = await fixture();
    const secondWorker = new ProgressiveCanaryTrafficWorker({
      plan,
      manifest,
      assignmentAuthority: assignment,
      outcomeAuthority,
      observationStore,
      now: () => 1_000,
    });
    const input = {
      stepId: "shadow",
      subjectDigest: D("concurrent-subject"),
      request: { prompt: "one execution" },
    };
    const settled = await Promise.allSettled([
      secondWorker.process(input),
      secondWorker.process(input),
    ]);
    expect(settled.some(({ status }) => status === "fulfilled")).toBe(true);
    expect(counters).toEqual({ baseline: 1, candidate: 1 });
  });

  it("feeds durable paired observations directly into the independent gate", async () => {
    const { plan, assignment, worker } = await fixture({
      candidate: { securityEvents: 1 },
    });
    await worker.process({
      stepId: "shadow",
      subjectDigest: D("security-subject"),
      request: { prompt: "security event" },
    });
    const observations = await worker.observations({ stepId: "shadow" });
    const sign = (payload) =>
      createHmac("sha256", "gate-secret")
        .update(canonical(payload))
        .digest("base64url");
    const gate = createProgressiveCanaryGateAuthority({
      plan,
      assignmentAuthority: assignment,
      now: () => 1_001,
      attestor: async (payload) => {
        const issuedAt = new Date(1_001).toISOString();
        const expiresAt = new Date(2_000).toISOString();
        return {
          issuedAt,
          expiresAt,
          signature: sign({ ...payload, issuedAt, expiresAt }),
        };
      },
      verifier: async ({ payload, signature }) => signature === sign(payload),
    });
    const receipt = await gate.evaluate({
      stepId: "shadow",
      stepStartedAt: 999,
      observedAt: 1_001,
      observations,
    });
    expect(receipt.report.passed).toBe(false);
    expect(receipt.report.failures).toContain("security_events");
  });

  it("rejects runner receipt replay against a different request", async () => {
    const { worker } = await fixture({
      baseline: { resultDigest: D("replayed") },
    });
    await expect(
      worker.process({
        stepId: "shadow",
        subjectDigest: D("replay-subject"),
        request: { prompt: "bound request" },
      }),
    ).rejects.toThrow("runner receipt was rejected");
  });
});
