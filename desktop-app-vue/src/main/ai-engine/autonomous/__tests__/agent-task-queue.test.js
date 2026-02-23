/**
 * AgentTaskQueue Unit Tests
 *
 * Covers: initialize (loads pending tasks from DB), enqueue (priority sort,
 *         persistence, event), dequeue (returns task / null, increments
 *         activeCount, event), peek (non-destructive), remove (by goalId,
 *         event), markComplete (decrements activeCount), getQueueStatus
 *         (pending / active / total fields), updatePriority (re-sorts queue),
 *         clear (empties queue, event), reSort
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "queue-item-uuid"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a shared prepared-statement stub so tests can override
 * .get() / .all() / .run() per-call via .mockReturnValueOnce().
 */
function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
    ...overrides,
  };
}

/**
 * Build a mock database.
 * Every call to prepare() returns the same shared stub (db._stmt).
 */
function createMockDb() {
  const prepStmt = makePrepStmt();
  return {
    exec: vi.fn(),
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
    prepare: vi.fn(() => prepStmt),
    saveToFile: vi.fn(),
    _stmt: prepStmt,
  };
}

/**
 * Build a minimal task descriptor accepted by enqueue().
 */
function makeTask(overrides = {}) {
  return {
    goalId: `goal-${Math.random().toString(36).slice(2, 8)}`,
    priority: 5,
    description: "Default test task",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentTaskQueue", () => {
  let AgentTaskQueue;
  let QUEUE_STATUS;
  let queue;
  let mockDb;

  beforeEach(async () => {
    const mod = await import("../agent-task-queue.js");
    AgentTaskQueue = mod.AgentTaskQueue;
    QUEUE_STATUS = mod.QUEUE_STATUS;

    mockDb = createMockDb();
    queue = new AgentTaskQueue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── initialize ─────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      await queue.initialize(mockDb);
      expect(queue.initialized).toBe(true);
    });

    it("should attach the database reference", async () => {
      await queue.initialize(mockDb);
      expect(queue.database).toBe(mockDb);
    });

    it("should call exec() to create tables", async () => {
      await queue.initialize(mockDb);
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("should be idempotent — second initialize() is a no-op", async () => {
      await queue.initialize(mockDb);
      await queue.initialize(mockDb);
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
    });

    it("should load queued tasks from DB into the in-memory queue", async () => {
      // Stub _loadFromDB rows
      mockDb._stmt.all.mockReturnValueOnce([
        {
          id: "item-1",
          goal_id: "goal-aaa",
          priority: 3,
          description: "High priority task",
          status: "queued",
          created_at: "2026-02-01T10:00:00Z",
          started_at: null,
          completed_at: null,
        },
        {
          id: "item-2",
          goal_id: "goal-bbb",
          priority: 7,
          description: "Low priority task",
          status: "queued",
          created_at: "2026-02-01T11:00:00Z",
          started_at: null,
          completed_at: null,
        },
      ]);
      // Second prepare().get() is for COUNT active tasks
      mockDb._stmt.get.mockReturnValueOnce({ count: 0 });

      await queue.initialize(mockDb);

      expect(queue.queue).toHaveLength(2);
      expect(queue.queue[0].goalId).toBe("goal-aaa");
    });

    it("should restore activeCount from DB on startup", async () => {
      mockDb._stmt.all.mockReturnValueOnce([]); // no queued items
      mockDb._stmt.get.mockReturnValueOnce({ count: 2 }); // 2 already active

      await queue.initialize(mockDb);

      expect(queue.activeCount).toBe(2);
    });

    it("should work without a database (no-op tables / load)", async () => {
      await expect(queue.initialize(null)).resolves.not.toThrow();
      expect(queue.initialized).toBe(true);
    });
  });

  // ─── enqueue ────────────────────────────────────────────────────────────────

  describe("enqueue()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should add a task to the queue", async () => {
      await queue.enqueue(makeTask());
      expect(queue.queue).toHaveLength(1);
    });

    it("should return the enqueued queue item", async () => {
      const task = makeTask({ goalId: "my-goal", priority: 3 });
      const item = await queue.enqueue(task);
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("goalId", "my-goal");
      expect(item).toHaveProperty("status", "queued");
    });

    it("should sort by priority — lower number (higher priority) goes first", async () => {
      await queue.enqueue(makeTask({ goalId: "goal-low", priority: 8 }));
      await queue.enqueue(makeTask({ goalId: "goal-high", priority: 2 }));

      expect(queue.queue[0].goalId).toBe("goal-high"); // priority 2 before 8
      expect(queue.queue[1].goalId).toBe("goal-low");
    });

    it("should insert in the middle when a medium-priority task arrives", async () => {
      await queue.enqueue(makeTask({ goalId: "goal-high", priority: 1 }));
      await queue.enqueue(makeTask({ goalId: "goal-low", priority: 9 }));
      await queue.enqueue(makeTask({ goalId: "goal-mid", priority: 5 }));

      expect(queue.queue.map((i) => i.priority)).toEqual([1, 5, 9]);
    });

    it("should clamp priority to [1, 10]", async () => {
      const item1 = await queue.enqueue(makeTask({ priority: -5 }));
      const item2 = await queue.enqueue(makeTask({ priority: 99 }));
      expect(item1.priority).toBe(1);
      expect(item2.priority).toBe(10);
    });

    it("should persist the task to the database via db.run()", async () => {
      await queue.enqueue(makeTask());
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO autonomous_task_queue"),
        expect.any(Array),
      );
    });

    it("should throw when task has no goalId", async () => {
      await expect(
        queue.enqueue({ priority: 5, description: "bad" }),
      ).rejects.toThrow("Task must have a goalId");
    });

    it('should emit "task-enqueued" with id, goalId, priority, and queueSize', async () => {
      const handler = vi.fn();
      queue.on("task-enqueued", handler);

      const task = makeTask({ goalId: "g1", priority: 3 });
      await queue.enqueue(task);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g1",
          priority: 3,
          queueSize: 1,
        }),
      );
    });
  });

  // ─── dequeue ────────────────────────────────────────────────────────────────

  describe("dequeue()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should return null when the queue is empty", async () => {
      const item = await queue.dequeue();
      expect(item).toBeNull();
    });

    it("should return the highest-priority task (lowest number)", async () => {
      await queue.enqueue(makeTask({ goalId: "low", priority: 9 }));
      await queue.enqueue(makeTask({ goalId: "high", priority: 1 }));

      const item = await queue.dequeue();
      expect(item.goalId).toBe("high");
    });

    it("should remove the returned item from the queue", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      expect(queue.queue).toHaveLength(1);

      await queue.dequeue();
      expect(queue.queue).toHaveLength(0);
    });

    it('should set status to "active" on the returned item', async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      const item = await queue.dequeue();
      expect(item.status).toBe("active");
    });

    it("should set startedAt on the returned item", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      const item = await queue.dequeue();
      expect(item.startedAt).toBeDefined();
      expect(new Date(item.startedAt).getTime()).toBeGreaterThan(0);
    });

    it("should increment activeCount by 1", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      expect(queue.activeCount).toBe(0);

      await queue.dequeue();
      expect(queue.activeCount).toBe(1);
    });

    it('should update the DB record to status="active"', async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.dequeue();
      // At least one run() call should reference 'active'
      const calls = mockDb.run.mock.calls;
      const hasActiveUpdate = calls.some(
        ([sql]) =>
          typeof sql === "string" && sql.toLowerCase().includes("update"),
      );
      expect(hasActiveUpdate).toBe(true);
    });

    it('should emit "task-dequeued" with id, goalId, and queueSize', async () => {
      const handler = vi.fn();
      queue.on("task-dequeued", handler);

      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.dequeue();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g1",
          queueSize: 0,
        }),
      );
    });
  });

  // ─── peek ───────────────────────────────────────────────────────────────────

  describe("peek()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should return null when queue is empty", async () => {
      expect(await queue.peek()).toBeNull();
    });

    it("should return the first item without removing it", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 2 }));
      await queue.enqueue(makeTask({ goalId: "g2", priority: 8 }));

      const peeked = await queue.peek();
      expect(peeked.goalId).toBe("g1"); // highest priority
      expect(queue.queue).toHaveLength(2); // not removed
    });

    it("should not increment activeCount", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.peek();
      expect(queue.activeCount).toBe(0);
    });
  });

  // ─── remove ─────────────────────────────────────────────────────────────────

  describe("remove()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should return true when the task is found and removed", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      const removed = await queue.remove("g1");
      expect(removed).toBe(true);
    });

    it("should return false when the goalId is not in the queue", async () => {
      const removed = await queue.remove("no-such-goal");
      expect(removed).toBe(false);
    });

    it("should reduce queue length by 1", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));

      await queue.remove("g1");
      expect(queue.queue).toHaveLength(1);
      expect(queue.queue[0].goalId).toBe("g2");
    });

    it('should update the DB record status to "removed"', async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.remove("g1");

      const runs = mockDb.run.mock.calls;
      const hasRemoved = runs.some(
        ([sql, params]) =>
          typeof sql === "string" &&
          sql.toLowerCase().includes("update") &&
          Array.isArray(params) &&
          params.includes("removed"),
      );
      expect(hasRemoved).toBe(true);
    });

    it('should emit "task-removed" with id, goalId, and queueSize', async () => {
      const handler = vi.fn();
      queue.on("task-removed", handler);

      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.remove("g1");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: "g1", queueSize: 0 }),
      );
    });
  });

  // ─── markComplete ────────────────────────────────────────────────────────────

  describe("markComplete()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should decrement activeCount by 1", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.dequeue(); // activeCount becomes 1
      expect(queue.activeCount).toBe(1);

      await queue.markComplete("g1", "completed");
      expect(queue.activeCount).toBe(0);
    });

    it("should not let activeCount go below 0", async () => {
      queue.activeCount = 0;
      await queue.markComplete("g1", "completed");
      expect(queue.activeCount).toBe(0);
    });

    it("should update the DB record with the final status", async () => {
      await queue.markComplete("g1", "failed");
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE autonomous_task_queue"),
        expect.arrayContaining(["failed"]),
      );
    });

    it('should default to status="completed" when no status arg is provided', async () => {
      await queue.markComplete("g1");
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["completed"]),
      );
    });

    it('should emit "task-completed" with goalId, status, and activeCount', async () => {
      const handler = vi.fn();
      queue.on("task-completed", handler);

      await queue.markComplete("g1", "completed");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g1",
          status: "completed",
          activeCount: expect.any(Number),
        }),
      );
    });
  });

  // ─── getQueueStatus ──────────────────────────────────────────────────────────

  describe("getQueueStatus()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should return success=true", async () => {
      const result = await queue.getQueueStatus();
      expect(result.success).toBe(true);
    });

    it("should report pending = queue.length", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));
      const result = await queue.getQueueStatus();
      expect(result.data.pending).toBe(2);
    });

    it("should report active = activeCount", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.dequeue(); // activeCount = 1
      const result = await queue.getQueueStatus();
      expect(result.data.active).toBe(1);
    });

    it("should report total = pending + active", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));
      await queue.dequeue(); // 1 active, 1 pending → total = 2
      const result = await queue.getQueueStatus();
      expect(result.data.total).toBe(result.data.pending + result.data.active);
    });

    it("should report maxConcurrent from the config", async () => {
      const result = await queue.getQueueStatus();
      expect(result.data.maxConcurrent).toBe(queue.maxConcurrent);
    });

    it("should report canAcceptMore based on active < maxConcurrent", async () => {
      queue.activeCount = 0;
      let result = await queue.getQueueStatus();
      expect(result.data.canAcceptMore).toBe(true);

      queue.activeCount = queue.maxConcurrent;
      result = await queue.getQueueStatus();
      expect(result.data.canAcceptMore).toBe(false);
    });

    it("should include an items array with queue snapshots", async () => {
      await queue.enqueue(
        makeTask({ goalId: "g1", priority: 3, description: "Task A" }),
      );
      const result = await queue.getQueueStatus();
      expect(Array.isArray(result.data.items)).toBe(true);
      expect(result.data.items[0]).toHaveProperty("goalId", "g1");
    });

    it("should include a byPriority distribution map", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 3 }));
      await queue.enqueue(makeTask({ goalId: "g2", priority: 3 }));
      await queue.enqueue(makeTask({ goalId: "g3", priority: 7 }));

      const result = await queue.getQueueStatus();
      expect(result.data.byPriority["priority-3"]).toBe(2);
      expect(result.data.byPriority["priority-7"]).toBe(1);
    });
  });

  // ─── updatePriority ──────────────────────────────────────────────────────────

  describe("updatePriority()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should return false when goalId is not in the queue", async () => {
      const result = await queue.updatePriority("no-such-goal", 1);
      expect(result).toBe(false);
    });

    it("should return true when the task is found", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      const result = await queue.updatePriority("g1", 2);
      expect(result).toBe(true);
    });

    it("should change the priority on the in-memory item", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      await queue.updatePriority("g1", 2);
      expect(queue.queue.find((i) => i.goalId === "g1").priority).toBe(2);
    });

    it("should re-sort the queue after changing priority", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      await queue.enqueue(makeTask({ goalId: "g2", priority: 8 }));

      // Bump g2 above g1
      await queue.updatePriority("g2", 1);

      expect(queue.queue[0].goalId).toBe("g2");
      expect(queue.queue[1].goalId).toBe("g1");
    });

    it("should clamp priority to [1, 10]", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      await queue.updatePriority("g1", 999);
      expect(queue.queue[0].priority).toBe(10);
    });

    it('should emit "priority-updated" with goalId and newPriority', async () => {
      const handler = vi.fn();
      queue.on("priority-updated", handler);

      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      await queue.updatePriority("g1", 3);

      expect(handler).toHaveBeenCalledWith({ goalId: "g1", newPriority: 3 });
    });

    it("should update the DB record priority", async () => {
      await queue.enqueue(makeTask({ goalId: "g1", priority: 5 }));
      await queue.updatePriority("g1", 2);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE autonomous_task_queue"),
        expect.arrayContaining([2]),
      );
    });
  });

  // ─── reSort ─────────────────────────────────────────────────────────────────

  describe("reSort()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should sort items by priority ascending", async () => {
      // Manually push unsorted items to bypass enqueue sorting
      queue.queue.push(
        {
          id: "a",
          goalId: "g1",
          priority: 7,
          description: "",
          createdAt: "2026-01-01",
        },
        {
          id: "b",
          goalId: "g2",
          priority: 2,
          description: "",
          createdAt: "2026-01-02",
        },
        {
          id: "c",
          goalId: "g3",
          priority: 5,
          description: "",
          createdAt: "2026-01-03",
        },
      );

      queue.reSort();

      expect(queue.queue.map((i) => i.priority)).toEqual([2, 5, 7]);
    });

    it("should use FIFO order for equal-priority tasks (earlier createdAt first)", () => {
      queue.queue.push(
        {
          id: "a",
          goalId: "g1",
          priority: 3,
          description: "",
          createdAt: "2026-01-02",
        },
        {
          id: "b",
          goalId: "g2",
          priority: 3,
          description: "",
          createdAt: "2026-01-01",
        },
      );

      queue.reSort();

      // g2 created earlier should be first
      expect(queue.queue[0].goalId).toBe("g2");
    });

    it('should emit "queue-resorted" event', () => {
      const handler = vi.fn();
      queue.on("queue-resorted", handler);
      queue.reSort();
      expect(handler).toHaveBeenCalledWith({ queueSize: 0 });
    });
  });

  // ─── clear ──────────────────────────────────────────────────────────────────

  describe("clear()", () => {
    beforeEach(async () => {
      await queue.initialize(mockDb);
    });

    it("should empty the in-memory queue", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));

      await queue.clear();
      expect(queue.queue).toHaveLength(0);
    });

    it("should return the count of removed items", async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));
      const count = await queue.clear();
      expect(count).toBe(2);
    });

    it("should return 0 when queue is already empty", async () => {
      const count = await queue.clear();
      expect(count).toBe(0);
    });

    it('should update the DB to mark queued items as "removed"', async () => {
      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.clear();

      const runs = mockDb.run.mock.calls;
      const hasRemoved = runs.some(
        ([sql]) =>
          typeof sql === "string" &&
          sql.toLowerCase().includes("update") &&
          sql.toLowerCase().includes("'removed'"),
      );
      expect(hasRemoved).toBe(true);
    });

    it('should emit "queue-cleared" with removedCount and goalIds', async () => {
      const handler = vi.fn();
      queue.on("queue-cleared", handler);

      await queue.enqueue(makeTask({ goalId: "g1" }));
      await queue.enqueue(makeTask({ goalId: "g2" }));
      await queue.clear();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          removedCount: 2,
          goalIds: expect.arrayContaining(["g1", "g2"]),
        }),
      );
    });
  });
});
