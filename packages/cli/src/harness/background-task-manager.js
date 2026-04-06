/**
 * Background Task Manager - daemon task queue with completion notifications.
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
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getHomeDir } from "../lib/paths.js";

function getTasksDir() {
  const dir = join(getHomeDir(), "tasks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function queuePath() {
  return join(getTasksDir(), "queue.jsonl");
}

export const TaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

const RECOVERABLE_TASK_STATUSES = new Set([TaskStatus.PENDING, TaskStatus.RUNNING]);

export class BackgroundTaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrent = options.maxConcurrent || 3;
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;
    this.historyLimit = options.historyLimit || 50;
    this.nodeId =
      options.nodeId || process.env.CC_NODE_ID || `${process.pid}@${process.platform}`;
    this.recoveryPolicy = options.recoveryPolicy || "claim-stale";
    this.staleNodeTimeout = options.staleNodeTimeout || 5 * 60 * 1000;
    this.tasks = new Map();
    this.processes = new Map();
    this._checkInterval = null;
    if (options.recoverOnStart) {
      this._loadPersistedTasks({
        recoverPending: options.recoverPending !== false,
      });
    }
  }

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
      history: [],
      outputSummary: null,
      recoveredFromRestart: false,
      recoverySourceStatus: null,
      ownerNodeId: spec.ownerNodeId || this.nodeId,
      recoveryDecision: null,
    };

    this._recordHistory(task, "created", {
      status: task.status,
      description: task.description,
    });
    this.tasks.set(id, task);
    this._persistTask(task, "created");
    return task;
  }

  start(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== TaskStatus.PENDING) {
      throw new Error(`Task ${taskId} is not pending (status: ${task.status})`);
    }

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    task.lastHeartbeat = Date.now();
    task.recoveredFromRestart = false;
    task.recoverySourceStatus = null;
    this._recordHistory(task, "started", { status: task.status });

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
          this._complete(taskId, TaskStatus.COMPLETED, "Process exited (0)", null);
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

    this._persistTask(task, "started");
    this._ensureHeartbeatChecker();
    return task;
  }

  run(spec) {
    const task = this.create(spec);
    this.start(task.id);
    return task;
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getDetails(taskId) {
    return this.get(taskId);
  }

  getHistory(taskId, options = {}) {
    const history = this.get(taskId)?.history || [];
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : null;
    const offset = Number.isFinite(options.offset) ? Math.max(0, options.offset) : 0;

    if (limit === null && offset === 0) {
      return history;
    }

    const items = history.slice(offset, offset + limit);
    return {
      items,
      total: history.length,
      offset,
      limit: limit || history.length,
      hasMore: offset + items.length < history.length,
      nextOffset: offset + items.length < history.length ? offset + items.length : null,
    };
  }

  list(filter = {}) {
    let tasks = [...this.tasks.values()];
    if (filter.status) {
      tasks = tasks.filter((task) => task.status === filter.status);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  stop(taskId) {
    const child = this.processes.get(taskId);
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2000);
    }
    const task = this.tasks.get(taskId);
    if (task) {
      this._recordHistory(task, "stop-requested", { requestedBy: "user" });
    }
    this._complete(taskId, TaskStatus.FAILED, null, "Stopped by user");
  }

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
        this._persistTask(task, "cleaned-up", { removedAt: Date.now() });
        removed++;
      }
    }
    return removed;
  }

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

  _complete(taskId, status, result, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    task.completedAt = Date.now();
    task.result = result;
    task.error = error;
    task.outputSummary = this._buildOutputSummary({ result, error, status });
    this._recordHistory(task, "completed", { status, result, error });
    this._persistTask(task, "completed");
    this.emit("task:complete", task);
  }

  _runningCount() {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.RUNNING) count++;
    }
    return count;
  }

  _persistTask(task, eventType = "snapshot", meta = {}) {
    try {
      const line =
        JSON.stringify({
          kind: "task_snapshot",
          eventType,
          persistedAt: Date.now(),
          meta,
          task,
        }) + "\n";
      appendFileSync(queuePath(), line, "utf-8");
    } catch (_e) {
      // Non-critical
    }
  }

  _recordHistory(task, event, meta = {}) {
    if (!Array.isArray(task.history)) {
      task.history = [];
    }
    task.history.push({
      event,
      timestamp: Date.now(),
      ...meta,
    });
    if (task.history.length > this.historyLimit) {
      task.history = task.history.slice(-this.historyLimit);
    }
  }

  _loadPersistedTasks(options = {}) {
    const filePath = queuePath();
    if (!existsSync(filePath)) return;

    try {
      const content = readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const task = this._normalizePersistedTask(parsed);
        if (!task?.id) continue;
        this.tasks.set(task.id, task);
      }

      if (options.recoverPending !== false) {
        this._recoverInterruptedTasks();
      }
    } catch (_err) {
      // Non-critical
    }
  }

  _normalizePersistedTask(entry) {
    const task = entry?.kind === "task_snapshot" && entry.task ? entry.task : entry;

    if (!task || typeof task !== "object") {
      return null;
    }

    const normalized = {
      ...task,
      history: Array.isArray(task.history) ? [...task.history] : [],
      outputSummary: task.outputSummary || this._buildOutputSummary(task),
      recoveredFromRestart: Boolean(task.recoveredFromRestart),
      recoverySourceStatus: task.recoverySourceStatus || null,
      ownerNodeId: task.ownerNodeId || this.nodeId,
      recoveryDecision: task.recoveryDecision || null,
    };

    if (normalized.history.length === 0) {
      normalized.history.push({
        event: "loaded",
        timestamp: normalized.completedAt || normalized.startedAt || normalized.createdAt || Date.now(),
        status: normalized.status,
      });
    }

    return normalized;
  }

  _recoverInterruptedTasks() {
    for (const task of this.tasks.values()) {
      if (!RECOVERABLE_TASK_STATUSES.has(task.status)) continue;
      const previousStatus = task.status;
      const decision = this._decideRecovery(task);
      task.recoveryDecision = decision;

      if (!decision.shouldRecover) {
        this._recordHistory(task, "recovery-skipped", {
          fromStatus: previousStatus,
          policy: decision.policy,
          reason: decision.reason,
          ownerNodeId: task.ownerNodeId || null,
          candidateNodeId: this.nodeId,
        });
        this._persistTask(task, "recovery-skipped", {
          fromStatus: previousStatus,
          policy: decision.policy,
          reason: decision.reason,
        });
        continue;
      }

      task.status = TaskStatus.PENDING;
      task.startedAt = null;
      task.lastHeartbeat = null;
      task.completedAt = null;
      task.result = null;
      task.error = null;
      task.outputSummary = null;
      task.recoveredFromRestart = true;
      task.recoverySourceStatus = previousStatus;
      task.recoveredAt = Date.now();
      task.ownerNodeId = this.nodeId;
      this._recordHistory(task, "recovered", {
        fromStatus: previousStatus,
        status: task.status,
        policy: decision.policy,
        reason: decision.reason,
        previousOwnerNodeId: decision.previousOwnerNodeId,
        claimedByNodeId: this.nodeId,
      });
      this._persistTask(task, "recovered", {
        fromStatus: previousStatus,
        policy: decision.policy,
        reason: decision.reason,
      });
    }
  }

  _decideRecovery(task) {
    const previousOwnerNodeId = task.ownerNodeId || null;
    const sameNode = previousOwnerNodeId === this.nodeId || !previousOwnerNodeId;
    const lastSeenAt = task.lastHeartbeat || task.startedAt || task.createdAt || 0;
    const stale = Date.now() - lastSeenAt > this.staleNodeTimeout;

    if (sameNode) {
      return {
        shouldRecover: true,
        policy: this.recoveryPolicy,
        reason: "same-node",
        previousOwnerNodeId,
      };
    }

    if (this.recoveryPolicy === "local-only") {
      return {
        shouldRecover: false,
        policy: this.recoveryPolicy,
        reason: "owned-by-other-node",
        previousOwnerNodeId,
      };
    }

    if (this.recoveryPolicy === "observe-only") {
      return {
        shouldRecover: false,
        policy: this.recoveryPolicy,
        reason: stale ? "foreign-node-stale-observed" : "foreign-node-active-observed",
        previousOwnerNodeId,
      };
    }

    return {
      shouldRecover: stale,
      policy: this.recoveryPolicy,
      reason: stale ? "stale-foreign-node-claimed" : "foreign-node-still-fresh",
      previousOwnerNodeId,
    };
  }

  _buildOutputSummary(task = {}) {
    const resultText = this._stringifyOutput(task.result);
    const errorText = this._stringifyOutput(task.error);
    const primary = errorText || resultText;

    if (!primary) return null;

    const lines = primary.split(/\r?\n/).filter(Boolean);
    return {
      kind: errorText ? "error" : "result",
      status: task.status || null,
      preview: primary.slice(0, 240),
      lineCount: lines.length,
      charCount: primary.length,
      truncated: primary.length > 240,
    };
  }

  _stringifyOutput(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    try {
      return JSON.stringify(value).trim();
    } catch {
      return String(value).trim();
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

    if (this._checkInterval.unref) {
      this._checkInterval.unref();
    }
  }
}
