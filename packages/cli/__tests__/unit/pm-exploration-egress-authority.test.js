import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createPmExplorationMemoryRetrievalAuthority,
  createPmExplorationModelEgressAuthority,
  inspectPmExplorationEgressAuthority,
  invokePmExplorationModelEgress,
  PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA,
  retrievePmExplorationMemory,
} from "../../src/lib/evolution/pm-exploration-egress-authority.js";

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function context() {
  return {
    planDigest: sha("plan"),
    environmentDigest: sha("environment"),
    executionManifestDigest: sha("manifest"),
    roundId: "round-one",
    stage: "broad",
    branchId: "branch-one",
    taskId: "task-one",
    inputMemoryDigest: sha("memory-one"),
  };
}

function runtime(remainingTokens = 20) {
  return {
    signal: new AbortController().signal,
    remainingTokens,
  };
}

describe("PM exploration egress authorities", () => {
  it("binds retrieval to the round Memory snapshot and freezes bounded requests", async () => {
    const retrieve = vi.fn(async (request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.query)).toBe(true);
      return { items: [{ text: "lesson" }] };
    });
    const authority = createPmExplorationMemoryRetrievalAuthority({
      authorityId: "memory-authority",
      revision: 1,
      handlerArtifactDigest: sha("memory-handler"),
      policyDigest: sha("memory-policy"),
      retrieve,
    });

    expect(inspectPmExplorationEgressAuthority(authority)).toMatchObject({
      schema: PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA,
      kind: "memory-retrieval",
      authorityId: "memory-authority",
      authorityDigest: expect.stringMatching(/^sha256:/u),
    });
    await expect(
      retrievePmExplorationMemory(
        authority,
        context(),
        { memoryDigest: sha("memory-one"), query: { taskId: "task-one" } },
        runtime(),
      ),
    ).resolves.toEqual({ items: [{ text: "lesson" }] });
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryDigest: sha("memory-one"),
        inputMemoryDigest: sha("memory-one"),
        requestDigest: expect.stringMatching(/^sha256:/u),
      }),
      expect.objectContaining({ remainingTokens: 20 }),
    );
  });

  it("rejects retrieval outside the bound snapshot before calling the handler", async () => {
    const retrieve = vi.fn(async () => ({ items: [] }));
    const authority = createPmExplorationMemoryRetrievalAuthority({
      authorityId: "memory-authority",
      revision: 1,
      handlerArtifactDigest: sha("memory-handler"),
      policyDigest: sha("memory-policy"),
      retrieve,
    });

    await expect(
      retrievePmExplorationMemory(
        authority,
        context(),
        { memoryDigest: sha("other-memory"), query: {} },
        runtime(),
      ),
    ).rejects.toThrow("escaped its round snapshot");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("caps model requests by the remaining parent budget and normalizes usage", async () => {
    const invoke = vi.fn(async () => ({
      output: { answer: "ok" },
      usage: { inputTokens: 4, outputTokens: 3 },
    }));
    const authority = createPmExplorationModelEgressAuthority({
      authorityId: "model-authority",
      revision: 2,
      handlerArtifactDigest: sha("model-handler"),
      policyDigest: sha("model-policy"),
      invoke,
    });

    await expect(
      invokePmExplorationModelEgress(
        authority,
        context(),
        {
          purpose: "actor-step",
          input: { prompt: "safe" },
          maxOutputTokens: 5,
        },
        runtime(10),
      ),
    ).resolves.toEqual({
      output: { answer: "ok" },
      usage: { inputTokens: 4, outputTokens: 3 },
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "actor-step",
        maxOutputTokens: 5,
        remainingTokens: 10,
        requestDigest: expect.stringMatching(/^sha256:/u),
      }),
      expect.objectContaining({ remainingTokens: 10 }),
    );
  });

  it("rejects a model request that exceeds the remaining budget before egress", async () => {
    const invoke = vi.fn(async () => ({
      output: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    const authority = createPmExplorationModelEgressAuthority({
      authorityId: "model-authority",
      revision: 1,
      handlerArtifactDigest: sha("model-handler"),
      policyDigest: sha("model-policy"),
      invoke,
    });

    await expect(
      invokePmExplorationModelEgress(
        authority,
        context(),
        { purpose: "actor-step", input: {}, maxOutputTokens: 11 },
        runtime(10),
      ),
    ).rejects.toThrow("exceeds its remaining budget");
    expect(invoke).not.toHaveBeenCalled();
  });
});
