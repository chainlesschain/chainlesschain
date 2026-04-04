/**
 * Background Task Manager — daemon task queue with completion notifications.
 *
 * Tasks run in child_process.fork() for isolation.
 * Queue persisted to .chainlesschain/tasks/queue.jsonl.
 * Completion notifications delivered to REPL callback.
 *
 * Feature-flag gated: BACKGROUND_TASKS
 */

import { fork } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getHomeDir } from "./paths.js";

function getTasksDir() {
  const dir = join(getHomeDir(), "tasks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function queuePath() {
  return join(getTasksDir(), "queue.jsonl");
}

// ── Task Status ─────────────────────────────────────────────────────────

export const TaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

// ── BackgroundTaskManager ───────────────────────────────────────────────

export class BackgroundTaskManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} [options.maxConcurrent=3] — Max parallel background tasks
   * @param {number} [options.heartbeatTimeout=60000] — Task heartbeat timeout (ms)
   */
  constructor(options = {}) {
    super();
    this.maxConcurrent = options.maxConcurrent || 3;
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;
    this.tasks = new Map(); // id -> task object
    this.processes = new Map(); // id -> child process
    this._checkInterval = null;
  }

  /**
   * Create and queue a new background task.
   * @param {object} spec
   * @param {string} spec.type — Task type (e.g. "shell", "agent", "script")
   * @param {string} spec.command — Command or script to execute
   * @param {string} [spec.cwd] — Working directory
   * @param {string} [spec.description] — Human-readable description
   * @returns {object} Created task
   */
  create(spec) {
    if (this._runningCount() >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent tasks reached (${this.maxConcurrent}). Wait for a task to finish.`,
      );
    }

    const id = `task-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;

    const task = {
      id,
      type: spec.type || "shell",
      command: spec.command,
      cwd: spec.cwd || process.cwd(),
      description: spec.description || spec.command,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      lastHeartbeat: null,
      result: null,
      error: null,
    };

    this.tasks.set(id, task);
    this._persistTask(task);
    return task;
  }

  /**
   * Start a pending task (runs in child process).
   */
  start(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== TaskStatus.PENDING)
      throw new Error(`Task ${taskId} is not pending (status: ${task.status})`);

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    task.lastHeartbeat = Date.now();

    // Create a wrapper script that executes the command
    const child = fork(
      join(import.meta.dirname || ".", "background-task-worker.js"),
      [task.command, task.cwd, task.type],
      {
        cwd: task.cwd,
        silent: true,
        env: { ...process.env, CC_TASK_ID: taskId },
      },
    );

    this.processes.set(taskId, child);

    child.on("message", (msg) => {
      if (msg.type === "heartbeat") {
        task.lastHeartbeat = Date.now();
      } else if (msg.type === "result") {
        this._complete(taskId, TaskStatus.COMPLETED, msg.data, null);
      } else if (msg.type === "error") {
        this._complete(taskId, TaskStatus.FAILED, null, msg.error);
      }
    });

    child.on("exit", (code) => {
      if (task.status === TaskStatus.RUNNING) {
        if (code === 0) {
          this._complete(
            taskId,
            TaskStatus.COMPLETED,
            "Process exited (0)",
            null,
          );
        } else {
          this._complete(
            taskId,
            TaskStatus.FAILED,
            null,
            `Process exited with code ${code}`,
          );
        }
      }
      this.processes.delete(taskId);
    });

    child.on("error", (err) => {
      this._complete(taskId, TaskStatus.FAILED, null, err.message);
      this.processes.delete(taskId);
    });

    this._persistTask(task);
    this._ensureHeartbeatChecker();
    return task;
  }

  /**
   * Create and immediately start a task.
   */
  run(spec) {
    const task = this.create(spec);
    this.start(task.id);
    return task;
  }

  /**
   * Get a task by ID.
   */
  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * List all tasks.
   */
  list(filter = {}) {
    let tasks = [...this.tasks.values()];
    if (filter.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Stop a running task.
   */
  stop(taskId) {
    const child = this.processes.get(taskId);
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2000);
    }
    this._complete(taskId, TaskStatus.FAILED, null, "Stopped by user");
  }

  /**
   * Clean up completed/failed tasks older than maxAge.
   * @param {number} [maxAge=3600000] — Max age in ms (default 1 hour)
   */
  cleanup(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (
        (task.status === TaskStatus.COMPLETED ||
          task.status === TaskStatus.FAILED ||
          task.status === TaskStatus.TIMEOUT) &&
        task.completedAt &&
        task.completedAt < cutoff
      ) {
        this.tasks.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Destroy the manager (kill all running tasks, clear intervals).
   */
  destroy() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
    for (const [id] of this.processes) {
      this.stop(id);
    }
    this.tasks.clear();
    this.processes.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────

  _complete(taskId, status, result, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    task.completedAt = Date.now();
    task.result = result;
    task.error = error;

    this._persistTask(task);
    this.emit("task:complete", task);
  }

  _runningCount() {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.RUNNING) count++;
    }
    return count;
  }

  _persistTask(task) {
    try {
      const line = JSON.stringify(task) + "\n";
      appendFileSync(queuePath(), line, "utf-8");
    } catch (_e) {
      // Non-critical
    }
  }

  _ensureHeartbeatChecker() {
    if (this._checkInterval) return;

    this._checkInterval = setInterval(
      () => {
        const now = Date.now();
        for (const [id, task] of this.tasks) {
          if (
            task.status === TaskStatus.RUNNING &&
            task.lastHeartbeat &&
            now - task.lastHeartbeat > this.heartbeatTimeout
          ) {
            this._complete(id, TaskStatus.TIMEOUT, null, "Heartbeat timeout");
            const child = this.processes.get(id);
            if (child) {
              child.kill("SIGKILL");
              this.processes.delete(id);
            }
          }
        }
      },
      Math.min(this.heartbeatTimeout / 2, 10000),
    );

    // Don't keep process alive for the checker
    if (this._checkInterval.unref) {
      this._checkInterval.unref();
    }
  }
}
