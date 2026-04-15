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
