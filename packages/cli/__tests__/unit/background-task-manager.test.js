import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  rmSync,
  existsSync,
  appendFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory
const testDir = join(tmpdir(), `cc-bg-test-${Date.now()}`);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

const { _deps, BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");
const originalSpawn = _deps.spawn;
const originalPlatform = _deps.platform;

function createPinnedPolicy(...requiredBoundaries) {
  return Object.freeze({
    requiredBoundaries: Object.freeze(requiredBoundaries),
  });
}

describe("BackgroundTaskManager", () => {
  let manager;

  beforeEach(() => {
    _deps.platform = "linux";
    mkdirSync(join(testDir, "tasks"), { recursive: true });
    manager = new BackgroundTaskManager({
      maxConcurrent: 3,
      heartbeatTimeout: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
    _deps.spawn = originalSpawn;
    _deps.platform = originalPlatform;
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

    it("pins a strict policy and canonical workspace before persistence", () => {
      manager.destroy();
      const policyCwd = join(testDir, "trusted-workspace");
      const taskCwd = join(policyCwd, "requested-task-cwd");
      mkdirSync(taskCwd, { recursive: true });
      const policy = createPinnedPolicy("filesystem", "network");
      const resolveSandboxPolicy = vi.fn(() => policy);
      _deps.spawn = vi.fn();
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy,
      });

      const task = manager.create({
        command: "echo sandboxed",
        cwd: taskCwd,
      });

      expect(task).toMatchObject({
        command: "echo sandboxed",
        cwd: taskCwd,
        sandboxWorkspaceCwd: policyCwd,
        sandboxRequiredBoundaries: ["filesystem", "network"],
        status: TaskStatus.PENDING,
      });
      expect(resolveSandboxPolicy).toHaveBeenCalledOnce();
      expect(resolveSandboxPolicy).toHaveBeenCalledWith({
        workspaceCwd: policyCwd,
        executionCwd: taskCwd,
      });
      expect(manager.list()).toEqual([task]);
      expect(manager._createSeq).toBe(1);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(true);
      expect(_deps.spawn).not.toHaveBeenCalled();
    });

    it("rejects a strict task cwd outside the trusted workspace before persistence", () => {
      manager.destroy();
      const policyCwd = join(testDir, "trusted-workspace");
      const taskCwd = join(testDir, "outside-workspace");
      mkdirSync(policyCwd, { recursive: true });
      mkdirSync(taskCwd, { recursive: true });
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy: () => createPinnedPolicy("filesystem"),
      });

      expect(() =>
        manager.create({ command: "echo denied", cwd: taskCwd }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_BACKGROUND_TASK_SANDBOX_BINDING_INVALID",
          sandboxReason: "background_sandbox_binding_invalid",
          sandboxFailClosed: true,
        }),
      );
      expect(manager.list()).toEqual([]);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(false);
    });

    it("fails closed before persistence when the strong backend is unavailable", () => {
      manager.destroy();
      _deps.platform = "win32";
      const policyCwd = join(testDir, "trusted-workspace");
      mkdirSync(policyCwd, { recursive: true });
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy: () => createPinnedPolicy("filesystem"),
      });

      expect(() =>
        manager.create({ command: "echo denied", cwd: policyCwd }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_BACKGROUND_TASK_SANDBOX_UNSUPPORTED",
          sandboxReason: "background_platform_backend_unavailable",
          sandboxFailClosed: true,
          sandboxCandidateBackend: null,
        }),
      );
      expect(manager.list()).toEqual([]);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(false);
    });

    it("rejects unsupported strong boundaries before persistence", () => {
      manager.destroy();
      const policyCwd = join(testDir, "trusted-workspace");
      mkdirSync(policyCwd, { recursive: true });
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy: () => createPinnedPolicy("process"),
      });

      expect(() =>
        manager.create({ command: "echo denied", cwd: policyCwd }),
      ).toThrow(
        expect.objectContaining({
          code: "ERR_BACKGROUND_TASK_SANDBOX_POLICY_INVALID",
          sandboxReason: "invalid_background_task_sandbox_policy",
          sandboxFailClosed: true,
        }),
      );
      expect(manager.list()).toEqual([]);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(false);
    });

    it("preserves policy discovery errors without task side effects", () => {
      manager.destroy();
      const discoveryError = Object.assign(
        new Error("plugin policy discovery failed"),
        {
          code: "ERR_PLUGIN_POLICY_DISCOVERY",
          sandboxFailClosed: true,
        },
      );
      manager = new BackgroundTaskManager({
        policyCwd: join(testDir, "trusted-workspace"),
        resolveSandboxPolicy: () => {
          throw discoveryError;
        },
      });

      let error;
      try {
        manager.create({ command: "echo denied" });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBe(discoveryError);
      expect(manager.list()).toEqual([]);
      expect(manager._createSeq).toBe(0);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(false);
    });

    it("rejects asynchronous policy resolvers before task mutation", () => {
      manager.destroy();
      manager = new BackgroundTaskManager({
        resolveSandboxPolicy: async () => null,
      });

      let error;
      try {
        manager.create({ command: "echo denied" });
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: "ERR_BACKGROUND_TASK_SANDBOX_POLICY_INVALID",
        sandboxReason: "invalid_background_task_sandbox_policy",
        sandboxFailClosed: true,
      });
      expect(manager.list()).toEqual([]);
      expect(manager._createSeq).toBe(0);
      expect(existsSync(join(testDir, "tasks", "queue.jsonl"))).toBe(false);
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

    it("supports paginated history lookup", () => {
      const task = manager.create({ command: "echo history" });
      manager._recordHistory(task, "step-1");
      manager._recordHistory(task, "step-2");
      manager._recordHistory(task, "step-3");

      const page = manager.getHistory(task.id, { offset: 1, limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(4);
      expect(page.items[0].event).toBe("step-1");
      expect(page.hasMore).toBe(true);
      expect(page.nextOffset).toBe(3);
    });

    it("returns all items past the offset when no limit is given", () => {
      const task = manager.create({ command: "echo history" });
      manager._recordHistory(task, "step-1");
      manager._recordHistory(task, "step-2");
      manager._recordHistory(task, "step-3");

      // Regression: an offset-only page (no limit) used to compute
      // slice(offset, offset + null) === slice(offset, offset) === [].
      const page = manager.getHistory(task.id, { offset: 1 });
      expect(page.items).toHaveLength(3);
      expect(page.items[0].event).toBe("step-1");
      expect(page.items[2].event).toBe("step-3");
      expect(page.hasMore).toBe(false);
      expect(page.nextOffset).toBeNull();
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

    it("starts the worker through a brokered Node IPC argv", () => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      child.exitCode = 0;
      _deps.spawn = vi.fn(() => child);
      const task = manager.create({
        command: "echo input with spaces",
        cwd: testDir,
        type: "shell",
      });

      manager.start(task.id);

      const [file, args, options] = _deps.spawn.mock.calls[0];
      expect(file).toBe(process.execPath);
      expect(args.slice(-6)).toEqual([
        expect.stringMatching(/background-task-worker\.js$/),
        "echo input with spaces",
        testDir,
        "shell",
        "",
        "[]",
      ]);
      expect(options).toMatchObject({
        cwd: testDir,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        origin: "background-task:worker",
        policy: "allow",
        scope: "background-task",
        shell: false,
      });
      expect(options).not.toHaveProperty("sandboxPolicy");
      child.emit("exit", 0);
    });

    it("starts a pinned task with a sanitized trusted-worker envelope", () => {
      manager.destroy();
      const policyCwd = join(testDir, "trusted-workspace");
      const taskCwd = join(policyCwd, "nested");
      mkdirSync(taskCwd, { recursive: true });
      const policy = createPinnedPolicy("network", "filesystem");
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy: () => policy,
      });
      const child = new EventEmitter();
      child.kill = vi.fn();
      child.exitCode = 0;
      _deps.spawn = vi.fn(() => child);
      const hostileEnvironment = {
        NODE_OPTIONS: "--require hostile.js",
        NODE_PATH: "hostile-node-path",
        LD_AUDIT: "hostile-audit.so",
        DYLD_INSERT_LIBRARIES: "hostile-dylib",
        PYTHONSTARTUP: "hostile-startup.py",
      };
      const previousEnvironment = Object.fromEntries(
        Object.keys(hostileEnvironment).map((key) => [key, process.env[key]]),
      );
      Object.assign(process.env, hostileEnvironment);
      try {
        const task = manager.create({
          command: "echo sandboxed",
          cwd: taskCwd,
        });
        manager.start(task.id);

        const [file, args, options] = _deps.spawn.mock.calls[0];
        expect(file).toBe(process.execPath);
        expect(args).toEqual([
          expect.stringMatching(/background-task-worker\.js$/),
          "echo sandboxed",
          taskCwd,
          "shell",
          policyCwd,
          JSON.stringify(["filesystem", "network"]),
        ]);
        expect(options).toMatchObject({
          cwd: taskCwd,
          origin: "background-task:worker",
          shell: false,
        });
        expect(options.env.CC_TASK_ID).toBe(task.id);
        for (const key of Object.keys(hostileEnvironment)) {
          expect(options.env).not.toHaveProperty(key);
        }
        expect(options).not.toHaveProperty("sandboxPolicy");
        child.emit("exit", 0);
      } finally {
        for (const [key, previous] of Object.entries(previousEnvironment)) {
          if (previous === undefined) delete process.env[key];
          else process.env[key] = previous;
        }
      }
    });

    it("rechecks policy before start and leaves a newly restricted task pending", () => {
      manager.destroy();
      const policyCwd = join(testDir, "trusted-workspace");
      const taskCwd = join(policyCwd, "requested-task-cwd");
      mkdirSync(taskCwd, { recursive: true });
      let policy = null;
      const resolveSandboxPolicy = vi.fn(() => policy);
      manager = new BackgroundTaskManager({
        policyCwd,
        resolveSandboxPolicy,
      });
      _deps.spawn = vi.fn();

      const task = manager.create({
        command: "echo initially-allowed",
        cwd: taskCwd,
      });
      const queueFile = join(testDir, "tasks", "queue.jsonl");
      const queueBeforeStart = readFileSync(queueFile, "utf-8");
      const historyBeforeStart = [...task.history];
      policy = createPinnedPolicy("filesystem");

      let error;
      try {
        manager.start(task.id);
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: "ERR_BACKGROUND_TASK_SANDBOX_POLICY_CHANGED",
        sandboxReason: "background_sandbox_policy_changed",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem"],
        missingBoundaries: ["filesystem"],
      });
      expect(resolveSandboxPolicy).toHaveBeenCalledTimes(2);
      expect(resolveSandboxPolicy).toHaveBeenLastCalledWith({
        workspaceCwd: policyCwd,
        executionCwd: taskCwd,
      });
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.startedAt).toBeNull();
      expect(task.lastHeartbeat).toBeNull();
      expect(task.history).toEqual(historyBeforeStart);
      expect(readFileSync(queueFile, "utf-8")).toBe(queueBeforeStart);
      expect(manager.processes.size).toBe(0);
      expect(_deps.spawn).not.toHaveBeenCalled();
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
      expect(handler.mock.calls[0][0].outputSummary.preview).toContain(
        "output",
      );
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
      expect(
        recovered
          .getHistory(task.id)
          .some((item) => item.event === "recovered"),
      ).toBe(true);
      recovered.destroy();
    });

    it("skips recovery for foreign nodes when local-only policy is used", () => {
      const foreignTask = {
        id: "task-foreign",
        type: "shell",
        command: "echo foreign",
        description: "foreign",
        status: TaskStatus.RUNNING,
        createdAt: Date.now() - 1000,
        startedAt: Date.now() - 1000,
        lastHeartbeat: Date.now() - 1000,
        history: [{ event: "created", timestamp: Date.now() - 1000 }],
        ownerNodeId: "node-b",
      };
      appendFileSync(
        join(testDir, "tasks", "queue.jsonl"),
        `${JSON.stringify(foreignTask)}\n`,
        "utf-8",
      );

      const recovered = new BackgroundTaskManager({
        recoverOnStart: true,
        nodeId: "node-a",
        recoveryPolicy: "local-only",
      });
      const restored = recovered.get("task-foreign");
      expect(restored.status).toBe(TaskStatus.RUNNING);
      expect(restored.recoveredFromRestart).toBe(false);
      expect(
        recovered
          .getHistory("task-foreign")
          .some((item) => item.event === "recovery-skipped"),
      ).toBe(true);
      recovered.destroy();
    });
  });
});
