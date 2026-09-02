import { describe, expect, it, vi } from "vitest";
import {
  BoundedSkillImprovementPilot,
  EVOLUTION_FAILURE_CATEGORY,
} from "../../src/lib/evolution/bounded-skill-improvement-pilot.js";

const descriptor = (overrides = {}) => ({
  tenantId: "tenant-a",
  evolutionRunId: "run-1",
  skillName: "focused-skill",
  baselineCandidateId: "candidate:baseline",
  baselineDigest: "sha256:baseline",
  baselineScore: 0.5,
  trainSplitDigest: "sha256:train",
  validationSplitDigest: "sha256:validation",
  deterministicGraderDigest: "sha256:grader",
  evaluatorDigest: "sha256:evaluator",
  runtimeFingerprintDigest: "sha256:runtime",
  gate: {
    minDeterministicScore: 0.8,
    minEvaluatorScore: 0.8,
    minImprovement: 0.1,
  },
  budget: { maxOuterTurns: 2, maxTokens: 100, maxCostUsd: 2 },
  ...overrides,
});

function ports(overrides = {}) {
  const receiptStore = new Map();
  const base = {
    propose: vi.fn(async ({ round }) => ({
      candidate: { content: `candidate-${round}` },
      usage: { tokens: 10, costUsd: 0.1, turns: 1, timeMs: 5 },
    })),
    persistCandidate: vi.fn(async ({ round }) => ({
      candidateId: `candidate:${round}`,
      contentDigest: `sha256:content-${round}`,
    })),
    gradeDeterministic: vi.fn(async () => ({
      score: 0.9,
      evidenceTrusted: true,
      authorityDigest: "sha256:grader",
      receiptDigest: "sha256:deterministic",
      usage: { tokens: 0, costUsd: 0, turns: 0, timeMs: 3 },
    })),
    evaluateIsolated: vi.fn(async () => ({
      score: 0.85,
      evidenceTrusted: true,
      authorityDigest: "sha256:evaluator",
      receiptDigest: "sha256:evaluator-receipt",
      usage: { tokens: 20, costUsd: 0.2, turns: 1, timeMs: 7 },
    })),
    appendReceipt: vi.fn(async ({ receiptDigest, idempotencyKey }) => {
      receiptStore.set(idempotencyKey, receiptDigest);
      return { durable: true, receiptDigest };
    }),
    readActiveState: vi.fn(async () => ({
      candidateId: "active:original",
      revision: 7,
    })),
  };
  return { ...base, ...overrides };
}

describe("BoundedSkillImprovementPilot", () => {
  it("runs one candidate, independent graders, preserves active, and keeps passing best", async () => {
    const p = ports();
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: p,
    }).run();

    expect(result.status).toBe("completed");
    expect(result.bestCandidateId).toBe("candidate:1");
    expect(result.bestScore).toBe(0.85);
    expect(result.usage).toMatchObject({ tokens: 30, turns: 2, timeMs: 15 });
    expect(result.usage.costUsd).toBeCloseTo(0.3);
    expect(p.propose).toHaveBeenCalledTimes(1);
    expect(p.gradeDeterministic.mock.invocationCallOrder[0]).toBeLessThan(
      p.evaluateIsolated.mock.invocationCallOrder[0],
    );
    expect(p.readActiveState).toHaveBeenCalledTimes(3);
  });

  it("rejects multiple candidates before persistence", async () => {
    const p = ports({
      propose: vi.fn(async () => ({ candidate: {}, candidates: [{}, {}] })),
    });
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: p,
    }).run();
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toMatchObject({
      category: EVOLUTION_FAILURE_CATEGORY.PROCEDURE,
      skillNegative: true,
    });
    expect(p.persistCandidate).not.toHaveBeenCalled();
  });

  it("keeps baseline and exhausts the root turn budget when the gate stays unmet", async () => {
    const p = ports({
      evaluateIsolated: vi.fn(async () => ({
        score: 0.6,
        evidenceTrusted: true,
        authorityDigest: "sha256:evaluator",
        receiptDigest: "sha256:low",
      })),
    });
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: p,
    }).run();
    expect(result.status).toBe("exhausted");
    expect(result.round).toBe(2);
    expect(result.bestCandidateId).toBe("candidate:baseline");
    expect(p.propose).toHaveBeenCalledTimes(2);
  });

  it("stops before accepting when aggregated child usage exhausts a root budget", async () => {
    const p = ports();
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor({
        budget: { maxOuterTurns: 5, maxTokens: 30, maxRootTurns: 2 },
      }),
      ports: p,
    }).run();
    expect(result.status).toBe("exhausted");
    expect(result.failures[0]).toMatchObject({
      code: "BUDGET_EXHAUSTED",
      limit: "max_tokens",
      skillNegative: false,
    });
    expect(result.bestCandidateId).toBe("candidate:baseline");
  });

  it.each([
    ["PROVIDER_TRANSIENT", EVOLUTION_FAILURE_CATEGORY.INFRASTRUCTURE],
    ["MCP_DISCOVERY_TIMEOUT", EVOLUTION_FAILURE_CATEGORY.INFRASTRUCTURE],
    ["PERMISSION_DENIED", EVOLUTION_FAILURE_CATEGORY.PERMISSION_POLICY],
    ["EVALUATOR_CRASH", EVOLUTION_FAILURE_CATEGORY.INFRASTRUCTURE],
  ])("classifies %s without compiling it into a Skill negative", async (code, category) => {
    const error = Object.assign(new Error(code), { code });
    const p = ports({ evaluateIsolated: vi.fn(async () => { throw error; }) });
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: p,
    }).run();
    expect(result.failures[0]).toMatchObject({ category, code, skillNegative: false });
    expect(result.bestCandidateId).toBe("candidate:baseline");
  });

  it("fails closed on unknown grader evidence and on receipt acknowledgement failure", async () => {
    const unknown = ports({
      gradeDeterministic: vi.fn(async () => ({ score: 1, evidenceTrusted: false })),
    });
    const first = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: unknown,
    }).run();
    expect(first.failures[0].category).toBe(EVOLUTION_FAILURE_CATEGORY.SECURITY);
    expect(unknown.evaluateIsolated).not.toHaveBeenCalled();

    const unacked = ports({ appendReceipt: vi.fn(async () => ({ durable: false })) });
    const second = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: unacked,
    }).run();
    expect(second.status).toBe("evidence-failed");
    expect(second.bestCandidateId).toBe("candidate:baseline");
  });

  it("snapshots, resumes at the next round, and preserves deterministic round keys", async () => {
    const lowEvaluator = vi.fn(async () => ({
      score: 0.6,
      evidenceTrusted: true,
      authorityDigest: "sha256:evaluator",
      receiptDigest: "sha256:low",
    }));
    const firstPorts = ports({ evaluateIsolated: lowEvaluator });
    const first = new BoundedSkillImprovementPilot({
      descriptor: descriptor({ budget: { maxOuterTurns: 3 } }),
      ports: firstPorts,
    });
    await first.start();
    await first.runRound();
    const snap = first.snapshot();

    const resumedPorts = ports();
    const resumed = new BoundedSkillImprovementPilot({
      descriptor: descriptor({ budget: { maxOuterTurns: 3 } }),
      ports: resumedPorts,
      snapshot: snap,
    });
    const result = await resumed.run();
    expect(result.status).toBe("completed");
    expect(result.round).toBe(2);
    expect(resumedPorts.propose.mock.calls[0][0].round).toBe(2);

    const replayPorts = ports({ evaluateIsolated: lowEvaluator });
    const replay = new BoundedSkillImprovementPilot({
      descriptor: descriptor({ budget: { maxOuterTurns: 3 } }),
      ports: replayPorts,
    });
    await replay.start();
    await replay.runRound();
    expect(replayPorts.propose.mock.calls[0][0].roundKey).toBe(
      firstPorts.propose.mock.calls[0][0].roundKey,
    );
    expect(replay.snapshot()).toEqual(snap);
  });

  it("detects any active-state mutation as a security failure", async () => {
    let calls = 0;
    const p = ports({
      readActiveState: vi.fn(async () =>
        ++calls === 1 ? { revision: 1 } : { revision: 2 },
      ),
    });
    const result = await new BoundedSkillImprovementPilot({
      descriptor: descriptor(),
      ports: p,
    }).run();
    expect(result.status).toBe("security-failed");
    expect(result.failures.at(-1)).toMatchObject({
      code: "ACTIVE_STATE_CHANGED",
      category: EVOLUTION_FAILURE_CATEGORY.SECURITY,
    });
  });
});
