import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import { createSkillDecisionRuntime } from "../../src/lib/decision-layer/runtime.js";
import { openSkillRetrievalRevocationAuthority } from "../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function skill(id, description) {
  return {
    id,
    dirName: id,
    displayName: id,
    description,
    category: "development",
    source: "workspace",
    version: "1.0.0",
    tags: ["code"],
    os: [],
    capabilities: ["workspace.read"],
    hasHandler: true,
    executionIdentity: { contentDigest: D(id) },
  };
}

function loader(
  skills = [
    skill("repair-tests", "repair failing vitest unit tests"),
    skill("write-docs", "write product documentation"),
  ],
) {
  return {
    getResolvedSkills: () => skills,
    recordDescriptorUse: vi.fn(),
  };
}

function decisionRuntime(mode, observe, onDecide = null) {
  const provider = openDecisionProviderAuthority({
    provider: "typesafe",
    model: "jev-test",
    decide: async (request) => {
      if (onDecide) await onDecide(request);
      const candidateIds = request.candidates.map(
        ({ candidateId }) => candidateId,
      );
      const probabilities = Object.fromEntries(
        candidateIds.map((candidateId, index) => [
          candidateId,
          index === 0 ? 0.96 : 0,
        ]),
      );
      probabilities.none = 0.04;
      return {
        provider: "typesafe",
        model: "jev-test",
        answers: {
          needs_skill: { type: "noul", noul: 0.97 },
          best_skill: {
            type: "choice",
            choice: "c1",
            confidence: 0.92,
            probabilities,
          },
          ...Object.fromEntries(
            candidateIds.map((candidateId, index) => [
              `fits_${candidateId}`,
              { type: "noul", noul: index === 0 ? 0.96 : 0.05 },
            ]),
          ),
        },
        usage: { input_tokens: 40, output_tokens: 8 },
      };
    },
  });
  return createSkillDecisionRuntime({
    mode,
    tenantId: "tenant-a",
    sessionId: "session-a",
    provider,
    persist: async () => {},
    observe,
    idGenerator: () => `${mode}-1`,
  });
}

describe("CLI list_skills decision suggestion", () => {
  it("exposes a typed suggestion without replacing the existing retrieval result", async () => {
    const observe = vi.fn(async () => {});
    const result = await executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        toolCallId: "tool-a",
        skillLoader: loader(),
        skillDecisionRuntime: decisionRuntime("suggest", observe),
      },
    );

    expect(result.routing.selectedDigest).toBe(D("repair-tests"));
    expect(result.routing.decisionSuggestion).toMatchObject({
      status: "suggestion",
      selectedSkillId: "repair-tests",
      selectedDigest: D("repair-tests"),
    });
    expect(result.skills[0].id).toBe("repair-tests");
    expect(observe).toHaveBeenCalledOnce();
  });

  it("records shadow decisions without changing the Agent-visible payload", async () => {
    const observe = vi.fn(async () => {});
    const result = await executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        toolCallId: "tool-a",
        skillLoader: loader(),
        skillDecisionRuntime: decisionRuntime("shadow", observe),
      },
    );

    expect(result.routing).not.toHaveProperty("decisionSuggestion");
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "shadow",
        status: "suggestion",
        selectedDigest: D("repair-tests"),
      }),
    );
  });

  it("drops advice when a nonselected decision candidate changes during provider work", async () => {
    const descriptors = [
      skill("repair-tests", "repair failing vitest unit tests"),
      skill("backup-tests", "repair vitest backup tests"),
    ];
    let release;
    let entered;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const resultPromise = executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        skillLoader: loader(descriptors),
        skillDecisionRuntime: decisionRuntime(
          "suggest",
          vi.fn(async () => {}),
          async () => {
            entered();
            await waiting;
          },
        ),
      },
    );
    await started;
    descriptors[1].description = "repair vitest backup tests, revised";
    release();
    const result = await resultPromise;
    expect(result.routing).not.toHaveProperty("decisionSuggestion");
    expect(result.skills).toHaveLength(2);
  });

  it("removes a candidate revoked while its advice is pending", async () => {
    let stored = null;
    const revocations = await openSkillRetrievalRevocationAuthority({
      tenantId: "tenant-a",
      ports: {
        async load() {
          return {
            authenticated: true,
            durable: true,
            found: stored !== null,
            state: stored,
            receiptDigest: D(stored?.stateDigest ?? "empty"),
          };
        },
        async commit({ state }) {
          stored = structuredClone(state);
          return {
            authenticated: true,
            durable: true,
            committed: true,
            stateDigest: state.stateDigest,
            receiptDigest: D("commit"),
          };
        },
      },
    });
    let release;
    let entered;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const resultPromise = executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        skillLoader: loader(),
        skillRetrievalRevocationReader: revocations,
        skillDecisionRuntime: decisionRuntime(
          "suggest",
          vi.fn(async () => {}),
          async () => {
            entered();
            await waiting;
          },
        ),
      },
    );
    await started;
    const requestCore = {
      schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
      tenantId: "tenant-a",
      streamId: "pilot-stream",
      operationId: "skill-revocation:repair-tests",
      transitionDigest: D("transition"),
      candidateId: D("candidate"),
      skillName: "repair-tests",
      occurredAt: "2026-10-16T00:00:00.000Z",
      sourceReceiptDigest: D("source"),
      resolutionDigest: D("resolution"),
      dependency: {
        kind: "retrieval-index",
        ref: "skill-content:tenant-a:repair-tests",
        digest: D("repair-tests"),
        disposition: "invalidate",
      },
    };
    await revocations.invalidateRetrieval({
      ...requestCore,
      requestDigest: digestSkillRevocationDependencyRequest(requestCore),
    });
    release();
    const result = await resultPromise;
    expect(result.routing).not.toHaveProperty("decisionSuggestion");
    expect(result.skills.map(({ id }) => id)).not.toContain("repair-tests");
    expect(result.routing.rejectedCount).toBeGreaterThan(0);
  });
});
