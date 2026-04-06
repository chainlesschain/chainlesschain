import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory
const testDir = join(tmpdir(), `cc-bg-test-${Date.now()}`);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

const { BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");

describe("BackgroundTaskManager", () => {
  let manager;

  beforeEach(() => {
    mkdirSync(join(testDir, "tasks"), { recursive: true });
    manager = new BackgroundTaskManager({
      maxConcurrent: 3,
      heartbeatTimeout: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ── create ────────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates a pending task with auto-generated ID", () => {
      const task = manager.create({ command: "echo hello", type: "shell" });
      expect(task.id).toMatch(/^task-/);
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.command).toBe("echo hello");
      expect(task.createdAt).toBeGreaterThan(0);
    });

    it("uses provided description", () => {
      const task = manager.create({
        command: "npm test",
        description: "Run tests",
      });
      expect(task.description).toBe("Run tests");
    });

    it("defaults description to command", () => {
      const task = manager.create({ command: "ls -la" });
      expect(task.description).toBe("ls -la");
    });

    it("throws when max concurrent reached", () => {
      manager.maxConcurrent = 0;
      expect(() => manager.create({ command: "echo" })).toThrow(
        /Max concurrent/,
      );
    });

    it("defaults type to shell", () => {
      const task = manager.create({ command: "pwd" });
      expect(task.type).toBe("shell");
    });
  });

  // ── get / list ────────────────────────────────────────────────────

  describe("get() and list()", () => {
    it("gets task by ID", () => {
      const task = manager.create({ command: "echo" });
      expect(manager.get(task.id)).toBe(task);
    });

    it("returns null for unknown ID", () => {
      expect(manager.get("nonexistent")).toBeNull();
    });

    it("returns details and history for a task", () => {
      const task = manager.create({ command: "echo history" });
      const details = manager.getDetails(task.id);
      expect(details.id).toBe(task.id);
      expect(manager.getHistory(task.id)[0].event).toBe("created");
    });

    it("lists all tasks sorted by creation", () => {
      manager.create({ command: "echo 1" });
      manager.create({ command: "echo 2" });
      manager.create({ command: "echo 3" });
      const tasks = manager.list();
      expect(tasks).toHaveLength(3);
      expect(tasks[0].createdAt).toBeGreaterThanOrEqual(tasks[1].createdAt);
    });

    it("filters by status", () => {
      const t1 = manager.create({ command: "echo" });
      const t2 = manager.create({ command: "echo" });
      t2.status = TaskStatus.COMPLETED;
      const pending = manager.list({ status: TaskStatus.PENDING });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(t1.id);
    });
  });

  // ── start (mocked child_process) ─────────────────────────────────

  describe("start()", () => {
    it("throws for unknown task ID", () => {
      expect(() => manager.start("nope")).toThrow(/not found/);
    });

    it("throws for non-pending task", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;
      expect(() => manager.start(task.id)).toThrow(/not pending/);
    });
  });

  // ── stop ──────────────────────────────────────────────────────────

  describe("stop()", () => {
    it("marks task as failed with stopped message", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;
      manager.stop(task.id);
      expect(task.status).toBe(TaskStatus.FAILED);
      expect(task.error).toBe("Stopped by user");
    });
  });

  // ── cleanup ───────────────────────────────────────────────────────

  describe("cleanup()", () => {
    it("removes old completed tasks", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.COMPLETED;
      task.completedAt = Date.now() - 7200000; // 2 hours ago

      const removed = manager.cleanup(3600000); // 1 hour max age
      expect(removed).toBe(1);
      expect(manager.get(task.id)).toBeNull();
    });

    it("keeps recent completed tasks", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.COMPLETED;
      task.completedAt = Date.now(); // just now

      const removed = manager.cleanup(3600000);
      expect(removed).toBe(0);
      expect(manager.get(task.id)).not.toBeNull();
    });

    it("keeps running tasks", () => {
      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;

      const removed = manager.cleanup(0);
      expect(removed).toBe(0);
    });
  });

  // ── destroy ───────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("clears all tasks and intervals", () => {
      manager.create({ command: "echo 1" });
      manager.create({ command: "echo 2" });
      manager.destroy();
      expect(manager.list()).toHaveLength(0);
    });
  });

  // ── events ────────────────────────────────────────────────────────

  describe("events", () => {
    it("emits task:complete on completion", () => {
      const handler = vi.fn();
      manager.on("task:complete", handler);

      const task = manager.create({ command: "echo" });
      task.status = TaskStatus.RUNNING;
      // Simulate completion
      manager._complete(task.id, TaskStatus.COMPLETED, "output", null);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].status).toBe(TaskStatus.COMPLETED);
      expect(handler.mock.calls[0][0].result).toBe("output");
    });

    it("emits task:complete on failure", () => {
      const handler = vi.fn();
      manager.on("task:complete", handler);

      const task = manager.create({ command: "bad" });
      task.status = TaskStatus.RUNNING;
      manager._complete(task.id, TaskStatus.FAILED, null, "command not found");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].status).toBe(TaskStatus.FAILED);
      expect(handler.mock.calls[0][0].error).toBe("command not found");
    });
  });

  // ── TaskStatus enum ───────────────────────────────────────────────

  describe("TaskStatus", () => {
    it("has all expected values", () => {
      expect(TaskStatus.PENDING).toBe("pending");
      expect(TaskStatus.RUNNING).toBe("running");
      expect(TaskStatus.COMPLETED).toBe("completed");
      expect(TaskStatus.FAILED).toBe("failed");
      expect(TaskStatus.TIMEOUT).toBe("timeout");
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe("persistence", () => {
    it("persists tasks to queue.jsonl", () => {
      manager.create({ command: "echo test" });
      const queueFile = join(testDir, "tasks", "queue.jsonl");
      expect(existsSync(queueFile)).toBe(true);
    });

    it("recovers pending and running tasks on restart", () => {
      const task = manager.create({ command: "echo recover" });
      task.status = TaskStatus.RUNNING;
      appendFileSync(
        join(testDir, "tasks", "queue.jsonl"),
        `${JSON.stringify(task)}\n`,
        "utf-8",
      );

      const recovered = new BackgroundTaskManager({ recoverOnStart: true });
      const restored = recovered.get(task.id);
      expect(restored.status).toBe(TaskStatus.PENDING);
      expect(restored.recoveredFromRestart).toBe(true);
      expect(recovered.getHistory(task.id).some((item) => item.event === "recovered")).toBe(true);
      recovered.destroy();
    });
  });
});
