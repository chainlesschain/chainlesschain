import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createEvolutionWikiImpactStage } from "../../src/lib/evolution/evolution-release-train-domain-stages.js";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const plan = Object.freeze({
  tenantId: "tenant-a",
  skillId: "safe-refactor",
  planDigest: digest("plan"),
  candidateId: digest("candidate-id"),
});
const releaseDigest = digest("release");
const transition = Object.freeze({
  tenantId: plan.tenantId,
  skillName: plan.skillId,
  candidateId: plan.candidateId,
  activeReleaseDigest: releaseDigest,
  sequence: 7,
  transitionDigest: digest("release-transition"),
});

function context() {
  return Object.freeze({
    plan,
    stage: "wiki-impact",
    operationKey: digest("operation:wiki-impact"),
    inputDigest: releaseDigest,
  });
}

function outputLedger(initialImpact = null) {
  const values = new Map([
    [
      "promotion",
      {
        outputDigest: releaseDigest,
        value: { release: { releaseDigest } },
      },
    ],
  ]);
  if (initialImpact) values.set("wiki-impact", initialImpact);
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

function reconciler(transitions = [transition], cursor = 7) {
  return {
    source: {
      list: vi.fn(async ({ afterSequence, limit }) =>
        transitions
          .filter((item) => item.sequence > afterSequence)
          .slice(0, limit),
      ),
    },
    reconcile: vi.fn(async () => ({ processed: 1, cursor, results: [] })),
  };
}

const usage = Object.freeze({ tokens: 0, cost: 0, timeMs: 5, turns: 1 });

describe("Evolution release train Wiki impact stage", () => {
  it("requires the promoted release event to reach the durable Wiki checkpoint", async () => {
    const wiki = reconciler();
    const outputs = outputLedger();
    const stage = createEvolutionWikiImpactStage({
      reconciler: wiki,
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      limit: 64,
      usage,
    });

    await expect(stage(context())).resolves.toMatchObject({
      stage: "wiki-impact",
      inputDigest: releaseDigest,
      outputDigest: expect.stringMatching(/^sha256:/u),
      durable: true,
    });
    expect(wiki.reconcile).toHaveBeenCalledTimes(1);
    expect(outputs.commit).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the release transition source is missing", async () => {
    const outputs = outputLedger();
    const stage = createEvolutionWikiImpactStage({
      reconciler: reconciler([]),
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(context())).rejects.toThrow(/absent from the Wiki/u);
    expect(outputs.commit).not.toHaveBeenCalled();
  });

  it("accepts a recovered impact only while the checkpoint remains ahead", async () => {
    const input = context();
    const stored = {
      planDigest: plan.planDigest,
      stage: "wiki-impact",
      operationKey: input.operationKey,
      inputDigest: input.inputDigest,
      outputDigest: digest("wiki-impact-output"),
      valueDigest: digest("stored:wiki-impact"),
      value: {
        releaseDigest,
        transitionDigest: transition.transitionDigest,
        transitionSequence: transition.sequence,
        checkpointCursor: transition.sequence,
      },
    };
    const outputs = outputLedger(stored);
    const stage = createEvolutionWikiImpactStage({
      reconciler: reconciler([transition], transition.sequence + 3),
      outputLedger: outputs,
      effectiveAt: "2026-09-05T00:00:00.000Z",
      usage,
    });

    await expect(stage(input)).resolves.toMatchObject({
      outputDigest: stored.outputDigest,
    });
    expect(outputs.commit).not.toHaveBeenCalled();
  });
});
