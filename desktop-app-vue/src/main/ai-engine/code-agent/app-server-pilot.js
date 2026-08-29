const { EventEmitter } = require("events");
const { AppServerPilotClient } = require("../../vendor/agent-sdk/index.js");
const {
  spawnWithDesktopBroker,
} = require("../../process/desktop-process-broker.js");
const { resolveActorDid } = require("../../permission/current-user-context.js");

const MAX_PARAMS_BYTES = 256 * 1024;
const MAX_PENDING_HUMAN_TASKS = 128;
const MAX_PROJECTED_MEMORIES = 256;

function normalizeParams(value) {
  const params = value == null ? {} : value;
  const prototype =
    typeof params === "object" && params !== null
      ? Object.getPrototypeOf(params)
      : null;
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError("App Server pilot parameters must be an object");
  }
  const serialized = JSON.stringify(params);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized) > MAX_PARAMS_BYTES
  ) {
    throw new RangeError("App Server pilot parameters exceed 256 KiB");
  }
  return JSON.parse(serialized);
}

/**
 * Feature-gated Desktop host for the shared Agent SDK App Server client.
 *
 * Every process goes through the Desktop broker and the renderer-facing layer
 * exposes fixed Thread/Turn/Graph methods only. Ordinary tool approvals remain
 * fail-closed here; durable Graph HumanTasks are routed to a reviewed Desktop
 * card and the authenticated actor is derived in main, never from renderer IPC.
 */
class DesktopAppServerPilot extends EventEmitter {
  constructor(options = {}) {
    super();
    const ClientClass = options.ClientClass || AppServerPilotClient;
    const spawnProcess = options.spawnProcess || spawnWithDesktopBroker;
    const requestTimeoutMs = Math.max(
      1,
      Number(options.requestTimeoutMs) || 120_000,
    );
    this.pendingHumanTasks = new Map();
    this.contextMemoryProjection = {
      lastPlan: null,
      lastCompactionReceipt: null,
      lastRecall: null,
      memoryRevision: 0,
      memories: new Map(),
    };
    this.resolveActorDid = options.resolveActorDid || resolveActorDid;
    this.humanTaskTimeoutMs = Math.max(
      1,
      Math.min(
        Number(options.humanTaskTimeoutMs) ||
          Math.max(1, requestTimeoutMs - 1_000),
        Math.max(1, requestTimeoutMs - 1),
      ),
    );
    this.client =
      options.client ||
      new ClientClass({
        cliPath: options.cliPath,
        cwd: options.cwd,
        storageBackend: options.storageBackend,
        stateDirectory: options.stateDirectory,
        statePath: options.statePath,
        serverQueueCap: options.serverQueueCap ?? 256,
        maxPendingRequests: options.maxPendingRequests ?? 128,
        requestTimeoutMs,
        env: options.env,
        clientName: "chainlesschain-desktop-app-server-pilot",
        clientVersion: options.clientVersion || "1",
        onServerRequest: (request) => this._handleServerRequest(request),
        spawn: (command, args, spawnOptions = {}) =>
          spawnProcess(command, args, {
            ...spawnOptions,
            windowsHide: true,
            shell: false,
            origin: "desktop:coding-agent-app-server-pilot",
            provenance: {
              component: "coding-agent-app-server-pilot",
            },
          }),
      });

    this.on("error", () => {});
    for (const eventName of [
      "ready",
      "notification",
      "stderr",
      "overloaded",
      "exit",
      "error",
    ]) {
      this.client.on(eventName, (payload) => {
        if (eventName === "notification") {
          this._projectNotification(payload);
        }
        this.emit(eventName, payload);
      });
    }
  }

  get status() {
    return {
      enabled: true,
      surface: "desktop",
      contextMemory: {
        lastPlan: this.contextMemoryProjection.lastPlan,
        lastCompactionReceipt:
          this.contextMemoryProjection.lastCompactionReceipt,
        lastRecall: this.contextMemoryProjection.lastRecall,
        memoryRevision: this.contextMemoryProjection.memoryRevision,
        memories: [...this.contextMemoryProjection.memories.values()],
      },
      ...this.client.status,
    };
  }

  start() {
    return this.client.start();
  }

  close() {
    for (const pending of this.pendingHumanTasks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("App Server HumanTask host closed"));
    }
    this.pendingHumanTasks.clear();
    return this.client.close();
  }

  _handleServerRequest(request) {
    if (request?.method !== "humanTask/decide") {
      return {
        kind: "decline",
        reason: "Desktop App Server pilot has no handler for this request",
      };
    }
    const task = normalizeParams(request.params?.task);
    for (const field of [
      "id",
      "runId",
      "nodeId",
      "revisionDigest",
      "operationDigest",
      "nonce",
    ]) {
      if (typeof task[field] !== "string" || !task[field]) {
        throw new TypeError(`HumanTask ${field} is required`);
      }
    }
    if (!Array.isArray(task.decisions)) {
      throw new TypeError("HumanTask decisions must be an array");
    }
    if (this.pendingHumanTasks.size >= MAX_PENDING_HUMAN_TASKS) {
      throw new Error("Desktop HumanTask review queue is full");
    }
    if (this.pendingHumanTasks.has(task.id)) {
      throw new Error(`HumanTask is already pending review: ${task.id}`);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHumanTasks.delete(task.id);
        reject(new Error(`Desktop HumanTask review timed out: ${task.id}`));
      }, this.humanTaskTimeoutMs);
      timer.unref?.();
      this.pendingHumanTasks.set(task.id, { task, resolve, reject, timer });
      this.emit("human-task-requested", task);
    });
  }

  respondHumanTask(payload) {
    const response = normalizeParams(payload);
    const humanTaskId = String(response.humanTaskId || "").trim();
    const pending = this.pendingHumanTasks.get(humanTaskId);
    if (!pending) {
      throw new Error("HumanTask is no longer pending in this Desktop host");
    }
    const { task } = pending;
    for (const [field, expected] of [
      ["runId", task.runId],
      ["revisionDigest", task.revisionDigest],
      ["operationDigest", task.operationDigest],
      ["nonce", task.nonce],
    ]) {
      if (response[field] !== expected) {
        throw new Error(`HumanTask response has a stale ${field}`);
      }
    }
    const decision = response.decision;
    if (
      !decision ||
      typeof decision !== "object" ||
      Array.isArray(decision) ||
      !["acceptOnce", "decline", "cancel"].includes(decision.kind)
    ) {
      throw new TypeError("Desktop HumanTask decision is invalid");
    }
    const allowedDecisionFields =
      decision.kind === "acceptOnce"
        ? new Set(["kind"])
        : new Set(["kind", "reason"]);
    if (
      Object.keys(decision).some(
        (field) => !allowedDecisionFields.has(field),
      ) ||
      (["decline", "cancel"].includes(decision.kind) &&
        decision.reason !== undefined &&
        (typeof decision.reason !== "string" || decision.reason.length > 2_048))
    ) {
      throw new TypeError("Desktop HumanTask decision fields are invalid");
    }
    const actorId = this.resolveActorDid(null, {
      channel: "coding-agent:app-server-human-task-decide",
      field: "actorId",
    });
    if (typeof actorId !== "string" || !actorId) {
      throw new Error("HumanTask review requires an authenticated Desktop DID");
    }
    if (
      task.separationOfDuties === true &&
      task.decisions.some((entry) => entry.actorId === actorId)
    ) {
      throw new Error(
        "This HumanTask requires a different authenticated reviewer",
      );
    }
    clearTimeout(pending.timer);
    this.pendingHumanTasks.delete(humanTaskId);
    const result = {
      humanTaskId,
      runId: task.runId,
      revisionDigest: task.revisionDigest,
      operationDigest: task.operationDigest,
      nonce: task.nonce,
      actorId,
      decision: JSON.parse(JSON.stringify(decision)),
    };
    pending.resolve(result);
    this.emit("human-task-settled", {
      humanTaskId,
      runId: task.runId,
      actorId,
      decision: result.decision,
    });
    return { accepted: true, humanTaskId, actorId };
  }

  listPendingHumanTasks() {
    return [...this.pendingHumanTasks.values()].map(({ task }) =>
      JSON.parse(JSON.stringify(task)),
    );
  }

  _projectNotification(notification) {
    const method = notification?.method;
    const value = notification?.params;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (method === "context/event") {
      if (value.type === "context.plan.created" && value.plan) {
        this.contextMemoryProjection.lastPlan = value.plan;
        if (Number.isSafeInteger(value.plan.memoryRevision)) {
          this.contextMemoryProjection.memoryRevision =
            value.plan.memoryRevision;
        }
      } else if (
        [
          "context.compaction.committed",
          "context.compaction.reconciliation_required",
        ].includes(value.type) &&
        value.receipt
      ) {
        this.contextMemoryProjection.lastCompactionReceipt = value.receipt;
        if (Number.isSafeInteger(value.receipt.memoryRevision)) {
          this.contextMemoryProjection.memoryRevision =
            value.receipt.memoryRevision;
        }
      }
      return;
    }
    if (method !== "memory/event") return;
    if (value.type === "memory.recalled" && value.result) {
      this.contextMemoryProjection.lastRecall = value.result;
      if (Number.isSafeInteger(value.result.memoryRevision)) {
        this.contextMemoryProjection.memoryRevision =
          value.result.memoryRevision;
      }
      return;
    }
    if (value.type === "memory.purged" && value.memory_id) {
      this.contextMemoryProjection.memories.delete(value.memory_id);
      return;
    }
    if (value.memory_id && value.record) {
      this.contextMemoryProjection.memories.set(value.memory_id, value.record);
      while (
        this.contextMemoryProjection.memories.size > MAX_PROJECTED_MEMORIES
      ) {
        this.contextMemoryProjection.memories.delete(
          this.contextMemoryProjection.memories.keys().next().value,
        );
      }
    }
  }

  threadStart(params = {}) {
    return this.client.threadStart(normalizeParams(params));
  }

  threadResume(params) {
    return this.client.threadResume(normalizeParams(params));
  }

  threadFork(params) {
    return this.client.threadFork(normalizeParams(params));
  }

  threadRead(params) {
    return this.client.threadRead(normalizeParams(params));
  }

  threadList(params = {}) {
    return this.client.threadList(normalizeParams(params));
  }

  threadArchive(params) {
    return this.client.threadArchive(normalizeParams(params));
  }

  turnStart(params) {
    return this.client.turnStart(normalizeParams(params));
  }

  turnInterrupt(params) {
    return this.client.turnInterrupt(normalizeParams(params));
  }

  graphCompile(params) {
    return this.client.graphCompile(normalizeParams(params));
  }

  graphRun(params) {
    return this.client.graphRun(normalizeParams(params));
  }

  graphStatus(params) {
    return this.client.graphStatus(normalizeParams(params));
  }

  graphHistory(params) {
    return this.client.graphHistory(normalizeParams(params));
  }

  graphCancel(params) {
    return this.client.graphCancel(normalizeParams(params));
  }

  graphReconcile(params) {
    return this.client.graphReconcile(normalizeParams(params));
  }

  contextPlan(params) {
    return this.client.contextPlan(normalizeParams(params));
  }

  contextCompact(params) {
    return this.client.contextCompact(normalizeParams(params));
  }

  memoryRecall(params) {
    return this.client.memoryRecall(normalizeParams(params));
  }

  memoryPropose(params) {
    return this.client.memoryPropose(normalizeParams(params));
  }

  memoryDecide(params) {
    return this.client.memoryDecide(normalizeParams(params));
  }

  memoryDelete(params) {
    return this.client.memoryDelete(normalizeParams(params));
  }

  memoryReconcile(params) {
    return this.client.memoryReconcile(normalizeParams(params));
  }
}

module.exports = {
  DesktopAppServerPilot,
  MAX_PROJECTED_MEMORIES,
  MAX_PENDING_HUMAN_TASKS,
  MAX_PARAMS_BYTES,
  normalizeParams,
};
