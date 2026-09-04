import { createHash, randomUUID } from "node:crypto";
import { BoundedAsyncQueue, QueueOverloadedError } from "./bounded-queue.js";
import { CliAgentKernelAdapter } from "./cli-agent-kernel-adapter.js";
import { assertRolloutStore } from "./rollout-store.js";
import {
  closeRolloutStore,
  createRolloutStore,
} from "./rollout-store-factory.js";
import { AppServerGraphRuntime } from "./graph-runtime.js";
import { captureAgentSkillOutcomeIndex } from "../evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../skill-vector-authority.js";
import { captureSkillRetrievalRevocationReader } from "../evolution/skill-retrieval-revocation-authority.js";
import { compileGraphDefinition } from "../graph-kernel/compiler.js";
import { createCliContextMemoryRuntime } from "../context-memory-kernel/runtime.js";
import { isEvolutionWorkbenchCliHost } from "../evolution/evolution-workbench-cli-host.js";
import { isGovernedKnowledgeReviewHost } from "../evolution/governed-knowledge-review-host.js";
import {
  contextPlanCreatedNotification,
  memoryDeletionNotification,
  memoryMutationNotification,
  memoryRecalledNotification,
} from "./context-memory-notifications.js";
import {
  APP_SERVER_MIN_PROTOCOL_VERSION,
  APP_SERVER_PROTOCOL_VERSION,
  APP_SERVER_SCHEMA,
  JSON_RPC_ERROR,
  JsonRpcError,
  negotiateProtocol,
  rpcError,
  rpcNotification,
  rpcResult,
  validateApprovalDecision,
  validateAppServerMessage,
} from "./protocol.js";

const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted"]);
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function safeId(value, fallback) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(text)) return text;
  return fallback;
}

function requireObject(value, label = "params") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.INVALID_PARAMS,
      `${label} must be an object`,
    );
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new JsonRpcError(
      JSON_RPC_ERROR.INVALID_PARAMS,
      `${label} is required`,
    );
  }
  return value.trim();
}

function textInput(value) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function turnProjection(turn) {
  return Object.freeze({
    id: turn.id,
    threadId: turn.threadId,
    status: turn.status,
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
    revision: turn.revision,
    terminalEvidence: turn.terminalEvidence,
  });
}

function publicError(error) {
  if (error instanceof JsonRpcError) return error;
  if (error?.code === "CC_ROLLOUT_THREAD_NOT_FOUND") {
    return new JsonRpcError(JSON_RPC_ERROR.NOT_FOUND, error.message);
  }
  if (
    error?.code === "CC_ROLLOUT_IDEMPOTENCY_CONFLICT" ||
    error?.code === "CC_APP_SERVER_TURN_ACTIVE"
  ) {
    return new JsonRpcError(JSON_RPC_ERROR.CONFLICT, error.message);
  }
  if (error?.code === "invalid_argument") {
    return new JsonRpcError(
      JSON_RPC_ERROR.INVALID_PARAMS,
      error.message,
      error.details || null,
    );
  }
  if (
    [
      "revision_conflict",
      "legacy_writer_fenced",
      "scope_denied",
      "replica_tombstone_fenced",
    ].includes(error?.code)
  ) {
    return new JsonRpcError(
      JSON_RPC_ERROR.CONFLICT,
      error.message,
      error.details || null,
    );
  }
  return error;
}

export class CcAppServer {
  constructor({
    send,
    store = null,
    kernel = new CliAgentKernelAdapter(),
    now = Date.now,
    createId = randomUUID,
    maxQueuedRequests = 256,
    maxQueuedRequestBytes = 4 * 1024 * 1024,
    maxConcurrentRequests = 8,
    requestTimeoutMs = 120_000,
    interruptSettlementMs = 30_000,
    transport = "stdio",
    graphRuntime = null,
    evolutionCompositionFactory = null,
    skillOutcomeIndex = null,
    skillVectorAuthority = null,
    skillRetrievalRevocationReader = null,
    evolutionWorkbenchHost = null,
    governedKnowledgeReviewHost = null,
    contextMemoryRuntimeFactory = createCliContextMemoryRuntime,
  } = {}) {
    if (typeof send !== "function") {
      throw new TypeError("CcAppServer requires a send(message) function");
    }
    const resolvedStore = assertRolloutStore(store || createRolloutStore(), {
      requireList: true,
    });
    this.send = send;
    this.store = resolvedStore;
    this._ownsStore = store == null;
    this.kernel = kernel;
    this.now = now;
    this.createId = createId;
    this.requestTimeoutMs = requestTimeoutMs;
    this.interruptSettlementMs = interruptSettlementMs;
    this.transport = transport === "websocket" ? "websocket" : "stdio";
    if (typeof contextMemoryRuntimeFactory !== "function") {
      throw new TypeError("contextMemoryRuntimeFactory must be a function");
    }
    this.contextMemoryRuntimeFactory = contextMemoryRuntimeFactory;
    if (
      evolutionWorkbenchHost !== null &&
      !isEvolutionWorkbenchCliHost(evolutionWorkbenchHost)
    ) {
      throw new TypeError(
        "CcAppServer evolutionWorkbenchHost must be a branded Workbench host",
      );
    }
    this.evolutionWorkbenchHost = evolutionWorkbenchHost;
    if (
      governedKnowledgeReviewHost !== null &&
      !isGovernedKnowledgeReviewHost(governedKnowledgeReviewHost)
    ) {
      throw new TypeError(
        "CcAppServer governedKnowledgeReviewHost must be a branded review host",
      );
    }
    this.governedKnowledgeReviewHost = governedKnowledgeReviewHost;
    this.skillOutcomeIndex =
      skillOutcomeIndex === null
        ? null
        : captureAgentSkillOutcomeIndex(skillOutcomeIndex);
    this.skillVectorAuthority =
      skillVectorAuthority === null
        ? null
        : captureSkillVectorAuthority(skillVectorAuthority);
    this.skillRetrievalRevocationReader =
      skillRetrievalRevocationReader === null
        ? null
        : captureSkillRetrievalRevocationReader(skillRetrievalRevocationReader);
    if (
      this.skillOutcomeIndex !== null &&
      this.skillVectorAuthority !== null &&
      this.skillOutcomeIndex.tenantId !== this.skillVectorAuthority.tenantId
    ) {
      throw new TypeError(
        "App Server retrieval authorities must share one tenant",
      );
    }
    if (
      this.skillVectorAuthority !== null &&
      this.skillRetrievalRevocationReader !== null &&
      this.skillVectorAuthority.tenantId !==
        this.skillRetrievalRevocationReader.tenantId
    ) {
      throw new TypeError(
        "App Server retrieval authorities must share one tenant",
      );
    }
    if (
      this.skillOutcomeIndex !== null &&
      this.skillRetrievalRevocationReader !== null &&
      this.skillOutcomeIndex.tenantId !==
        this.skillRetrievalRevocationReader.tenantId
    ) {
      throw new TypeError(
        "App Server retrieval authorities must share one tenant",
      );
    }
    if (
      graphRuntime &&
      (evolutionCompositionFactory ||
        skillOutcomeIndex ||
        skillVectorAuthority ||
        skillRetrievalRevocationReader)
    ) {
      throw new TypeError(
        "graphRuntime and host-owned Graph authorities cannot both be provided",
      );
    }
    this.graphRuntime =
      graphRuntime ||
      new AppServerGraphRuntime({
        rolloutStore: resolvedStore,
        now,
        createId,
        evolutionCompositionFactory,
        skillOutcomeIndex: this.skillOutcomeIndex,
        skillVectorAuthority: this.skillVectorAuthority,
        skillRetrievalRevocationReader: this.skillRetrievalRevocationReader,
        executeNode: (context) => this._executeGraphNode(context),
        requestHumanTask: (context) => this._requestHumanTask(context),
        onEvent: (event) => {
          void this._notify("graph/event", event).catch(() => {});
        },
      });
    this.initialized = false;
    this.negotiated = null;
    this.client = null;
    this.closed = false;
    this.turns = new Map();
    this.activeTurns = new Map();
    this.pendingClientRequests = new Map();
    this.completedRequests = new Map();
    this.requestQueue = new BoundedAsyncQueue({
      maxItems: maxQueuedRequests,
      maxBytes: maxQueuedRequestBytes,
      sizeOf: (entry) =>
        Buffer.byteLength(JSON.stringify(entry.message), "utf8"),
    });
    this.workers = Array.from(
      { length: Math.max(1, Number(maxConcurrentRequests) || 8) },
      () => this._work(),
    );
  }

  async _work() {
    for await (const entry of this.requestQueue) {
      try {
        const response = await this._handleRequest(entry.message);
        if (response) await this.send(response);
        entry.resolve(response);
      } catch (error) {
        const response = rpcError(entry.message?.id, publicError(error));
        try {
          await this.send(response);
        } finally {
          entry.resolve(response);
        }
      }
    }
  }

  async receive(message) {
    if (this.closed) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.INTERNAL_ERROR,
        "App Server is closed",
      );
    }
    const validation = validateAppServerMessage(message);
    if (!validation.ok) {
      const response = rpcError(
        message?.id,
        new JsonRpcError(
          JSON_RPC_ERROR.INVALID_REQUEST,
          "Invalid JSON-RPC message",
          { errors: validation.errors.slice(0, 32) },
        ),
      );
      await this.send(response);
      return response;
    }
    if (message.method == null && Object.hasOwn(message, "id")) {
      return this._settleClientRequest(message);
    }
    if (!Object.hasOwn(message, "id")) {
      const response = rpcError(
        null,
        new JsonRpcError(
          JSON_RPC_ERROR.INVALID_REQUEST,
          "client notifications are not supported",
        ),
      );
      await this.send(response);
      return response;
    }
    return new Promise((resolve) => {
      try {
        this.requestQueue.push({ message, resolve });
      } catch (error) {
        if (!(error instanceof QueueOverloadedError)) throw error;
        const response = rpcError(
          message.id,
          new JsonRpcError(
            JSON_RPC_ERROR.OVERLOADED,
            "App Server is overloaded",
            { retry_after_ms: error.retryAfterMs },
          ),
        );
        void Promise.resolve(this.send(response)).finally(() =>
          resolve(response),
        );
      }
    });
  }

  _settleClientRequest(message) {
    const pending = this.pendingClientRequests.get(String(message.id));
    if (!pending) return false;
    this.pendingClientRequests.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new JsonRpcError(
          Number(message.error.code) || JSON_RPC_ERROR.INTERNAL_ERROR,
          String(message.error.message || "Client request failed"),
          message.error.data,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
    return true;
  }

  async _requestClient(method, params) {
    const id = `server:${this.createId()}`;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingClientRequests.delete(id);
        reject(
          new JsonRpcError(
            JSON_RPC_ERROR.INTERRUPTED,
            `Client request timed out: ${method}`,
          ),
        );
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pendingClientRequests.set(id, { resolve, reject, timer, method });
    });
    try {
      await this.send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      const pending = this.pendingClientRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingClientRequests.delete(id);
      }
      throw error;
    }
    return response;
  }

  async _handleRequest(message) {
    const method = message.method;
    if (method === "initialize") return this._initialize(message);
    if (!this.initialized) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.NOT_INITIALIZED,
        "initialize must be called first",
      );
    }
    const handlers = {
      "thread/start": () => this._threadStart(message.params),
      "thread/resume": () => this._threadResume(message.params),
      "thread/fork": () => this._threadFork(message.params),
      "thread/read": () => this._threadRead(message.params),
      "thread/list": () => this._threadList(message.params),
      "thread/archive": () => this._threadArchive(message.params),
      "turn/start": () => this._turnStart(message.params),
      "turn/interrupt": () => this._turnInterrupt(message.params),
      "graph/compile": () => this._graphCompile(message.params),
      "graph/run": () => this._graphRun(message.params),
      "graph/status": () => this._graphStatus(message.params),
      "graph/history": () => this._graphHistory(message.params),
      "graph/cancel": () => this._graphCancel(message.params),
      "graph/reconcile": () => this._graphReconcile(message.params),
      "context/plan": () => this._contextPlan(message.params),
      "context/compact": () => this._contextCompact(message.params),
      "memory/recall": () => this._memoryRecall(message.params),
      "memory/propose": () => this._memoryPropose(message.params),
      "memory/decide": () => this._memoryDecide(message.params),
      "memory/delete": () => this._memoryDelete(message.params),
      "memory/reconcile": () => this._memoryReconcile(message.params),
      "evolution/workbench/list": () =>
        this._evolutionWorkbenchList(message.params),
      "evolution/workbench/compare": () =>
        this._evolutionWorkbenchCompare(message.params),
      "evolution/workbench/review": () =>
        this._evolutionWorkbenchReview(message.params),
      "evolution/workbench/rollback": () =>
        this._evolutionWorkbenchRollback(message.params),
      "evolution/knowledge/conflicts": () =>
        this._governedKnowledgeConflicts(message.params),
      "evolution/knowledge/merge": () =>
        this._governedKnowledgeMerge(message.params),
    };
    const handler = handlers[method];
    if (!handler) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.METHOD_NOT_FOUND,
        `Unknown App Server method: ${method}`,
      );
    }
    const key = message.params?.idempotencyKey;
    const cacheKey =
      typeof key === "string" && key ? `${method}\0${key}` : null;
    if (cacheKey && this.completedRequests.has(cacheKey)) {
      return rpcResult(message.id, this.completedRequests.get(cacheKey));
    }
    const result = await handler();
    if (cacheKey) {
      this.completedRequests.set(cacheKey, result);
      if (this.completedRequests.size > 10_000) {
        this.completedRequests.delete(
          this.completedRequests.keys().next().value,
        );
      }
    }
    return rpcResult(message.id, result);
  }

  _initialize(message) {
    if (this.initialized) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.CONFLICT,
        "App Server connection is already initialized",
      );
    }
    const params = requireObject(message.params);
    this.negotiated = negotiateProtocol(params);
    this.client = Object.freeze({ ...params.client });
    this.initialized = true;
    return rpcResult(message.id, {
      server: { name: "chainlesschain-cc-app-server", version: "1" },
      protocolVersion: this.negotiated.protocolVersion,
      minimumProtocolVersion: APP_SERVER_MIN_PROTOCOL_VERSION,
      features: this.negotiated.features,
      downgraded: this.negotiated.downgraded,
      transports: [this.transport],
      websocket: { stability: "experimental" },
      limits: this.requestQueue.snapshot(),
      graphRuntime: this.graphRuntime.runtimeClaims(),
      evolutionWorkbench: {
        available: this.evolutionWorkbenchHost !== null,
        methods:
          this.evolutionWorkbenchHost === null
            ? []
            : ["list", "compare", "review", "rollback"],
      },
      governedKnowledgeReview: {
        available: this.governedKnowledgeReviewHost !== null,
        methods:
          this.governedKnowledgeReviewHost === null
            ? []
            : ["conflicts", "merge"],
      },
      schema: {
        id: APP_SERVER_SCHEMA.$id,
        version: APP_SERVER_PROTOCOL_VERSION,
      },
    });
  }

  _contextMemoryRuntime(options = {}) {
    const runtime = this.contextMemoryRuntimeFactory(options);
    if (!runtime?.kernel) {
      throw new Error("Context/Memory runtime factory returned no kernel");
    }
    return runtime;
  }

  _requireEvolutionWorkbenchHost() {
    if (this.evolutionWorkbenchHost === null) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.NOT_FOUND,
        "Evolution Workbench is not configured for this App Server",
      );
    }
    return this.evolutionWorkbenchHost;
  }

  _evolutionWorkbenchList(rawParams = {}) {
    const params = requireObject(rawParams);
    return this._requireEvolutionWorkbenchHost().list({
      query: typeof params.query === "string" ? params.query : "",
      status: params.status ?? null,
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
    });
  }

  _evolutionWorkbenchCompare(rawParams) {
    const params = requireObject(rawParams);
    return this._requireEvolutionWorkbenchHost().compare(
      requiredString(params.leftPacketDigest, "leftPacketDigest"),
      requiredString(params.rightPacketDigest, "rightPacketDigest"),
    );
  }

  _evolutionWorkbenchReview(rawParams) {
    const params = requireObject(rawParams);
    if (!Array.isArray(params.packetDigests)) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.INVALID_PARAMS,
        "packetDigests must be an array",
      );
    }
    return this._requireEvolutionWorkbenchHost().review({
      packetDigests: params.packetDigests,
      decision: requiredString(params.decision, "decision"),
      reason: requiredString(params.reason, "reason"),
    });
  }

  _evolutionWorkbenchRollback(rawParams) {
    const params = requireObject(rawParams);
    return this._requireEvolutionWorkbenchHost().rollback({
      fromPacketDigest: requiredString(
        params.fromPacketDigest,
        "fromPacketDigest",
      ),
      toPacketDigest: requiredString(params.toPacketDigest, "toPacketDigest"),
      reason: requiredString(params.reason, "reason"),
    });
  }

  _requireGovernedKnowledgeReviewHost() {
    if (this.governedKnowledgeReviewHost === null) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.NOT_FOUND,
        "Governed knowledge review is not configured for this App Server",
      );
    }
    return this.governedKnowledgeReviewHost;
  }

  _governedKnowledgeConflicts(rawParams = {}) {
    const params = requireObject(rawParams);
    return this._requireGovernedKnowledgeReviewHost().list({
      cursor: params.cursor ?? 0,
      limit: params.limit ?? 50,
    });
  }

  _governedKnowledgeMerge(rawParams) {
    const params = requireObject(rawParams);
    return this._requireGovernedKnowledgeReviewHost().merge({
      conflictEnvelopeDigest: requiredString(
        params.conflictEnvelopeDigest,
        "conflictEnvelopeDigest",
      ),
      mergedRecord: requireObject(params.mergedRecord, "mergedRecord"),
      reason: requiredString(params.reason, "reason"),
    });
  }

  async _contextPlan(rawParams) {
    const params = requireObject(rawParams);
    const runtime = this._contextMemoryRuntime({
      scopeKey: `app-server:context:${params.sessionHead || "plan"}`,
    });
    try {
      const plan = await runtime.kernel.planContext(params);
      const notification = contextPlanCreatedNotification(plan);
      await this._notify(notification.method, notification.params);
      return plan;
    } catch (error) {
      await this._notify("context/event", {
        type: "context.plan.rejected",
        reason_code: safeId(error?.code, "context_plan_failed"),
      });
      throw error;
    }
  }

  async _contextCompact(rawParams) {
    const params = requireObject(rawParams);
    const sessionId = requiredString(params.sessionId, "sessionId");
    const operationId = requiredString(params.operationId, "operationId");
    const runtime = this._contextMemoryRuntime({ sessionId });
    await this._notify("context/event", {
      type: "context.compaction.started",
      operation_id: operationId,
      session_id: sessionId,
    });
    try {
      const receipt = await runtime.kernel.compactContext(params);
      const type =
        receipt.status === "reconciliation_required"
          ? "context.compaction.reconciliation_required"
          : ["committed", "degraded"].includes(receipt.status)
            ? "context.compaction.committed"
            : "context.compaction.aborted";
      await this._notify("context/event", {
        type,
        operation_id: operationId,
        session_id: sessionId,
        ...(type === "context.compaction.aborted"
          ? { reason_code: safeId(receipt.status, "compaction_aborted") }
          : { receipt }),
      });
      return receipt;
    } catch (error) {
      await this._notify("context/event", {
        type: "context.compaction.aborted",
        operation_id: operationId,
        session_id: sessionId,
        reason_code: safeId(error?.code, "compaction_failed"),
      });
      throw error;
    }
  }

  async _memoryRecall(rawParams) {
    const params = requireObject(rawParams);
    const runtime = this._contextMemoryRuntime({
      scopeKey: "app-server:memory",
    });
    const result = await runtime.kernel.recallMemory(params);
    const notification = memoryRecalledNotification(result);
    await this._notify(notification.method, notification.params);
    return result;
  }

  async _memoryPropose(rawParams) {
    const params = requireObject(rawParams);
    const runtime = this._contextMemoryRuntime({
      scopeKey: "app-server:memory",
    });
    const mutation = await runtime.kernel.proposeMemory(params);
    await this._notifyMemoryMutation(mutation);
    return mutation;
  }

  async _memoryDecide(rawParams) {
    const params = requireObject(rawParams);
    const runtime = this._contextMemoryRuntime({
      scopeKey: "app-server:memory",
    });
    const mutation = await runtime.kernel.decideMemory(params);
    await this._notifyMemoryMutation(mutation);
    return mutation;
  }

  async _notifyMemoryMutation(mutation) {
    const notification = memoryMutationNotification(mutation);
    if (!notification) return;
    await this._notify(notification.method, notification.params);
  }

  async _memoryDelete(rawParams) {
    const params = requireObject(rawParams);
    const runtime = this._contextMemoryRuntime({
      scopeKey: "app-server:memory",
    });
    const receipt = await runtime.kernel.deleteMemory(params);
    const notification = memoryDeletionNotification(receipt);
    await this._notify(notification.method, notification.params);
    return receipt;
  }

  async _memoryReconcile(rawParams) {
    const params = requireObject(rawParams);
    const operationId = requiredString(params.operationId, "operationId");
    const runtime = this._contextMemoryRuntime({
      scopeKey: "app-server:memory",
    });
    const result = await runtime.kernel.reconcile(operationId);
    const notification = memoryDeletionNotification(result, operationId);
    if (notification)
      await this._notify(notification.method, notification.params);
    return result;
  }

  _graphCompile(rawParams) {
    const params = requireObject(rawParams);
    const compiled = compileGraphDefinition(
      requireObject(params.definition, "definition"),
    );
    return {
      definitionId: compiled.definitionId,
      revision: compiled.revision,
      revisionDigest: compiled.revisionDigest,
      migratedFrom: compiled.migratedFrom,
      definitionMigration: compiled.definitionMigration
        ? {
            schema: compiled.definitionMigration.schema,
            fromVersion: compiled.definitionMigration.fromVersion,
            toVersion: compiled.definitionMigration.toVersion,
            revisionDigest: compiled.definitionMigration.revisionDigest,
            rollbackDigest: compiled.definitionMigration.rollbackDigest,
            backupAvailable: true,
          }
        : null,
      topologicalOrder: [...compiled.topologicalOrder],
    };
  }

  async _graphRun(rawParams) {
    const params = requireObject(rawParams);
    if (params.resume === true) {
      return this.graphRuntime.resume(requiredString(params.runId, "runId"), {
        waitForCompletion: params.waitForCompletion === true,
      });
    }
    return this.graphRuntime.run({
      definition: requireObject(params.definition, "definition"),
      runId: params.runId || this.createId(),
      inputs: params.inputs || {},
      originSurface: params.originSurface || "desktop",
      agentCapacity: params.agentCapacity,
      authorityMode: params.authorityMode || "canonical",
      waitForCompletion: params.waitForCompletion === true,
    });
  }

  _graphStatus(rawParams) {
    const params = requireObject(rawParams);
    return this.graphRuntime.status(requiredString(params.runId, "runId"));
  }

  _graphHistory(rawParams) {
    const params = requireObject(rawParams);
    return this.graphRuntime.history(requiredString(params.runId, "runId"), {
      afterSeq: params.afterSeq,
      limit: params.limit,
      snapshotLimit: params.snapshotLimit,
    });
  }

  _graphCancel(rawParams) {
    const params = requireObject(rawParams);
    return this.graphRuntime.cancel(
      requiredString(params.runId, "runId"),
      params.reason || "cancelled by App Server client",
    );
  }

  _graphReconcile(rawParams) {
    const params = requireObject(rawParams);
    return this.graphRuntime.reconcile(
      requiredString(params.runId, "runId"),
      requireObject(params.reconciliation, "reconciliation"),
    );
  }

  async _executeGraphNode({
    runId,
    nodeId,
    attempt,
    input,
    signal,
    evolutionIngress,
    skillOutcomeIndex,
    skillVectorAuthority,
    skillRetrievalRevocationReader,
  }) {
    const threadId = `graph-agent:${runId}:${nodeId}`;
    const turn = { id: attempt.id, threadId };
    const onAbort = () => {
      void this.kernel.interruptTurn?.(threadId, attempt.id);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      const turnOptions = { ...(input?.options || {}) };
      delete turnOptions.evolutionIngress;
      delete turnOptions.skillOutcomeIndex;
      delete turnOptions.skillVectorAuthority;
      delete turnOptions.skillRetrievalRevocationReader;
      if (evolutionIngress !== null && evolutionIngress !== undefined) {
        turnOptions.evolutionIngress = evolutionIngress;
      }
      if (skillOutcomeIndex !== null && skillOutcomeIndex !== undefined) {
        turnOptions.skillOutcomeIndex = skillOutcomeIndex;
      }
      if (skillVectorAuthority !== null && skillVectorAuthority !== undefined) {
        turnOptions.skillVectorAuthority = skillVectorAuthority;
      }
      if (
        skillRetrievalRevocationReader !== null &&
        skillRetrievalRevocationReader !== undefined
      ) {
        turnOptions.skillRetrievalRevocationReader =
          skillRetrievalRevocationReader;
      }
      const result = await this.kernel.startTurn({
        threadId,
        turnId: attempt.id,
        input: requiredString(input?.prompt, `inputs.${nodeId}.prompt`),
        options: turnOptions,
        emit: (event) =>
          this._notify("graph/event", {
            type: "graph/agent-event",
            runId,
            nodeId,
            attemptId: attempt.id,
            event,
          }),
        requestApproval: (event) => this._requestApproval(turn, event),
      });
      const failed = result?.is_error === true || result?.subtype === "error";
      const output = typeof result?.result === "string" ? result.result : "";
      const receiptThreadId = `graph-executor:${runId}`;
      this.store.start({
        threadId: receiptThreadId,
        title: `Graph executor receipts for ${runId}`,
        metadata: { kind: "graph_executor_receipts", graphRunId: runId },
      });
      const events = this.store.read(receiptThreadId);
      const receiptEvent = this.store.append({
        threadId: receiptThreadId,
        turnId: attempt.id,
        eventType: failed ? "executor.failed" : "executor.succeeded",
        idempotencyKey: `graph-executor:${attempt.id}`,
        payload: {
          runId,
          nodeId,
          attemptId: attempt.id,
          status: failed ? "failed" : "succeeded",
          outputDigest: output ? digest(output) : null,
          error: failed ? String(result?.error || "Agent turn failed") : null,
        },
        expectedRevision: events.at(-1)?.seq,
        expectedHeadHash: events.at(-1)?.hash,
      });
      if (failed) {
        return {
          status: "failed",
          outcomeKnown: true,
          error: result?.error || "Agent turn failed",
        };
      }
      return {
        status: "succeeded",
        terminalEvidence: {
          eventDigest: receiptEvent.hash,
          outputDigest: output ? digest(output) : null,
        },
        usage: result?.usage || {},
      };
    } finally {
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  async _notify(method, params, rollout = null) {
    if (rollout) {
      this.store.append({
        threadId: rollout.threadId,
        turnId: rollout.turnId,
        itemId: rollout.itemId,
        eventType: method.replaceAll("/", "."),
        toolUseId: rollout.toolUseId,
        approvalId: rollout.approvalId,
        traceId: rollout.traceId,
        parentId: rollout.parentId,
        idempotencyKey: rollout.idempotencyKey,
        payload: params,
      });
    }
    await this.send(rpcNotification(method, params));
  }

  async _threadStart(rawParams) {
    const params = requireObject(rawParams);
    const thread = this.store.start({
      threadId: params.threadId || this.createId(),
      title: params.title ?? null,
      metadata: {
        ...(params.metadata || {}),
        agentOptions: params.agentOptions || {},
      },
    });
    await this._notify("thread/updated", { thread });
    return { thread };
  }

  _threadResume(rawParams) {
    const params = requireObject(rawParams);
    const threadId = requiredString(params.threadId, "threadId");
    const thread = this.store.resume(threadId);
    const events = this.store.read(threadId, {
      afterSeq: params.afterEventSeq || 0,
      limit: params.limit || 10_000,
    });
    return { thread, events };
  }

  async _threadFork(rawParams) {
    const params = requireObject(rawParams);
    const sourceThreadId = requiredString(params.threadId, "threadId");
    const requestId = requiredString(
      params.idempotencyKey || this.createId(),
      "idempotencyKey",
    );
    const kernelThreadId = await this.kernel.forkThread?.(
      sourceThreadId,
      requestId,
    );
    const thread = this.store.forkThread(sourceThreadId, {
      threadId: kernelThreadId || params.newThreadId || this.createId(),
      title: params.title ?? null,
    });
    await this._notify("thread/updated", { thread });
    return { thread, historyForked: Boolean(kernelThreadId) };
  }

  _threadRead(rawParams) {
    const params = requireObject(rawParams);
    const threadId = requiredString(params.threadId, "threadId");
    return {
      thread: this.store.resume(threadId),
      events: this.store.read(threadId, {
        afterSeq: params.afterEventSeq || 0,
        limit: params.limit || 10_000,
      }),
    };
  }

  _threadList(rawParams = {}) {
    const params = rawParams == null ? {} : requireObject(rawParams);
    return {
      threads: this.store.list({
        includeArchived: params.includeArchived === true,
        limit: params.limit || 100,
      }),
    };
  }

  async _threadArchive(rawParams) {
    const params = requireObject(rawParams);
    const threadId = requiredString(params.threadId, "threadId");
    if (this.activeTurns.has(threadId)) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.CONFLICT,
        "cannot archive a thread with an active turn",
      );
    }
    await this.kernel.closeThread?.(threadId);
    const thread = this.store.archive(threadId);
    await this._notify("thread/updated", { thread });
    return { thread };
  }

  async _turnStart(rawParams) {
    const params = requireObject(rawParams);
    const threadId = requiredString(params.threadId, "threadId");
    const input = textInput(params.input);
    if (!input) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.INVALID_PARAMS,
        "turn input must contain non-empty text",
      );
    }
    if (this.activeTurns.has(threadId)) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.CONFLICT,
        "thread already has an active turn",
      );
    }
    const thread = this.store.resume(threadId);
    if (thread.status === "archived") {
      throw new JsonRpcError(
        JSON_RPC_ERROR.CONFLICT,
        "archived threads cannot start turns",
      );
    }
    const id = safeId(params.turnId, `turn:${this.createId()}`);
    const createdAt = new Date(this.now()).toISOString();
    const turn = {
      id,
      threadId,
      status: "queued",
      createdAt,
      completedAt: null,
      revision: 0,
      terminalEvidence: null,
      interruptRequested: false,
      assistantStarted: false,
      legacyItemIds: new Map(),
    };
    this.turns.set(id, turn);
    const userItemId = `${id}:user`;
    this.store.append({
      threadId,
      turnId: id,
      itemId: userItemId,
      eventType: "item.completed",
      idempotencyKey: `turn-input:${id}`,
      payload: {
        item: {
          id: userItemId,
          threadId,
          turnId: id,
          kind: "user_message",
          status: "completed",
          content: { text: input },
          createdAt,
          completedAt: createdAt,
        },
      },
    });
    turn.status = "running";
    turn.revision += 1;
    await this._notify(
      "turn/started",
      { turn: turnProjection(turn) },
      {
        threadId,
        turnId: id,
        idempotencyKey: `turn-started:${id}`,
      },
    );
    const active = {
      turn,
      settled: null,
    };
    active.settled = this._runTurn(active, input, params.options || {});
    active.settled.catch(() => {});
    this.activeTurns.set(threadId, active);
    return { turn: turnProjection(turn) };
  }

  async _runTurn(active, input, options) {
    const { turn } = active;
    try {
      const turnOptions = { ...options };
      delete turnOptions.skillOutcomeIndex;
      delete turnOptions.skillVectorAuthority;
      delete turnOptions.skillRetrievalRevocationReader;
      if (this.skillOutcomeIndex !== null) {
        turnOptions.skillOutcomeIndex = this.skillOutcomeIndex;
      }
      if (this.skillVectorAuthority !== null) {
        turnOptions.skillVectorAuthority = this.skillVectorAuthority;
      }
      if (this.skillRetrievalRevocationReader !== null) {
        turnOptions.skillRetrievalRevocationReader =
          this.skillRetrievalRevocationReader;
      }
      const result = await this.kernel.startTurn({
        threadId: turn.threadId,
        turnId: turn.id,
        input,
        options: turnOptions,
        emit: (event) => this._emitKernelEvent(turn, event),
        requestApproval: (event) => this._requestApproval(turn, event),
      });
      if (turn.interruptRequested) {
        await this._completeTurn(turn, "interrupted", result);
      } else if (result?.is_error === true || result?.subtype === "error") {
        await this._completeTurn(turn, "failed", result);
      } else {
        await this._completeTurn(turn, "completed", result);
      }
    } catch (error) {
      await this._completeTurn(
        turn,
        turn.interruptRequested ? "interrupted" : "failed",
        {
          is_error: true,
          error: String(error?.message || error).slice(0, 4096),
          code: error?.code || null,
        },
      );
    } finally {
      if (this.activeTurns.get(turn.threadId) === active) {
        this.activeTurns.delete(turn.threadId);
      }
    }
    return turnProjection(turn);
  }

  async _ensureAssistantStarted(turn, traceId = null) {
    if (turn.assistantStarted) return `${turn.id}:assistant`;
    turn.assistantStarted = true;
    const itemId = `${turn.id}:assistant`;
    await this._notify(
      "item/started",
      {
        item: {
          id: itemId,
          threadId: turn.threadId,
          turnId: turn.id,
          kind: "assistant_message",
          status: "started",
          createdAt: new Date(this.now()).toISOString(),
        },
      },
      {
        threadId: turn.threadId,
        turnId: turn.id,
        itemId,
        traceId,
        idempotencyKey: `assistant-started:${turn.id}`,
      },
    );
    return itemId;
  }

  async _emitKernelEvent(turn, event) {
    if (TERMINAL_TURN_STATUSES.has(turn.status)) return;
    const traceId = safeId(event?.trace_id, null);
    if (
      event?.type === "stream_event" &&
      event.event?.type === "content_block_delta"
    ) {
      const itemId = await this._ensureAssistantStarted(turn, traceId);
      await this._notify(
        "item/delta",
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          delta: event.event.delta,
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          traceId,
        },
      );
      return;
    }
    if (event?.type === "tool_use") {
      const toolUseId = safeId(
        event.id,
        `tool:${turn.id}:${turn.revision + 1}`,
      );
      const itemId = `${turn.id}:tool:${toolUseId}`;
      turn.legacyItemIds.set(toolUseId, itemId);
      await this._notify(
        "tool/requested",
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          toolUseId,
          tool: event.tool,
          args: event.args || {},
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          toolUseId,
          traceId,
          idempotencyKey: `tool-requested:${turn.id}:${toolUseId}`,
        },
      );
      return;
    }
    if (event?.type === "tool_result") {
      const toolUseId = safeId(
        event.id,
        `tool:${turn.id}:${turn.revision + 1}`,
      );
      const itemId =
        turn.legacyItemIds.get(toolUseId) || `${turn.id}:tool:${toolUseId}`;
      await this._notify(
        "tool/result",
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          toolUseId,
          tool: event.tool,
          isError: event.is_error === true,
          error: event.error ?? null,
          result: event.result ?? null,
          permissionDecision: event.permission_decision ?? null,
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          toolUseId,
          traceId,
          idempotencyKey: `tool-result:${turn.id}:${toolUseId}`,
        },
      );
      return;
    }
    if (event?.type === "approval_request") {
      turn.status = "waiting_approval";
      turn.revision += 1;
      const request = this._approvalRequest(turn, event);
      await this._notify(
        "approval/requested",
        { request },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId: request.binding.itemId,
          approvalId: request.id,
          traceId,
          idempotencyKey: `approval-requested:${turn.id}:${request.id}`,
        },
      );
      return;
    }
    if (event?.type === "approval_resolved") {
      turn.status = "running";
      turn.revision += 1;
      await this._notify(
        "approval/resolved",
        {
          threadId: turn.threadId,
          turnId: turn.id,
          approvalId: safeId(event.id, `${turn.id}:approval`),
          approved: event.approved === true,
          via: event.via || "unknown",
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          approvalId: safeId(event.id, `${turn.id}:approval`),
          traceId,
          idempotencyKey: `approval-resolved:${turn.id}:${event.id}:${event.via}`,
        },
      );
      return;
    }
    if (event?.type === "plan_update") {
      await this._notify(
        "item/completed",
        {
          item: {
            id: `${turn.id}:plan:${event.plan_version || turn.revision + 1}`,
            threadId: turn.threadId,
            turnId: turn.id,
            kind: "plan",
            status: "completed",
            content: event,
            createdAt: new Date(this.now()).toISOString(),
            completedAt: new Date(this.now()).toISOString(),
          },
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId: `${turn.id}:plan:${event.plan_version || turn.revision + 1}`,
          traceId,
        },
      );
    }
  }

  _approvalRequest(turn, event) {
    const approvalId = safeId(event.id, `${turn.id}:approval`);
    const itemId = `${turn.id}:approval:${approvalId}`;
    const operation = {
      tool: event.tool ?? null,
      command: event.command ?? null,
      rule: event.rule ?? null,
      legacyBinding: event.binding ?? null,
    };
    return {
      id: approvalId,
      binding: {
        threadId: turn.threadId,
        turnId: turn.id,
        itemId,
        attemptId: null,
        operationDigest: digest(operation),
        policyDigest: digest({ rule: event.rule, risk: event.risk }),
        workspaceDigest: digest({ cwd: this.kernel.cwd || process.cwd() }),
        cwd: this.kernel.cwd || process.cwd(),
        nonce: approvalId,
        expiresAt: new Date(this.now() + this.requestTimeoutMs).toISOString(),
      },
      operation,
      risk: ["low", "medium", "high", "critical"].includes(event.risk)
        ? event.risk
        : "high",
      reason: event.reason || "The Agent Kernel requires approval",
      requestedPermissions: Array.isArray(event.requested_permissions)
        ? event.requested_permissions
        : [],
    };
  }

  async _requestApproval(turn, event) {
    const request = this._approvalRequest(turn, event);
    const result = await this._requestClient("approval/decide", { request });
    const validation = validateApprovalDecision(result);
    if (!validation.ok) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.INVALID_PARAMS,
        "client returned an invalid approval decision",
        { errors: validation.errors },
      );
    }
    return result;
  }

  async _requestHumanTask({ task }) {
    const result = await this._requestClient("humanTask/decide", { task });
    const response = requireObject(result, "humanTask decision");
    const validation = validateApprovalDecision(response.decision);
    const bindings = [
      ["humanTaskId", task.id],
      ["runId", task.runId],
      ["revisionDigest", task.revisionDigest],
      ["operationDigest", task.operationDigest],
      ["nonce", task.nonce],
    ];
    if (
      !validation.ok ||
      typeof response.actorId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(response.actorId) ||
      Object.keys(response).some(
        (field) =>
          ![
            "humanTaskId",
            "runId",
            "revisionDigest",
            "operationDigest",
            "nonce",
            "actorId",
            "decision",
          ].includes(field),
      ) ||
      bindings.some(([field, expected]) => response[field] !== expected)
    ) {
      throw new JsonRpcError(
        JSON_RPC_ERROR.INVALID_PARAMS,
        "client returned an invalid or stale HumanTask decision",
        { errors: validation.errors },
      );
    }
    return response;
  }

  async _completeTurn(turn, status, result) {
    if (TERMINAL_TURN_STATUSES.has(turn.status)) return;
    if (turn.assistantStarted) {
      const itemId = `${turn.id}:assistant`;
      await this._notify(
        "item/completed",
        {
          item: {
            id: itemId,
            threadId: turn.threadId,
            turnId: turn.id,
            kind: "assistant_message",
            status:
              status === "completed"
                ? "completed"
                : status === "interrupted"
                  ? "cancelled"
                  : "failed",
            content: { text: result?.result || "" },
            createdAt: turn.createdAt,
            completedAt: new Date(this.now()).toISOString(),
          },
        },
        {
          threadId: turn.threadId,
          turnId: turn.id,
          itemId,
          idempotencyKey: `assistant-completed:${turn.id}`,
        },
      );
    }
    turn.status = status;
    turn.completedAt = new Date(this.now()).toISOString();
    turn.revision += 1;
    const event = this.store.append({
      threadId: turn.threadId,
      turnId: turn.id,
      eventType: `turn.${status}`,
      idempotencyKey: `turn-terminal:${turn.id}`,
      payload: {
        status,
        result: result?.result ?? null,
        error: result?.error ?? null,
        code: result?.code ?? null,
      },
    });
    turn.terminalEvidence = {
      status:
        status === "completed"
          ? "succeeded"
          : status === "interrupted"
            ? "cancelled"
            : "failed",
      eventDigest: event.hash,
      outputDigest:
        typeof result?.result === "string" ? digest(result.result) : null,
      artifactIds: [],
      commit: null,
      testReceiptIds: [],
    };
    await this.send(
      rpcNotification("turn/completed", {
        turn: turnProjection(turn),
        error:
          status === "failed"
            ? {
                code: result?.code || "CC_AGENT_TURN_FAILED",
                message: String(result?.error || "Agent turn failed").slice(
                  0,
                  4096,
                ),
              }
            : null,
      }),
    );
    await this._notify("thread/updated", {
      thread: this.store.resume(turn.threadId),
    });
  }

  async _turnInterrupt(rawParams) {
    const params = requireObject(rawParams);
    const threadId = requiredString(params.threadId, "threadId");
    const turnId = requiredString(params.turnId, "turnId");
    const active = this.activeTurns.get(threadId);
    if (!active || active.turn.id !== turnId) {
      const known = this.turns.get(turnId);
      if (known && TERMINAL_TURN_STATUSES.has(known.status)) {
        return { turn: turnProjection(known), alreadyTerminal: true };
      }
      throw new JsonRpcError(
        JSON_RPC_ERROR.NOT_FOUND,
        "active turn was not found",
      );
    }
    active.turn.interruptRequested = true;
    await this.kernel.interruptTurn(threadId, turnId);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new JsonRpcError(
              JSON_RPC_ERROR.INTERRUPTED,
              "turn interruption has not physically settled",
              { retry_after_ms: 100 },
            ),
          ),
        this.interruptSettlementMs,
      );
      timer.unref?.();
    });
    try {
      await Promise.race([active.settled, timeout]);
    } finally {
      clearTimeout(timer);
    }
    return { turn: turnProjection(active.turn), physicallySettled: true };
  }

  status() {
    return Object.freeze({
      initialized: this.initialized,
      client: this.client,
      negotiated: this.negotiated,
      queue: this.requestQueue.snapshot(),
      activeTurns: this.activeTurns.size,
      pendingClientRequests: this.pendingClientRequests.size,
      closed: this.closed,
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.requestQueue.close();
    for (const pending of this.pendingClientRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new JsonRpcError(
          JSON_RPC_ERROR.INTERRUPTED,
          "App Server connection closed",
        ),
      );
    }
    this.pendingClientRequests.clear();
    try {
      await this.kernel.close?.();
      await Promise.all(this.workers);
    } finally {
      if (this._ownsStore) closeRolloutStore(this.store);
    }
  }
}
