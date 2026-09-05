import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  WIKI_STATE_SCHEMA,
  digestWikiState,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import { EvolutionRawCryptoShred } from "../../src/lib/evolution/evolution-raw-crypto-shred.js";
import {
  GOVERNED_WIKI_PRUNING_PLAN_SCHEMA,
  GovernedWikiPruning,
} from "../../src/lib/evolution/governed-wiki-pruning.js";

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

function redigestPlan(plan) {
  const core = structuredClone(plan);
  delete core.planDigest;
  return {
    ...core,
    planDigest: D(`${GOVERNED_WIKI_PRUNING_PLAN_SCHEMA}\0${canonical(core)}`),
  };
}

function wikiState() {
  const evidence = {
    "evidence:private": {
      ref: "evidence:private",
      sourceDigest: D("private-source"),
      artifactRef: "artifact://private",
    },
  };
  const pattern = (patternId, status, skillNames = []) => ({
    patternId,
    status,
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    skillNames,
  });
  return {
    schema: WIKI_STATE_SCHEMA,
    tenantId: "tenant:a",
    revision: 4,
    revisionId: "wiki:revision",
    patterns: {
      "pat-old": pattern("pat-old", "stale"),
      "pat-live-skill": pattern("pat-live-skill", "corroborated", [
        "repair-tests",
      ]),
      "pat-revoked": pattern("pat-revoked", "revoked"),
    },
    index: [],
    evidence,
    evidenceDependents: {
      "evidence:private": ["pat-live-skill"],
    },
    maintenanceRequests: {},
    skillImpact: {},
    evolutionLog: [],
  };
}

function harness(overrides = {}) {
  const state = wikiState();
  const stateDigest = digestWikiState(state);
  let control = null;
  const ack = async ({ requestDigest }) => ({
    authenticated: true,
    durable: true,
    requestDigest,
    receiptDigest: D(requestDigest),
  });
  const ports = {
    loadWikiState: vi.fn(async () => ({
      trusted: true,
      state,
      stateDigest,
    })),
    resolveDeletionReceipt: vi.fn(async ({ receiptDigest }) => ({
      authenticated: true,
      tenantId: "tenant:a",
      decision: "delete",
      evidenceRef: "evidence:private",
      sourceDigest: D("private-source"),
      artifactRef: "artifact://private",
      rawArtifactRef: "artifact://tenant:a/raw/private",
      rawCipherDigest: D("private-cipher"),
      keyRef: "kms://tenant:a/private",
      receiptDigest,
    })),
    commitControl: vi.fn(async ({ state: next, expectedControlDigest }) => {
      if (control && control.controlDigest === next.controlDigest)
        return { authenticated: true, durable: true, ...control };
      if ((control?.controlDigest ?? null) !== expectedControlDigest)
        return { authenticated: false, durable: false };
      control = next;
      return { authenticated: true, durable: true, ...next };
    }),
    applyDependencyDispositions: vi.fn(ack),
    applyWikiRevision: vi.fn(ack),
    cryptoShred: vi.fn(ack),
    publishRetrievalProjection: vi.fn(ack),
    verifyOfflineClosure: vi.fn(async ({ receiptDigest }) => ({
      authenticated: true,
      stable: true,
      tenantId: "tenant:a",
      receiptDigest,
    })),
    ...overrides,
  };
  return {
    pruning: new GovernedWikiPruning({
      descriptor: { tenantId: "tenant:a", staleGraceDays: 30 },
      ports,
    }),
    ports,
    stateDigest,
  };
}

describe("Governed Wiki Pruning", () => {
  it("separates retrieval cleanup from immutable audit retention", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
    });
    expect(plan.patternActions).toEqual([
      {
        type: "tombstone",
        patternId: "pat-old",
        reason: "stale-grace-elapsed",
      },
    ]);
    expect(plan.retrievalRemovals).toEqual(["pat-old", "pat-revoked"]);
    expect(plan.auditPolicy).toMatchObject({
      retainWikiRevisions: true,
      retainEvolutionLog: true,
    });
  });

  it("binds privacy deletion and rolls back dependent active skills", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    expect(plan.dependencyDispositions).toEqual([
      {
        evidenceRef: "evidence:private",
        patternId: "pat-live-skill",
        action: "rollback",
        skillNames: ["repair-tests"],
      },
    ]);
    expect(plan.retrievalRemovals).toContain("pat-live-skill");
  });

  it("rejects substituted deletion receipts", async () => {
    const h = harness();
    h.ports.resolveDeletionReceipt.mockResolvedValueOnce({
      authenticated: true,
      tenantId: "tenant:a",
      decision: "delete",
      evidenceRef: "evidence:private",
      sourceDigest: D("wrong"),
      artifactRef: "artifact://private",
      rawArtifactRef: "artifact://tenant:a/raw/private",
      rawCipherDigest: D("private-cipher"),
      keyRef: "kms://tenant:a/private",
      receiptDigest: D("deletion"),
    });
    await expect(
      h.pruning.plan({
        expectedStateDigest: h.stateDigest,
        effectiveAt: "2026-09-03T00:00:00.000Z",
        deletionReceiptDigests: [D("deletion")],
      }),
    ).rejects.toThrow("not exactly bound");
  });

  it("durably applies dependencies before crypto-shred and projection", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    const result = await h.pruning.execute({ plan });
    expect(result.phase).toBe("finalized");
    expect(h.ports.commitControl).toHaveBeenCalledTimes(2);
    expect(h.ports.applyDependencyDispositions).toHaveBeenCalledOnce();
    expect(h.ports.cryptoShred).toHaveBeenCalledOnce();
    expect(h.ports.publishRetrievalProjection).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "omitted dependencies",
      (plan) => {
        plan.dependencyDispositions = [];
      },
    ],
    [
      "omitted tombstones",
      (plan) => {
        plan.patternActions = [];
      },
    ],
    [
      "omitted index removals",
      (plan) => {
        plan.retrievalRemovals = [];
      },
    ],
    [
      "unrelated pattern",
      (plan) => {
        plan.patternActions[0].patternId = "pat-live-skill";
      },
    ],
    [
      "replaced deletion target",
      (plan) => {
        plan.deletions[0].keyRef = "kms://tenant:a/unrelated";
      },
    ],
    [
      "discarded audit retention",
      (plan) => {
        plan.auditPolicy.retainEvolutionLog = false;
      },
    ],
    [
      "unknown plan fields",
      (plan) => {
        plan.skipApproval = true;
      },
    ],
  ])(
    "rejects redigested plan %s before any side effect",
    async (_label, mutate) => {
      const h = harness();
      const original = await h.pruning.plan({
        expectedStateDigest: h.stateDigest,
        effectiveAt: "2026-09-03T00:00:00.000Z",
        deletionReceiptDigests: [D("deletion")],
      });
      const altered = structuredClone(original);
      mutate(altered);
      const forged = redigestPlan(altered);
      expect(forged.planDigest).not.toBe(original.planDigest);
      await expect(h.pruning.execute({ plan: forged })).rejects.toThrow(
        /current trusted policy/u,
      );
      for (const name of [
        "commitControl",
        "applyDependencyDispositions",
        "applyWikiRevision",
        "cryptoShred",
        "publishRetrievalProjection",
      ])
        expect(h.ports[name], name).not.toHaveBeenCalled();
    },
  );

  it("reauthenticates deletion authorization between planning and execution", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    h.ports.resolveDeletionReceipt.mockResolvedValueOnce({
      authenticated: false,
    });
    await expect(h.pruning.execute({ plan })).rejects.toThrow(
      /not exactly bound/u,
    );
    expect(h.ports.commitControl).not.toHaveBeenCalled();
    expect(h.ports.cryptoShred).not.toHaveBeenCalled();
  });

  it("captures the policy and ports so callers cannot replace execution authorization", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    const captured = { ...h.ports };
    for (const name of Object.keys(h.ports))
      h.ports[name] = vi.fn(() => {
        throw new Error("substituted port");
      });
    expect(Object.isFrozen(h.pruning)).toBe(true);
    expect(Object.isFrozen(h.pruning.descriptor)).toBe(true);
    expect(Reflect.set(h.pruning, "plan", async () => plan)).toBe(false);
    expect(
      Reflect.set(h.pruning, "_commitControl", h.ports.commitControl),
    ).toBe(false);
    expect(Reflect.set(h.pruning, "descriptor", { tenantId: "attacker" })).toBe(
      false,
    );
    expect(Object.keys(h.pruning)).toEqual(["descriptor"]);
    await expect(h.pruning.execute({ plan })).resolves.toMatchObject({
      phase: "finalized",
    });
    expect(captured.cryptoShred).toHaveBeenCalledOnce();
    expect(captured.resolveDeletionReceipt).toHaveBeenCalledTimes(2);
    for (const operation of Object.values(h.ports))
      expect(operation).not.toHaveBeenCalled();
  });

  it("enforces the executor's current action budget on a previously valid plan", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    const stricter = new GovernedWikiPruning({
      descriptor: { tenantId: "tenant:a", maxActions: 1 },
      ports: h.ports,
    });
    await expect(stricter.execute({ plan })).rejects.toThrow(/action budget/u);
    expect(h.ports.commitControl).not.toHaveBeenCalled();
    expect(h.ports.cryptoShred).not.toHaveBeenCalled();
  });

  it("captures the submitted plan before asynchronous revalidation", async () => {
    const h = harness();
    const plan = structuredClone(
      await h.pruning.plan({
        expectedStateDigest: h.stateDigest,
        effectiveAt: "2026-09-03T00:00:00.000Z",
        deletionReceiptDigests: [D("deletion")],
      }),
    );
    const execution = h.pruning.execute({ plan });
    plan.dependencyDispositions = [];
    plan.deletions[0].keyRef = "kms://tenant:a/substituted-after-await";
    await expect(execution).resolves.toMatchObject({ phase: "finalized" });
    expect(
      h.ports.applyDependencyDispositions.mock.calls[0][0].request.payload,
    ).toHaveLength(1);
    expect(h.ports.cryptoShred.mock.calls[0][0].request.payload.keyRef).toBe(
      "kms://tenant:a/private",
    );
  });

  it("composes with the Raw KMS shredder and retains a deletion tombstone", async () => {
    const kms = {
      verifyDeletionReceipt: vi.fn(async ({ receiptDigest }) => ({
        authenticated: true,
        tenantId: "tenant:a",
        decision: "delete",
        evidenceRef: "evidence:private",
        sourceDigest: D("private-source"),
        artifactRef: "artifact://private",
        rawArtifactRef: "artifact://tenant:a/raw/private",
        rawCipherDigest: D("private-cipher"),
        keyRef: "kms://tenant:a/private",
        receiptDigest,
      })),
      destroyKey: vi.fn(async (request) => ({
        authenticated: true,
        durable: true,
        destroyed: true,
        keyRef: request.keyRef,
        requestDigest: request.requestDigest,
        receiptDigest: D("destroyed"),
      })),
      confirmKeyDestroyed: vi.fn(
        async ({ keyRef, destructionReceiptDigest }) => ({
          authenticated: true,
          destroyed: true,
          keyRef,
          destructionReceiptDigest,
          receiptDigest: D("confirmed"),
        }),
      ),
      retainTombstone: vi.fn(async ({ tombstone }) => ({
        authenticated: true,
        durable: true,
        tombstoneDigest: tombstone.tombstoneDigest,
        receiptDigest: D("retained"),
      })),
    };
    const shredder = new EvolutionRawCryptoShred({
      tenantId: "tenant:a",
      ports: kms,
    });
    const h = harness({ cryptoShred: shredder.shred.bind(shredder) });
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
      deletionReceiptDigests: [D("deletion")],
    });
    await h.pruning.execute({ plan });

    expect(kms.destroyKey).toHaveBeenCalledOnce();
    expect(kms.retainTombstone).toHaveBeenCalledOnce();
    expect(
      h.ports.applyDependencyDispositions.mock.invocationCallOrder[0],
    ).toBeLessThan(kms.destroyKey.mock.invocationCallOrder[0]);
  });

  it("fails closed when an operation acknowledgement is not durable", async () => {
    const h = harness();
    const plan = await h.pruning.plan({
      expectedStateDigest: h.stateDigest,
      effectiveAt: "2026-09-03T00:00:00.000Z",
    });
    h.ports.applyWikiRevision.mockResolvedValueOnce({ durable: false });
    await expect(h.pruning.execute({ plan })).rejects.toThrow(
      "wiki-revision was not durably acknowledged",
    );
  });

  it("authorizes online adaptation only after offline closure and without new authority", async () => {
    const h = harness();
    const authorization = await h.pruning.authorizeOnlineAdaptation({
      tenantId: "tenant:a",
      sessionId: "session:1",
      candidateOnly: true,
      promotionGateRequired: true,
      baselineCapabilities: ["read-wiki", "write-candidate"],
      requestedCapabilities: ["read-wiki"],
      offlineClosureReceiptDigest: D("offline-closure"),
    });
    expect(authorization).toMatchObject({
      tenantId: "tenant:a",
      candidateOnly: true,
      promotionGateRequired: true,
    });
  });

  it("rejects online adaptation that requests added capability", async () => {
    const h = harness();
    await expect(
      h.pruning.authorizeOnlineAdaptation({
        tenantId: "tenant:a",
        sessionId: "session:1",
        candidateOnly: true,
        promotionGateRequired: true,
        baselineCapabilities: ["read-wiki"],
        requestedCapabilities: ["read-wiki", "network"],
        offlineClosureReceiptDigest: D("offline-closure"),
      }),
    ).rejects.toThrow("cannot expand authority");
  });
});
