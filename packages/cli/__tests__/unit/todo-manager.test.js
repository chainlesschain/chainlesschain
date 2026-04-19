import { describe, it, expect, beforeEach } from "vitest";
import {
  writeTodos,
  getTodos,
  clearTodos,
  validateTodos,
  summarizeTodos,
  resetAllStores,
} from "../../src/lib/todo-manager.js";

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
    const result = writeTodos("sess-1", [
      { id: "a", content: "step a", status: "pending" },
      { id: "b", content: "step b", status: "in_progress" },
    ]);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    const todos = getTodos("sess-1");
    expect(todos).toHaveLength(2);
    expect(todos[1].status).toBe("in_progress");
  });

  it("is idempotent — second write replaces first", () => {
    writeTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    writeTodos("s", [{ id: "b", content: "y", status: "completed" }]);
    const todos = getTodos("s");
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe("b");
  });

  it("isolates sessions", () => {
    writeTodos("s1", [{ id: "a", content: "x", status: "pending" }]);
    writeTodos("s2", [{ id: "b", content: "y", status: "pending" }]);
    expect(getTodos("s1")[0].id).toBe("a");
    expect(getTodos("s2")[0].id).toBe("b");
  });

  it("returns error on invalid write (store unchanged)", () => {
    writeTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    const result = writeTodos("s", [
      { id: "a", content: "x", status: "in_progress" },
      { id: "b", content: "y", status: "in_progress" },
    ]);
    expect(result.success).toBe(false);
    expect(getTodos("s")).toHaveLength(1);
    expect(getTodos("s")[0].status).toBe("pending");
  });

  it("clearTodos empties the list", () => {
    writeTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    clearTodos("s");
    expect(getTodos("s")).toHaveLength(0);
  });

  it("getTodos returns a deep copy (mutation safe)", () => {
    writeTodos("s", [{ id: "a", content: "x", status: "pending" }]);
    const todos = getTodos("s");
    todos[0].status = "completed";
    expect(getTodos("s")[0].status).toBe("pending");
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


// ===== V2 Tests: Todo Manager governance overlay =====
import {
  TODO_LIST_MATURITY_V2, TODO_ITEM_LIFECYCLE_V2,
  registerTodoListV2, activateTodoListV2, pauseTodoListV2, archiveTodoListV2, touchTodoListV2,
  getTodoListV2, listTodoListsV2,
  createTodoItemV2, startTodoItemV2, completeTodoItemV2, failTodoItemV2, cancelTodoItemV2,
  getTodoItemV2, listTodoItemsV2,
  autoPauseIdleTodoListsV2, autoFailStuckTodoItemsV2,
  getTodoManagerStatsV2, _resetStateTodoManagerV2,
  setMaxActiveTodoListsPerOwnerV2, getMaxActiveTodoListsPerOwnerV2,
  setMaxPendingItemsPerTodoListV2, getMaxPendingItemsPerTodoListV2,
  setTodoListIdleMsV2, getTodoListIdleMsV2, setTodoItemStuckMsV2, getTodoItemStuckMsV2,
} from "../../src/lib/todo-manager.js";

describe("Todo Manager V2 governance overlay", () => {
  beforeEach(() => { _resetStateTodoManagerV2(); });
  describe("enums", () => {
    it("list 4 states", () => { expect(Object.keys(TODO_LIST_MATURITY_V2).sort()).toEqual(["ACTIVE", "ARCHIVED", "DRAFT", "PAUSED"]); expect(Object.isFrozen(TODO_LIST_MATURITY_V2)).toBe(true); });
    it("item 5 states", () => { expect(Object.keys(TODO_ITEM_LIFECYCLE_V2).sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED", "IN_PROGRESS", "PENDING"]); });
  });
  describe("list lifecycle", () => {
    it("draft → active", () => { registerTodoListV2({ id: "l", owner: "u" }); const x = activateTodoListV2("l"); expect(x.status).toBe("active"); expect(x.activatedAt).not.toBeNull(); });
    it("dup rejected", () => { registerTodoListV2({ id: "l", owner: "u" }); expect(() => registerTodoListV2({ id: "l", owner: "u" })).toThrow(/already/); });
    it("paused → active preserves activatedAt", () => { registerTodoListV2({ id: "l", owner: "u" }); activateTodoListV2("l"); const t1 = getTodoListV2("l").activatedAt; pauseTodoListV2("l"); expect(activateTodoListV2("l").activatedAt).toBe(t1); });
    it("archive stamps", () => { registerTodoListV2({ id: "l", owner: "u" }); expect(archiveTodoListV2("l").archivedAt).not.toBeNull(); });
    it("touch terminal throws", () => { registerTodoListV2({ id: "l", owner: "u" }); archiveTodoListV2("l"); expect(() => touchTodoListV2("l")).toThrow(/terminal/); });
  });
  describe("active cap", () => {
    it("recovery exempt", () => { setMaxActiveTodoListsPerOwnerV2(1); registerTodoListV2({ id: "a", owner: "u" }); activateTodoListV2("a"); pauseTodoListV2("a"); registerTodoListV2({ id: "b", owner: "u" }); activateTodoListV2("b"); expect(activateTodoListV2("a").status).toBe("active"); });
    it("initial enforced", () => { setMaxActiveTodoListsPerOwnerV2(1); registerTodoListV2({ id: "a", owner: "u" }); activateTodoListV2("a"); registerTodoListV2({ id: "b", owner: "u" }); expect(() => activateTodoListV2("b")).toThrow(/max active/); });
  });
  describe("item lifecycle", () => {
    beforeEach(() => { registerTodoListV2({ id: "l", owner: "u" }); });
    it("create pending", () => { expect(createTodoItemV2({ id: "i", listId: "l", description: "d" }).status).toBe("pending"); });
    it("missing list throws", () => { expect(() => createTodoItemV2({ id: "i", listId: "nope" })).toThrow(/not found/); });
    it("start stamps startedAt", () => { createTodoItemV2({ id: "i", listId: "l" }); const x = startTodoItemV2("i"); expect(x.status).toBe("in_progress"); expect(x.startedAt).not.toBeNull(); });
    it("complete stamps settledAt", () => { createTodoItemV2({ id: "i", listId: "l" }); startTodoItemV2("i"); expect(completeTodoItemV2("i").settledAt).not.toBeNull(); });
    it("fail reason", () => { createTodoItemV2({ id: "i", listId: "l" }); startTodoItemV2("i"); expect(failTodoItemV2("i", "x").metadata.failReason).toBe("x"); });
    it("cancel pending", () => { createTodoItemV2({ id: "i", listId: "l" }); expect(cancelTodoItemV2("i").status).toBe("cancelled"); });
    it("invalid transition throws", () => { createTodoItemV2({ id: "i", listId: "l" }); expect(() => completeTodoItemV2("i")).toThrow(/invalid/); });
  });
  describe("pending cap", () => {
    it("enforced", () => { setMaxPendingItemsPerTodoListV2(2); registerTodoListV2({ id: "l", owner: "u" }); createTodoItemV2({ id: "a", listId: "l" }); createTodoItemV2({ id: "b", listId: "l" }); expect(() => createTodoItemV2({ id: "c", listId: "l" })).toThrow(/max pending/); });
  });
  describe("auto flip", () => {
    it("auto-pause idle", () => { setTodoListIdleMsV2(1000); registerTodoListV2({ id: "l", owner: "u" }); activateTodoListV2("l"); const base = getTodoListV2("l").lastTouchedAt; expect(autoPauseIdleTodoListsV2({ now: base + 5000 }).count).toBe(1); expect(getTodoListV2("l").status).toBe("paused"); });
    it("auto-fail stuck", () => { setTodoItemStuckMsV2(500); registerTodoListV2({ id: "l", owner: "u" }); createTodoItemV2({ id: "i", listId: "l" }); startTodoItemV2("i"); const base = getTodoItemV2("i").startedAt; expect(autoFailStuckTodoItemsV2({ now: base + 5000 }).count).toBe(1); expect(getTodoItemV2("i").status).toBe("failed"); });
  });
  describe("config & stats", () => {
    it("rejects invalid", () => { expect(() => setMaxActiveTodoListsPerOwnerV2(0)).toThrow(); });
    it("floors", () => { setMaxPendingItemsPerTodoListV2(40.9); expect(getMaxPendingItemsPerTodoListV2()).toBe(40); });
    it("round-trip", () => { setTodoListIdleMsV2(10); setTodoItemStuckMsV2(20); expect(getTodoListIdleMsV2()).toBe(10); expect(getTodoItemStuckMsV2()).toBe(20); });
    it("stats zero-init", () => { const s = getTodoManagerStatsV2(); for (const v of Object.values(TODO_LIST_MATURITY_V2)) expect(s.listsByStatus[v]).toBe(0); for (const v of Object.values(TODO_ITEM_LIFECYCLE_V2)) expect(s.itemsByStatus[v]).toBe(0); });
    it("reset", () => { setMaxActiveTodoListsPerOwnerV2(99); registerTodoListV2({ id: "l", owner: "u" }); _resetStateTodoManagerV2(); expect(getTodoManagerStatsV2().totalListsV2).toBe(0); expect(getMaxActiveTodoListsPerOwnerV2()).toBe(10); });
    it("defensive copy", () => { registerTodoListV2({ id: "l", owner: "u", metadata: { k: "v" } }); const x = getTodoListV2("l"); x.metadata.k = "bad"; expect(getTodoListV2("l").metadata.k).toBe("v"); });
    it("lists", () => { registerTodoListV2({ id: "a", owner: "u" }); registerTodoListV2({ id: "b", owner: "u" }); expect(listTodoListsV2().length).toBe(2); createTodoItemV2({ id: "i", listId: "a" }); expect(listTodoItemsV2().length).toBe(1); });
  });
});
