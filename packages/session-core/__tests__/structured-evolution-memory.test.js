import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import memory from "../lib/structured-evolution-memory.js";

const {
  STRUCTURED_MEMORY_EVENT_SCHEMA,
  MEMORY_LAYER,
  MEMORY_ACTION,
  StructuredEvolutionMemory,
  projectStructuredMemory,
  createStructuredMemoryAuthority,
  captureStructuredMemoryAuthority,
  createStructuredMemoryReceiptProvider,
  createStructuredMemoryAuthorityReceipt,
  createStructuredMemoryPostCompactVerifier,
} = memory;

function digest(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

const actor = (role, actorType = "agent") => ({
  actorId: `${role}-1`,
  actorType,
  role,
});

function event(overrides = {}) {
  return {
    schema: STRUCTURED_MEMORY_EVENT_SCHEMA,
    tenantId: "tenant-a",
    eventId: "event-1",
    sequence: 1,
    memoryId: "memory-1",
    layer: MEMORY_LAYER.EPISODIC,
    action: MEMORY_ACTION.APPEND,
    actor: actor("producer"),
    automatic: true,
    contentDigest: digest("content-1"),
    artifactRef: "artifact://memory-1",
    evidenceRefs: [],
    supersedes: [],
    receipts: {},
    timestamp: "2026-09-02T00:00:00.000Z",
    metadata: { source: "session-1" },
    ...overrides,
  };
}

function ports(overrides = {}) {
  const postCompact = postCompactAuthority();
  return {
    persistEvent: vi.fn(async (value) => ({
      persisted: true,
      eventId: value.eventId,
      eventDigest: hashEvent(value),
    })),
    persistSnapshot: vi.fn(async (value) => ({
      persisted: true,
      snapshotDigest: value.snapshotDigest,
    })),
    postCompactVerifier: postCompact.provider,
    postCompactHook: postCompact.hook,
    postCompactAttestationVerifier: postCompact.verifier,
    receiptProvider: receiptProvider(),
    ...overrides,
  };
}

function postCompactResult(request, decision = "accepted") {
  return {
    schema: memory.STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
    authenticated: true,
    tenantId: "tenant-a",
    authorityId: "post-compact-runtime",
    authorityRevision: 1,
    handlerDigest: digest("post-compact-handler"),
    snapshotDigest: request.snapshotDigest,
    projectionDigest: request.projectionDigest,
    previousSnapshotDigest: request.previousSnapshotDigest,
    decision,
    checkedAt: "2026-09-02T00:00:00.000Z",
    receiptDigest: digest(`post-compact:${decision}`),
  };
}

function postCompactAuthority(overrides = {}) {
  const descriptor = {
    tenantId: "tenant-a",
    authorityId: "post-compact-runtime",
    authorityRevision: 1,
    handlerDigest: digest("post-compact-handler"),
  };
  const hook = overrides.hook || {
    run: vi.fn(async (request) => postCompactResult(request)),
  };
  const verifier = overrides.verifier || { verify: vi.fn(async () => true) };
  return {
    hook,
    verifier,
    provider: createStructuredMemoryPostCompactVerifier({
      descriptor,
      hook,
      verifier,
    }),
  };
}

function receiptProvider(overrides = {}) {
  const descriptor = {
    tenantId: "tenant-a",
    authorityId: "memory-receipts",
    authorityRevision: 1,
    handlerDigest: digest("memory-receipt-handler"),
  };
  const resolver = {
    resolve: vi.fn(async (request) => {
      const receipt = createStructuredMemoryAuthorityReceipt({
        tenantId: request.tenantId,
        kind: request.kind,
        decision: "accepted",
        memoryId: request.memoryId,
        layer: request.layer,
        action: request.action,
        contentDigest: request.contentDigest,
        artifactRef: request.artifactRef,
        evidenceRefs: request.evidenceRefs,
        issuerId: `${request.kind}-authority`,
        issuerRevision: 1,
        issuerHandlerDigest: digest(`${request.kind}-handler`),
        issuedAt: "2026-09-02T00:00:00.000Z",
      });
      return {
        schema: memory.STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
        authenticated: true,
        ...descriptor,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
        receipt,
        resolutionReceiptDigest: digest(
          `resolution:${request.kind}:${request.receiptDigest}`,
        ),
      };
    }),
  };
  const verifier = { verify: vi.fn(async () => true) };
  return createStructuredMemoryReceiptProvider({
    descriptor,
    resolver: overrides.resolver || resolver,
    verifier: overrides.verifier || verifier,
  });
}

function authorityReceipt(kind, overrides = {}) {
  return createStructuredMemoryAuthorityReceipt({
    tenantId: "tenant-a",
    kind,
    decision: "accepted",
    memoryId: "memory-1",
    layer:
      kind === "promotion"
        ? "procedural"
        : kind === "policy"
          ? "policy"
          : "semantic",
    action: "accept",
    contentDigest: digest("content-1"),
    artifactRef: "artifact://memory-1",
    evidenceRefs:
      kind === "critic" || kind === "evaluator" ? ["evidence://grader/1"] : [],
    issuerId: `${kind}-authority`,
    issuerRevision: 1,
    issuerHandlerDigest: digest(`${kind}-handler`),
    issuedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  });
}

function authority(
  role = "producer",
  actorType = "agent",
  tenantId = "tenant-a",
) {
  return createStructuredMemoryAuthority({
    tenantId,
    actorId: `${role}-runtime`,
    actorType,
    role,
    authorityDigest: digest(`authority:${role}:${tenantId}`),
  });
}

function runtimeEvent(overrides = {}) {
  const value = event(overrides);
  delete value.schema;
  delete value.tenantId;
  delete value.sequence;
  delete value.actor;
  return { ...value, authority: overrides.authority ?? authority() };
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hashEvent(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function compactInput(overrides = {}) {
  return {
    requirements: ["preserve authorization boundary"],
    decisions: ["use append-only projection"],
    openRisks: ["production adapter pending"],
    failedAttempts: ["free-text compaction"],
    tests: ["structured-evolution-memory.test.js"],
    goalState: { status: "active", objectiveDigest: digest("goal") },
    delegatedTasks: ["task:critic-review"],
    memoryLineage: ["memory-1"],
    ...overrides,
  };
}

describe("structured evolution memory projection", () => {
  it("captures only branded authorities with the required tenant and actor scope", () => {
    const promotion = authority("promotion-controller", "service");
    expect(
      captureStructuredMemoryAuthority(promotion, {
        tenantId: "tenant-a",
        role: "promotion-controller",
        actorType: "service",
      }),
    ).toBe(promotion);
    expect(() =>
      captureStructuredMemoryAuthority(promotion, {
        tenantId: "tenant-b",
        role: "promotion-controller",
        actorType: "service",
      }),
    ).toThrow(/branded tenant-scoped/u);
    expect(() =>
      captureStructuredMemoryAuthority(authority("governor", "service"), {
        tenantId: "tenant-a",
        role: "promotion-controller",
        actorType: "service",
      }),
    ).toThrow(/wrong actor scope/u);
  });

  it("keeps episodic memory append-only and uses tombstones instead of overwrite", () => {
    const first = event();
    const duplicateMemory = event({
      eventId: "event-2",
      sequence: 2,
      contentDigest: digest("changed"),
    });
    expect(() => projectStructuredMemory([first, duplicateMemory])).toThrow(
      /silently overwrite/,
    );
    const tombstone = event({
      eventId: "event-2",
      sequence: 2,
      action: "tombstone",
      actor: actor("governor", "service"),
      automatic: false,
    });
    const projected = projectStructuredMemory([first, tombstone]);
    expect(projected.memories).not.toHaveProperty("memory-1");
    expect(projected.tombstones["memory-1"].contentDigest).toBe(
      first.contentDigest,
    );
  });

  it("queues child-agent semantic facts and requires critic, evaluator and governor to accept", () => {
    const proposal = event({
      layer: "semantic",
      action: "propose",
      actor: actor("child-agent"),
      evidenceRefs: ["evidence://grader/1"],
    });
    const proposed = projectStructuredMemory([proposal]);
    expect(proposed.queue).toEqual(["memory-1"]);
    expect(proposed.memories["memory-1"].status).toBe("proposed");
    const accepted = event({
      eventId: "event-2",
      sequence: 2,
      layer: "semantic",
      action: "accept",
      actor: actor("governor", "service"),
      receipts: { critic: digest("critic"), evaluator: digest("eval") },
      evidenceRefs: ["evidence://grader/1"],
    });
    const final = projectStructuredMemory([proposal, accepted]);
    expect(final.queue).toEqual([]);
    expect(final.memories["memory-1"].status).toBe("active");
    for (const invalid of [
      { actor: actor("proposer") },
      { receipts: { critic: digest("critic") } },
      { contentDigest: digest("substituted") },
      { evidenceRefs: ["evidence://substituted"] },
    ])
      expect(() =>
        projectStructuredMemory([proposal, { ...accepted, ...invalid }]),
      ).toThrow();
  });

  it("only lets promotion-controller receipts change procedural memory", () => {
    const valid = event({
      layer: "procedural",
      action: "accept",
      actor: actor("promotion-controller", "service"),
      receipts: { promotion: digest("promotion") },
    });
    expect(projectStructuredMemory([valid]).memories["memory-1"].status).toBe(
      "active",
    );
    for (const invalid of [
      { actor: actor("child-agent") },
      { actor: actor("promotion-controller", "service"), receipts: {} },
      { action: "propose", actor: actor("proposer") },
    ])
      expect(() => projectStructuredMemory([{ ...valid, ...invalid }])).toThrow(
        /promotion controller/,
      );
  });

  it("quarantines procedural memory only through a revocation receipt", () => {
    const accepted = event({
      layer: "procedural",
      action: "accept",
      actor: actor("promotion-controller", "service"),
      receipts: { promotion: digest("promotion") },
    });
    const quarantined = event({
      eventId: "event-2",
      sequence: 2,
      layer: "procedural",
      action: "quarantine",
      actor: actor("promotion-controller", "service"),
      receipts: { revocation: digest("revocation") },
      metadata: { revocationPropagationRequestDigest: digest("request") },
    });

    const projection = projectStructuredMemory([accepted, quarantined]);
    expect(projection.memories["memory-1"]).toBeUndefined();
    expect(projection.quarantines["memory-1"]).toMatchObject({
      contentDigest: accepted.contentDigest,
      receipts: { revocation: digest("revocation") },
    });
    expect(() =>
      projectStructuredMemory([
        accepted,
        { ...quarantined, receipts: {}, actor: actor("governor", "service") },
      ]),
    ).toThrow(/promotion controller/);
  });

  it("never lets automatic experience overwrite policy memory", () => {
    const valid = event({
      layer: "policy",
      action: "accept",
      automatic: false,
      actor: actor("governor", "human"),
      receipts: { policy: digest("policy-approval") },
    });
    expect(projectStructuredMemory([valid]).memories["memory-1"].layer).toBe(
      "policy",
    );
    for (const invalid of [
      { automatic: true },
      { actor: actor("governor", "service") },
      { actor: actor("child-agent"), action: "propose" },
    ])
      expect(() =>
        projectStructuredMemory([{ ...valid, ...invalid }]),
      ).toThrow();
  });

  it("rejects raw content, cross-tenant events, sequence gaps and conflicting replay", () => {
    expect(() =>
      projectStructuredMemory([event({ metadata: { content: "secret" } })]),
    ).toThrow(/raw material/);
    expect(() =>
      projectStructuredMemory([
        event(),
        event({ eventId: "event-2", sequence: 2, tenantId: "tenant-b" }),
      ]),
    ).toThrow(/cross-tenant/);
    expect(() => projectStructuredMemory([event({ sequence: 2 })])).toThrow(
      /contiguous/,
    );
    expect(() =>
      projectStructuredMemory([
        event(),
        event({ contentDigest: digest("other") }),
      ]),
    ).toThrow(/conflicting/);
    expect(() =>
      projectStructuredMemory([
        event(),
        event({
          eventId: "event-2",
          sequence: 2,
          layer: "procedural",
          action: "accept",
          actor: actor("promotion-controller", "service"),
          receipts: { promotion: digest("promotion") },
        }),
      ]),
    ).toThrow(/cross memory layers/);
  });

  it("replays identical events deterministically", () => {
    const input = [
      event(),
      event({
        eventId: "event-2",
        sequence: 2,
        memoryId: "memory-2",
        contentDigest: digest("content-2"),
        artifactRef: "artifact://memory-2",
      }),
    ];
    expect(projectStructuredMemory([...input].reverse())).toEqual(
      projectStructuredMemory(input),
    );
    expect(
      projectStructuredMemory([...input, structuredClone(input[0])]),
    ).toEqual(projectStructuredMemory(input));
  });

  it("rejects a caller-forged continuation state before applying an authorized-looking event", () => {
    const projected = projectStructuredMemory([event()]);
    const state = structuredClone(
      Object.fromEntries(
        Object.entries(projected).filter(([key]) => key !== "projectionDigest"),
      ),
    );
    state.memories["memory-1"].layer = "semantic";
    const accepted = event({
      eventId: "event-2",
      sequence: 2,
      layer: "semantic",
      action: "accept",
      actor: actor("governor", "service"),
      receipts: { critic: digest("critic"), evaluator: digest("eval") },
    });
    expect(() =>
      projectStructuredMemory([accepted], {
        tenantId: "tenant-a",
        state,
        stateDigest: projected.projectionDigest,
      }),
    ).toThrow(/not digest-bound/);
  });
});

describe("StructuredEvolutionMemory", () => {
  it("does not expose an event until durable persistence confirms its exact digest", async () => {
    const p = ports({
      persistEvent: vi.fn(async () => ({ persisted: false })),
    });
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await expect(store.append(runtimeEvent())).rejects.toThrow(/not confirmed/);
    expect(store.projection().sequence).toBe(0);
  });

  it("compacts every required field only after PostCompact verification and persistence", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await store.append(runtimeEvent());
    const result = await store.compact(compactInput());
    expect(result.status).toBe("compacted");
    expect(result.snapshot).toMatchObject({
      throughSequence: 1,
      requirements: compactInput().requirements,
      decisions: compactInput().decisions,
      memoryLineage: ["memory-1"],
    });
    expect(p.postCompactHook.run).toHaveBeenCalledWith(
      expect.objectContaining({ projection: store.projection() }),
    );
    expect(p.persistSnapshot).toHaveBeenCalledTimes(1);
  });

  it("restores the previous snapshot when PostCompact verification fails", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await store.append(runtimeEvent());
    const first = await store.compact(compactInput());
    p.postCompactHook.run.mockImplementationOnce(async (request) =>
      postCompactResult(request, "rejected"),
    );
    const failed = await store.compact(
      compactInput({ decisions: ["unsafe replacement"] }),
    );
    expect(failed).toEqual({
      status: "restored",
      snapshot: first.snapshot,
      reason: "post-compact verification failed",
    });
    expect(store.snapshot()).toEqual(first.snapshot);
    expect(p.persistSnapshot).toHaveBeenCalledTimes(1);
  });

  it("requires branded PostCompact composition and rejects substituted or unauthenticated results", async () => {
    const base = ports();
    expect(
      () =>
        new StructuredEvolutionMemory({
          tenantId: "tenant-a",
          ...base,
          postCompactVerifier: async () => true,
        }),
    ).toThrow(/branded tenant-scoped PostCompact/);

    const substitutedAuthority = postCompactAuthority({
      hook: {
        run: vi.fn(async (request) => ({
          ...postCompactResult(request),
          snapshotDigest: digest("substituted"),
        })),
      },
    });
    const substitutedPorts = ports({
      postCompactVerifier: substitutedAuthority.provider,
      postCompactHook: substitutedAuthority.hook,
    });
    const substituted = new StructuredEvolutionMemory({
      tenantId: "tenant-a",
      ...substitutedPorts,
    });
    await substituted.append(runtimeEvent());
    expect(await substituted.compact(compactInput())).toMatchObject({
      status: "restored",
      snapshot: null,
    });
    expect(substitutedPorts.persistSnapshot).not.toHaveBeenCalled();

    const rejectedAuthority = postCompactAuthority({
      verifier: { verify: vi.fn(async () => false) },
    });
    const rejectedPorts = ports({
      postCompactVerifier: rejectedAuthority.provider,
    });
    const rejected = new StructuredEvolutionMemory({
      tenantId: "tenant-a",
      ...rejectedPorts,
    });
    await rejected.append(runtimeEvent());
    expect(await rejected.compact(compactInput())).toMatchObject({
      status: "restored",
      snapshot: null,
    });
    expect(rejectedPorts.persistSnapshot).not.toHaveBeenCalled();
  });

  it("restores the previous snapshot when snapshot persistence is unconfirmed", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await store.append(runtimeEvent());
    const first = await store.compact(compactInput());
    p.persistSnapshot.mockResolvedValueOnce({ persisted: false });
    const failed = await store.compact(
      compactInput({ openRisks: ["new risk"] }),
    );
    expect(failed.status).toBe("restored");
    expect(store.snapshot()).toEqual(first.snapshot);
    p.persistSnapshot.mockRejectedValueOnce(new Error("storage unavailable"));
    const thrown = await store.compact(
      compactInput({ openRisks: ["storage error"] }),
    );
    expect(thrown.status).toBe("restored");
    expect(store.snapshot()).toEqual(first.snapshot);
  });

  it("rejects forged and cross-tenant runtime role authorities before persistence", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await expect(
      store.append(
        runtimeEvent({
          authority: { tenantId: "tenant-a", actor: actor("governor") },
        }),
      ),
    ).rejects.toThrow(/branded tenant-scoped/);
    await expect(
      store.append(
        runtimeEvent({ authority: authority("producer", "agent", "tenant-b") }),
      ),
    ).rejects.toThrow(/branded tenant-scoped/);
    expect(p.persistEvent).not.toHaveBeenCalled();
  });

  it("resolves semantic approval receipts through the configured branded provider", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    const semantic = {
      layer: "semantic",
      evidenceRefs: ["evidence://grader/1"],
    };
    await store.append(
      runtimeEvent({
        ...semantic,
        action: "propose",
        authority: authority("child-agent"),
      }),
    );
    const result = await store.append(
      runtimeEvent({
        ...semantic,
        eventId: "event-2",
        action: "accept",
        authority: authority("governor", "service"),
        receiptRefs: {
          critic: authorityReceipt("critic").receiptDigest,
          evaluator: authorityReceipt("evaluator").receiptDigest,
        },
      }),
    );
    expect(result.event.receipts).toEqual({
      critic: authorityReceipt("critic").receiptDigest,
      evaluator: authorityReceipt("evaluator").receiptDigest,
      promotion: null,
      revocation: null,
      policy: null,
    });
    expect(result.projection.memories["memory-1"].status).toBe("active");
  });

  it("resolves promotion and human-policy receipts without exposing digest injection", async () => {
    const transitions = [
      {
        layer: "procedural",
        authority: authority("promotion-controller", "service"),
        receiptRefs: { promotion: authorityReceipt("promotion").receiptDigest },
        expectedKind: "promotion",
      },
      {
        layer: "policy",
        authority: authority("governor", "human"),
        automatic: false,
        receiptRefs: { policy: authorityReceipt("policy").receiptDigest },
        expectedKind: "policy",
      },
    ];
    for (const transition of transitions) {
      const p = ports();
      const store = new StructuredEvolutionMemory({
        tenantId: "tenant-a",
        ...p,
      });
      const result = await store.append(
        runtimeEvent({ ...transition, action: "accept" }),
      );
      expect(result.event.receipts[transition.expectedKind]).toBe(
        transition.receiptRefs[transition.expectedKind],
      );
      expect(result.projection.memories["memory-1"].status).toBe("active");
    }
  });

  it("rejects caller-supplied receipt digests and unbranded receipt providers", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await expect(
      store.append(
        runtimeEvent({
          layer: "procedural",
          action: "accept",
          authority: authority("promotion-controller", "service"),
          receipts: { promotion: digest("forged") },
        }),
      ),
    ).rejects.toThrow(/configured provider/);
    expect(
      () =>
        new StructuredEvolutionMemory({
          tenantId: "tenant-a",
          ...p,
          receiptProvider: { resolveForEvent: async () => ({}) },
        }),
    ).toThrow(/branded tenant-scoped/);
    expect(p.persistEvent).not.toHaveBeenCalled();
  });

  it("fails closed when receipt resolution substitutes the transition or is unauthenticated", async () => {
    const substituted = receiptProvider({
      resolver: {
        resolve: async (request) => ({
          schema: memory.STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
          authenticated: true,
          tenantId: "tenant-a",
          authorityId: "memory-receipts",
          authorityRevision: 1,
          handlerDigest: digest("memory-receipt-handler"),
          kind: request.kind,
          receiptDigest: request.receiptDigest,
          resolutionReceiptDigest: digest("resolution"),
          receipt: {
            ...createStructuredMemoryAuthorityReceipt({
              tenantId: "tenant-a",
              kind: request.kind,
              decision: "accepted",
              memoryId: request.memoryId,
              layer: request.layer,
              action: request.action,
              contentDigest: request.contentDigest,
              artifactRef: request.artifactRef,
              evidenceRefs: request.evidenceRefs,
              issuerId: `${request.kind}-authority`,
              issuerRevision: 1,
              issuerHandlerDigest: digest(`${request.kind}-handler`),
              issuedAt: "2026-09-02T00:00:00.000Z",
            }),
            contentDigest: digest("substituted"),
          },
        }),
      },
    });
    const p = ports({ receiptProvider: substituted });
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await expect(
      store.append(
        runtimeEvent({
          layer: "procedural",
          action: "accept",
          authority: authority("promotion-controller", "service"),
          receiptRefs: {
            promotion: authorityReceipt("promotion").receiptDigest,
          },
        }),
      ),
    ).rejects.toThrow(/digest does not bind/);
    const unauthenticated = receiptProvider({
      verifier: { verify: async () => false },
    });
    const rejected = new StructuredEvolutionMemory({
      tenantId: "tenant-a",
      ...ports({ receiptProvider: unauthenticated }),
    });
    await expect(
      rejected.append(
        runtimeEvent({
          layer: "procedural",
          action: "accept",
          authority: authority("promotion-controller", "service"),
          receiptRefs: {
            promotion: authorityReceipt("promotion").receiptDigest,
          },
        }),
      ),
    ).rejects.toThrow(/authentication failed/);
  });

  it("hydrates deterministically from persisted events and a verified compaction snapshot", async () => {
    const p = ports();
    const first = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await first.append(runtimeEvent());
    const compacted = await first.compact(compactInput());
    const initialEvents = p.persistEvent.mock.calls.map(
      ([persisted]) => persisted,
    );
    const reopened = new StructuredEvolutionMemory({
      tenantId: "tenant-a",
      ...ports(),
      initialEvents,
      initialSnapshot: compacted.snapshot,
    });
    expect(reopened.projection()).toEqual(first.projection());
    expect(reopened.snapshot()).toEqual(compacted.snapshot);
  });

  it("rejects a substituted snapshot or snapshot/event lineage during hydration", async () => {
    const p = ports();
    const first = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await first.append(runtimeEvent());
    const compacted = await first.compact(compactInput());
    const initialEvents = p.persistEvent.mock.calls.map(
      ([persisted]) => persisted,
    );
    expect(
      () =>
        new StructuredEvolutionMemory({
          tenantId: "tenant-a",
          ...ports(),
          initialEvents,
          initialSnapshot: {
            ...compacted.snapshot,
            decisions: ["substituted"],
          },
        }),
    ).toThrow(/snapshot is invalid/);
    const unrelated = event({
      eventId: "other",
      memoryId: "other",
      contentDigest: digest("other"),
      artifactRef: "artifact://other",
    });
    expect(
      () =>
        new StructuredEvolutionMemory({
          tenantId: "tenant-a",
          ...ports(),
          initialEvents: [unrelated],
          initialSnapshot: compacted.snapshot,
        }),
    ).toThrow(/does not match event lineage/);
  });
});
