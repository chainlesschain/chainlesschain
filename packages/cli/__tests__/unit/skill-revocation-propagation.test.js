import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
  SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
  createSkillRevocationPropagation,
} from "../../src/lib/evolution/skill-revocation-propagation.js";
import {
  SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
  createSkillWikiPilotReconciliationSource,
} from "../../src/lib/evolution/skill-wiki-reconciliation.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function outcome(overrides = {}) {
  return {
    schema: SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: "tenant-a",
    streamId: "pilot-a:wiki-outcomes",
    sequence: 11,
    pilotId: "pilot-a",
    descriptorDigest: hash("descriptor"),
    candidateId: hash("candidate"),
    skillName: "safe-refactor",
    outcome: "rollback",
    reason: "The production Pilot rolled back the candidate.",
    occurredAt: "2026-09-05T00:00:00.000Z",
    activeStateDigest: hash("active-state"),
    evidenceReceiptDigests: [hash("gate")],
    sourceReceiptDigest: hash("rollback-receipt"),
    ...overrides,
  };
}

function dependencies() {
  return [
    {
      kind: "wiki-pattern",
      ref: "pat-safe-refactor",
      digest: hash("pattern"),
      disposition: "stale",
    },
    {
      kind: "memory",
      ref: "memory://tenant-a/skill/safe-refactor",
      digest: hash("memory"),
      disposition: "quarantine",
    },
    {
      kind: "retrieval-index",
      ref: "retrieval://tenant-a/pat-safe-refactor",
      digest: hash("retrieval"),
      disposition: "invalidate",
    },
    {
      kind: "marketplace-badge",
      ref: "marketplace://safe-refactor/eval-badge",
      digest: hash("badge"),
      disposition: "revoke",
    },
  ].sort((left, right) =>
    `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`),
  );
}

function fixture({ crash = false, loseCheckpointAck = false } = {}) {
  let checkpoint = null;
  let shouldCrash = crash;
  let loseAck = loseCheckpointAck;
  const applied = new Set();
  const source = createSkillWikiPilotReconciliationSource({
    tenantId: "tenant-a",
    streamId: "pilot-a:wiki-outcomes",
    readPilotOutcomes: async () => [outcome()],
  });
  const resolveDependencies = vi.fn(async (event) => {
    const core = {
      schema: SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
      tenantId: "tenant-a",
      transitionDigest: event.transitionDigest,
      candidateId: event.candidateId,
      skillName: event.skillName,
      completeKinds: [
        "wiki-pattern",
        "memory",
        "retrieval-index",
        "marketplace-badge",
      ],
      dependencies: dependencies(),
    };
    return {
      ...core,
      authenticated: true,
      durable: true,
      resolutionDigest: hash(core),
      receiptDigest: hash("dependency-resolution"),
    };
  });
  const effect = vi.fn(async (request) => {
    applied.add(request.operationId);
    return {
      schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
      authenticated: true,
      durable: true,
      applied: true,
      idempotent: true,
      tenantId: request.tenantId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      dependencyKind: request.dependency.kind,
      dependencyRef: request.dependency.ref,
      dependencyDigest: request.dependency.digest,
      disposition: request.dependency.disposition,
      receiptDigest: hash(`effect:${request.operationId}`),
    };
  });
  const ports = {
    resolveDependencies,
    stalePattern: effect,
    quarantineMemory: effect,
    invalidateRetrieval: effect,
    revokeMarketplaceBadge: effect,
    loadCheckpoint: vi.fn(async () => checkpoint),
    commitCheckpoint: vi.fn(
      async ({ checkpoint: next, expectedCheckpointDigest }) => {
        expect(expectedCheckpointDigest).toBe(
          checkpoint?.checkpointDigest ?? null,
        );
        checkpoint = next;
        if (loseAck) {
          loseAck = false;
          throw new Error("simulated checkpoint response loss");
        }
        return {
          authenticated: true,
          durable: true,
          committed: true,
          checkpointDigest: next.checkpointDigest,
        };
      },
    ),
  };
  const propagation = createSkillRevocationPropagation({
    source,
    ports,
    crashHook() {
      if (shouldCrash) {
        shouldCrash = false;
        throw new Error("simulated process loss after effects");
      }
    },
  });
  return { applied, effect, ports, propagation, source };
}

describe("SkillRevocationPropagation", () => {
  it("applies all four rollback dependency dispositions before checkpointing", async () => {
    const h = fixture();

    await expect(h.propagation.propagate()).resolves.toMatchObject({
      processed: 1,
      cursor: 11,
      outcomes: [{ outcome: "rollback", effects: 4 }],
    });
    await expect(h.propagation.propagate()).resolves.toMatchObject({
      processed: 0,
      cursor: 11,
    });
    expect(h.applied.size).toBe(4);
    expect(h.effect.mock.calls.map(([request]) => request.dependency)).toEqual(
      expect.arrayContaining(dependencies()),
    );
  });

  it("replays deterministic idempotent effects after a crash and recovers a lost checkpoint ack", async () => {
    const h = fixture({ crash: true, loseCheckpointAck: true });
    await expect(h.propagation.propagate()).rejects.toThrow(
      /simulated process loss after effects/,
    );
    const reopened = createSkillRevocationPropagation({
      source: h.source,
      ports: h.ports,
    });

    await expect(reopened.propagate()).resolves.toMatchObject({
      processed: 1,
      cursor: 11,
      outcomes: [{ effects: 4 }],
    });
    expect(h.effect).toHaveBeenCalledTimes(8);
    expect(h.applied.size).toBe(4);
    await expect(reopened.propagate()).resolves.toMatchObject({ processed: 0 });
  });

  it("fails closed when the resolver omits a dependency domain", async () => {
    const h = fixture();
    h.ports.resolveDependencies.mockResolvedValueOnce({
      ...(await h.ports.resolveDependencies(
        await h.source.list().then(([item]) => item),
      )),
      completeKinds: ["wiki-pattern", "memory", "retrieval-index"],
    });

    await expect(h.propagation.propagate()).rejects.toMatchObject({
      code: "CC_SKILL_REVOCATION_PROPAGATION_INVALID",
    });
    expect(h.effect).not.toHaveBeenCalled();
  });
});
