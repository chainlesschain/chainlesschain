/**
 * useTaskBoardStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: tasksByColumn / filteredTasks (all 6 filters) /
 *    todoCount / inProgressCount / completedCount / overdueCount / isLoading
 *  - Pure local actions: setFilters / clearFilters / setViewMode /
 *    closeTaskDetail / reset
 *  - IPC actions (mocked window.electronAPI.invoke): loadBoards / createBoard /
 *    loadSprints (activeSprint derivation) / createLabel
 *  - Error handling when IPC throws (error set + loading reset + rethrow)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useTaskBoardStore } from "../taskBoard";
import type { Task, Column, Sprint } from "../taskBoard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    boardId: "board-1",
    columnId: "col-1",
    title: "Test Task",
    description: "A test task",
    status: "todo",
    priority: "medium",
    position: 0,
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-1",
    boardId: "board-1",
    name: "To Do",
    position: 0,
    ...overrides,
  };
}

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: "sprint-1",
    boardId: "board-1",
    name: "Sprint 1",
    status: "planning",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("useTaskBoardStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with empty collections and sensible defaults", () => {
      const store = useTaskBoardStore();
      expect(store.boards).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.columns).toEqual([]);
      expect(store.currentBoard).toBeNull();
      expect(store.currentTask).toBeNull();
      expect(store.viewMode).toBe("kanban");
      expect(store.error).toBeNull();
      expect(store.filters).toEqual({
        assigneeDid: null,
        priority: null,
        labels: [],
        status: null,
        searchQuery: "",
        sprintId: null,
      });
      expect(Object.values(store.loading).every((v) => v === false)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getter: tasksByColumn", () => {
    it("groups tasks by columnId across all columns", () => {
      const store = useTaskBoardStore();
      store.columns = [
        makeColumn({ id: "col-1" }),
        makeColumn({ id: "col-2" }),
      ];
      store.tasks = [
        makeTask({ id: "t1", columnId: "col-1" }),
        makeTask({ id: "t2", columnId: "col-2" }),
        makeTask({ id: "t3", columnId: "col-1" }),
      ];
      const grouped = store.tasksByColumn;
      expect(grouped["col-1"].map((t) => t.id)).toEqual(["t1", "t3"]);
      expect(grouped["col-2"].map((t) => t.id)).toEqual(["t2"]);
    });

    it("yields empty arrays for columns with no tasks", () => {
      const store = useTaskBoardStore();
      store.columns = [makeColumn({ id: "col-empty" })];
      store.tasks = [];
      expect(store.tasksByColumn["col-empty"]).toEqual([]);
    });
  });

  describe("getter: filteredTasks", () => {
    beforeEach(() => {
      const store = useTaskBoardStore();
      store.tasks = [
        makeTask({
          id: "t1",
          assigneeDid: "did:a",
          priority: "high",
          status: "todo",
          labels: ["bug"],
          sprintId: "s1",
          title: "Fix login",
        }),
        makeTask({
          id: "t2",
          assigneeDid: "did:b",
          priority: "low",
          status: "done",
          labels: ["chore"],
          sprintId: "s2",
          title: "Update docs",
          description: "readme",
        }),
        makeTask({
          id: "t3",
          assigneeDid: "did:a",
          priority: "medium",
          status: "in_progress",
          labels: ["bug", "ui"],
          sprintId: "s1",
          title: "Polish UI",
        }),
      ];
    });

    it("no filters → all tasks", () => {
      expect(useTaskBoardStore().filteredTasks.map((t) => t.id)).toEqual([
        "t1",
        "t2",
        "t3",
      ]);
    });

    it("filters by assigneeDid", () => {
      const store = useTaskBoardStore();
      store.filters.assigneeDid = "did:a";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t1", "t3"]);
    });

    it("filters by priority", () => {
      const store = useTaskBoardStore();
      store.filters.priority = "high";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t1"]);
    });

    it("filters by labels (any match)", () => {
      const store = useTaskBoardStore();
      store.filters.labels = ["bug"];
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t1", "t3"]);
    });

    it("filters by status", () => {
      const store = useTaskBoardStore();
      store.filters.status = "done";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t2"]);
    });

    it("filters by sprintId", () => {
      const store = useTaskBoardStore();
      store.filters.sprintId = "s1";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t1", "t3"]);
    });

    it("filters by searchQuery on title + description, case-insensitive", () => {
      const store = useTaskBoardStore();
      store.filters.searchQuery = "FIX";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t1"]);
      store.filters.searchQuery = "readme"; // matches t2.description
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t2"]);
    });

    it("combines multiple filters (AND)", () => {
      const store = useTaskBoardStore();
      store.filters.assigneeDid = "did:a";
      store.filters.labels = ["ui"];
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["t3"]);
    });
  });

  describe("getters: status counts + overdue", () => {
    it("counts todo / in_progress / done", () => {
      const store = useTaskBoardStore();
      store.tasks = [
        makeTask({ id: "t1", status: "todo" }),
        makeTask({ id: "t2", status: "todo" }),
        makeTask({ id: "t3", status: "in_progress" }),
        makeTask({ id: "t4", status: "done" }),
      ];
      expect(store.todoCount).toBe(2);
      expect(store.inProgressCount).toBe(1);
      expect(store.completedCount).toBe(1);
    });

    it("overdueCount counts past-due tasks that are not done", () => {
      const store = useTaskBoardStore();
      const past = Date.now() - 100_000;
      const future = Date.now() + 100_000;
      store.tasks = [
        makeTask({ id: "t1", dueDate: past, status: "todo" }), // overdue
        makeTask({ id: "t2", dueDate: past, status: "done" }), // done → not overdue
        makeTask({ id: "t3", dueDate: future, status: "todo" }), // future → not overdue
        makeTask({ id: "t4", status: "todo" }), // no dueDate → not overdue
      ];
      expect(store.overdueCount).toBe(1);
    });
  });

  describe("getter: isLoading", () => {
    it("is false when all flags false, true when any flag set", () => {
      const store = useTaskBoardStore();
      expect(store.isLoading).toBe(false);
      store.loading.tasks = true;
      expect(store.isLoading).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pure local actions
  // -------------------------------------------------------------------------

  describe("pure local actions", () => {
    it("setFilters merges into existing filters", () => {
      const store = useTaskBoardStore();
      store.setFilters({ priority: "high", searchQuery: "x" });
      expect(store.filters.priority).toBe("high");
      expect(store.filters.searchQuery).toBe("x");
      expect(store.filters.assigneeDid).toBeNull(); // untouched
    });

    it("clearFilters resets all filters to defaults", () => {
      const store = useTaskBoardStore();
      store.setFilters({ priority: "high", labels: ["bug"], searchQuery: "x" });
      store.clearFilters();
      expect(store.filters).toEqual({
        assigneeDid: null,
        priority: null,
        labels: [],
        status: null,
        searchQuery: "",
        sprintId: null,
      });
    });

    it("setViewMode updates the view mode", () => {
      const store = useTaskBoardStore();
      store.setViewMode("timeline");
      expect(store.viewMode).toBe("timeline");
    });

    it("closeTaskDetail hides the drawer and clears currentTask", () => {
      const store = useTaskBoardStore();
      store.taskDetailVisible = true;
      store.currentTask = makeTask();
      store.closeTaskDetail();
      expect(store.taskDetailVisible).toBe(false);
      expect(store.currentTask).toBeNull();
    });

    it("reset restores initial state", () => {
      const store = useTaskBoardStore();
      store.boards = [{ id: "b1", name: "B", orgId: "o", createdAt: 1 }];
      store.viewMode = "list";
      store.tasks = [makeTask()];
      store.reset();
      expect(store.boards).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.viewMode).toBe("kanban");
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadBoards sets boards on success and toggles loading", async () => {
      const store = useTaskBoardStore();
      const boards = [
        { id: "b1", name: "Board 1", orgId: "org-1", createdAt: 1 },
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, boards });
      const result = await store.loadBoards("org-1");
      expect(mockInvoke).toHaveBeenCalledWith("task:get-boards", {
        orgId: "org-1",
      });
      expect(result.success).toBe(true);
      expect(store.boards).toEqual(boards);
      expect(store.loading.boards).toBe(false);
    });

    it("createBoard prepends the new board on success", async () => {
      const store = useTaskBoardStore();
      store.boards = [{ id: "b0", name: "Old", orgId: "org-1", createdAt: 1 }];
      mockInvoke.mockResolvedValueOnce({ success: true, boardId: "b1" });
      await store.createBoard({ name: "New Board", orgId: "org-1" });
      expect(store.boards[0].id).toBe("b1");
      expect(store.boards[0].name).toBe("New Board");
      expect(store.boards).toHaveLength(2);
    });

    it("loadSprints sets sprints and derives the active sprint", async () => {
      const store = useTaskBoardStore();
      const sprints = [
        makeSprint({ id: "s1", status: "completed" }),
        makeSprint({ id: "s2", status: "active" }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, sprints });
      await store.loadSprints("board-1");
      expect(store.sprints).toEqual(sprints);
      expect(store.activeSprint?.id).toBe("s2");
    });

    it("loadSprints leaves activeSprint null when none active", async () => {
      const store = useTaskBoardStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        sprints: [makeSprint({ id: "s1", status: "planning" })],
      });
      await store.loadSprints("board-1");
      expect(store.activeSprint).toBeNull();
    });

    it("createLabel appends the new label on success", async () => {
      const store = useTaskBoardStore();
      mockInvoke.mockResolvedValueOnce({ success: true, labelId: "l1" });
      await store.createLabel("org-1", { name: "bug", color: "#f00" });
      expect(store.labels).toHaveLength(1);
      expect(store.labels[0]).toMatchObject({
        id: "l1",
        orgId: "org-1",
        name: "bug",
      });
    });

    it("loadBoards on IPC error sets error, resets loading, and rethrows", async () => {
      const store = useTaskBoardStore();
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      await expect(store.loadBoards("org-1")).rejects.toThrow("boom");
      expect(store.error).toBe("boom");
      expect(store.loading.boards).toBe(false);
    });
  });
});
