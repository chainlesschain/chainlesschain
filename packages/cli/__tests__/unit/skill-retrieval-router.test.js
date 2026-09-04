import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SKILL_RETRIEVAL_RESULT_SCHEMA,
  routeSkillDescriptors,
} from "../../src/lib/skill-retrieval-router.js";
import { openSkillRetrievalRevocationAuthority } from "../../src/lib/evolution/skill-retrieval-revocation-authority.js";
import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "../../src/lib/evolution/skill-revocation-propagation.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function skill(id, description, overrides = {}) {
  return {
    id,
    displayName: id,
    description,
    category: "development",
    source: "workspace",
    version: "1.0.0",
    tags: ["code"],
    paths: [],
    os: [],
    capabilities: ["workspace.read"],
    executionIdentity: { contentDigest: D(id) },
    ...overrides,
  };
}

describe("Skill retrieval router", () => {
  it("excludes durably revoked content before lexical, vector, and outcome scoring", async () => {
    let stored = null;
    const authority = await openSkillRetrievalRevocationAuthority({
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
    const revoked = skill("repair-tests", "repair vitest failures");
    const requestCore = {
      schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
      tenantId: "tenant-a",
      streamId: "pilot-stream",
      operationId: "skill-revocation:repair-tests",
      transitionDigest: D("transition"),
      candidateId: D("candidate"),
      skillName: revoked.id,
      occurredAt: "2026-09-05T08:00:00.000Z",
      sourceReceiptDigest: D("source"),
      resolutionDigest: D("resolution"),
      dependency: {
        kind: "retrieval-index",
        ref: `skill-content:tenant-a:${revoked.id}`,
        digest: revoked.executionIdentity.contentDigest,
        disposition: "invalidate",
      },
    };
    await authority.invalidateRetrieval({
      ...requestCore,
      requestDigest: digestSkillRevocationDependencyRequest(requestCore),
    });

    const result = routeSkillDescriptors({
      skills: [revoked, skill("docs", "repair documentation")],
      query: "repair vitest failures",
      vectorScores: { [revoked.executionIdentity.contentDigest]: 1 },
      outcomeMetrics: {
        [revoked.executionIdentity.contentDigest]: {
          samples: 100,
          successRate: 1,
          correctionRate: 0,
        },
      },
      revocationReader: authority,
    });

    expect(result.candidates.map(({ id }) => id)).not.toContain(revoked.id);
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        id: revoked.id,
        reasons: expect.arrayContaining(["revoked-by-evolution"]),
        revocationReceiptDigest: expect.stringMatching(/^sha256:/u),
      }),
    );
  });

  it("ranks BM25, vector and verified outcome signals with explanations", () => {
    const repair = skill(
      "repair-tests",
      "repair failing unit tests with vitest",
    );
    const docs = skill("write-docs", "write documentation and release notes");
    const result = routeSkillDescriptors({
      skills: [docs, repair],
      query: "repair vitest failure",
      vectorScores: { [D("repair-tests")]: 0.9, [D("write-docs")]: 0.1 },
      outcomeMetrics: {
        [D("repair-tests")]: {
          samples: 20,
          successRate: 0.95,
          correctionRate: 0.05,
        },
      },
    });
    expect(result).toMatchObject({
      schema: SKILL_RETRIEVAL_RESULT_SCHEMA,
      selected: { id: "repair-tests", digest: D("repair-tests") },
      vectorAvailable: true,
    });
    expect(result.candidates[0].reason).toContain("bm25=");
    expect(result.candidates[0].contextCostTokens).toBeGreaterThan(0);
  });

  it("filters namespace, tags, path, OS and capability before recall", () => {
    const result = routeSkillDescriptors({
      skills: [
        skill("allowed", "deploy service", { paths: ["services/api"] }),
        skill("wrong-namespace", "deploy service", { source: "marketplace" }),
        skill("wrong-os", "deploy service", { os: ["darwin"] }),
        skill("too-powerful", "deploy service", {
          capabilities: ["workspace.read", "network.write"],
        }),
      ],
      query: "deploy service",
      namespace: "workspace",
      tags: ["code"],
      targetPath: "services/api/src",
      target: { os: "linux", allowedCapabilities: ["workspace.read"] },
    });
    expect(result.candidates.map(({ id }) => id)).toEqual(["allowed"]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "wrong-namespace" }),
        expect.objectContaining({ id: "wrong-os" }),
        expect.objectContaining({ id: "too-powerful" }),
      ]),
    );
  });

  it("never silently selects same-name incompatible versions", () => {
    const result = routeSkillDescriptors({
      skills: [
        skill("repair", "repair tests", {
          version: "1.0.0",
          executionIdentity: { contentDigest: D("repair-v1") },
        }),
        skill("repair", "repair tests", {
          version: "2.0.0",
          source: "marketplace",
          executionIdentity: { contentDigest: D("repair-v2") },
        }),
      ],
      query: "repair tests",
      ambiguityMargin: 0,
    });
    expect(result.selected).toBeNull();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "same-name-different-version" }),
    ]);
  });

  it("abstains when top scores are ambiguous", () => {
    const result = routeSkillDescriptors({
      skills: [skill("alpha", "same task"), skill("beta", "same task")],
      query: "same task",
      ambiguityMargin: 0.5,
    });
    expect(result.selected).toBeNull();
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ambiguous-top-score" }),
      ]),
    );
  });

  it("rejects unbounded inputs and invalid outcome evidence", () => {
    expect(() => routeSkillDescriptors({ skills: [], query: "" })).toThrow(
      "invalid or unbounded",
    );
    expect(() =>
      routeSkillDescriptors({
        skills: [skill("repair", "repair tests")],
        query: "repair",
        outcomeMetrics: {
          [D("repair")]: { samples: 1, successRate: 2, correctionRate: 0 },
        },
      }),
    ).toThrow("outcome metrics");
  });
});
