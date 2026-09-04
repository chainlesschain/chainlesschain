import { randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
} from "../graph-kernel/compiler.js";
import { createGraphAuthorityBinding } from "../graph-kernel/authority.js";
import { GraphEventStore } from "../graph-kernel/event-store.js";
import { GraphKernel } from "../graph-kernel/runtime.js";
import {
  captureAgentEvolutionRuntimeComposition,
  captureAgentSkillOutcomeIndex,
} from "../evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../skill-vector-authority.js";
import { captureSkillRetrievalRevocationReader } from "../evolution/skill-retrieval-revocation-authority.js";
import {
  diffGraphTrace,
  locateBlockedRoot,
  reduceGraphTrace,
} from "../graph-kernel/trace-reducer.js";

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
const DEFAULT_HISTORY_EVENT_LIMIT = 1_000;
const MAX_HISTORY_EVENT_LIMIT = 2_000;
const DEFAULT_HISTORY_SNAPSHOT_LIMIT = 200;
const MAX_HISTORY_SNAPSHOT_LIMIT = 200;

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

function boundedInteger(value, fallback, { min = 0, max } = {}) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw runtimeError(
      "CC_GRAPH_HISTORY_RANGE_INVALID",
      `Graph history range must be an integer between ${min} and ${max}`,
    );
  }
  return number;
}

function debuggerProjection(projection) {
  return Object.freeze({
    ...projection,
    timeline: Object.freeze(
      (projection.timeline || []).map((event) =>
        Object.freeze({
          seq: event.seq,
          timestamp: event.timestamp,
          type: event.type,
          hash: event.hash,
        }),
      ),
    ),
    effects: Object.freeze(
      (projection.effects || []).map((effect) =>
        Object.freeze({
          id: effect.id,
          nodeId: effect.nodeId ?? null,
          attemptId: effect.attemptId ?? null,
          status: effect.status,
          iterationPath: Object.freeze([...(effect.iterationPath || [])]),
          receiptDigest: DIGEST.test(
            String(effect.receipt?.receiptDigest || ""),
          )
            ? effect.receipt.receiptDigest
            : null,
          compensationEffectId: effect.compensationEffectId ?? null,
        }),
      ),
    ),
  });
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
    requestHumanTask = null,
    now = Date.now,
    createId = randomUUID,
    onEvent = null,
    evolutionCompositionFactory = null,
    skillOutcomeIndex = null,
    skillVectorAuthority = null,
    skillRetrievalRevocationReader = null,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
  } = {}) {
    if (typeof executeNode !== "function") {
      throw new TypeError("AppServerGraphRuntime requires executeNode()");
    }
    if (
      evolutionCompositionFactory !== null &&
      typeof evolutionCompositionFactory !== "function"
    ) {
      throw new TypeError("evolutionCompositionFactory must be a function");
    }
    this.eventStore = eventStore;
    this.rolloutStore = eventStore.rolloutStore;
    this.executeNode = executeNode;
    this.requestHumanTask =
      typeof requestHumanTask === "function" ? requestHumanTask : null;
    this.now = now;
    this.createId = createId;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.evolutionCompositionFactory = evolutionCompositionFactory;
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
      throw new TypeError("Graph retrieval authorities must share one tenant");
    }
    if (
      this.skillVectorAuthority !== null &&
      this.skillRetrievalRevocationReader !== null &&
      this.skillVectorAuthority.tenantId !==
        this.skillRetrievalRevocationReader.tenantId
    ) {
      throw new TypeError("Graph retrieval authorities must share one tenant");
    }
    if (
      this.skillOutcomeIndex !== null &&
      this.skillRetrievalRevocationReader !== null &&
      this.skillOutcomeIndex.tenantId !==
        this.skillRetrievalRevocationReader.tenantId
    ) {
      throw new TypeError("Graph retrieval authorities must share one tenant");
    }
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.runs = new Map();
    this.drives = new Map();
    this.active = new Map();
  }

  async _prepareEvolution(entry) {
    if (!this.evolutionCompositionFactory) return null;
    if (!entry.evolutionCompositionPromise) {
      const context = Object.freeze({
        mode: "graph",
        runId: entry.runId,
        originSurface: entry.originSurface,
        revisionDigest: entry.compiled.revisionDigest,
        authorityMode: entry.authorityMode,
      });
      entry.evolutionCompositionPromise = Promise.resolve()
        .then(() => this.evolutionCompositionFactory(context))
        .then((value) => {
          const composition = captureAgentEvolutionRuntimeComposition(value);
          if (composition.runId !== entry.runId) {
            throw new TypeError(
              "Agent evolution composition belongs to another Graph run",
            );
          }
          if (
            this.skillOutcomeIndex !== null &&
            composition.tenantId !== this.skillOutcomeIndex.tenantId
          ) {
            throw new TypeError(
              "Graph evolution composition and Skill outcome index must share one tenant",
            );
          }
          if (
            this.skillVectorAuthority !== null &&
            composition.tenantId !== this.skillVectorAuthority.tenantId
          ) {
            throw new TypeError(
              "Graph evolution composition and Skill vector authority must share one tenant",
            );
          }
          if (
            this.skillRetrievalRevocationReader !== null &&
            composition.tenantId !==
              this.skillRetrievalRevocationReader.tenantId
          ) {
            throw new TypeError(
              "Graph evolution composition and Skill revocation authority must share one tenant",
            );
          }
          if (
            typeof composition.evolutionIngress?.start !== "function" ||
            typeof composition.evolutionIngress?.complete !== "function"
          ) {
            throw new TypeError(
              "Agent evolution composition has no usable ingress",
            );
          }
          return composition;
        });
    }
    if (!entry.evolutionStartPromise) {
      entry.evolutionStartPromise = entry.evolutionCompositionPromise.then(
        async (composition) => {
          await composition.evolutionIngress.start();
          return composition;
        },
      );
    }
    try {
      return await entry.evolutionStartPromise;
    } catch (cause) {
      entry.evolutionIngressFailed = true;
      if (cause?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
      const error = runtimeError(
        "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        `Graph evolution ingress failed: ${cause?.message || String(cause)}`,
        { cause },
      );
      throw error;
    }
  }

  async _completeEvolution(entry) {
    if (!this.evolutionCompositionFactory || entry.evolutionIngressFailed) {
      return;
    }
    if (entry.evolutionCompletionPromise) {
      return entry.evolutionCompletionPromise;
    }
    try {
      entry.evolutionCompletionPromise = this._prepareEvolution(entry).then(
        (composition) => composition.evolutionIngress.complete(),
      );
      await entry.evolutionCompletionPromise;
    } catch (cause) {
      entry.evolutionIngressFailed = true;
      if (cause?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
      throw runtimeError(
        "CC_AGENT_EVOLUTION_INGRESS_FAILED",
        `Graph evolution completion failed: ${cause?.message || String(cause)}`,
        { cause },
      );
    }
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
      durableHumanTasks: true,
      humanTaskQuorum: true,
      humanTaskSeparationOfDuties: true,
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
      definition:
        compiled.definitionMigration?.backupDefinition || compiled.definition,
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
      originSurface,
      authorityMode,
    });
    this._emit(id, "graph/run-started", { projection });
    return this.status(id);
  }

  run(options = {}) {
    const projection = this.start(options);
    if (projection.authorityMode === "shadow") {
      return Promise.resolve(this.status(projection.id));
    }
    const entry = this.runs.get(projection.id);
    const launch = () => {
      const settled = this._drive(projection.id);
      if (options.waitForCompletion === true) return settled;
      return projection;
    };
    if (this.evolutionCompositionFactory) {
      return this._prepareEvolution(entry).then(launch);
    }
    return Promise.resolve(launch());
  }

  resume(runId, { waitForCompletion = false } = {}) {
    const id = String(runId || "").trim();
    if (!id) {
      throw runtimeError(
        "CC_GRAPH_RUN_ID_REQUIRED",
        "Graph resume requires a durable run id",
      );
    }
    const request = this._readRequest(id);
    return this.run({
      ...request,
      runId: id,
      waitForCompletion: waitForCompletion === true,
    });
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
    await this._prepareEvolution(entry);
    for (let steps = 0; steps < 10_000; steps += 1) {
      const status = kernel.getRun(runId);
      if (TERMINAL.has(status.status)) {
        await this._completeEvolution(entry);
        this._emit(runId, "graph/run-settled", { projection: status });
        return status;
      }
      if (status.status === "reconciliation_required") {
        this._emit(runId, "graph/run-settled", { projection: status });
        return status;
      }
      const pendingHumanTask = kernel
        .humanTasks(runId)
        .find((task) => ["open", "claimed"].includes(task.status));
      if (pendingHumanTask) {
        if (!this.requestHumanTask) return status;
        await this._requestHumanTaskDecision(entry, pendingHumanTask);
        continue;
      }
      const next = kernel
        .readyNodes(runId)
        .find((candidate) => candidate.dispatch !== "subgraph");
      if (!next) return status;
      if (entry.compiled.nodes[next.nodeId]?.kind === "human") {
        await this._executeHumanTask(entry, next.nodeId);
      } else {
        await this._executeAttempt(entry, next.nodeId);
      }
    }
    throw runtimeError(
      "CC_GRAPH_DRIVE_LIMIT",
      "Graph executor exceeded its bounded scheduling step limit",
    );
  }

  async _executeHumanTask(entry, nodeId) {
    const { kernel } = entry;
    const runId = entry.runId;
    const node = entry.compiled.nodes[nodeId];
    if (node.effectClass !== "none") {
      throw runtimeError(
        "CC_GRAPH_HUMAN_TASK_EFFECT_UNSUPPORTED",
        "HumanTask nodes must use effectClass=none; approved effects belong to a dependent task node",
      );
    }
    const attempt = kernel.assignNode(runId, nodeId, "app-server-agent", {
      ttlMs: this.writerLeaseTtlMs,
      leaseId: `app-server-human-attempt:${this.createId()}`,
      grant: { executor: "durable_human_task", originSurface: "desktop" },
    });
    const quorum =
      node.join === "quorum" ? Math.max(1, Number(node.quorum) || 1) : 1;
    const task = kernel.createHumanTask(runId, {
      humanTaskId: `app-server-human-task:${this.createId()}`,
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      operation: nodeInput(entry.inputs, nodeId),
      nonce: `app-server-human-nonce:${this.createId()}`,
      ttlMs: this.writerLeaseTtlMs,
      quorum,
      // Product quorum is intentionally fail-closed: one identity can never
      // contribute more than one vote to a multi-review HumanTask.
      separationOfDuties: quorum > 1,
    });
    this._emit(runId, "graph/human-task-requested", {
      nodeId,
      humanTaskId: task.id,
      quorum: task.quorum,
      separationOfDuties: task.separationOfDuties,
    });
    if (!this.requestHumanTask) {
      return kernel.getRun(runId);
    }
    return this._requestHumanTaskDecision(entry, task);
  }

  async _requestHumanTaskDecision(entry, task) {
    const { kernel, runId } = entry;
    const response = await this.requestHumanTask({ task });
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw runtimeError(
        "CC_GRAPH_HUMAN_DECISION_INVALID",
        "HumanTask client returned no structured decision",
      );
    }
    for (const [field, expected] of [
      ["humanTaskId", task.id],
      ["runId", runId],
      ["revisionDigest", task.revisionDigest],
      ["operationDigest", task.operationDigest],
      ["nonce", task.nonce],
    ]) {
      if (response[field] !== expected) {
        throw runtimeError(
          "CC_GRAPH_HUMAN_TASK_BINDING_MISMATCH",
          `HumanTask client response does not match ${field}`,
        );
      }
    }
    const actorId = String(response.actorId || "").trim();
    if (!actorId) {
      throw runtimeError(
        "CC_GRAPH_HUMAN_DECISION_INVALID",
        "HumanTask client response requires an authenticated actorId",
      );
    }
    if (
      task.separationOfDuties === true &&
      task.decisions.some((entry) => entry.actorId === actorId)
    ) {
      throw runtimeError(
        "CC_GRAPH_HUMAN_SEPARATION_OF_DUTIES",
        "HumanTask requires a different authenticated actor",
      );
    }
    const claim = kernel.claimHumanTask(runId, task.id, actorId, {
      claimLeaseId: `app-server-human-claim:${this.createId()}`,
      ttlMs: Math.min(this.writerLeaseTtlMs, 5 * 60 * 1000),
    });
    const decided = kernel.decideHumanTask(runId, task.id, {
      actorId,
      claimLeaseId: claim.claimLeaseId,
      revisionDigest: response.revisionDigest,
      operationDigest: response.operationDigest,
      nonce: response.nonce,
      decision: response.decision,
    });
    this._emit(runId, "graph/human-task-decided", {
      nodeId: decided.nodeId,
      humanTaskId: decided.id,
      actorId,
      status: decided.status,
      acceptedDecisions: decided.decisions.filter((entry) =>
        ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
          entry.decision.kind,
        ),
      ).length,
      quorum: decided.quorum,
    });
    if (
      decided.status !== "decided" ||
      ["decline", "cancel"].includes(decided.decision?.kind)
    ) {
      return kernel.getRun(runId);
    }
    const settlement = kernel.assignNode(
      runId,
      decided.nodeId,
      "app-server-agent",
      {
        ttlMs: this.writerLeaseTtlMs,
        leaseId: `app-server-human-settlement:${this.createId()}`,
        grant: {
          executor: "durable_human_task_decision",
          humanTaskId: decided.id,
        },
      },
    );
    const settled = kernel.settleAttempt(runId, {
      attemptId: settlement.id,
      leaseId: settlement.leaseId,
      fence: settlement.fence,
      outcome: "succeeded",
      evidence: {
        outputDigest: graphDigest(
          {
            humanTaskId: decided.id,
            revisionDigest: decided.revisionDigest,
            operationDigest: decided.operationDigest,
            decisions: decided.decisions,
          },
          "cc.app-server.human-task-settlement/v1",
        ),
      },
      usage: { turns: 0, tokens: 0, costUsd: 0, wallMs: 0 },
    });
    this._emit(runId, "graph/node-settled", {
      nodeId: decided.nodeId,
      attemptId: settlement.id,
      outcome: "succeeded",
      humanTaskId: decided.id,
    });
    return settled;
  }

  async _executeAttempt(entry, nodeId) {
    const { kernel } = entry;
    const runId = entry.runId;
    const evolutionComposition = await this._prepareEvolution(entry);
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
        evolutionIngress: evolutionComposition?.evolutionIngress || null,
        skillOutcomeIndex: this.skillOutcomeIndex,
        skillVectorAuthority: this.skillVectorAuthority,
        skillRetrievalRevocationReader: this.skillRetrievalRevocationReader,
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
      if (error?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") {
        entry.evolutionIngressFailed = true;
      }
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

  humanTasks(runId) {
    const id = String(runId);
    const entry = this.runs.get(id) || this._recover(id);
    return entry.kernel.humanTasks(id);
  }

  history(
    runId,
    {
      afterSeq = 0,
      limit = DEFAULT_HISTORY_EVENT_LIMIT,
      snapshotLimit = DEFAULT_HISTORY_SNAPSHOT_LIMIT,
    } = {},
  ) {
    const id = String(runId);
    const cursor = boundedInteger(afterSeq, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    const eventLimit = boundedInteger(limit, DEFAULT_HISTORY_EVENT_LIMIT, {
      min: 1,
      max: MAX_HISTORY_EVENT_LIMIT,
    });
    const projectionLimit = boundedInteger(
      snapshotLimit,
      DEFAULT_HISTORY_SNAPSHOT_LIMIT,
      { min: 1, max: MAX_HISTORY_SNAPSHOT_LIMIT },
    );
    const head = this.eventStore.head(id);
    const effectiveCursor =
      cursor === 0 && head.seq > eventLimit ? head.seq - eventLimit : cursor;
    const selected = this.eventStore.read(id, {
      afterSeq: effectiveCursor,
      limit: eventLimit + 1,
    });
    const hasMore = selected.length > eventLimit;
    const events = selected.slice(0, eventLimit);
    const stateEvents = events.filter(
      (event) => event.payload?.state?.version === 1,
    );
    if (stateEvents.length === 0) {
      throw runtimeError(
        "CC_GRAPH_TRACE_STATE_MISSING",
        `Graph history has no runtime snapshot after sequence ${effectiveCursor}: ${id}`,
      );
    }
    const snapshotEvents = stateEvents.slice(-projectionLimit);
    const snapshots = snapshotEvents.map((event) => {
      const through = events.filter((candidate) => candidate.seq <= event.seq);
      return Object.freeze({
        seq: event.seq,
        timestamp: event.timestamp,
        type: event.type,
        hash: event.hash,
        projection: debuggerProjection(reduceGraphTrace(through)),
      });
    });
    const diffs = snapshots
      .slice(1)
      .map((snapshot, index) =>
        diffGraphTrace(snapshots[index].projection, snapshot.projection),
      );
    const current = snapshots.at(-1).projection;
    const blockedRoots = Object.freeze(
      current.taskGraph.nodes
        .filter((node) => node.blockedRoot)
        .map((node) =>
          Object.freeze({
            nodeId: node.id,
            ...locateBlockedRoot(current, node.id),
          }),
        ),
    );
    return Object.freeze({
      schema: "chainlesschain.graph-debug-history/v1",
      runId: id,
      requestedAfterSeq: cursor,
      afterSeq: effectiveCursor,
      nextAfterSeq: events.at(-1)?.seq || effectiveCursor,
      hasMore,
      truncatedBefore: effectiveCursor > cursor,
      truncatedSnapshots: stateEvents.length > projectionLimit,
      eventCount: events.length,
      events: Object.freeze(
        events.map((event) =>
          Object.freeze({
            seq: event.seq,
            timestamp: event.timestamp,
            type: event.type,
            hash: event.hash,
          }),
        ),
      ),
      snapshots: Object.freeze(snapshots),
      diffs: Object.freeze(diffs),
      blockedRoots,
      current,
    });
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
      originSurface: request.originSurface,
      authorityMode: request.authorityMode,
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
    const attempts = new Map(state.attempts || []);
    const receiptForAttempt = (attempt) => {
      const visited = new Set();
      let current = attempt;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const receipt = receipts.get(current.id);
        if (receipt) return receipt;
        current = current.resumedFromAttemptId
          ? attempts.get(current.resumedFromAttemptId)
          : null;
      }
      return null;
    };
    const effectsByAttempt = new Map();
    for (const [, effect] of state.effects || []) {
      const values = effectsByAttempt.get(effect.attemptId) || [];
      values.push(effect);
      effectsByAttempt.set(effect.attemptId, values);
    }
    for (const [, attempt] of state.attempts || []) {
      if (attempt.status !== "active") continue;
      const receipt = receiptForAttempt(attempt);
      if (!receipt || receipt.nodeId !== attempt.nodeId) continue;
      const effects = effectsByAttempt.get(attempt.id) || [];
      const expectedEffectStatus =
        receipt.status === "succeeded" ? "committed" : "failed";
      if (effects.some((effect) => effect.status !== expectedEffectStatus)) {
        continue;
      }
      const authority = kernel.getRun(runId);
      const settledAttempt =
        attempt.authorityGeneration === authority.authorityGeneration &&
        attempt.writerId === authority.writerId
          ? attempt
          : kernel.resumeAttempt(runId, attempt.id, {
              resumedAttemptId: `app-server-recovery-attempt:${this.createId()}`,
              leaseId: `app-server-recovery-lease:${this.createId()}`,
              ttlMs: this.writerLeaseTtlMs,
              reason:
                "immutable executor receipt recovered after writer takeover",
            });
      kernel.settleAttempt(runId, {
        attemptId: settledAttempt.id,
        leaseId: settledAttempt.leaseId,
        fence: settledAttempt.fence,
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
    const projection = await entry.kernel.cancelRun(id, {
      reason,
      interrupt: async (attempt) => {
        const active = this.active.get(attempt.id);
        if (!active) return;
        active.controller.abort(runtimeError("CC_GRAPH_CANCELLED", reason));
        await active.done;
      },
    });
    if (TERMINAL.has(projection.status)) {
      await this._completeEvolution(entry);
    }
    return projection;
  }

  async reconcile(runId, input = {}) {
    const id = String(runId);
    const entry = this.runs.get(id) || this._recover(id);
    const effect = entry.kernel
      .effectState(id)
      .find((candidate) => candidate.id === input.effectId);
    if (!effect) {
      throw runtimeError(
        "CC_GRAPH_EFFECT_NOT_FOUND",
        `Graph reconciliation effect was not found: ${input.effectId}`,
      );
    }
    const terminalEvidence =
      input.decision === "committed"
        ? evidence({ terminalEvidence: input.terminalEvidence })
        : null;
    entry.kernel.reconcileEffect(id, input);
    if (input.decision === "committed") {
      const attempt = entry.kernel.assignNode(
        id,
        effect.nodeId,
        "app-server-agent",
        {
          ttlMs: this.writerLeaseTtlMs,
          leaseId: `app-server-reconcile-attempt:${this.createId()}`,
          grant: {
            executor: "audited_reconciliation_receipt",
            auditDecisionId: input.auditDecisionId,
          },
        },
      );
      entry.kernel.settleAttempt(id, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "succeeded",
        evidence: terminalEvidence,
        usage: { turns: 1 },
      });
      const drive = this._drive(id);
      return input.waitForCompletion === true
        ? await drive
        : entry.kernel.getRun(id);
    }
    const drive = this._drive(id);
    return input.waitForCompletion === true
      ? await drive
      : entry.kernel.getRun(id);
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
