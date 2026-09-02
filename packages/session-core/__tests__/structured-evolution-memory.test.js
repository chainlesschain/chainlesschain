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
} = memory;

function digest(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

const actor = (role, actorType = "agent") => ({ actorId: `${role}-1`, actorType, role });

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
  return {
    persistEvent: vi.fn(async (value) => ({ persisted: true, eventId: value.eventId,
      eventDigest: hashEvent(value) })),
    persistSnapshot: vi.fn(async (value) => ({ persisted: true, snapshotDigest: value.snapshotDigest })),
    postCompactVerifier: vi.fn(async () => true),
    ...overrides,
  };
}

function authority(role = "producer", actorType = "agent", tenantId = "tenant-a") {
  return createStructuredMemoryAuthority({ tenantId, actorId: `${role}-runtime`, actorType, role,
    authorityDigest: digest(`authority:${role}:${tenantId}`) });
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
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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
  it("keeps episodic memory append-only and uses tombstones instead of overwrite", () => {
    const first = event();
    const duplicateMemory = event({ eventId: "event-2", sequence: 2, contentDigest: digest("changed") });
    expect(() => projectStructuredMemory([first, duplicateMemory])).toThrow(/silently overwrite/);
    const tombstone = event({ eventId: "event-2", sequence: 2, action: "tombstone",
      actor: actor("governor", "service"), automatic: false });
    const projected = projectStructuredMemory([first, tombstone]);
    expect(projected.memories).not.toHaveProperty("memory-1");
    expect(projected.tombstones["memory-1"].contentDigest).toBe(first.contentDigest);
  });

  it("queues child-agent semantic facts and requires critic, evaluator and governor to accept", () => {
    const proposal = event({ layer: "semantic", action: "propose", actor: actor("child-agent"),
      evidenceRefs: ["evidence://grader/1"] });
    const proposed = projectStructuredMemory([proposal]);
    expect(proposed.queue).toEqual(["memory-1"]);
    expect(proposed.memories["memory-1"].status).toBe("proposed");
    const accepted = event({ eventId: "event-2", sequence: 2, layer: "semantic", action: "accept",
      actor: actor("governor", "service"), receipts: { critic: digest("critic"), evaluator: digest("eval") },
      evidenceRefs: ["evidence://grader/1"] });
    const final = projectStructuredMemory([proposal, accepted]);
    expect(final.queue).toEqual([]);
    expect(final.memories["memory-1"].status).toBe("active");
    for (const invalid of [
      { actor: actor("proposer") },
      { receipts: { critic: digest("critic") } },
      { contentDigest: digest("substituted") },
      { evidenceRefs: ["evidence://substituted"] },
    ]) expect(() => projectStructuredMemory([proposal, { ...accepted, ...invalid }])).toThrow();
  });

  it("only lets promotion-controller receipts change procedural memory", () => {
    const valid = event({ layer: "procedural", action: "accept", actor: actor("promotion-controller", "service"),
      receipts: { promotion: digest("promotion") } });
    expect(projectStructuredMemory([valid]).memories["memory-1"].status).toBe("active");
    for (const invalid of [
      { actor: actor("child-agent") },
      { actor: actor("promotion-controller", "service"), receipts: {} },
      { action: "propose", actor: actor("proposer") },
    ]) expect(() => projectStructuredMemory([{ ...valid, ...invalid }])).toThrow(/promotion controller/);
  });

  it("never lets automatic experience overwrite policy memory", () => {
    const valid = event({ layer: "policy", action: "accept", automatic: false,
      actor: actor("governor", "human"), receipts: { policy: digest("policy-approval") } });
    expect(projectStructuredMemory([valid]).memories["memory-1"].layer).toBe("policy");
    for (const invalid of [
      { automatic: true },
      { actor: actor("governor", "service") },
      { actor: actor("child-agent"), action: "propose" },
    ]) expect(() => projectStructuredMemory([{ ...valid, ...invalid }])).toThrow();
  });

  it("rejects raw content, cross-tenant events, sequence gaps and conflicting replay", () => {
    expect(() => projectStructuredMemory([event({ metadata: { content: "secret" } })])).toThrow(/raw material/);
    expect(() => projectStructuredMemory([event(), event({ eventId: "event-2", sequence: 2, tenantId: "tenant-b" })])).toThrow(/cross-tenant/);
    expect(() => projectStructuredMemory([event({ sequence: 2 })])).toThrow(/contiguous/);
    expect(() => projectStructuredMemory([event(), event({ contentDigest: digest("other") })])).toThrow(/conflicting/);
    expect(() => projectStructuredMemory([event(), event({ eventId: "event-2", sequence: 2,
      layer: "procedural", action: "accept", actor: actor("promotion-controller", "service"),
      receipts: { promotion: digest("promotion") } })])).toThrow(/cross memory layers/);
  });

  it("replays identical events deterministically", () => {
    const input = [event(), event({ eventId: "event-2", sequence: 2, memoryId: "memory-2",
      contentDigest: digest("content-2"), artifactRef: "artifact://memory-2" })];
    expect(projectStructuredMemory([...input].reverse())).toEqual(projectStructuredMemory(input));
    expect(projectStructuredMemory([...input, structuredClone(input[0])])).toEqual(projectStructuredMemory(input));
  });

  it("rejects a caller-forged continuation state before applying an authorized-looking event", () => {
    const projected = projectStructuredMemory([event()]);
    const state = structuredClone(Object.fromEntries(Object.entries(projected).filter(([key]) => key !== "projectionDigest")));
    state.memories["memory-1"].layer = "semantic";
    const accepted = event({ eventId: "event-2", sequence: 2, layer: "semantic", action: "accept",
      actor: actor("governor", "service"), receipts: { critic: digest("critic"), evaluator: digest("eval") } });
    expect(() => projectStructuredMemory([accepted], { tenantId: "tenant-a", state,
      stateDigest: projected.projectionDigest })).toThrow(/not digest-bound/);
  });
});

describe("StructuredEvolutionMemory", () => {
  it("does not expose an event until durable persistence confirms its exact digest", async () => {
    const p = ports({ persistEvent: vi.fn(async () => ({ persisted: false })) });
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
    expect(result.snapshot).toMatchObject({ throughSequence: 1, requirements: compactInput().requirements,
      decisions: compactInput().decisions, memoryLineage: ["memory-1"] });
    expect(p.postCompactVerifier).toHaveBeenCalledWith(expect.objectContaining({ projection: store.projection() }));
    expect(p.persistSnapshot).toHaveBeenCalledTimes(1);
  });

  it("restores the previous snapshot when PostCompact verification fails", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await store.append(runtimeEvent());
    const first = await store.compact(compactInput());
    p.postCompactVerifier.mockResolvedValueOnce(false);
    const failed = await store.compact(compactInput({ decisions: ["unsafe replacement"] }));
    expect(failed).toEqual({ status: "restored", snapshot: first.snapshot,
      reason: "post-compact verification failed" });
    expect(store.snapshot()).toEqual(first.snapshot);
    expect(p.persistSnapshot).toHaveBeenCalledTimes(1);
  });

  it("restores the previous snapshot when snapshot persistence is unconfirmed", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await store.append(runtimeEvent());
    const first = await store.compact(compactInput());
    p.persistSnapshot.mockResolvedValueOnce({ persisted: false });
    const failed = await store.compact(compactInput({ openRisks: ["new risk"] }));
    expect(failed.status).toBe("restored");
    expect(store.snapshot()).toEqual(first.snapshot);
    p.persistSnapshot.mockRejectedValueOnce(new Error("storage unavailable"));
    const thrown = await store.compact(compactInput({ openRisks: ["storage error"] }));
    expect(thrown.status).toBe("restored");
    expect(store.snapshot()).toEqual(first.snapshot);
  });

  it("rejects forged and cross-tenant runtime role authorities before persistence", async () => {
    const p = ports();
    const store = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await expect(store.append(runtimeEvent({ authority: { tenantId: "tenant-a", actor: actor("governor") } })))
      .rejects.toThrow(/branded tenant-scoped/);
    await expect(store.append(runtimeEvent({ authority: authority("producer", "agent", "tenant-b") })))
      .rejects.toThrow(/branded tenant-scoped/);
    expect(p.persistEvent).not.toHaveBeenCalled();
  });

  it("hydrates deterministically from persisted events and a verified compaction snapshot", async () => {
    const p = ports();
    const first = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await first.append(runtimeEvent());
    const compacted = await first.compact(compactInput());
    const initialEvents = p.persistEvent.mock.calls.map(([persisted]) => persisted);
    const reopened = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...ports(),
      initialEvents, initialSnapshot: compacted.snapshot });
    expect(reopened.projection()).toEqual(first.projection());
    expect(reopened.snapshot()).toEqual(compacted.snapshot);
  });

  it("rejects a substituted snapshot or snapshot/event lineage during hydration", async () => {
    const p = ports();
    const first = new StructuredEvolutionMemory({ tenantId: "tenant-a", ...p });
    await first.append(runtimeEvent());
    const compacted = await first.compact(compactInput());
    const initialEvents = p.persistEvent.mock.calls.map(([persisted]) => persisted);
    expect(() => new StructuredEvolutionMemory({ tenantId: "tenant-a", ...ports(), initialEvents,
      initialSnapshot: { ...compacted.snapshot, decisions: ["substituted"] } })).toThrow(/snapshot is invalid/);
    const unrelated = event({ eventId: "other", memoryId: "other", contentDigest: digest("other"),
      artifactRef: "artifact://other" });
    expect(() => new StructuredEvolutionMemory({ tenantId: "tenant-a", ...ports(), initialEvents: [unrelated],
      initialSnapshot: compacted.snapshot })).toThrow(/does not match event lineage/);
  });
});
