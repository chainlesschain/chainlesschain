"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ContextMemoryKernel,
  ContextMemoryAuthorityRegistry,
  InMemoryMemoryPort,
  InMemoryProjectionPurgePort,
  createMemoryCandidate,
  applyMemoryCommand,
  mergeReplicaRecord,
} = require("../lib/index.js");
const { AT, CLOCK, proposal } = require("./helpers.js");

function deletionRequest(overrides = {}) {
  return {
    requestId: "delete-1",
    subject: "user-1",
    scope: "user",
    scopeId: "user-1",
    selector: "memory:memory-1",
    memoryId: "memory-1",
    expectedRevision: 1,
    fence: "delete-fence-1",
    authority: "user-1",
    ...overrides,
  };
}

test("memory proposal, recall, tombstone, purge, and idempotent receipt use revisions", async () => {
  let uuid = 0;
  const memory = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({
    memoryPort: memory,
    clock: CLOCK,
    randomUUID: () => `id-${++uuid}`,
  });
  const proposed = await kernel.proposeMemory(proposal());
  assert.equal(proposed.record.state, "active");
  const recalled = await kernel.recallMemory({
    query: "deterministic tests",
    sink: "provider.local",
    scopeAdmissions: [{ scope: "user", scopeId: "user-1" }],
    limit: 10,
    tokenBudget: 1000,
    now: AT,
  });
  assert.deepEqual(recalled.results.map((entry) => entry.memoryId), ["memory-1"]);
  const deleted = await kernel.deleteMemory(deletionRequest());
  assert.equal(deleted.status, "purged");
  assert.equal(deleted.recordState, "purged");
  assert.equal(deleted.stores[0].status, "purged");
  assert.deepEqual(await kernel.deleteMemory(deletionRequest()), deleted);
  assert.deepEqual(await kernel.reconcile("delete-1"), deleted);
});

test("wildcard recall lists active records without weakening scope admission", async () => {
  const memory = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({ memoryPort: memory, clock: CLOCK });
  await kernel.proposeMemory(proposal());
  const allowed = await kernel.recallMemory({
    query: "*",
    sink: "provider.local",
    scopeAdmissions: [{ scope: "user", scopeId: "user-1" }],
  });
  assert.deepEqual(allowed.results.map((entry) => entry.memoryId), ["memory-1"]);
  const denied = await kernel.recallMemory({
    query: "*",
    sink: "provider.local",
    scopeAdmissions: [{ scope: "user", scopeId: "other-user" }],
  });
  assert.equal(denied.results.length, 0);
});

test("partial deletion remains tombstoned across Kernel restart until reconciliation", async () => {
  const memory = new InMemoryMemoryPort();
  const projection = new InMemoryProjectionPurgePort("search-index");
  projection.failWith(Object.assign(new Error("offline"), { code: "index_offline" }));
  const first = new ContextMemoryKernel({ memoryPort: memory, purgePorts: [projection], clock: CLOCK });
  await first.proposeMemory(proposal());
  const partial = await first.deleteMemory(deletionRequest());
  assert.equal(partial.status, "partial");
  assert.equal((await memory.read("memory-1")).state, "deleted");

  const second = new ContextMemoryKernel({ memoryPort: memory, purgePorts: [projection], clock: CLOCK });
  const completed = await second.reconcile("delete-1");
  assert.equal(completed.status, "purged");
  assert.equal((await memory.read("memory-1")).state, "purged");
});

test("legal hold, wrong scope, stale revision, and illegal transition fail closed", async () => {
  const legal = new InMemoryMemoryPort([
    createMemoryCandidate(
      proposal({ retentionPolicy: { mode: "legal_hold", legalHoldId: "hold-1" } }),
    ),
  ]);
  const kernel = new ContextMemoryKernel({ memoryPort: legal, clock: CLOCK });
  await assert.rejects(kernel.deleteMemory(deletionRequest()), /legal hold/u);
  await assert.rejects(
    kernel.deleteMemory(deletionRequest({ scope: "project", scopeId: "project-1" })),
    { code: "scope_denied" },
  );
  const record = createMemoryCandidate(proposal());
  assert.throws(
    () => applyMemoryCommand(record, { type: "archive", expectedRevision: 99 }, { clock: CLOCK }),
    { code: "revision_conflict" },
  );
  const deleted = applyMemoryCommand(
    record,
    {
      type: "delete",
      expectedRevision: 1,
      deletionFence: "fence-1",
      authority: "user-1",
    },
    { clock: CLOCK },
  ).record;
  assert.throws(
    () => applyMemoryCommand(deleted, { type: "activate", expectedRevision: 2 }, { clock: CLOCK }),
    { code: "illegal_memory_transition" },
  );
});

test("tombstone fencing rejects offline replica resurrection", () => {
  const active = createMemoryCandidate(proposal());
  const deleted = applyMemoryCommand(
    active,
    {
      type: "delete",
      expectedRevision: 1,
      deletionFence: "fence-1",
      authority: "user-1",
    },
    { clock: CLOCK },
  ).record;
  const staleReplica = createMemoryCandidate(proposal());
  assert.throws(() => mergeReplicaRecord(deleted, staleReplica), {
    code: "replica_tombstone_fenced",
  });
});

test("authority registry fences shadow, stale, expired, and retired writers", () => {
  let now = Date.parse(AT);
  const registry = new ContextMemoryAuthorityRegistry({ clock: () => now });
  registry.bind({
    scopeKey: "cli:session-1",
    surface: "cli",
    mode: "legacy",
    stage: "inventory",
    writerId: "legacy-writer",
    generation: 1,
  });
  registry.bind({
    scopeKey: "cli:session-1",
    surface: "cli",
    mode: "legacy",
    stage: "shadow",
    writerId: "legacy-writer",
    generation: 2,
  });
  registry.bind({
    scopeKey: "cli:session-1",
    surface: "cli",
    mode: "canonical",
    stage: "internal_canary",
    writerId: "canonical-writer",
    generation: 3,
    leaseExpiresAt: "2026-08-29T00:10:00.000Z",
  });
  const writer = {
    scopeKey: "cli:session-1",
    surface: "cli",
    mode: "canonical",
    writerId: "canonical-writer",
    generation: 3,
  };
  assert.equal(registry.assertWriter(writer).writerId, "canonical-writer");
  assert.throws(() => registry.assertWriter({ ...writer, generation: 2 }), {
    code: "legacy_writer_fenced",
  });
  now = Date.parse("2026-08-29T00:11:00.000Z");
  assert.throws(() => registry.assertWriter(writer), { code: "legacy_writer_fenced" });

  now = Date.parse(AT);
  registry.bind({
    ...writer,
    stage: "opt_in_canary",
    generation: 4,
    leaseExpiresAt: "2026-08-29T00:20:00.000Z",
  });
  registry.bind({
    ...writer,
    stage: "canonical_default",
    generation: 5,
    leaseExpiresAt: "2026-08-29T00:20:00.000Z",
  });
  registry.bind({
    ...writer,
    stage: "legacy_read_only",
    generation: 6,
    leaseExpiresAt: "2026-08-29T00:20:00.000Z",
  });
  assert.equal(
    registry.assertWriter({ ...writer, generation: 6 }).stage,
    "legacy_read_only",
  );
});
