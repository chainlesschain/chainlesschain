/**
 * `/todos` renderer — formats todo-manager's getTodos(sessionId) output into a
 * human-readable block. Pure + deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  formatTodos,
  todoStatusLabel,
  summarize,
} from "../../src/repl/todos-status.js";

describe("todoStatusLabel", () => {
  it("badges each known status; falls back for unknown", () => {
    expect(todoStatusLabel("pending")).toBe("☐ pending");
    expect(todoStatusLabel("in_progress")).toBe("▶ in progress");
    expect(todoStatusLabel("completed")).toBe("✓ done");
    expect(todoStatusLabel("cancelled")).toBe("✗ cancelled");
    expect(todoStatusLabel("weird")).toBe("weird");
    expect(todoStatusLabel(undefined)).toBe("?");
  });
});

describe("summarize", () => {
  it("counts by status and tolerates garbage", () => {
    expect(
      summarize([
        { status: "pending" },
        { status: "in_progress" },
        { status: "completed" },
        { status: "completed" },
        { status: "bogus" },
        null,
      ]),
    ).toEqual({ pending: 1, in_progress: 1, completed: 2, cancelled: 0 });
  });
});

describe("formatTodos", () => {
  it("explains the empty case and points at the todo_write tool", () => {
    const out = formatTodos([]);
    expect(out).toMatch(/No TODOs for this session/);
    expect(out).toMatch(/todo_write/);
    // non-array input is tolerated
    expect(formatTodos(null)).toMatch(/No TODOs/);
  });

  it("renders a header summary and one line per item with status badges", () => {
    const out = formatTodos([
      { id: "1", content: "scaffold module", status: "completed" },
      { id: "2", content: "wire the handler", status: "in_progress" },
      { id: "3", content: "write tests", status: "pending" },
    ]);
    expect(out).toMatch(
      /Session TODOs \(3: 1 done, 1 in progress, 1 pending\):/,
    );
    expect(out).toMatch(/✓ done {2}scaffold module/);
    expect(out).toMatch(/▶ in progress {2}wire the handler/);
    expect(out).toMatch(/☐ pending {2}write tests/);
  });

  it("includes cancelled in the header only when present", () => {
    const out = formatTodos([
      { id: "1", content: "a", status: "pending" },
      { id: "2", content: "b", status: "cancelled" },
    ]);
    expect(out).toMatch(/1 pending, 1 cancelled\):/);
  });

  it("collapses whitespace and truncates long content", () => {
    const long = "x".repeat(200);
    const out = formatTodos([
      { id: "1", content: "a\n  b\t c", status: "pending" },
      { id: "2", content: long, status: "pending" },
    ]);
    expect(out).toMatch(/☐ pending {2}a b c/);
    expect(out).toMatch(/…/);
    expect(out).not.toContain("x".repeat(90));
  });
});
