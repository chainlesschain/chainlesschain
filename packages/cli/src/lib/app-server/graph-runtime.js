import { randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
} from "../graph-kernel/compiler.js";
import { createGraphAuthorityBinding } from "../graph-kernel/authority.js";
import { GraphEventStore } from "../graph-kernel/event-store.js";
import { GraphKernel } from "../graph-kernel/runtime.js";

const TERMINAL = new Set([
  "succeeded",
  "failed",
  "partial",
  "cancelled",
  "blocked",
  "deadlocked",
  "budget_exhausted",
  "compensated",
  "compensation_failed",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function runtimeError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "AppServerGraphRuntimeError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function evidence(value) {
  const source = value?.terminalEvidence || {};
  const terminal = {};
  if (DIGEST.test(String(source.outputDigest || ""))) {
    terminal.outputDigest = source.outputDigest;
  }
  if (source.commit) terminal.commit = String(source.commit);
  if (Array.isArray(source.artifactIds) && source.artifactIds.length) {
    terminal.artifactIds = source.artifactIds.map(String);
  }
  if (Array.isArray(source.testReceiptIds) && source.testReceiptIds.length) {
    terminal.testReceiptIds = source.testReceiptIds.map(String);
  }
  if (Object.keys(terminal).length === 0) {
    throw runtimeError(
      "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
      "Graph node executor did not return immutable terminal evidence",
    );
  }
  return terminal;
}

function usage(value) {
  const source = value?.usage || {};
  return {
    turns: Math.max(0, Number(source.turns) || 1),
    tokens: Math.max(
      0,
      Number(source.tokens) ||
        Number(source.input_tokens || 0) + Number(source.output_tokens || 0),
    ),
    costUsd: Math.max(0, Number(source.costUsd) || 0),
    wallMs: Math.max(0, Number(source.wallMs) || 0),
  };
}

function nodeInput(inputs, nodeId) {
  const value = inputs?.[nodeId];
  if (typeof value === "string") return { prompt: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value, prompt: String(value.prompt || value.input || "") };
  }
  return { prompt: "" };
}

/**
 * Host-owned Graph executor used by fixed App Server capabilities. GraphKernel
 * owns ready/attempt/effect/terminal state; the injected executor owns only a
 * single real Agent turn and must return immutable evidence.
 */
export class AppServerGraphRuntime {
  constructor({
    rolloutStore,
    eventStore = rolloutStore
      ? new GraphEventStore({ rolloutStore })
      : new GraphEventStore(),
    executeNode,
    now = Date.now,
    createId = randomUUID,
    onEvent = null,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
  } = {}) {
    if (typeof executeNode !== "function") {
      throw new TypeError("AppServerGraphRuntime requires executeNode()");
    }
    this.eventStore = eventStore;
    this.rolloutStore = eventStore.rolloutStore;
    this.executeNode = executeNode;
    this.now = now;
    this.createId = createId;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.runs = new Map();
    this.drives = new Map();
    this.active = new Map();
  }

  _requestThread(runId) {
    return `graph-request:${graphDigest(
      runId,
      "cc.app-server.graph-run-id/v1",
    ).slice(7)}`;
  }

  _persistRequest(runId, request) {
    const threadId = this._requestThread(runId);
    this.rolloutStore.start({
      threadId,
      title: `Graph request ${runId}`,
      metadata: { kind: "graph_run_request", graphRunId: runId },
    });
    const events = this.rolloutStore.read(threadId);
    this.rolloutStore.append({
      threadId,
      eventType: "graph.request.committed",
      idempotencyKey: `graph-request:${runId}`,
      payload: request,
      expectedRevision: events.at(-1)?.event_seq,
      expectedHeadHash: events.at(-1)?.hash,
    });
  }

  _readRequest(runId) {
    let events;
    try {
      events = this.rolloutStore.read(this._requestThread(runId));
    } catch (error) {
      throw runtimeError(
        "CC_GRAPH_REQUEST_RECEIPT_MISSING",
        `Graph run has no durable request receipt: ${runId}`,
        { cause: error },
      );
    }
    const receipt = [...events]
      .reverse()
      .find((event) => event.event_type === "graph.request.committed");
    if (!receipt?.payload?.definition || !receipt?.payload?.inputs) {
      throw runtimeError(
        "CC_GRAPH_REQUEST_RECEIPT_FORGED",
        `Graph run request receipt is incomplete: ${runId}`,
      );
    }
    return receipt.payload;
  }

  runtimeClaims() {
    return Object.freeze({
      originSurface: "desktop",
      surface: "desktop",
      execution: "real",
      persistence: "durable",
      isolated: true,
      terminalEvidence: true,
      authorityModes: Object.freeze(["shadow", "canonical"]),
      featureGated: true,
    });
  }

  _emit(runId, type, payload = {}) {
    try {
      this.onEvent?.({ type, runId, ...payload });
    } catch {
      // Observability never owns execution authority.
    }
  }

  _newKernel({ runId, generation = 1, authoritySource = "graph_kernel" }) {
    const writerId = `app-server:${runId}:writer:${process.pid}:${generation}`;
    const writerLeaseId = `app-server:${runId}:lease:${this.createId()}`;
    const kernel = new GraphKernel({
      eventStore: this.eventStore,
      now: this.now,
      writerId,
      writerLeaseId,
      authoritySource,
      authorityGeneration: generation,
      writerLeaseTtlMs: this.writerLeaseTtlMs,
    });
    return { kernel, writerId, writerLeaseId, generation };
  }

  start({
    definition,
    runId = this.createId(),
    inputs = {},
    originSurface = "desktop",
    agentCapacity = 1,
    authorityMode = "canonical",
  } = {}) {
    if (!["shadow", "canonical"].includes(authorityMode)) {
      throw runtimeError(
        "CC_GRAPH_AUTHORITY_MODE_UNSUPPORTED",
        "App Server Graph execution accepts shadow or canonical authority",
      );
    }
    const compiled = compileGraphDefinition(definition);
    const id = String(runId);
    const request = {
      definition: compiled.definition,
      inputs: { ...inputs },
      originSurface,
      agentCapacity: Math.max(1, Number(agentCapacity) || 1),
      authorityMode,
    };
    this._persistRequest(id, request);
    if (this.runs.has(id)) {
      const existing = this.runs.get(id);
      if (existing.compiled.revisionDigest !== compiled.revisionDigest) {
        throw runtimeError(
          "CC_GRAPH_RUN_CONFLICT",
          "Graph run id is already bound to another revision",
        );
      }
      return this.status(id);
    }
    let persisted = [];
    try {
      persisted = this.eventStore.read(id);
    } catch (error) {
      if (error?.code !== "CC_ROLLOUT_THREAD_NOT_FOUND") throw error;
    }
    if (persisted.length) {
      const recovered = this._recover(id);
      const projection = recovered.kernel.getRun(id);
      if (projection.revisionDigest !== compiled.revisionDigest) {
        throw runtimeError(
          "CC_GRAPH_RUN_CONFLICT",
          "persisted Graph run is bound to another revision",
        );
      }
      if (projection.authorityMode !== authorityMode) {
        throw runtimeError(
          "CC_GRAPH_MIGRATION_REQUIRED",
          "persisted Graph run authority mode cannot change without a migration saga",
        );
      }
      recovered.compiled = compiled;
      recovered.inputs = { ...inputs };
      return projection;
    }
    const holder = this._newKernel({
      runId: id,
      authoritySource:
        authorityMode === "shadow" ? "graph_kernel_shadow" : "graph_kernel",
    });
    const projection = holder.kernel.startRun(compiled, {
      runId: id,
      originSurface,
    });
    holder.kernel.registerAgent(id, {
      agentId: "app-server-agent",
      capacity: Math.max(1, Number(agentCapacity) || 1),
      resident: true,
    });
    holder.kernel.sealRun(id);
    this.runs.set(id, {
      ...holder,
      runId: id,
      compiled,
      inputs: { ...inputs },
    });
    this._emit(id, "graph/run-started", { projection });
    return this.status(id);
  }

  run(options = {}) {
    const projection = this.start(options);
    if (projection.authorityMode === "shadow") {
      return Promise.resolve(this.status(projection.id));
    }
    const settled = this._drive(projection.id);
    if (options.waitForCompletion === true) return settled;
    return Promise.resolve(projection);
  }

  _drive(runId) {
    if (this.drives.has(runId)) return this.drives.get(runId);
    const drive = this._driveLoop(runId).finally(() => {
      this.drives.delete(runId);
    });
    drive.catch(() => {});
    this.drives.set(runId, drive);
    return drive;
  }

  async _driveLoop(runId) {
    const entry = this.runs.get(runId);
    if (!entry)
      throw runtimeError("CC_GRAPH_RUN_NOT_FOUND", "Graph run missing");
    const { kernel } = entry;
    for (let steps = 0; steps < 10_000; steps += 1) {
      const status = kernel.getRun(runId);
      if (
        TERMINAL.has(status.status) ||
        status.status === "reconciliation_required"
      ) {
        this._emit(runId, "graph/run-settled", { projection: status });
        return status;
      }
      const next = kernel
        .readyNodes(runId)
        .find((candidate) => candidate.dispatch !== "subgraph");
      if (!next) return status;
      await this._executeAttempt(entry, next.nodeId);
    }
    throw runtimeError(
      "CC_GRAPH_DRIVE_LIMIT",
      "Graph executor exceeded its bounded scheduling step limit",
    );
  }

  async _executeAttempt(entry, nodeId) {
    const { kernel } = entry;
    const runId = entry.runId;
    const attempt = kernel.assignNode(runId, nodeId, "app-server-agent", {
      ttlMs: this.writerLeaseTtlMs,
      leaseId: `app-server-attempt:${this.createId()}`,
      grant: { executor: "agent_kernel", originSurface: "desktop" },
    });
    let effect = null;
    if (attempt.effectIdempotencyKey) {
      effect = kernel.beginEffect(runId, {
        effectId: `app-server-effect:${this.createId()}`,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey: attempt.effectIdempotencyKey,
        operationDigest: graphDigest(
          { runId, nodeId, input: nodeInput(entry.inputs, nodeId) },
          "cc.app-server.graph-operation/v1",
        ),
      });
    }
    const controller = new AbortController();
    let releaseActive;
    const done = new Promise((resolve) => {
      releaseActive = resolve;
    });
    this.active.set(attempt.id, { controller, done });
    this._emit(runId, "graph/node-started", { nodeId, attemptId: attempt.id });
    try {
      const result = await this.executeNode({
        runId,
        nodeId,
        attempt,
        input: nodeInput(entry.inputs, nodeId),
        signal: controller.signal,
      });
      if (!result || !["succeeded", "completed"].includes(result.status)) {
        const error = runtimeError(
          "CC_GRAPH_EXECUTOR_FAILED",
          result?.error || "Graph node executor did not succeed",
        );
        error.outcomeKnown = result?.outcomeKnown === true;
        throw error;
      }
      const receipt = graphExecutorReceipt(result);
      if (controller.signal.aborted) return kernel.getRun(runId);
      if (effect) {
        kernel.settleEffect(runId, {
          effectId: effect.id,
          attemptId: attempt.id,
          leaseId: attempt.leaseId,
          fence: attempt.fence,
          outcome: "committed",
          receipt: { receiptDigest: receipt.receiptDigest },
        });
      }
      const settled = kernel.settleAttempt(runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "succeeded",
        evidence: receipt.terminalEvidence,
        usage: receipt.usage,
      });
      this._emit(runId, "graph/node-settled", {
        nodeId,
        attemptId: attempt.id,
        outcome: "succeeded",
      });
      return settled;
    } catch (error) {
      if (controller.signal.aborted) return kernel.getRun(runId);
      if (effect) {
        const known = error?.outcomeKnown === true;
        kernel.settleEffect(runId, {
          effectId: effect.id,
          attemptId: attempt.id,
          leaseId: attempt.leaseId,
          fence: attempt.fence,
          outcome: known ? "failed" : "unknown",
        });
        if (!known) {
          this._emit(runId, "graph/node-reconciliation-required", {
            nodeId,
            attemptId: attempt.id,
            error: error?.message || String(error),
          });
          return kernel.getRun(runId);
        }
      }
      const settled = kernel.settleAttempt(runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "failed",
        error: error?.message || String(error),
      });
      this._emit(runId, "graph/node-settled", {
        nodeId,
        attemptId: attempt.id,
        outcome: "failed",
      });
      return settled;
    } finally {
      this.active.delete(attempt.id);
      releaseActive();
    }
  }

  status(runId) {
    const id = String(runId);
    const entry = this.runs.get(id) || this._recover(id);
    return entry.kernel.getRun(id);
  }

  _recover(runId) {
    let events;
    try {
      events = this.eventStore.read(runId);
    } catch (error) {
      throw runtimeError(
        "CC_GRAPH_RUN_NOT_FOUND",
        `Graph run was not found: ${runId}`,
        { cause: error },
      );
    }
    const latest = events.at(-1);
    const previous = [...events]
      .reverse()
      .find((event) => event.payload?.state?.authority)?.payload
      .state.authority;
    if (!previous || !latest) {
      throw runtimeError(
        "CC_GRAPH_RECOVERY_UNAVAILABLE",
        `Graph run has no authority snapshot: ${runId}`,
      );
    }
    const generation = Number(previous.authorityGeneration) + 1;
    const authoritySource =
      previous.authorityMode === "shadow"
        ? "graph_kernel_shadow"
        : "graph_kernel";
    const holder = this._newKernel({
      runId,
      generation,
      authoritySource,
    });
    const authority = createGraphAuthorityBinding({
      ...previous,
      authorityMode: previous.authorityMode,
      authoritySource,
      authorityGeneration: generation,
      writerId: holder.writerId,
      writerLeaseId: holder.writerLeaseId,
      writerLeaseExpiresAt: new Date(
        this.now() + this.writerLeaseTtlMs,
      ).toISOString(),
      eventHead: latest.hash,
    });
    holder.kernel.recoverRun(runId, { authority });
    const request = this._readRequest(runId);
    const entry = {
      ...holder,
      runId,
      compiled: compileGraphDefinition(request.definition),
      inputs: { ...request.inputs },
    };
    this.runs.set(runId, entry);
    this._recoverReceiptedAttempts(entry);
    return entry;
  }

  _executorReceipts(runId) {
    let events;
    try {
      events = this.rolloutStore.read(`graph-executor:${runId}`);
    } catch (error) {
      if (error?.code === "CC_ROLLOUT_THREAD_NOT_FOUND") return new Map();
      throw error;
    }
    const receipts = new Map();
    for (const event of events) {
      if (!event.event_type.startsWith("executor.")) continue;
      const payload = event.payload || {};
      if (
        payload.runId !== runId ||
        typeof payload.attemptId !== "string" ||
        !["executor.succeeded", "executor.failed"].includes(event.event_type)
      ) {
        throw runtimeError(
          "CC_GRAPH_EXECUTOR_RECEIPT_FORGED",
          "Graph executor receipt does not match its run and attempt",
        );
      }
      const status =
        event.event_type === "executor.succeeded" ? "succeeded" : "failed";
      if (
        status === "succeeded" &&
        !DIGEST.test(String(payload.outputDigest || ""))
      ) {
        throw runtimeError(
          "CC_GRAPH_EXECUTOR_RECEIPT_FORGED",
          "successful Graph executor receipt has no immutable output digest",
        );
      }
      receipts.set(payload.attemptId, {
        status,
        nodeId: payload.nodeId,
        outputDigest: payload.outputDigest,
        error: payload.error,
        receiptDigest: event.hash,
      });
    }
    return receipts;
  }

  _latestState(runId) {
    const event = [...this.eventStore.read(runId)]
      .reverse()
      .find((candidate) => candidate.payload?.state?.version === 1);
    if (!event) {
      throw runtimeError(
        "CC_GRAPH_RECOVERY_UNAVAILABLE",
        `Graph run has no recoverable state: ${runId}`,
      );
    }
    return event.payload.state;
  }

  _recoverReceiptedAttempts(entry) {
    const { kernel, runId } = entry;
    const receipts = this._executorReceipts(runId);
    if (receipts.size === 0) return kernel.getRun(runId);

    let state = this._latestState(runId);
    const effectsByAttempt = new Map();
    for (const [, effect] of state.effects || []) {
      const values = effectsByAttempt.get(effect.attemptId) || [];
      values.push(effect);
      effectsByAttempt.set(effect.attemptId, values);
    }
    for (const [, attempt] of state.attempts || []) {
      if (attempt.status !== "active") continue;
      const receipt = receipts.get(attempt.id);
      if (!receipt || receipt.nodeId !== attempt.nodeId) continue;
      const effects = effectsByAttempt.get(attempt.id) || [];
      const expectedEffectStatus =
        receipt.status === "succeeded" ? "committed" : "failed";
      if (effects.some((effect) => effect.status !== expectedEffectStatus)) {
        continue;
      }
      kernel.settleAttempt(runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: receipt.status,
        evidence:
          receipt.status === "succeeded"
            ? { outputDigest: receipt.outputDigest }
            : null,
        error: receipt.error,
        usage: { turns: 1 },
      });
    }

    let projection = kernel.getRun(runId);
    if (projection.status !== "reconciliation_required") return projection;
    state = this._latestState(runId);
    const effects = new Map(state.effects || []);
    for (const effectId of projection.reconciliationEffectIds) {
      const effect = effects.get(effectId);
      const receipt = effect ? receipts.get(effect.attemptId) : null;
      if (!effect || !receipt || receipt.nodeId !== effect.nodeId) continue;
      const succeeded = receipt.status === "succeeded";
      kernel.reconcileEffect(runId, {
        effectId,
        decision: succeeded ? "committed" : "failed",
        receipt: succeeded ? { receiptDigest: receipt.receiptDigest } : null,
        auditDecisionId: `executor-receipt:${receipt.receiptDigest.slice(7, 39)}`,
      });
      const retry = kernel.assignNode(
        runId,
        effect.nodeId,
        "app-server-agent",
        {
          ttlMs: this.writerLeaseTtlMs,
          leaseId: `app-server-recovery-attempt:${this.createId()}`,
          grant: { executor: "agent_kernel_receipt_recovery" },
        },
      );
      if (effect.idempotencyKey) {
        kernel.beginEffect(runId, {
          effectId: `app-server-recovery-effect:${this.createId()}`,
          attemptId: retry.id,
          leaseId: retry.leaseId,
          fence: retry.fence,
          idempotencyKey: effect.idempotencyKey,
          operationDigest: effect.operationDigest,
        });
      }
      kernel.settleAttempt(runId, {
        attemptId: retry.id,
        leaseId: retry.leaseId,
        fence: retry.fence,
        outcome: receipt.status,
        evidence: succeeded ? { outputDigest: receipt.outputDigest } : null,
        error: receipt.error,
        usage: { turns: 1 },
      });
      projection = kernel.getRun(runId);
    }
    return projection;
  }

  async cancel(runId, reason = "cancelled by App Server client") {
    const id = String(runId);
    const entry = this.runs.get(id) || this._recover(id);
    return entry.kernel.cancelRun(id, {
      reason,
      interrupt: async (attempt) => {
        const active = this.active.get(attempt.id);
        if (!active) return;
        active.controller.abort(runtimeError("CC_GRAPH_CANCELLED", reason));
        await active.done;
      },
    });
  }

  reconcile(runId, input = {}) {
    const id = String(runId);
    const entry = this.runs.get(id) || this._recover(id);
    return entry.kernel.reconcileEffect(id, input);
  }
}

export function graphExecutorReceipt(value) {
  const terminal = evidence(value);
  return Object.freeze({
    terminalEvidence: terminal,
    receiptDigest:
      value?.terminalEvidence?.eventDigest ||
      terminal.outputDigest ||
      graphDigest(terminal, "cc.app-server.graph-executor-receipt/v1"),
    usage: usage(value),
  });
}
