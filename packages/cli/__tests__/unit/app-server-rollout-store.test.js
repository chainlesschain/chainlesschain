import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ROLLOUT_STORE_METHODS,
  JsonlRolloutStore,
  MemoryRolloutStore,
  assertRolloutStore,
  migrateRolloutStore,
} from "../../src/lib/app-server/rollout-store.js";
import {
  SqliteRolloutStore,
  sqliteRolloutStoreAvailable,
} from "../../src/lib/app-server/sqlite-rollout-store.js";
import {
  closeRolloutStore,
  createRolloutStore,
  ROLLOUT_STORE_ENV,
  ROLLOUT_STORE_PATH_ENV,
} from "../../src/lib/app-server/rollout-store-factory.js";

const temporary = [];
const originalBackend = process.env.CHAINLESSCHAIN_ROLLOUT_STORE;
const originalPath = process.env.CHAINLESSCHAIN_ROLLOUT_STORE_PATH;

afterEach(() => {
  if (originalBackend === undefined) delete process.env[ROLLOUT_STORE_ENV];
  else process.env[ROLLOUT_STORE_ENV] = originalBackend;
  if (originalPath === undefined) delete process.env[ROLLOUT_STORE_PATH_ENV];
  else process.env[ROLLOUT_STORE_PATH_ENV] = originalPath;
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rollout-"));
  temporary.push(directory);
  return directory;
}

const implementations = [
  ["memory", () => new MemoryRolloutStore({ now: () => 1_700_000_000_000 })],
];
if (sqliteRolloutStoreAvailable()) {
  implementations.push([
    "sqlite",
    () =>
      new SqliteRolloutStore({
        filename: ":memory:",
        now: () => 1_700_000_000_000,
      }),
  ]);
} else {
  it("reports a stable capability error when node:sqlite is unavailable", () => {
    expect(() => new SqliteRolloutStore()).toThrowError(
      expect.objectContaining({ code: "CC_ROLLOUT_SQLITE_UNAVAILABLE" }),
    );
  });
}
implementations.push([
  "jsonl",
  () =>
    new JsonlRolloutStore({
      directory: createDirectory(),
      now: () => 1_700_000_000_000,
    }),
]);

for (const [name, createStore] of implementations) {
  describe(`App Server rollout store (${name})`, () => {
    it("supports the complete canonical logical contract", () => {
      const store = createStore();
      expect(assertRolloutStore(store)).toBe(store);
      expect(ROLLOUT_STORE_METHODS.every((method) => method in store)).toBe(
        true,
      );
      const thread = store.start({
        threadId: "thread-1",
        title: "Canonical",
        metadata: { provider: "fake" },
      });
      expect(thread).toMatchObject({ id: "thread-1", revision: 1 });

      const first = store.append({
        threadId: thread.id,
        turnId: "turn-1",
        itemId: "item-1",
        eventType: "turn.started",
        toolUseId: "tool-1",
        approvalId: "approval-1",
        traceId: "trace-1",
        parentId: "parent-1",
        idempotencyKey: "turn-start-1",
        payload: { status: "running" },
      });
      const replay = store.append({
        threadId: thread.id,
        turnId: "turn-1",
        itemId: "item-1",
        eventType: "turn.started",
        toolUseId: "tool-1",
        approvalId: "approval-1",
        traceId: "trace-1",
        parentId: "parent-1",
        idempotencyKey: "turn-start-1",
        payload: { status: "running" },
      });
      expect(replay).toEqual(first);
      expect(first).toMatchObject({
        schema_version: 1,
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        event_seq: 2,
        tool_use_id: "tool-1",
        approval_id: "approval-1",
        trace_id: "trace-1",
        parent_id: "parent-1",
        timestamp: expect.any(String),
      });
      expect(store.read(thread.id)).toHaveLength(2);
      expect(store.resume(thread.id)).toMatchObject({
        status: "active",
        revision: 2,
        headHash: expect.stringMatching(/^sha256:/),
      });

      store.checkpoint(thread.id, {
        idempotencyKey: "checkpoint-1",
        frontier: ["node-a"],
      });
      store.compact(thread.id, {
        idempotencyKey: "compact-1",
        summary: "Retained pending approval and frontier",
        retainedState: { pendingApproval: "approval-1" },
      });
      const forkedThread = store.fork(thread.id, {
        threadId: "thread-2",
      });
      expect(forkedThread).toMatchObject({
        id: "thread-2",
        parentThreadId: "thread-1",
      });
      expect(store.read(forkedThread.id).at(-1).payload).toMatchObject({
        sourceThreadId: "thread-1",
        sourceHeadHash: expect.stringMatching(/^sha256:/),
      });

      expect(store.archive(thread.id).status).toBe("archived");
      expect(store.list()).toEqual([
        expect.objectContaining({ id: "thread-2" }),
      ]);
      expect(store.list({ includeArchived: true })).toHaveLength(2);
      expect(store.migrate({ fromVersion: 1, toVersion: 1 })).toMatchObject({
        fromVersion: 1,
        toVersion: 1,
        changes: 0,
      });
    }, 15_000);

    it("rejects idempotency drift", () => {
      const store = createStore();
      store.start({ threadId: "thread-drift" });
      store.append({
        threadId: "thread-drift",
        eventType: "item.delta",
        idempotencyKey: "delta-1",
        payload: { text: "a" },
      });
      expect(() =>
        store.append({
          threadId: "thread-drift",
          eventType: "item.delta",
          idempotencyKey: "delta-1",
          payload: { text: "b" },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_IDEMPOTENCY_CONFLICT" }),
      );
    });

    it("enforces head CAS and compaction invariants", () => {
      const store = createStore();
      const thread = store.start({ threadId: "thread-cas" });
      expect(() =>
        store.append({
          threadId: thread.id,
          eventType: "item.delta",
          expectedRevision: 99,
          expectedHeadHash: "sha256:wrong",
          payload: {},
        }),
      ).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_HEAD_CONFLICT" }),
      );
      expect(() => store.compact(thread.id, { summary: "" })).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_INVALID_ARGUMENT" }),
      );
      expect(() => store.compact(thread.id, { summary: 42 })).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_INVALID_ARGUMENT" }),
      );
      expect(() =>
        store.migrate({ fromVersion: 0, toVersion: 1 }),
      ).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_MIGRATION_UNSUPPORTED" }),
      );
      expect(() =>
        store.migrate({ fromVersion: "invalid", toVersion: 1 }),
      ).toThrowError(
        expect.objectContaining({ code: "CC_ROLLOUT_MIGRATION_UNSUPPORTED" }),
      );
    }, 15_000);
  });
}

it("migrates an identical hash chain between physical adapters and resumes", () => {
  const source = new MemoryRolloutStore({ now: () => 1_700_000_000_000 });
  const directory = createDirectory();
  const target = new JsonlRolloutStore({ directory });
  source.start({
    threadId: "thread-migrate",
    title: "Migration",
    metadata: { physical: "memory" },
  });
  source.append({
    threadId: "thread-migrate",
    turnId: "turn-migrate",
    eventType: "turn.started",
    idempotencyKey: "migration-turn",
    payload: { status: "running" },
  });
  source.checkpoint("thread-migrate", {
    idempotencyKey: "migration-checkpoint",
    messages: [{ role: "user", content: "resume me" }],
  });

  expect(
    migrateRolloutStore({ sourceStore: source, targetStore: target }),
  ).toMatchObject({
    dryRun: true,
    threads: 1,
    events: 3,
    copiedEvents: 3,
  });
  expect(() => target.resume("thread-migrate")).toThrowError(
    expect.objectContaining({ code: "CC_ROLLOUT_THREAD_NOT_FOUND" }),
  );

  expect(source.migrate({ targetStore: target, dryRun: false })).toMatchObject({
    copiedEvents: 3,
    alreadyPresent: 0,
  });
  expect(target.read("thread-migrate")).toEqual(source.read("thread-migrate"));
  expect(target.resume("thread-migrate")).toEqual(
    source.resume("thread-migrate"),
  );
  expect(source.migrate({ targetStore: target, dryRun: false })).toMatchObject({
    copiedEvents: 0,
    alreadyPresent: 3,
  });
}, 30_000);

it("restarts from a verified target prefix and refuses a divergent target", () => {
  const now = () => 1_700_000_000_000;
  const source = new MemoryRolloutStore({ now });
  source.start({ threadId: "thread-prefix", title: "Prefix" });
  source.append({
    threadId: "thread-prefix",
    eventType: "turn.started",
    payload: { status: "running" },
  });

  const partial = new MemoryRolloutStore({ now });
  partial.start({ threadId: "thread-prefix", title: "Prefix" });
  expect(source.migrate({ targetStore: partial, dryRun: false })).toMatchObject(
    { copiedEvents: 1, alreadyPresent: 1 },
  );
  expect(partial.read("thread-prefix")).toEqual(source.read("thread-prefix"));

  const divergent = new MemoryRolloutStore({ now });
  divergent.start({ threadId: "thread-prefix", title: "Prefix" });
  divergent.append({
    threadId: "thread-prefix",
    eventType: "turn.started",
    payload: { status: "different" },
  });
  expect(() =>
    source.migrate({ targetStore: divergent, dryRun: false }),
  ).toThrowError(
    expect.objectContaining({ code: "CC_ROLLOUT_MIGRATION_CONFLICT" }),
  );
});

if (sqliteRolloutStoreAvailable()) {
  it("round-trips canonical hashes between JSONL and SQLite", () => {
    const root = createDirectory();
    const source = createRolloutStore({
      backend: "jsonl",
      directory: path.join(root, "jsonl"),
      now: () => 1_700_000_000_000,
    });
    const sqlite = createRolloutStore({
      backend: "sqlite",
      filename: path.join(root, "rollouts.sqlite"),
    });
    const roundTrip = createRolloutStore({
      backend: "jsonl",
      directory: path.join(root, "round-trip"),
    });
    try {
      source.start({ threadId: "thread-round-trip" });
      source.checkpoint("thread-round-trip", {
        idempotencyKey: "round-trip-checkpoint",
        state: { pending: true },
      });
      source.migrate({ targetStore: sqlite, dryRun: false });
      sqlite.migrate({ targetStore: roundTrip, dryRun: false });
      expect(roundTrip.read("thread-round-trip")).toEqual(
        source.read("thread-round-trip"),
      );
    } finally {
      closeRolloutStore(sqlite);
    }
  }, 30_000);
}

it("creates selectable JSONL and SQLite production adapters", () => {
  const directory = createDirectory();
  const jsonl = createRolloutStore({ backend: "jsonl", directory });
  expect(jsonl).toMatchObject({ backend: "jsonl" });
  jsonl.start({ threadId: "factory-jsonl" });

  if (sqliteRolloutStoreAvailable()) {
    const sqlite = createRolloutStore({ backend: "sqlite", directory });
    try {
      expect(sqlite).toMatchObject({ backend: "sqlite" });
      sqlite.start({ threadId: "factory-sqlite" });
      expect(sqlite.resume("factory-sqlite").id).toBe("factory-sqlite");
    } finally {
      closeRolloutStore(sqlite);
    }
  }
}, 15_000);

it("honors host environment selection and validates custom adapters", () => {
  const directory = path.join(createDirectory(), "from-env");
  process.env[ROLLOUT_STORE_ENV] = "jsonl";
  process.env[ROLLOUT_STORE_PATH_ENV] = directory;
  const selected = createRolloutStore();
  expect(selected).toMatchObject({
    backend: "jsonl",
    location: path.resolve(directory),
  });

  const remoteSeam = new MemoryRolloutStore();
  expect(createRolloutStore({ adapter: remoteSeam })).toMatchObject({
    backend: "custom",
  });
  const explicitIdRemoteSeam = Object.fromEntries(
    ROLLOUT_STORE_METHODS.map((method) => [
      method,
      remoteSeam[method].bind(remoteSeam),
    ]),
  );
  expect(createRolloutStore({ adapter: explicitIdRemoteSeam })).toMatchObject({
    backend: "custom",
  });
  const frozenRemoteSeam = Object.freeze({ ...explicitIdRemoteSeam });
  expect(createRolloutStore({ adapter: frozenRemoteSeam })).toBe(
    frozenRemoteSeam,
  );
  expect(() => createRolloutStore({ adapter: {} })).toThrowError(
    expect.objectContaining({ code: "CC_ROLLOUT_ADAPTER_INVALID" }),
  );
});

it("JSONL adapter detects a mutated hash-chained event", () => {
  const directory = createDirectory();
  const store = new JsonlRolloutStore({ directory });
  store.start({ threadId: "thread-tamper" });
  store.append({
    threadId: "thread-tamper",
    eventType: "turn.started",
    payload: { status: "running" },
  });
  const [file] = fs.readdirSync(directory);
  const filePath = path.join(directory, file);
  fs.writeFileSync(
    filePath,
    fs.readFileSync(filePath, "utf8").replace('"running"', '"completed"'),
    "utf8",
  );
  expect(() => store.read("thread-tamper")).toThrowError(
    expect.objectContaining({ code: "CC_ROLLOUT_CORRUPT" }),
  );
}, 15_000);
