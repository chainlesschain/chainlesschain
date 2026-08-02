/**
 * Background Task Manager - daemon task queue with completion notifications.
 *
 * Tasks run in a brokered Node child with an IPC channel for isolation.
 * Queue persisted to .chainlesschain/tasks/queue.jsonl.
 * Completion notifications delivered to REPL callback.
 *
 * Feature-flag gated: BACKGROUND_TASKS
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getHomeDir } from "../lib/paths.js";
import executionBroker from "../lib/process-execution-broker/index.js";

function defaultKillProcessTree(child, signal = "SIGTERM") {
  // `child.killed` only means Node successfully delivered an earlier signal;
  // the process may still be alive and must remain eligible for escalation.
  if (!child || child.exitCode !== null) return false;
  try {
    if (_deps.platform === "win32" && child.pid) {
      const result = executionBroker.spawnSync(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          encoding: "utf8",
          origin: "background-task:process-tree-kill",
          policy: "allow",
          scope: "background-task",
        },
      );
      if (!result?.error && result?.status === 0) return true;
      return child.kill(signal) !== false;
    }
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch {
        return child.kill(signal) !== false;
      }
    }
    return child.kill(signal) !== false;
  } catch {
    return false;
  }
}

export const _deps = {
  spawn: executionBroker.spawn.bind(executionBroker),
  platform: process.platform,
  killProcessTree: defaultKillProcessTree,
};

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

const RECOVERABLE_TASK_STATUSES = new Set([
  TaskStatus.PENDING,
  TaskStatus.RUNNING,
]);
const SUPPORTED_STRONG_BOUNDARIES = new Set(["filesystem", "network"]);

function validatePinnedSandboxPolicy(policy) {
  if (policy == null) return null;
  if (
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    typeof policy.then === "function" ||
    !Array.isArray(policy.requiredBoundaries) ||
    policy.requiredBoundaries.length === 0 ||
    policy.requiredBoundaries.some(
      (boundary) =>
        typeof boundary !== "string" ||
        !SUPPORTED_STRONG_BOUNDARIES.has(boundary),
    ) ||
    !Object.isFrozen(policy) ||
    !Object.isFrozen(policy.requiredBoundaries)
  ) {
    const error = new TypeError("invalid_background_task_sandbox_policy");
    error.code = "ERR_BACKGROUND_TASK_SANDBOX_POLICY_INVALID";
    error.sandboxReason = "invalid_background_task_sandbox_policy";
    error.sandboxFailClosed = true;
    throw error;
  }
  return policy;
}

function createSandboxError(code, reason, message, requiredBoundaries = []) {
  const error = new Error(message);
  error.code = code;
  error.sandboxReason = reason;
  error.sandboxFailClosed = true;
  error.requiredBoundaries = [...requiredBoundaries];
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  error.sandboxCandidateBackend =
    _deps.platform === "linux" ? "linux-bwrap-workspace" : null;
  return error;
}

function canonicalSandboxBinding(workspaceCwd, executionCwd) {
  try {
    if (
      typeof workspaceCwd !== "string" ||
      !isAbsolute(workspaceCwd) ||
      typeof executionCwd !== "string"
    ) {
      throw new Error("sandbox paths must be absolute");
    }
    const workspaceRoot = realpathSync.native(resolve(workspaceCwd));
    const workingDirectory = realpathSync.native(resolve(executionCwd));
    if (
      !statSync(workspaceRoot).isDirectory() ||
      !statSync(workingDirectory).isDirectory()
    ) {
      throw new Error("sandbox paths must be directories");
    }
    const rel = relative(workspaceRoot, workingDirectory);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("execution cwd escapes workspace");
    }
    return { workspaceRoot, workingDirectory };
  } catch (cause) {
    const error = createSandboxError(
      "ERR_BACKGROUND_TASK_SANDBOX_BINDING_INVALID",
      "background_sandbox_binding_invalid",
      "Background task sandbox workspace/cwd binding is invalid.",
    );
    error.cause = cause;
    throw error;
  }
}

function sameBoundaries(left, right) {
  const normalizedLeft = Array.isArray(left) ? [...left].sort() : null;
  const normalizedRight = Array.isArray(right) ? [...right].sort() : null;
  return (
    normalizedLeft &&
    normalizedRight &&
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function strongWorkerEnvironment(taskId) {
  const blocked = new Set([
    "BASH_ENV",
    "CC_TASK_ID",
    "ELECTRON_RUN_AS_NODE",
    "ENV",
    "GCONV_PATH",
    "OPENSSL_CONF",
    "RUBYOPT",
  ]);
  const blockedPrefixes = ["DYLD_", "LD_", "NODE_", "PYTHON"];
  return Object.fromEntries([
    ...Object.entries(process.env).filter(([key, value]) => {
      const normalizedKey = key.toUpperCase();
      return (
        value != null &&
        !blocked.has(normalizedKey) &&
        !blockedPrefixes.some((prefix) => normalizedKey.startsWith(prefix))
      );
    }),
    ["CC_TASK_ID", taskId],
  ]);
}

export class BackgroundTaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    const resolveSandboxPolicy = options.resolveSandboxPolicy ?? null;
    if (
      resolveSandboxPolicy !== null &&
      typeof resolveSandboxPolicy !== "function"
    ) {
      throw new TypeError("resolveSandboxPolicy must be a function or null");
    }
    this.maxConcurrent = options.maxConcurrent || 3;
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;
    this.historyLimit = options.historyLimit || 50;
    this.nodeId =
      options.nodeId ||
      process.env.CC_NODE_ID ||
      `${process.pid}@${process.platform}`;
    this.recoveryPolicy = options.recoveryPolicy || "claim-stale";
    this.staleNodeTimeout = options.staleNodeTimeout || 5 * 60 * 1000;
    this._policyCwd = resolveSandboxPolicy
      ? resolve(options.policyCwd || process.cwd())
      : null;
    this._resolveSandboxPolicy = resolveSandboxPolicy;
    this.sessionBudget = options.sessionBudget || null;
    if (
      this.sessionBudget !== null &&
      (typeof this.sessionBudget.acquireWork !== "function" ||
        typeof this.sessionBudget.registerAbortable !== "function")
    ) {
      throw new TypeError("sessionBudget must be a SessionResourceBudget");
    }
    this.killGraceMs =
      Number.isFinite(options.killGraceMs) && options.killGraceMs >= 0
        ? options.killGraceMs
        : 2000;
    this.tasks = new Map();
    this.processes = new Map();
    this._budgetLeases = new Map();
    this._budgetAbortCleanup = new Map();
    this._killTimers = new Map();
    this._checkInterval = null;
    this._createSeq = 0;
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

    const cwd = spec.cwd || process.cwd();
    const sandboxPolicy = this._resolvePinnedSandboxPolicy(cwd);
    const sandboxBinding = sandboxPolicy
      ? canonicalSandboxBinding(this._policyCwd, cwd)
      : null;

    const id = `task-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
    const task = {
      id,
      type: spec.type || "shell",
      command: spec.command,
      cwd: sandboxBinding?.workingDirectory || cwd,
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
      sandboxWorkspaceCwd: sandboxBinding?.workspaceRoot || null,
      sandboxRequiredBoundaries: sandboxPolicy
        ? [...sandboxPolicy.requiredBoundaries].sort()
        : null,
      depth:
        Number.isSafeInteger(spec.depth) && spec.depth >= 0 ? spec.depth : 1,
      _seq: ++this._createSeq,
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
    if (this._runningCount() >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent tasks reached (${this.maxConcurrent}). Wait for a task to finish.`,
      );
    }

    const sandboxPolicy = this._resolvePinnedSandboxPolicy(task.cwd);
    const pinnedBoundaries = task.sandboxRequiredBoundaries;
    if (
      Boolean(sandboxPolicy) !== Array.isArray(pinnedBoundaries) ||
      (sandboxPolicy &&
        !sameBoundaries(sandboxPolicy.requiredBoundaries, pinnedBoundaries))
    ) {
      throw createSandboxError(
        "ERR_BACKGROUND_TASK_SANDBOX_POLICY_CHANGED",
        "background_sandbox_policy_changed",
        "Background task sandbox policy changed after creation; recreate the task.",
        sandboxPolicy?.requiredBoundaries || pinnedBoundaries || [],
      );
    }
    if (sandboxPolicy) {
      const currentBinding = canonicalSandboxBinding(this._policyCwd, task.cwd);
      if (
        currentBinding.workspaceRoot !== task.sandboxWorkspaceCwd ||
        currentBinding.workingDirectory !== task.cwd
      ) {
        throw createSandboxError(
          "ERR_BACKGROUND_TASK_SANDBOX_BINDING_CHANGED",
          "background_sandbox_binding_changed",
          "Background task sandbox workspace/cwd identity changed after creation; recreate the task.",
          pinnedBoundaries,
        );
      }
    }

    const budgetLease = this.sessionBudget?.acquireWork({
      id: `background-task:${taskId}`,
      kind: "background-task",
      depth: task.depth ?? 1,
    });
    if (budgetLease && !budgetLease.ok) {
      const error = new Error(
        `Background task blocked by session budget: ${budgetLease.reason}`,
      );
      error.code = "ERR_SESSION_RESOURCE_BUDGET";
      error.budgetReason = budgetLease.reason;
      error.retryable = budgetLease.retryable === true;
      throw error;
    }
    if (budgetLease) this._budgetLeases.set(taskId, budgetLease);

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    task.lastHeartbeat = Date.now();
    task.recoveredFromRestart = false;
    task.recoverySourceStatus = null;
    this._recordHistory(task, "started", { status: task.status });

    const workerPath = join(
      import.meta.dirname || ".",
      "background-task-worker.js",
    );
    let child;
    try {
      child = _deps.spawn(
        process.execPath,
        [
          ...(sandboxPolicy ? [] : process.execArgv),
          workerPath,
          task.command,
          task.cwd,
          task.type,
          task.sandboxWorkspaceCwd || "",
          JSON.stringify(task.sandboxRequiredBoundaries || []),
        ],
        {
          cwd: task.cwd,
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          env: sandboxPolicy
            ? strongWorkerEnvironment(taskId)
            : { ...process.env, CC_TASK_ID: taskId },
          origin: "background-task:worker",
          policy: "allow",
          scope: "background-task",
          shell: false,
          // POSIX group ownership lets cancellation kill the worker and every
          // shell/tool descendant with one negative-pid signal.
          detached: _deps.platform !== "win32",
        },
      );
    } catch (error) {
      this._complete(taskId, TaskStatus.FAILED, null, error.message);
      throw error;
    }

    this.processes.set(taskId, child);

    child.on("message", (msg) => {
      if (task.status !== TaskStatus.RUNNING) return;
      if (msg.type === "heartbeat") {
        task.lastHeartbeat = Date.now();
      } else if (msg.type === "result") {
        this._complete(taskId, TaskStatus.COMPLETED, msg.data, null);
      } else if (msg.type === "error") {
        task.errorCode = msg.code || null;
        task.sandboxReason = msg.sandboxReason || null;
        task.sandboxFailClosed = msg.sandboxFailClosed === true;
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
      this._settleProcessOwnership(taskId, child);
    });

    child.on("error", (err) => {
      this._complete(taskId, TaskStatus.FAILED, null, err.message);
      this._settleProcessOwnership(taskId, child);
    });

    if (this.sessionBudget) {
      try {
        const unregister = this.sessionBudget.registerAbortable(
          `background-task:${taskId}`,
          (reason) => this._stopForBudget(taskId, reason),
        );
        this._budgetAbortCleanup.set(taskId, unregister);
      } catch (error) {
        // Registration happens after spawn, so settlement and lease release
        // must still run even if an injected/host kill adapter itself throws.
        try {
          _deps.killProcessTree(child, "SIGKILL");
        } catch {
          // Keep the live child in `processes` so destroy()/its eventual event
          // retains ownership and can retry instead of orphaning it.
        }
        this._complete(taskId, TaskStatus.FAILED, null, error.message);
        throw error;
      }
    }

    this._persistTask(task, "started");
    this._ensureHeartbeatChecker();
    return task;
  }

  run(spec) {
    const task = this.create(spec);
    this.start(task.id);
    return task;
  }

  _resolvePinnedSandboxPolicy(executionCwd) {
    if (!this._resolveSandboxPolicy) return;
    const sandboxPolicy = validatePinnedSandboxPolicy(
      this._resolveSandboxPolicy({
        workspaceCwd: this._policyCwd,
        executionCwd,
      }),
    );
    if (sandboxPolicy && _deps.platform !== "linux") {
      throw createSandboxError(
        "ERR_BACKGROUND_TASK_SANDBOX_UNSUPPORTED",
        "background_platform_backend_unavailable",
        "Background task strong sandbox execution is only available on Linux.",
        sandboxPolicy.requiredBoundaries,
      );
    }
    return sandboxPolicy;
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getDetails(taskId) {
    return this.get(taskId);
  }

  getHistory(taskId, options = {}) {
    const history = this.get(taskId)?.history || [];
    const limit = Number.isFinite(options.limit)
      ? Math.max(1, options.limit)
      : null;
    const offset = Number.isFinite(options.offset)
      ? Math.max(0, options.offset)
      : 0;

    if (limit === null && offset === 0) {
      return history;
    }

    // offset + null === offset, so an offset-only page (no limit) used to
    // slice(offset, offset) === [] and lose every item past the offset. Use
    // history.length as the end when limit is null.
    const end = limit === null ? history.length : offset + limit;
    const items = history.slice(offset, end);
    return {
      items,
      total: history.length,
      offset,
      limit: limit || history.length,
      hasMore: offset + items.length < history.length,
      nextOffset:
        offset + items.length < history.length ? offset + items.length : null,
    };
  }

  list(filter = {}) {
    let tasks = [...this.tasks.values()];
    if (filter.status) {
      tasks = tasks.filter((task) => task.status === filter.status);
    }
    return tasks.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      // Tiebreak: insertion sequence (newer = higher _seq)
      return (b._seq || 0) - (a._seq || 0);
    });
  }

  stop(taskId) {
    const child = this.processes.get(taskId);
    if (child) {
      this._clearKillTimer(taskId);
      _deps.killProcessTree(child, "SIGTERM");
      // Escalate to SIGKILL only if SIGTERM didn't take. unref() + clear-on-exit
      // so a prompt exit (or process shutdown right after stop) isn't held open
      // for the full grace period by this timer.
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          _deps.killProcessTree(child, "SIGKILL");
        }
      }, this.killGraceMs);
      if (killTimer && typeof killTimer.unref === "function") killTimer.unref();
      this._killTimers.set(taskId, killTimer);
      if (typeof child.once === "function") {
        child.once("exit", () => this._clearKillTimer(taskId));
      }
    }
    const task = this.tasks.get(taskId);
    if (task) {
      this._recordHistory(task, "stop-requested", { requestedBy: "user" });
    }
    this._complete(taskId, TaskStatus.FAILED, null, "Stopped by user");
  }

  _stopForBudget(taskId, reason) {
    const child = this.processes.get(taskId);
    if (child) {
      this._clearKillTimer(taskId);
      _deps.killProcessTree(child, "SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          _deps.killProcessTree(child, "SIGKILL");
        }
      }, this.killGraceMs);
      killTimer?.unref?.();
      this._killTimers.set(taskId, killTimer);
      child.once?.("exit", () => this._clearKillTimer(taskId));
    }
    const budgetReason =
      reason?.budgetReason || reason?.message || "session-budget";
    const task = this.tasks.get(taskId);
    if (task) {
      this._recordHistory(task, "budget-stop-requested", { budgetReason });
    }
    this._complete(
      taskId,
      TaskStatus.FAILED,
      null,
      `Session budget exhausted: ${budgetReason}`,
    );
  }

  _clearKillTimer(taskId) {
    const timer = this._killTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this._killTimers.delete(taskId);
  }

  _releaseBudget(taskId) {
    const unregister = this._budgetAbortCleanup.get(taskId);
    this._budgetAbortCleanup.delete(taskId);
    try {
      unregister?.();
    } catch {
      // Budget cancellation has already been delivered.
    }
    const lease = this._budgetLeases.get(taskId);
    this._budgetLeases.delete(taskId);
    try {
      lease?.release?.();
    } catch {
      // Work leases are idempotent and must not hide task settlement.
    }
  }

  _settleProcessOwnership(taskId, child = null) {
    const ownedChild = this.processes.get(taskId);
    if (child && ownedChild && ownedChild !== child) return false;
    if (ownedChild) this.processes.delete(taskId);
    this._clearKillTimer(taskId);
    this._releaseBudget(taskId);
    return Boolean(ownedChild);
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
    for (const [id, child] of this.processes) {
      this.stop(id);
      // destroy() has no future owner that can wait for the grace timer. Force
      // the detached group/tree down before clearing process accountability.
      if (child.exitCode === null) {
        _deps.killProcessTree(child, "SIGKILL");
      }
      this._clearKillTimer(id);
    }
    this.tasks.clear();
    for (const taskId of [...this._killTimers.keys()]) {
      this._clearKillTimer(taskId);
    }
    for (const taskId of [...this._budgetLeases.keys()]) {
      if (!this.processes.has(taskId)) this._releaseBudget(taskId);
    }
  }

  _complete(taskId, status, result, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (
      task.completedAt !== null &&
      [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.TIMEOUT].includes(
        task.status,
      )
    ) {
      return;
    }

    task.status = status;
    task.completedAt = Date.now();
    task.result = result;
    task.error = error;
    task.outputSummary = this._buildOutputSummary({ result, error, status });
    this._recordHistory(task, "completed", { status, result, error });
    this._persistTask(task, "completed");
    // Logical settlement can arrive over IPC before the worker and its tool
    // descendants have physically exited. Keep the work lease and abort hook
    // until exit/error proves that process ownership has ended.
    if (!this.processes.has(taskId)) this._releaseBudget(taskId);
    this.emit("task:complete", task);
  }

  _runningCount() {
    // A task can be known to be running before/without a local child-process
    // entry (for example a restored task or an alternate executor), while a
    // logically settled task must continue occupying capacity until its owned
    // worker actually exits. Count the union so neither case can bypass the
    // concurrency ceiling, and avoid double-counting ordinary local workers.
    const activeTaskIds = new Set(this.processes.keys());
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.RUNNING) activeTaskIds.add(task.id);
    }
    return activeTaskIds.size;
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
    const task =
      entry?.kind === "task_snapshot" && entry.task ? entry.task : entry;

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
        timestamp:
          normalized.completedAt ||
          normalized.startedAt ||
          normalized.createdAt ||
          Date.now(),
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
    const sameNode =
      previousOwnerNodeId === this.nodeId || !previousOwnerNodeId;
    const lastSeenAt =
      task.lastHeartbeat || task.startedAt || task.createdAt || 0;
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
        reason: stale
          ? "foreign-node-stale-observed"
          : "foreign-node-active-observed",
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
              _deps.killProcessTree(child, "SIGKILL");
              // Retain ownership until exit/error confirms the child is gone;
              // destroy() can otherwise retry a failed host termination.
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
