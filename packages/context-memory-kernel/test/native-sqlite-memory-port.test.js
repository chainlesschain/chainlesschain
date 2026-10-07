"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve, sep } = require("node:path");
const Database = require("better-sqlite3");
const {
  NativeSqliteMemoryPort,
  ContextMemoryKernel,
  InMemoryProjectionPurgePort,
  InMemoryContentPort,
  canonicalDigest,
  createMemoryCandidate,
  applyMemoryCommand,
  normalizeMemoryRecord,
} = require("../lib/index.js");
const { proposal, CLOCK } = require("./helpers.js");

const SCOPE = { scope: "project", scopeId: "store-alice-project-goal" };
function fixture(t, { file = ":memory:", ...options } = {}) {
  const db = new Database(file);
  t.after(() => {
    if (db.open) db.close();
  });
  const port = new NativeSqliteMemoryPort({
    db,
    scope: SCOPE,
    authorize: () => ({ allowed: true }),
    ...options,
  });
  const kernel = new ContextMemoryKernel({
    memoryPort: port,
    reconciliationPort: port,
    clock: CLOCK,
  });
  return { db, port, kernel };
}
function input(overrides = {}) {
  return proposal({ ...SCOPE, ...overrides });
}
function deletion(record, overrides = {}) {
  return {
    requestId: "delete-1",
    subject: "alice",
    ...SCOPE,
    selector: `memory:${record.memoryId}`,
    memoryId: record.memoryId,
    expectedRevision: record.revision,
    fence: "fence-1",
    authority: "host",
    ...overrides,
  };
}
function initialMutation(overrides = {}) {
  const record = createMemoryCandidate(input(overrides), { clock: CLOCK });
  const event = {
    schema: "chainlesschain.memory-event/v1",
    eventId: `event-${record.memoryId}`,
    type: "memory.activated",
    memoryId: record.memoryId,
    fromState: null,
    toState: "active",
    previousRevision: 0,
    revision: 1,
    recordDigest: record.digest,
    at: record.updatedAt,
  };
  event.digest = canonicalDigest(event, event.schema);
  return { record, event };
}
function redigest(event) {
  delete event.digest;
  event.digest = canonicalDigest(event, event.schema);
}

test("native records, scoped revisions and precise events survive reopen", async (t) => {
  const root = resolve(tmpdir());
  const dir = mkdtempSync(join(root, "kernel-native-memory-"));
  t.after(() => {
    const target = resolve(dir);
    assert.ok(target.startsWith(root + sep) && target !== root);
    rmSync(target, { recursive: true, force: true });
  });
  const file = join(dir, "memory.db");
  const first = fixture(t, { file });
  const old = await first.kernel.proposeMemory(input());
  const corrected = await first.kernel.proposeMemory(
    input({ memoryId: "corrected", content: "Use native persistence" }),
  );
  await first.kernel.decideMemory({
    memoryId: old.record.memoryId,
    expectedRevision: 1,
    type: "supersede",
    successorMemoryId: corrected.record.memoryId,
    authority: "host",
    reason: "Sensitive old wording",
  });
  first.db.close();
  const second = fixture(t, { file });
  assert.equal(second.port.getRevision(), 3);
  assert.equal(second.port.read(old.record.memoryId).state, "superseded");
  const event = second.port.readEvent(old.record.memoryId, 2);
  assert.equal(event.successorMemoryId, "corrected");
  assert.equal(event.reason, undefined);
  assert.equal(second.port.readEvent(old.record.memoryId, 3), null);
  assert.equal(second.port.read("missing"), null);
  assert.ok(event.eventDigest.startsWith("sha256:"));
  assert.equal(second.port.query({ scopeAdmissions: [SCOPE] }).length, 2);
  second.db.close();
});

test("scope binding rejects expansion and isolates identical memory IDs", async (t) => {
  const { db, port, kernel } = fixture(t);
  await kernel.proposeMemory(input());
  const other = new NativeSqliteMemoryPort({
    db,
    scope: { ...SCOPE, scopeId: "other-owner" },
    authorize: () => ({ allowed: true }),
  });
  assert.equal(other.read("memory-1"), null);
  assert.equal(other.getRevision(), 0);
  assert.equal(other.readEvent("memory-1", 1), null);
  assert.throws(() => port.query({ scopeAdmissions: [SCOPE, other.scope] }), {
    code: "scope_denied",
  });
  assert.throws(() => other.commit(initialMutation()), {
    code: "scope_denied",
  });
  assert.throws(
    () =>
      new NativeSqliteMemoryPort({
        db,
        scope: { scope: "global" },
        authorize: () => ({ allowed: true }),
      }),
  );
  assert.throws(() => {
    port.scope.scopeId = "other-owner";
  });
});

test("every public operation requires explicit synchronous authorization", async (t) => {
  let decision = { allowed: true };
  const { port, kernel } = fixture(t, { authorize: () => decision });
  await kernel.proposeMemory(input());
  const mutation = initialMutation({ memoryId: "another" });
  for (const denied of [
    false,
    true,
    undefined,
    {},
    { allowed: 1 },
    Promise.resolve({ allowed: true }),
  ]) {
    decision = denied;
    for (const operation of [
      () => port.read("memory-1"),
      () => port.readEvent("memory-1", 1),
      () => port.query(),
      () => port.getRevision(),
      () => port.commit(mutation),
      () => port.getReconciliation("delete-1"),
      () => port.putReconciliation({ requestId: "delete-1" }),
    ])
      assert.throws(operation, { code: "scope_denied" });
  }
  decision = { allowed: true };
  assert.equal(port.read("another"), null);
  assert.equal(port.getRevision(), 1);
});

test("CAS, duplicate events and reducer lineage roll back atomically", async (t) => {
  const { db, port, kernel } = fixture(t);
  const original = await kernel.proposeMemory(input());
  const mutation = applyMemoryCommand(
    original.record,
    { type: "reinforce", expectedRevision: 1, confidenceDelta: 0.02 },
    { clock: CLOCK },
  );
  const rival = new NativeSqliteMemoryPort({
    db,
    scope: SCOPE,
    authorize: () => ({ allowed: true }),
  });
  assert.equal(rival.commit(mutation, 1).ok, true);
  assert.deepEqual(port.commit(mutation, 1), {
    ok: false,
    currentRevision: 2,
    storeRevision: 2,
  });
  const bad = applyMemoryCommand(
    port.read("memory-1"),
    { type: "archive", expectedRevision: 2 },
    { clock: CLOCK },
  );
  bad.event.previousRevision = 1;
  redigest(bad.event);
  assert.throws(() => port.commit(bad, 2), /lineage/);
  const changed = applyMemoryCommand(
    port.read("memory-1"),
    { type: "archive", expectedRevision: 2 },
    { clock: CLOCK },
  );
  changed.record = normalizeMemoryRecord({
    ...changed.record,
    content: "Unauthorized body rewrite",
    digest: undefined,
  });
  changed.event.recordDigest = changed.record.digest;
  redigest(changed.event);
  assert.throws(() => port.commit(changed, 2), /reducer/);
  const duplicate = initialMutation({ memoryId: "another" });
  duplicate.event.eventId = original.event.eventId;
  redigest(duplicate.event);
  assert.throws(() => port.commit(duplicate), /UNIQUE/);
  assert.equal(port.read("another"), null);
  assert.equal(port.getRevision(), 2);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM context_memory_sqlite_events").get()
      .n,
    2,
  );
});

test("host native transaction can synchronously read and atomically roll back nested writes", (t) => {
  const { db, port } = fixture(t);
  assert.throws(
    () =>
      db
        .transaction(() => {
          port.commit(initialMutation());
          assert.equal(port.read("memory-1").revision, 1);
          assert.equal(port.readEvent("memory-1", 1).revision, 1);
          throw new Error("host rollback");
        })
        .immediate(),
    /host rollback/,
  );
  assert.equal(port.read("memory-1"), null);
  assert.equal(port.getRevision(), 0);
});

test("query bound fails closed while exact read stays available", async (t) => {
  const { port, kernel } = fixture(t, { maxQueryRecords: 1 });
  await kernel.proposeMemory(input());
  await kernel.proposeMemory(input({ memoryId: "another" }));
  assert.throws(() => port.query(), {
    code: "native_sqlite_memory_query_limit",
  });
  assert.equal(port.read("another").memoryId, "another");
});

test("deletion erases canonical content, retains fencing and seals exact replay receipt", async (t) => {
  const { db, port, kernel } = fixture(t);
  const body = "Private phrase that must leave all logical memory rows";
  const { record } = await kernel.proposeMemory(input({ content: body }));
  const request = deletion(record, { reason: body });
  const receipt = await kernel.deleteMemory(request);
  assert.equal(receipt.status, "purged");
  assert.deepEqual(await kernel.deleteMemory(request), receipt);
  assert.deepEqual(await kernel.reconcile(request.requestId), receipt);
  assert.equal(port.read(record.memoryId).content, "");
  assert.equal(port.read(record.memoryId).deletionFence, request.fence);
  for (const [table, column] of [
    ["context_memory_sqlite_records", "record_json"],
    ["context_memory_sqlite_events", "event_json"],
    ["context_memory_sqlite_reconciliations", "operation_json"],
  ])
    assert.equal(
      db
        .prepare(`SELECT ${column} AS value FROM ${table}`)
        .all()
        .some((row) => row.value.includes(body)),
      false,
    );
  assert.equal(port.commit(initialMutation(), 0).ok, false);
  const resurrect = initialMutation();
  resurrect.record = normalizeMemoryRecord({
    ...resurrect.record,
    revision: 4,
    digest: undefined,
  });
  resurrect.event = {
    ...resurrect.event,
    type: "memory.active",
    fromState: "purged",
    previousRevision: 3,
    revision: 4,
    recordDigest: resurrect.record.digest,
  };
  redigest(resurrect.event);
  assert.throws(() => port.commit(resurrect, 3), {
    code: "illegal_memory_transition",
  });
  const other = new NativeSqliteMemoryPort({
    db,
    scope: { ...SCOPE, scopeId: "other" },
    authorize: () => ({ allowed: true }),
  });
  assert.equal(other.getReconciliation(request.requestId), null);
  const forged = structuredClone(port.getReconciliation(request.requestId));
  forged.receipt.completedAt = "2026-10-01T00:00:00.000Z";
  const { digest, ...unsigned } = forged.receipt;
  forged.receipt.digest = canonicalDigest(
    unsigned,
    "chainlesschain.memory-deletion-receipt/v1",
  );
  assert.throws(() => port.putReconciliation(forged), /immutable/);
});

test("failed purge recovery persists its tombstone and rejects forged completion or rebinding", async (t) => {
  const { db, port } = fixture(t);
  const purge = new InMemoryProjectionPurgePort("search-index");
  purge.failWith(new Error("offline"));
  const kernel = new ContextMemoryKernel({
    memoryPort: port,
    reconciliationPort: port,
    purgePorts: [purge],
    clock: CLOCK,
  });
  const { record } = await kernel.proposeMemory(input());
  const request = deletion(record);
  assert.equal((await kernel.deleteMemory(request)).status, "partial");
  const pending = port.getReconciliation(request.requestId);
  assert.equal(pending.state, "purge_pending");
  assert.throws(
    () => port.putReconciliation({ ...pending, state: "purged" }),
    /state/,
  );
  assert.throws(
    () => port.putReconciliation({ ...pending, subject: "bob" }),
    /binding/,
  );
  assert.throws(
    () => port.putReconciliation({ ...pending, requestId: "new-request" }),
    /tombstone commit/,
  );
  const recoveredPort = new NativeSqliteMemoryPort({
    db,
    scope: SCOPE,
    authorize: () => ({ allowed: true }),
  });
  const recovered = new ContextMemoryKernel({
    memoryPort: recoveredPort,
    reconciliationPort: recoveredPort,
    purgePorts: [purge],
    clock: CLOCK,
  });
  const receipt = await recovered.reconcile(request.requestId);
  assert.equal(receipt.status, "purged");
  assert.equal(receipt.stores[1].receipt.fence, request.fence);
  assert.equal(
    recoveredPort.getReconciliation(request.requestId).evidenceRefs,
    undefined,
  );
});

test("tampered canonical record, event and reconciliation JSON fail digest validation", async (t) => {
  const { db, port, kernel } = fixture(t);
  const { record } = await kernel.proposeMemory(input());
  const row = db.prepare("SELECT * FROM context_memory_sqlite_records").get();
  const changed = JSON.parse(row.record_json);
  changed.content = "tampered";
  db.prepare("UPDATE context_memory_sqlite_records SET record_json=?").run(
    JSON.stringify(changed),
  );
  assert.throws(() => port.read(record.memoryId), { code: "digest_mismatch" });
  db.prepare("UPDATE context_memory_sqlite_records SET record_json=?").run(
    row.record_json,
  );
  const event = JSON.parse(
    db.prepare("SELECT event_json FROM context_memory_sqlite_events").get()
      .event_json,
  );
  event.successorMemoryId = "tampered-successor";
  db.prepare("UPDATE context_memory_sqlite_events SET event_json=?").run(
    JSON.stringify(event),
  );
  assert.throws(() => port.readEvent(record.memoryId, 1), {
    code: "digest_mismatch",
  });
  await kernel.deleteMemory(deletion(record));
  const operation = port.getReconciliation("delete-1");
  operation.subject = "bob";
  db.prepare(
    "UPDATE context_memory_sqlite_reconciliations SET operation_json=?",
  ).run(JSON.stringify(operation));
  assert.throws(() => port.getReconciliation("delete-1"), {
    code: "digest_mismatch",
  });
});

test("invalid reconciliation makes the entire tombstone commit roll back", async (t) => {
  const { port, kernel } = fixture(t);
  const { record } = await kernel.proposeMemory(input());
  const mutation = applyMemoryCommand(
    record,
    { type: "delete", expectedRevision: 1, deletionFence: "fence-1" },
    { clock: CLOCK },
  );
  assert.throws(() =>
    port.commit(
      {
        ...mutation,
        reconciliation: {
          ...deletion(record),
          state: "tombstoned",
          startedAt: record.createdAt,
          stores: [],
          evidenceRefs: [],
        },
      },
      1,
    ),
  );
  assert.equal(port.read(record.memoryId).state, "active");
  assert.equal(port.getRevision(), 1);
  assert.equal(port.readEvent(record.memoryId, 2), null);
});

test("content purge retries keep real acknowledgments and erase sealed references", async (t) => {
  const { port } = fixture(t);
  const content = new InMemoryContentPort();
  const contentRef = await content.put("externally stored body", {
    summary: "external source",
  });
  const index = new InMemoryProjectionPurgePort("index");
  index.failWith(new Error("index unavailable"));
  const kernel = new ContextMemoryKernel({
    memoryPort: port,
    reconciliationPort: port,
    contentPort: content,
    purgePorts: [index],
    clock: CLOCK,
  });
  const { record } = await kernel.proposeMemory(input({ contentRef }));
  const request = deletion(record);
  const partial = await kernel.deleteMemory(request);
  assert.equal(partial.status, "partial");
  assert.equal(partial.stores[1].receipt.existed, true);
  assert.deepEqual(
    port.getReconciliation(request.requestId).contentRef,
    contentRef,
  );
  const complete = await kernel.reconcile(request.requestId);
  assert.equal(complete.status, "purged");
  assert.equal(complete.stores[1].receipt.existed, false);
  assert.equal(port.getReconciliation(request.requestId).contentRef, undefined);
});

test("native driver enforces legal hold even for direct reducer commits", async (t) => {
  const { port, kernel } = fixture(t);
  const { record } = await kernel.proposeMemory(
    input({ retentionPolicy: { mode: "legal_hold", legalHoldId: "hold-1" } }),
  );
  const mutation = applyMemoryCommand(
    record,
    { type: "delete", expectedRevision: 1, deletionFence: "fence-1" },
    { clock: CLOCK },
  );
  assert.throws(() => port.commit(mutation, 1), { code: "scope_denied" });
  assert.equal(port.read(record.memoryId).state, "active");
});

test("independent SQLite connections fence stale writes and reopen pending deletion", async (t) => {
  const root = resolve(tmpdir());
  const dir = mkdtempSync(join(root, "kernel-native-recovery-"));
  t.after(() => {
    const target = resolve(dir);
    assert.ok(target.startsWith(root + sep) && target !== root);
    rmSync(target, { recursive: true, force: true });
  });
  const file = join(dir, "memory.db");
  const first = fixture(t, { file });
  const { record } = await first.kernel.proposeMemory(input());
  const stale = applyMemoryCommand(
    record,
    { type: "archive", expectedRevision: 1 },
    { clock: CLOCK },
  );
  const second = fixture(t, { file });
  await second.kernel.decideMemory({
    memoryId: record.memoryId,
    type: "reinforce",
    expectedRevision: 1,
  });
  assert.equal(first.port.commit(stale, 1).ok, false);
  const purge = new InMemoryProjectionPurgePort("index");
  purge.failWith(new Error("temporarily unavailable"));
  const deleting = new ContextMemoryKernel({
    memoryPort: first.port,
    reconciliationPort: first.port,
    purgePorts: [purge],
    clock: CLOCK,
  });
  assert.equal(
    (await deleting.deleteMemory(deletion(first.port.read(record.memoryId))))
      .status,
    "partial",
  );
  first.db.close();
  second.db.close();
  const reopened = fixture(t, { file });
  assert.equal(reopened.port.read(record.memoryId).state, "deleted");
  assert.equal(
    reopened.port.getReconciliation("delete-1").state,
    "purge_pending",
  );
  const recovering = new ContextMemoryKernel({
    memoryPort: reopened.port,
    reconciliationPort: reopened.port,
    purgePorts: [purge],
    clock: CLOCK,
  });
  assert.equal((await recovering.reconcile("delete-1")).status, "purged");
  reopened.db.close();
});
