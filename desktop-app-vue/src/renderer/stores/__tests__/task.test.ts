/**
 * useTaskStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - loadTasks()          → tasks:list
 *  - createTask()         → tasks:create
 *  - updateTask()         → tasks:update
 *  - deleteTask()         → tasks:delete
 *  - loadTaskDetail()     → tasks:detail
 *  - assignTask()         → tasks:assign
 *  - changeStatus()       → tasks:changeStatus
 *  - loadTaskComments()   → tasks:comment:list
 *  - addComment()         → tasks:comment:add
 *  - deleteComment()      → tasks:comment:delete
 *  - loadTaskChanges()    → tasks:getHistory
 *  - loadBoards()         → tasks:board:list
 *  - createBoard()        → tasks:board:create
 *  - Getters: tasksByStatus, tasksByPriority, taskStats, overdueTasks, etc.
 *  - Filters: updateFilters(), clearFilters()
 *  - UI helpers: openTaskDetail(), closeTaskDetail()
 *  - Error handling when IPC throws
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Mock ant-design-vue message
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock identityStore
vi.mock("../identityStore", () => ({
  useIdentityStore: vi.fn(() => ({
    currentUserDID: null,
  })),
}));

import type { Task, TaskComment, TaskChange } from "../task";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Test Task",
    description: "A test task",
    status: "pending",
    priority: "medium",
    assigned_to: undefined,
    created_by: "did:test:creator",
    workspace_id: undefined,
    org_id: undefined,
    due_date: undefined,
    collaborators: [],
    labels: [],
    blocked_by: [],
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
  return {
    id: "comment-1",
    task_id: "task-1",
    author_did: "did:test:author",
    content: "Test comment",
    mentions: [],
    attachments: [],
    created_at: 1700000000000,
    ...overrides,
  };
}

function makeChange(overrides: Partial<TaskChange> = {}): TaskChange {
  return {
    id: "change-1",
    task_id: "task-1",
    changed_by: "did:test:user",
    field: "status",
    old_value: "pending",
    new_value: "in_progress",
    changed_at: 1700000000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTaskStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue({ success: true });

    (window as any).ipc = {
      invoke: mockInvoke,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("tasks starts as empty array", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.tasks).toEqual([]);
    });

    it("currentTask starts as null", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.currentTask).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.loading).toBe(false);
    });

    it("filters start with all null values", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.filters).toEqual({
        status: null,
        priority: null,
        assigned_to: null,
        workspace_id: null,
        org_id: null,
      });
    });

    it("boards starts as empty array", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.boards).toEqual([]);
    });

    it("taskDetailVisible starts as false", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      expect(store.taskDetailVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadTasks
  // -------------------------------------------------------------------------

  describe("loadTasks()", () => {
    it("calls tasks:list via IPC with filters", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTasks();
      expect(mockInvoke).toHaveBeenCalledWith(
        "tasks:list",
        expect.objectContaining({
          filters: expect.any(Object),
        }),
      );
    });

    it("populates tasks array from IPC result", async () => {
      const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
      mockInvoke.mockResolvedValue({ success: true, tasks });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTasks();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].id).toBe("t1");
    });

    it("parses JSON string fields (collaborators, labels, blocked_by)", async () => {
      const tasks = [
        makeTask({
          id: "t1",
          collaborators: '["did:a","did:b"]' as any,
          labels: '["bug"]' as any,
        }),
      ];
      mockInvoke.mockResolvedValue({ success: true, tasks });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTasks();
      expect(store.tasks[0].collaborators).toEqual(["did:a", "did:b"]);
      expect(store.tasks[0].labels).toEqual(["bug"]);
    });

    it("sets loading to false after completion", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTasks();
      expect(store.loading).toBe(false);
    });

    it("sets loading to false even when IPC throws", async () => {
      mockInvoke.mockRejectedValue(new Error("Network error"));
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTasks();
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // createTask
  // -------------------------------------------------------------------------

  describe("createTask()", () => {
    it("calls tasks:create via IPC with task data", async () => {
      const task = makeTask({ id: "new-1" });
      mockInvoke.mockResolvedValue({ success: true, task, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.createTask({ title: "New Task" });
      expect(mockInvoke).toHaveBeenCalledWith("tasks:create", {
        taskData: { title: "New Task" },
      });
    });

    it("returns the created task on success", async () => {
      const task = makeTask({ id: "new-1", title: "New Task" });
      mockInvoke.mockResolvedValue({ success: true, task, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.createTask({ title: "New Task" });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("new-1");
    });

    it("returns null on failure", async () => {
      mockInvoke.mockResolvedValue({
        success: false,
        error: "Validation failed",
      });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.createTask({ title: "" });
      expect(result).toBeNull();
    });

    it("returns null when IPC throws", async () => {
      mockInvoke.mockRejectedValue(new Error("IPC error"));
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.createTask({ title: "Test" });
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // updateTask
  // -------------------------------------------------------------------------

  describe("updateTask()", () => {
    it("calls tasks:update via IPC", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [makeTask({ id: "t1" })];
      await store.updateTask("t1", { title: "Updated" });
      expect(mockInvoke).toHaveBeenCalledWith("tasks:update", {
        taskId: "t1",
        updates: { title: "Updated" },
      });
    });

    it("updates the task in local list on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [makeTask({ id: "t1", title: "Old" })];
      await store.updateTask("t1", { title: "New" });
      expect(store.tasks[0].title).toBe("New");
    });

    it("updates currentTask if it matches the updated task", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [makeTask({ id: "t1" })];
      store.currentTask = makeTask({ id: "t1", title: "Old" });
      await store.updateTask("t1", { title: "New" });
      expect(store.currentTask!.title).toBe("New");
    });

    it("returns false on failure", async () => {
      mockInvoke.mockResolvedValue({ success: false, error: "Not found" });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.updateTask("t1", { title: "X" });
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // deleteTask
  // -------------------------------------------------------------------------

  describe("deleteTask()", () => {
    it("removes task from local list on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [makeTask({ id: "del-1" }), makeTask({ id: "keep-1" })];
      await store.deleteTask("del-1");
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].id).toBe("keep-1");
    });

    it("clears currentTask and hides detail if deleted task was selected", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [makeTask({ id: "del-1" })];
      store.currentTask = makeTask({ id: "del-1" });
      store.taskDetailVisible = true;
      await store.deleteTask("del-1");
      expect(store.currentTask).toBeNull();
      expect(store.taskDetailVisible).toBe(false);
    });

    it("returns false when IPC throws", async () => {
      mockInvoke.mockRejectedValue(new Error("Delete failed"));
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.deleteTask("t1");
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // assignTask
  // -------------------------------------------------------------------------

  describe("assignTask()", () => {
    it("calls tasks:assign via IPC", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.assignTask("t1", "did:test:user");
      expect(mockInvoke).toHaveBeenCalledWith("tasks:assign", {
        taskId: "t1",
        assignedTo: "did:test:user",
      });
    });

    it("returns false on failure", async () => {
      mockInvoke.mockResolvedValue({ success: false, error: "Invalid user" });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.assignTask("t1", "bad-did");
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // changeStatus
  // -------------------------------------------------------------------------

  describe("changeStatus()", () => {
    it("calls tasks:changeStatus via IPC", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.changeStatus("t1", "completed");
      expect(mockInvoke).toHaveBeenCalledWith("tasks:changeStatus", {
        taskId: "t1",
        status: "completed",
      });
    });

    it("returns false when IPC throws", async () => {
      mockInvoke.mockRejectedValue(new Error("Status error"));
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      const result = await store.changeStatus("t1", "completed");
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadTaskComments / addComment / deleteComment
  // -------------------------------------------------------------------------

  describe("Comments", () => {
    it("loadTaskComments populates currentTaskComments", async () => {
      const comments = [makeComment({ id: "c1" }), makeComment({ id: "c2" })];
      mockInvoke.mockResolvedValue({ success: true, comments });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTaskComments("task-1");
      expect(store.currentTaskComments).toHaveLength(2);
    });

    it("addComment calls tasks:comment:add with correct args", async () => {
      mockInvoke.mockResolvedValue({ success: true, comments: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.addComment("task-1", "Hello", ["did:a"]);
      expect(mockInvoke).toHaveBeenCalledWith("tasks:comment:add", {
        taskId: "task-1",
        content: "Hello",
        mentions: ["did:a"],
      });
    });

    it("deleteComment calls tasks:comment:delete", async () => {
      mockInvoke.mockResolvedValue({ success: true, comments: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.currentTask = makeTask({ id: "task-1" });
      await store.deleteComment("c1");
      expect(mockInvoke).toHaveBeenCalledWith("tasks:comment:delete", {
        commentId: "c1",
      });
    });
  });

  // -------------------------------------------------------------------------
  // loadTaskChanges
  // -------------------------------------------------------------------------

  describe("loadTaskChanges()", () => {
    it("populates currentTaskChanges from IPC result", async () => {
      const changes = [makeChange({ id: "ch1" }), makeChange({ id: "ch2" })];
      mockInvoke.mockResolvedValue({ success: true, changes });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadTaskChanges("task-1");
      expect(store.currentTaskChanges).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Boards
  // -------------------------------------------------------------------------

  describe("Boards", () => {
    it("loadBoards populates boards array", async () => {
      const boards = [
        {
          id: "b1",
          name: "Sprint Board",
          org_id: "org-1",
          columns: [],
          filters: {},
          created_at: 1700000000000,
        },
      ];
      mockInvoke.mockResolvedValue({ success: true, boards });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadBoards("org-1");
      expect(store.boards).toHaveLength(1);
      expect(store.boards[0].name).toBe("Sprint Board");
    });

    it("loadBoards auto-selects first board when no board selected", async () => {
      const boards = [
        {
          id: "b1",
          name: "Board 1",
          org_id: "org-1",
          columns: "[]",
          filters: "{}",
          created_at: 1700000000000,
        },
      ];
      mockInvoke.mockResolvedValue({ success: true, boards });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.loadBoards("org-1");
      expect(store.currentBoard).not.toBeNull();
      expect(store.currentBoard!.id).toBe("b1");
    });

    it("createBoard calls tasks:board:create via IPC", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        board: { id: "b-new" },
        boards: [],
      });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      await store.createBoard("org-1", { name: "New Board" });
      expect(mockInvoke).toHaveBeenCalledWith("tasks:board:create", {
        orgId: "org-1",
        boardData: { name: "New Board" },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("tasksByStatus groups tasks correctly", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [
        makeTask({ id: "t1", status: "pending" }),
        makeTask({ id: "t2", status: "in_progress" }),
        makeTask({ id: "t3", status: "completed" }),
        makeTask({ id: "t4", status: "pending" }),
      ];
      expect(store.tasksByStatus.pending).toHaveLength(2);
      expect(store.tasksByStatus.in_progress).toHaveLength(1);
      expect(store.tasksByStatus.completed).toHaveLength(1);
      expect(store.tasksByStatus.cancelled).toHaveLength(0);
    });

    it("tasksByPriority groups tasks correctly", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [
        makeTask({ id: "t1", priority: "urgent" }),
        makeTask({ id: "t2", priority: "high" }),
        makeTask({ id: "t3", priority: "medium" }),
      ];
      expect(store.tasksByPriority.urgent).toHaveLength(1);
      expect(store.tasksByPriority.high).toHaveLength(1);
      expect(store.tasksByPriority.medium).toHaveLength(1);
      expect(store.tasksByPriority.low).toHaveLength(0);
    });

    it("taskStats computes correct totals", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [
        makeTask({ id: "t1", status: "pending" }),
        makeTask({ id: "t2", status: "in_progress" }),
        makeTask({ id: "t3", status: "completed" }),
        makeTask({ id: "t4", status: "pending", due_date: 1 }),
      ];
      expect(store.taskStats.total).toBe(4);
      expect(store.taskStats.pending).toBe(2);
      expect(store.taskStats.inProgress).toBe(1);
      expect(store.taskStats.completed).toBe(1);
      expect(store.taskStats.overdue).toBe(1); // t4 has due_date=1 (past) and not completed
    });

    it("overdueTasks returns tasks with past due_date that are not completed", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [
        makeTask({ id: "t1", due_date: 1, status: "pending" }), // overdue
        makeTask({ id: "t2", due_date: 1, status: "completed" }), // completed, not overdue
        makeTask({
          id: "t3",
          due_date: Date.now() + 100000,
          status: "pending",
        }), // future, not overdue
        makeTask({ id: "t4", status: "pending" }), // no due date
      ];
      expect(store.overdueTasks).toHaveLength(1);
      expect(store.overdueTasks[0].id).toBe("t1");
    });

    it("inProgressTasks filters correctly", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.tasks = [
        makeTask({ id: "t1", status: "in_progress" }),
        makeTask({ id: "t2", status: "pending" }),
      ];
      expect(store.inProgressTasks).toHaveLength(1);
      expect(store.inProgressTasks[0].id).toBe("t1");
    });
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  describe("Filters", () => {
    it("updateFilters merges new filter values", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.updateFilters({ status: "pending", priority: "high" });
      expect(store.filters.status).toBe("pending");
      expect(store.filters.priority).toBe("high");
      expect(store.filters.assigned_to).toBeNull();
    });

    it("clearFilters resets all filters to null", async () => {
      mockInvoke.mockResolvedValue({ success: true, tasks: [] });
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.filters.status = "completed";
      store.filters.priority = "urgent";
      store.clearFilters();
      expect(store.filters.status).toBeNull();
      expect(store.filters.priority).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------------

  describe("UI helpers", () => {
    it("closeTaskDetail clears currentTask and hides dialog", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();
      store.currentTask = makeTask({ id: "t1" });
      store.taskDetailVisible = true;
      store.currentTaskComments = [makeComment()];
      store.currentTaskChanges = [makeChange()];
      store.closeTaskDetail();
      expect(store.taskDetailVisible).toBe(false);
      expect(store.currentTask).toBeNull();
      expect(store.currentTaskComments).toEqual([]);
      expect(store.currentTaskChanges).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("clears all state to defaults", async () => {
      const { useTaskStore } = await import("../task");
      const store = useTaskStore();

      store.tasks = [makeTask()];
      store.currentTask = makeTask();
      store.currentTaskComments = [makeComment()];
      store.currentTaskChanges = [makeChange()];
      store.boards = [
        {
          id: "b1",
          name: "B",
          org_id: "o",
          columns: [],
          filters: {},
          created_at: 0,
        },
      ];
      store.loading = true;
      store.taskDetailVisible = true;
      store.createTaskVisible = true;
      store.filters.status = "pending";

      store.reset();

      expect(store.tasks).toEqual([]);
      expect(store.currentTask).toBeNull();
      expect(store.currentTaskComments).toEqual([]);
      expect(store.currentTaskChanges).toEqual([]);
      expect(store.boards).toEqual([]);
      expect(store.currentBoard).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.taskDetailVisible).toBe(false);
      expect(store.createTaskVisible).toBe(false);
      expect(store.filters.status).toBeNull();
    });
  });
});
