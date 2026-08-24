import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JsonlRolloutStore,
  MemoryRolloutStore,
} from "../../src/lib/app-server/rollout-store.js";
import { SqliteRolloutStore } from "../../src/lib/app-server/sqlite-rollout-store.js";

const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rollout-"));
  temporary.push(directory);
  return directory;
}

for (const [name, createStore] of [
  ["memory", () => new MemoryRolloutStore({ now: () => 1_700_000_000_000 })],
  [
    "sqlite",
    () =>
      new SqliteRolloutStore({
        filename: ":memory:",
        now: () => 1_700_000_000_000,
      }),
  ],
  [
    "jsonl",
    () =>
      new JsonlRolloutStore({
        directory: createDirectory(),
        now: () => 1_700_000_000_000,
      }),
  ],
]) {
  describe(`App Server rollout store (${name})`, () => {
    it("supports start/append/read/resume/fork/checkpoint/compact/archive", () => {
      const store = createStore();
      const thread = store.start({
        threadId: "thread-1",
        title: "Canonical",
        metadata: { provider: "fake" },
      });
      expect(thread).toMatchObject({ id: "thread-1", revision: 1 });

      const first = store.append({
        threadId: thread.id,
        turnId: "turn-1",
        eventType: "turn.started",
        idempotencyKey: "turn-start-1",
        payload: { status: "running" },
      });
      const replay = store.append({
        threadId: thread.id,
        turnId: "turn-1",
        eventType: "turn.started",
        idempotencyKey: "turn-start-1",
        payload: { status: "running" },
      });
      expect(replay).toEqual(first);
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
      const fork = store.fork(thread.id, { threadId: "thread-2" });
      expect(fork).toMatchObject({
        id: "thread-2",
        parentThreadId: "thread-1",
      });
      expect(store.read(fork.id).at(-1).payload).toMatchObject({
        sourceThreadId: "thread-1",
        sourceHeadHash: expect.stringMatching(/^sha256:/),
      });

      expect(store.archive(thread.id).status).toBe("archived");
      expect(store.list()).toEqual([
        expect.objectContaining({ id: "thread-2" }),
      ]);
      expect(store.list({ includeArchived: true })).toHaveLength(2);
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
  });
}

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
});
