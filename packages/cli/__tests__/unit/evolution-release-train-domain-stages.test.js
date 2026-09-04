import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createEvolutionCandidateStage,
  createEvolutionProposalStage,
  createEvolutionWikiMaintainStage,
} from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const usage = Object.freeze({ tokens: 1, cost: 0, timeMs: 1, turns: 1 });

function context(stage, inputDigest, overrides = {}) {
  return Object.freeze({
    plan: Object.freeze({
      planDigest: digest("plan"),
      wikiRevisionDigest: digest("wiki"),
      candidateId: digest("candidate-id"),
      candidateDigest: digest("candidate"),
      ...overrides,
    }),
    stage,
    operationKey: digest(`operation:${stage}`),
    inputDigest,
  });
}

describe("Evolution release train domain stages", () => {
  it("binds the real Wiki maintainer output to the pre-authorized plan", async () => {
    const maintainer = {
      maintain: vi.fn(async () => ({ stateDigest: digest("wiki") })),
    };
    const stage = createEvolutionWikiMaintainStage({
      maintainer,
      request: {
        evidenceRefs: ["evidence:1"],
        effectiveAt: "2026-09-05T00:00:00.000Z",
      },
      usage,
    });
    const input = context("wiki-maintain", digest("plan"));

    await expect(stage(input)).resolves.toMatchObject({
      stage: "wiki-maintain",
      inputDigest: input.inputDigest,
      outputDigest: digest("wiki"),
      durable: true,
    });
    expect(maintainer.maintain).toHaveBeenCalledTimes(1);
  });

  it("persists a proposal before issuing its stage receipt", async () => {
    const proposalDigest = digest("proposal");
    const drafted = { status: "proposal", proposalDigest, proposal: {} };
    let stored = null;
    const proposer = { draft: vi.fn(async () => drafted) };
    const proposalLedger = {
      load: vi.fn(() => stored),
      commit: vi.fn((request) => {
        stored = {
          ...request,
          outputDigest: request.drafted.proposalDigest,
        };
        return { committed: true };
      }),
    };
    const stage = createEvolutionProposalStage({
      proposer,
      proposalLedger,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });
    const input = context("propose", digest("wiki"));

    await expect(stage(input)).resolves.toMatchObject({
      stage: "propose",
      outputDigest: proposalDigest,
      durable: true,
    });
    expect(proposalLedger.commit).toHaveBeenCalledTimes(1);
  });

  it("reuses a recovered proposal without regenerating it", async () => {
    const input = context("propose", digest("wiki"));
    const stored = {
      planDigest: input.plan.planDigest,
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: digest("proposal"),
      drafted: { status: "proposal" },
    };
    const proposer = { draft: vi.fn() };
    const proposalLedger = {
      load: vi.fn(() => stored),
      commit: vi.fn(),
    };
    const stage = createEvolutionProposalStage({
      proposer,
      proposalLedger,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(input)).resolves.toMatchObject({
      outputDigest: stored.outputDigest,
    });
    expect(proposer.draft).not.toHaveBeenCalled();
    expect(proposalLedger.commit).not.toHaveBeenCalled();
  });

  it("creates Candidate only from the exact persisted proposal input", async () => {
    const proposalDigest = digest("proposal");
    const created = {
      status: "proposal",
      candidateId: digest("candidate-id"),
      contentDigest: digest("candidate"),
    };
    const proposer = {
      createCandidateFromDraft: vi.fn(async () => created),
    };
    const proposalLedger = {
      load: vi.fn(() => ({
        outputDigest: proposalDigest,
        drafted: { status: "proposal", proposalDigest },
      })),
    };
    const stage = createEvolutionCandidateStage({
      proposer,
      proposalLedger,
      usage,
    });

    await expect(
      stage(context("candidate", proposalDigest)),
    ).resolves.toMatchObject({
      stage: "candidate",
      outputDigest: digest("candidate"),
      durable: true,
    });
    expect(proposer.createCandidateFromDraft).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Candidate bytes differ from the plan digest", async () => {
    const proposalDigest = digest("proposal");
    const proposer = {
      createCandidateFromDraft: vi.fn(async () => ({
        contentDigest: digest("substituted-candidate"),
      })),
    };
    const proposalLedger = {
      load: () => ({ outputDigest: proposalDigest, drafted: {} }),
    };
    const stage = createEvolutionCandidateStage({
      proposer,
      proposalLedger,
      usage,
    });

    await expect(stage(context("candidate", proposalDigest))).rejects.toThrow(
      /does not match the EvolutionPlan candidate digest/u,
    );
  });
});
