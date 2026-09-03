"use strict";

const { EventEmitter } = require("node:events");
const { AppServerPilotClient } = require("./vendor/agent-sdk/index.js");

/**
 * VS Code host adapter for the shared, fixed-capability App Server client.
 * The extension entry point owns the feature flag and user interaction; this
 * class remains VS Code-free so its process and protocol behavior is testable.
 */
class IdeAppServerPilot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.ClientClass = options.ClientClass || AppServerPilotClient;
    this.client = options.client || null;
    this.lastThreadId = null;
    this.lastTurnId = null;
    this.contextMemoryProjection = {
      lastPlan: null,
      lastCompactionReceipt: null,
      lastRecall: null,
      memoryRevision: 0,
      memories: new Map(),
    };
    this.on("error", () => {});
    if (this.client) this._attach(this.client);
  }

  get status() {
    return {
      enabled: true,
      surface: "vscode",
      lastThreadId: this.lastThreadId,
      lastTurnId: this.lastTurnId,
      contextMemory: {
        lastPlan: this.contextMemoryProjection.lastPlan,
        lastCompactionReceipt:
          this.contextMemoryProjection.lastCompactionReceipt,
        lastRecall: this.contextMemoryProjection.lastRecall,
        memoryRevision: this.contextMemoryProjection.memoryRevision,
        memories: [...this.contextMemoryProjection.memories.values()],
      },
      ...(this.client?.status || {
        running: false,
        initialized: false,
        pendingRequestCount: 0,
        capabilities: null,
        lastError: null,
      }),
    };
  }

  _getClient() {
    if (this.client) return this.client;
    const cliPath = this.options.getCliPath?.() || this.options.cliPath || "cc";
    const cwd = this.options.getCwd?.() || this.options.cwd;
    this.client = new this.ClientClass({
      cliPath,
      cwd,
      env: this.options.env,
      storageBackend: this.options.storageBackend,
      stateDirectory: this.options.stateDirectory,
      statePath: this.options.statePath,
      serverQueueCap: this.options.serverQueueCap ?? 256,
      maxPendingRequests: this.options.maxPendingRequests ?? 128,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 120_000,
      clientName: "chainlesschain-vscode-app-server-pilot",
      clientVersion: this.options.clientVersion || "1",
      onServerRequest: (request) => this._handleServerRequest(request),
    });
    this._attach(this.client);
    return this.client;
  }

  async _handleServerRequest(request) {
    if (request?.method !== "approval/decide") {
      return {
        kind: "decline",
        reason: "VS Code App Server pilot has no handler for this request",
      };
    }
    if (typeof this.options.reviewApproval !== "function") {
      return {
        kind: "decline",
        reason: "VS Code App Server approval UI is unavailable",
      };
    }
    try {
      return await this.options.reviewApproval(request.params?.request);
    } catch (error) {
      return {
        kind: "decline",
        reason: `VS Code App Server approval failed: ${
          error?.message || String(error)
        }`.slice(0, 2_048),
      };
    }
  }

  _attach(client) {
    for (const eventName of [
      "ready",
      "notification",
      "stderr",
      "overloaded",
      "exit",
      "error",
    ]) {
      client.on(eventName, (payload) => {
        if (eventName === "notification") this._projectNotification(payload);
        this.emit(eventName, payload);
      });
    }
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
    if (value.memory_id && value.record) {
      this.contextMemoryProjection.memories.set(value.memory_id, value.record);
      while (this.contextMemoryProjection.memories.size > 256) {
        this.contextMemoryProjection.memories.delete(
          this.contextMemoryProjection.memories.keys().next().value,
        );
      }
    } else if (value.type === "memory.purged" && value.memory_id) {
      this.contextMemoryProjection.memories.delete(value.memory_id);
    }
  }

  start() {
    return this._getClient().start();
  }

  async close() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.lastThreadId = null;
    this.lastTurnId = null;
  }

  async threadStart(params = {}) {
    const result = await this._getClient().threadStart(params);
    this.lastThreadId = result?.thread?.id || this.lastThreadId;
    return result;
  }

  threadResume(params) {
    return this._getClient().threadResume(params);
  }

  threadFork(params) {
    return this._getClient().threadFork(params);
  }

  threadRead(params) {
    return this._getClient().threadRead(params);
  }

  threadList(params = {}) {
    return this._getClient().threadList(params);
  }

  threadArchive(params) {
    return this._getClient().threadArchive(params);
  }

  async turnStart(params) {
    const result = await this._getClient().turnStart(params);
    this.lastThreadId = result?.turn?.threadId || params?.threadId || null;
    this.lastTurnId = result?.turn?.id || this.lastTurnId;
    return result;
  }

  turnInterrupt(params) {
    return this._getClient().turnInterrupt(params);
  }

  contextPlan(params) {
    return this._getClient().contextPlan(params);
  }

  contextCompact(params) {
    return this._getClient().contextCompact(params);
  }

  memoryRecall(params) {
    return this._getClient().memoryRecall(params);
  }

  memoryPropose(params) {
    return this._getClient().memoryPropose(params);
  }

  memoryDecide(params) {
    return this._getClient().memoryDecide(params);
  }

  memoryDelete(params) {
    return this._getClient().memoryDelete(params);
  }

  memoryReconcile(params) {
    return this._getClient().memoryReconcile(params);
  }

  evolutionWorkbenchList(params = {}) {
    return this._getClient().evolutionWorkbenchList(params);
  }

  evolutionWorkbenchCompare(params) {
    return this._getClient().evolutionWorkbenchCompare(params);
  }

  evolutionWorkbenchReview(params) {
    return this._getClient().evolutionWorkbenchReview(params);
  }

  evolutionWorkbenchRollback(params) {
    return this._getClient().evolutionWorkbenchRollback(params);
  }
}

module.exports = { IdeAppServerPilot };
