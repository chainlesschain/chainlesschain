import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeTodos,
  getTodos,
  getTodoSnapshot,
  clearTodos,
  validateTodos,
  summarizeTodos,
  resetAllStores,
  recoverTodoSnapshot,
  resolveTodoStateDir,
  todoSnapshotPath,
  TodoSnapshotPersistence,
  TODO_PERSISTENCE_ERROR_CODES,
  TODO_SNAPSHOT_SCHEMA,
  TODO_SNAPSHOT_VERSION,
} from "../../src/lib/todo-manager.js";

const MEMORY_ONLY = Object.freeze({ memoryOnly: true });
const writeMemoryTodos = (sessionId, todos) =>
  writeTodos(sessionId, todos, MEMORY_ONLY);
const getMemoryTodos = (sessionId) => getTodos(sessionId, MEMORY_ONLY);
const clearMemoryTodos = (sessionId) => clearTodos(sessionId, MEMORY_ONLY);

describe("todo-manager — validateTodos()", () => {
  it("accepts an empty array", () => {
    expect(validateTodos([]).valid).toBe(true);
  });

  it("rejects non-array input", () => {
    expect(validateTodos(null).valid).toBe(false);
    expect(validateTodos({}).valid).toBe(false);
    expect(validateTodos("x").valid).toBe(false);
  });

  it("requires id/content/status on every item", () => {
    expect(validateTodos([{ content: "x", status: "pending" }]).valid).toBe(
      false,
    );
    expect(validateTodos([{ id: "a", status: "pending" }]).valid).toBe(false);
    expect(validateTodos([{ id: "a", content: "x" }]).valid).toBe(false);
  });

  it("rejects duplicate ids", () => {
    const check = validateTodos([
      { id: "a", content: "x", status: "pending" },
      { id: "a", content: "y", status: "pending" },
    ]);
    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/duplicate/);
  });

  it("rejects invalid status", () => {
    expect(
      validateTodos([{ id: "a", content: "x", status: "bogus" }]).valid,
    ).toBe(false);
  });

  it("rejects >1 in_progress items", () => {
    const check = validateTodos([
      { id: "a", content: "x", status: "in_progress" },
      { id: "b", content: "y", status: "in_progress" },
    ]);
    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/one todo/);
  });

  it("accepts exactly one in_progress", () => {
    const check = validateTodos([
      { id: "a", content: "x", status: "in_progress" },
      { id: "b", content: "y", status: "pending" },
    ]);
    expect(check.valid).toBe(true);
  });
});

describe("todo-manager — writeTodos() / getTodos() / clearTodos()", () => {
  beforeEach(() => resetAllStores());

  it("writes and reads back", () => {
    const result = writeMemoryTodos("sess-1", [
      { id: "a", content: "step a", status: "pending" },
      { id: "b", content: "step b", status: "in_progress" },
    ]);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    const todos = getMemoryTodos("sess-1");
    expect(todos).toHaveLength(2);
    expect(todos[1].status).toBe("in_progress");
  });

  it("is idempotent — second write replaces first", () => {
    writeMemoryTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    writeMemoryTodos("s", [{ id: "b", content: "y", status: "completed" }]);
    const todos = getMemoryTodos("s");
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe("b");
  });

  it("isolates sessions", () => {
    writeMemoryTodos("s1", [{ id: "a", content: "x", status: "pending" }]);
    writeMemoryTodos("s2", [{ id: "b", content: "y", status: "pending" }]);
    expect(getMemoryTodos("s1")[0].id).toBe("a");
    expect(getMemoryTodos("s2")[0].id).toBe("b");
  });

  it("returns error on invalid write (store unchanged)", () => {
    writeMemoryTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    const result = writeMemoryTodos("s", [
      { id: "a", content: "x", status: "in_progress" },
      { id: "b", content: "y", status: "in_progress" },
    ]);
    expect(result.success).toBe(false);
    expect(getMemoryTodos("s")).toHaveLength(1);
    expect(getMemoryTodos("s")[0].status).toBe("pending");
  });

  it("clearTodos empties the list", () => {
    writeMemoryTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    clearMemoryTodos("s");
    expect(getMemoryTodos("s")).toHaveLength(0);
  });

  it("getTodos returns a deep copy (mutation safe)", () => {
    writeMemoryTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    const todos = getMemoryTodos("s");
    todos[0].status = "completed";
    expect(getMemoryTodos("s")[0].status).toBe("pending");
  });
});

describe("todo-manager — summarizeTodos()", () => {
  it("counts by status", () => {
    const summary = summarizeTodos([
      { id: "a", content: "", status: "pending" },
      { id: "b", content: "", status: "pending" },
      { id: "c", content: "", status: "in_progress" },
      { id: "d", content: "", status: "completed" },
      { id: "e", content: "", status: "cancelled" },
    ]);
    expect(summary).toEqual({
      pending: 2,
      in_progress: 1,
      completed: 1,
      cancelled: 1,
    });
  });

  it("handles empty/undefined input", () => {
    expect(summarizeTodos([])).toEqual({
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    });
    expect(summarizeTodos(null)).toEqual({
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    });
  });
});

describe("todo-manager — durable session snapshots", () => {
  let tempRoot;
  let stateDir;

  beforeEach(() => {
    resetAllStores();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-todos-"));
    stateDir = path.join(tempRoot, "todo-state");
  });

  afterEach(() => {
    resetAllStores();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("prefers the injectable CHAINLESSCHAIN_DATA_DIR seam", () => {
    const dataDir = path.join(tempRoot, "explicit-data");
    expect(
      resolveTodoStateDir({
        env: { CHAINLESSCHAIN_DATA_DIR: dataDir },
        getStatePath: () => path.join(tempRoot, "fallback-state"),
      }),
    ).toBe(path.join(dataDir, "todos"));
  });

  it("keeps an unnamed session on the compatible memory-only path", () => {
    const result = writeTodos(
      undefined,
      [{ id: "memory", content: "ephemeral", status: "pending" }],
      { stateDir },
    );
    expect(result).toMatchObject({ success: true, revision: 1 });
    expect(getTodos(undefined, { stateDir })[0].id).toBe("memory");
    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("round-trips a versioned snapshot after an in-process restart", () => {
    const sessionId = "session-restart";
    const options = { stateDir };
    const first = writeTodos(
      sessionId,
      [
        { id: "a", content: "restore me", status: "in_progress" },
        { id: "b", content: "next", status: "pending" },
      ],
      options,
    );
    expect(first).toMatchObject({ success: true, revision: 1, count: 2 });

    const filePath = todoSnapshotPath(sessionId, options);
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(onDisk).toMatchObject({
      schema: TODO_SNAPSHOT_SCHEMA,
      version: TODO_SNAPSHOT_VERSION,
      sessionId,
      revision: 1,
    });

    resetAllStores();
    const restored = getTodoSnapshot(sessionId, options);
    expect(restored.revision).toBe(1);
    expect(restored.todos.map((todo) => todo.id)).toEqual(["a", "b"]);
    expect(restored.todos[0].status).toBe("in_progress");
  });

  it("blocks corrupt snapshots without overwriting them and supports quarantine recovery", () => {
    const sessionId = "session-corrupt";
    const options = { stateDir };
    const filePath = todoSnapshotPath(sessionId, options);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(filePath, '{"schema":', "utf8");
    const corruptBytes = fs.readFileSync(filePath, "utf8");

    let loadError;
    try {
      getTodos(sessionId, options);
    } catch (error) {
      loadError = error;
    }
    expect(loadError?.code).toBe(TODO_PERSISTENCE_ERROR_CODES.CORRUPT);
    expect(loadError?.recoveryStrategy).toBe("quarantine-corrupt");

    const refused = writeTodos(
      sessionId,
      [{ id: "a", content: "must not overwrite", status: "pending" }],
      options,
    );
    expect(refused).toMatchObject({
      success: false,
      code: TODO_PERSISTENCE_ERROR_CODES.CORRUPT,
      recoveryStrategy: "quarantine-corrupt",
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe(corruptBytes);

    const recovery = recoverTodoSnapshot(
      sessionId,
      "quarantine-corrupt",
      options,
    );
    expect(recovery.recovered).toBe(1);
    expect(fs.existsSync(recovery.quarantinePath)).toBe(true);
    expect(getTodos(sessionId, options)).toEqual([]);
  });

  it("rejects a stale revision instead of using last-write-wins", () => {
    const sessionId = "session-cas";
    const options = { stateDir };
    const first = writeTodos(
      sessionId,
      [{ id: "a", content: "first", status: "pending" }],
      options,
    );
    expect(getTodoSnapshot(sessionId, options).revision).toBe(1);

    const concurrentWriter = new TodoSnapshotPersistence({
      stateDir,
      validateTodos,
    });
    concurrentWriter.compareAndSwap(sessionId, first.revision, [
      { id: "b", content: "concurrent", status: "completed" },
    ]);

    const conflict = writeTodos(
      sessionId,
      [{ id: "c", content: "stale", status: "pending" }],
      options,
    );
    expect(conflict).toMatchObject({
      success: false,
      code: TODO_PERSISTENCE_ERROR_CODES.REVISION_CONFLICT,
      expectedRevision: 1,
      actualRevision: 2,
    });

    resetAllStores();
    expect(getTodos(sessionId, options)).toEqual([
      { id: "b", content: "concurrent", status: "completed" },
    ]);
  });

  it("keeps the prior snapshot and memory state when atomic replacement fails", () => {
    const sessionId = "session-atomic-failure";
    const options = { stateDir };
    writeTodos(
      sessionId,
      [{ id: "safe", content: "committed", status: "pending" }],
      options,
    );
    resetAllStores();

    const failingPersistence = new TodoSnapshotPersistence({
      stateDir,
      validateTodos,
      beforeRename: () => {
        throw new Error("injected rename failure");
      },
    });
    expect(
      getTodoSnapshot(sessionId, { persistence: failingPersistence }).revision,
    ).toBe(1);
    const secret = "TOP-SECRET-TODO-CONTENT";
    const failed = writeTodos(
      sessionId,
      [{ id: "secret", content: secret, status: "pending" }],
      { persistence: failingPersistence },
    );
    expect(failed).toMatchObject({
      success: false,
      code: TODO_PERSISTENCE_ERROR_CODES.WRITE_FAILED,
    });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(
      fs.readdirSync(stateDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);

    resetAllStores();
    expect(getTodos(sessionId, options)).toEqual([
      { id: "safe", content: "committed", status: "pending" },
    ]);
  });

  it("makes an orphaned half-write visible until explicitly discarded", () => {
    const sessionId = "session-half-write";
    const options = { stateDir };
    writeTodos(
      sessionId,
      [{ id: "safe", content: "committed", status: "pending" }],
      options,
    );
    resetAllStores();
    const filePath = todoSnapshotPath(sessionId, options);
    const orphan = path.join(
      stateDir,
      `.${path.basename(filePath)}.999.crash.tmp`,
    );
    fs.writeFileSync(orphan, '{"partial":', "utf8");

    const refused = writeTodos(
      sessionId,
      [{ id: "new", content: "blocked", status: "pending" }],
      options,
    );
    expect(refused).toMatchObject({
      success: false,
      code: TODO_PERSISTENCE_ERROR_CODES.RECOVERY_REQUIRED,
      recoveryStrategy: "discard-temporary",
    });
    expect(fs.existsSync(orphan)).toBe(true);

    const recovery = recoverTodoSnapshot(
      sessionId,
      "discard-temporary",
      options,
    );
    expect(recovery.recovered).toBe(1);
    expect(getTodos(sessionId, options)[0].id).toBe("safe");
  });
});

// ===== V2 Tests: Todo Manager governance overlay =====
import {
  TODO_LIST_MATURITY_V2,
  TODO_ITEM_LIFECYCLE_V2,
  registerTodoListV2,
  activateTodoListV2,
  pauseTodoListV2,
  archiveTodoListV2,
  touchTodoListV2,
  getTodoListV2,
  listTodoListsV2,
  createTodoItemV2,
  startTodoItemV2,
  completeTodoItemV2,
  failTodoItemV2,
  cancelTodoItemV2,
  getTodoItemV2,
  listTodoItemsV2,
  autoPauseIdleTodoListsV2,
  autoFailStuckTodoItemsV2,
  getTodoManagerStatsV2,
  _resetStateTodoManagerV2,
  setMaxActiveTodoListsPerOwnerV2,
  getMaxActiveTodoListsPerOwnerV2,
  setMaxPendingItemsPerTodoListV2,
  getMaxPendingItemsPerTodoListV2,
  setTodoListIdleMsV2,
  getTodoListIdleMsV2,
  setTodoItemStuckMsV2,
  getTodoItemStuckMsV2,
} from "../../src/lib/todo-manager.js";

describe("Todo Manager V2 governance overlay", () => {
  beforeEach(() => {
    _resetStateTodoManagerV2();
  });
  describe("enums", () => {
    it("list 4 states", () => {
      expect(Object.keys(TODO_LIST_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "ARCHIVED",
        "DRAFT",
        "PAUSED",
      ]);
      expect(Object.isFrozen(TODO_LIST_MATURITY_V2)).toBe(true);
    });
    it("item 5 states", () => {
      expect(Object.keys(TODO_ITEM_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "FAILED",
        "IN_PROGRESS",
        "PENDING",
      ]);
    });
  });
  describe("list lifecycle", () => {
    it("draft → active", () => {
      registerTodoListV2({ id: "l", owner: "u" });
      const x = activateTodoListV2("l");
      expect(x.status).toBe("active");
      expect(x.activatedAt).not.toBeNull();
    });
    it("dup rejected", () => {
      registerTodoListV2({ id: "l", owner: "u" });
      expect(() => registerTodoListV2({ id: "l", owner: "u" })).toThrow(
        /already/,
      );
    });
    it("paused → active preserves activatedAt", () => {
      registerTodoListV2({ id: "l", owner: "u" });
      activateTodoListV2("l");
      const t1 = getTodoListV2("l").activatedAt;
      pauseTodoListV2("l");
      expect(activateTodoListV2("l").activatedAt).toBe(t1);
    });
    it("archive stamps", () => {
      registerTodoListV2({ id: "l", owner: "u" });
      expect(archiveTodoListV2("l").archivedAt).not.toBeNull();
    });
    it("touch terminal throws", () => {
      registerTodoListV2({ id: "l", owner: "u" });
      archiveTodoListV2("l");
      expect(() => touchTodoListV2("l")).toThrow(/terminal/);
    });
  });
  describe("active cap", () => {
    it("recovery exempt", () => {
      setMaxActiveTodoListsPerOwnerV2(1);
      registerTodoListV2({ id: "a", owner: "u" });
      activateTodoListV2("a");
      pauseTodoListV2("a");
      registerTodoListV2({ id: "b", owner: "u" });
      activateTodoListV2("b");
      expect(activateTodoListV2("a").status).toBe("active");
    });
    it("initial enforced", () => {
      setMaxActiveTodoListsPerOwnerV2(1);
      registerTodoListV2({ id: "a", owner: "u" });
      activateTodoListV2("a");
      registerTodoListV2({ id: "b", owner: "u" });
      expect(() => activateTodoListV2("b")).toThrow(/max active/);
    });
  });
  describe("item lifecycle", () => {
    beforeEach(() => {
      registerTodoListV2({ id: "l", owner: "u" });
    });
    it("create pending", () => {
      expect(
        createTodoItemV2({ id: "i", listId: "l", description: "d" }).status,
      ).toBe("pending");
    });
    it("missing list throws", () => {
      expect(() => createTodoItemV2({ id: "i", listId: "nope" })).toThrow(
        /not found/,
      );
    });
    it("start stamps startedAt", () => {
      createTodoItemV2({ id: "i", listId: "l" });
      const x = startTodoItemV2("i");
      expect(x.status).toBe("in_progress");
      expect(x.startedAt).not.toBeNull();
    });
    it("complete stamps settledAt", () => {
      createTodoItemV2({ id: "i", listId: "l" });
      startTodoItemV2("i");
      expect(completeTodoItemV2("i").settledAt).not.toBeNull();
    });
    it("fail reason", () => {
      createTodoItemV2({ id: "i", listId: "l" });
      startTodoItemV2("i");
      expect(failTodoItemV2("i", "x").metadata.failReason).toBe("x");
    });
    it("cancel pending", () => {
      createTodoItemV2({ id: "i", listId: "l" });
      expect(cancelTodoItemV2("i").status).toBe("cancelled");
    });
    it("invalid transition throws", () => {
      createTodoItemV2({ id: "i", listId: "l" });
      expect(() => completeTodoItemV2("i")).toThrow(/invalid/);
    });
  });
  describe("pending cap", () => {
    it("enforced", () => {
      setMaxPendingItemsPerTodoListV2(2);
      registerTodoListV2({ id: "l", owner: "u" });
      createTodoItemV2({ id: "a", listId: "l" });
      createTodoItemV2({ id: "b", listId: "l" });
      expect(() => createTodoItemV2({ id: "c", listId: "l" })).toThrow(
        /max pending/,
      );
    });
  });
  describe("auto flip", () => {
    it("auto-pause idle", () => {
      setTodoListIdleMsV2(1000);
      registerTodoListV2({ id: "l", owner: "u" });
      activateTodoListV2("l");
      const base = getTodoListV2("l").lastTouchedAt;
      expect(autoPauseIdleTodoListsV2({ now: base + 5000 }).count).toBe(1);
      expect(getTodoListV2("l").status).toBe("paused");
    });
    it("auto-fail stuck", () => {
      setTodoItemStuckMsV2(500);
      registerTodoListV2({ id: "l", owner: "u" });
      createTodoItemV2({ id: "i", listId: "l" });
      startTodoItemV2("i");
      const base = getTodoItemV2("i").startedAt;
      expect(autoFailStuckTodoItemsV2({ now: base + 5000 }).count).toBe(1);
      expect(getTodoItemV2("i").status).toBe("failed");
    });
  });
  describe("config & stats", () => {
    it("rejects invalid", () => {
      expect(() => setMaxActiveTodoListsPerOwnerV2(0)).toThrow();
    });
    it("floors", () => {
      setMaxPendingItemsPerTodoListV2(40.9);
      expect(getMaxPendingItemsPerTodoListV2()).toBe(40);
    });
    it("round-trip", () => {
      setTodoListIdleMsV2(10);
      setTodoItemStuckMsV2(20);
      expect(getTodoListIdleMsV2()).toBe(10);
      expect(getTodoItemStuckMsV2()).toBe(20);
    });
    it("stats zero-init", () => {
      const s = getTodoManagerStatsV2();
      for (const v of Object.values(TODO_LIST_MATURITY_V2))
        expect(s.listsByStatus[v]).toBe(0);
      for (const v of Object.values(TODO_ITEM_LIFECYCLE_V2))
        expect(s.itemsByStatus[v]).toBe(0);
    });
    it("reset", () => {
      setMaxActiveTodoListsPerOwnerV2(99);
      registerTodoListV2({ id: "l", owner: "u" });
      _resetStateTodoManagerV2();
      expect(getTodoManagerStatsV2().totalListsV2).toBe(0);
      expect(getMaxActiveTodoListsPerOwnerV2()).toBe(10);
    });
    it("defensive copy", () => {
      registerTodoListV2({ id: "l", owner: "u", metadata: { k: "v" } });
      const x = getTodoListV2("l");
      x.metadata.k = "bad";
      expect(getTodoListV2("l").metadata.k).toBe("v");
    });
    it("lists", () => {
      registerTodoListV2({ id: "a", owner: "u" });
      registerTodoListV2({ id: "b", owner: "u" });
      expect(listTodoListsV2().length).toBe(2);
      createTodoItemV2({ id: "i", listId: "a" });
      expect(listTodoItemsV2().length).toBe(1);
    });
  });
});
