import { createHash, randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
  writeScopesOverlap,
} from "../graph-kernel/compiler.js";
import { GraphEventStore } from "../graph-kernel/event-store.js";
import { GraphKernel } from "../graph-kernel/runtime.js";
import { createGraphAuthorityBinding } from "../graph-kernel/authority.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TeamGraphRuntimeAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeIdentifier(value, prefix) {
  const candidate = String(value || "").trim();
  if (IDENTIFIER.test(candidate)) return candidate;
  return `${prefix}-${createHash("sha256")
    .update(candidate, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function priorityValue(value) {
  if (value === "high") return 100;
  if (value === "low") return -100;
  return 0;
}

function teamBudget(input = {}) {
  const output = {};
  for (const [source, target] of [
    ["maxTasks", "turns"],
    ["maxTokens", "tokens"],
    ["maxUsd", "costUsd"],
    ["maxWallMs", "wallMs"],
  ]) {
    if (input[source] == null || input[source] === "") continue;
    const value = Number(input[source]);
    if (Number.isFinite(value) && value >= 0) output[target] = value;
  }
  return output;
}

function compileTeamTaskNode(
  task,
  taskToNode,
  { executionMode, worktree, maxAttempts },
) {
  const scopePaths = Array.isArray(task.metadata?.scopePaths)
    ? task.metadata.scopePaths.map(String).filter(Boolean)
    : [];
  const effectful = executionMode !== "dry-run";
  const node = {
    id: taskToNode.get(task.key),
    kind: "task",
    dependsOn: (task.dependsOn || []).map((key) => {
      const dependency = taskToNode.get(key);
      if (!dependency) {
        throw adapterError(
          "CC_TEAM_GRAPH_DEPENDENCY_UNKNOWN",
          `team task ${task.key} depends on unknown task ${key}`,
        );
      }
      return dependency;
    }),
    inputs: [],
    outputs: [],
    effectClass: effectful ? "workspace_write" : "none",
    priority: priorityValue(task.priority),
    retryLimit: Math.max(0, Number(maxAttempts || 1) - 1),
  };
  if (effectful) {
    node.idempotencyKey =
      task.metadata?.idempotencyKey ||
      graphDigest(
        { taskKey: task.key, title: task.title, scopePaths },
        "cc.team.effect/v1",
      );
    node.workspaceIsolation = worktree ? "worktree" : "declared_scope";
    if (!worktree) node.writeSet = scopePaths.length ? scopePaths : ["**"];
  }
  return node;
}

const TEAM_TASK_INTERNAL_METADATA = new Set([
  "key",
  "dependsOn",
  "lease",
  "attempts",
  "lastError",
  "result",
  "custodyHandoffs",
  "adjudication",
  "interruption",
  "abandonedLeaseEvidence",
  "canonicalGraphProjection",
]);

function persistedTeamTaskDefinition(task) {
  return {
    key: task.key,
    title: task.title,
    dependsOn: [...(task.dependsOn || [])],
    priority: task.priority || "normal",
    createdBy: task.metadata?.createdBy ?? task.createdBy ?? null,
    metadata: Object.fromEntries(
      Object.entries(task.metadata || {})
        .filter(([key]) => !TEAM_TASK_INTERNAL_METADATA.has(key))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]),
    ),
  };
}

function taskWriteScopes(task) {
  const scopes = Array.isArray(task?.metadata?.scopePaths)
    ? task.metadata.scopePaths.map(String).filter(Boolean)
    : [];
  return scopes.length > 0 ? scopes : ["**"];
}

function scopesOverlap(left, right) {
  return left.some((a) => right.some((b) => writeScopesOverlap(a, b)));
}

export function compileTeamGraphDefinition(
  registry,
  {
    definitionId = "cli-team",
    revision = 1,
    executionMode = "agent",
    worktree = false,
    budget = {},
  } = {},
) {
  if (!registry || typeof registry.list !== "function") {
    throw new TypeError("compileTeamGraphDefinition requires a task registry");
  }
  const tasks = registry.list();
  if (tasks.length === 0) {
    throw adapterError(
      "CC_TEAM_GRAPH_EMPTY",
      "canonical Team Graph requires at least one task",
    );
  }
  const taskToNode = new Map(
    tasks.map((task) => [task.key, safeIdentifier(task.key, "team-node")]),
  );
  if (new Set(taskToNode.values()).size !== taskToNode.size) {
    throw adapterError(
      "CC_TEAM_GRAPH_NODE_COLLISION",
      "team task keys collide after canonical identifier normalization",
    );
  }
  const nodes = tasks.map((task) =>
    compileTeamTaskNode(task, taskToNode, {
      executionMode,
      worktree,
      maxAttempts: registry.maxAttempts,
    }),
  );
  const definition = {
    schemaVersion: 1,
    id: safeIdentifier(definitionId, "team-definition"),
    revision: Math.max(1, Number(revision) || 1),
    nodes,
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: teamBudget(budget),
    allowedCapabilities: [],
    metadata: {
      originSurface: "cli_team",
      executionMode,
      taskKeyByNodeId: Object.fromEntries(
        [...taskToNode].map(([taskKey, nodeId]) => [nodeId, taskKey]),
      ),
      taskDefinitionsByNodeId: Object.fromEntries(
        tasks.map((task) => [
          taskToNode.get(task.key),
          persistedTeamTaskDefinition(task),
        ]),
      ),
    },
  };
  return Object.freeze({
    compiled: compileGraphDefinition(definition),
    taskToNode,
    nodeToTask: new Map(
      [...taskToNode].map(([taskKey, nodeId]) => [nodeId, taskKey]),
    ),
  });
}

function terminalEvidence(result) {
  const source = result?.terminalEvidence || result || {};
  const evidence = {};
  if (DIGEST.test(String(source.outputDigest || ""))) {
    evidence.outputDigest = source.outputDigest;
  }
  if (source.commit) evidence.commit = String(source.commit);
  if (Array.isArray(source.artifactIds) && source.artifactIds.length) {
    evidence.artifactIds = [...source.artifactIds];
  }
  if (Array.isArray(source.testReceiptIds) && source.testReceiptIds.length) {
    evidence.testReceiptIds = [...source.testReceiptIds];
  }
  if (Object.keys(evidence).length === 0) {
    throw adapterError(
      "CC_TEAM_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
      "canonical Team task success requires immutable output, artifact, commit, or test evidence",
    );
  }
  return evidence;
}

function graphUsage(source) {
  const usage = source?.usage || {};
  const tokens = [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ].reduce((total, key) => total + Math.max(0, Number(usage[key]) || 0), 0);
  return { turns: 1, tokens };
}

const TEAM_MAILBOX_GRAPH_SCHEMA = "chainlesschain.team-graph-mailbox/v1";

function mailboxProjectionKey(runId, request, createId) {
  const stable = request.idempotencyKey
    ? {
        runId,
        from: request.from || "coordinator",
        taskKey: request.senderAttempt?.taskKey || null,
        idempotencyKey: String(request.idempotencyKey),
      }
    : {
        runId,
        nonce: String(createId()),
      };
  return safeIdentifier(
    `team-mail:${graphDigest(stable, "cc.team.mailbox-projection/v1").slice(7, 47)}`,
    "team-mail",
  );
}

function graphMessageId(projectionKey, recipient) {
  return safeIdentifier(
    `team-message:${graphDigest(
      { projectionKey, recipient },
      "cc.team.graph-message/v1",
    ).slice(7, 47)}`,
    "team-message",
  );
}

function shadowMailboxProjectionKey(runId, message) {
  return safeIdentifier(
    `team-shadow-mail:${graphDigest(
      {
        runId,
        legacyMessageId: message?.id ?? null,
        payloadDigest: message?.payloadDigest ?? null,
      },
      "cc.team.shadow-mailbox-projection/v1",
    ).slice(7, 47)}`,
    "team-shadow-mail",
  );
}

function mailboxPayload(request, projectionKey) {
  return {
    schema: TEAM_MAILBOX_GRAPH_SCHEMA,
    projectionKey,
    from: request.from || "coordinator",
    to: request.to,
    subject: request.subject ?? null,
    body: request.body,
    mode: request.mode === "followup" ? "followup" : "send",
    causationId: request.causationId ?? null,
    correlationId: request.correlationId ?? null,
    originalIdempotencyKey: request.idempotencyKey ?? null,
    senderAttempt: request.senderAttempt ?? null,
  };
}

export class TeamGraphRuntimeAdapter {
  constructor({
    eventStore = new GraphEventStore(),
    now = Date.now,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
    createId = randomUUID,
  } = {}) {
    this.eventStore = eventStore;
    this.now = now;
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.createId = createId;
    this.kernel = null;
    this.runId = null;
    this.compiled = null;
    this.taskToNode = null;
    this.nodeToTask = null;
    this.attempts = new Map();
    this.authorityMode = null;
    this.agentIds = new Set(["coordinator"]);
    this.dynamic = false;
    this.producerLease = null;
    this.executionMode = "agent";
    this.worktree = false;
    this.maxAttempts = 1;
    this.taskDefinitions = new Map();
  }

  runtimeClaims() {
    return Object.freeze({
      originSurface: "cli_team",
      surface: "cli_team",
      execution: "real",
      persistence: "durable",
      isolated: true,
      terminalEvidence: true,
      authorityModes: Object.freeze(["shadow", "canonical"]),
      featureGated: true,
    });
  }

  open({
    registry,
    runId,
    executionMode,
    worktree = false,
    teammates = 1,
    budget = {},
    authorityMode = "canonical",
    dynamic = false,
    recoveryReceipts = null,
  }) {
    if (!["shadow", "canonical"].includes(authorityMode)) {
      throw adapterError(
        "CC_TEAM_GRAPH_AUTHORITY_MODE_INVALID",
        "Team Graph adapter authorityMode must be shadow or canonical",
      );
    }
    this.authorityMode = authorityMode;
    this.runId = safeIdentifier(runId, "team-run");
    this.dynamic = dynamic === true;
    this.executionMode = executionMode;
    this.worktree = worktree === true;
    this.maxAttempts = Math.max(1, Number(registry.maxAttempts || 1));
    let events = [];
    try {
      events = this.eventStore.read(this.runId);
    } catch (error) {
      if (error?.code !== "CC_ROLLOUT_THREAD_NOT_FOUND") throw error;
    }
    const latest = events.at(-1) || null;
    if (this.dynamic && latest) {
      const persistedDefinitions = Object.values(
        latest.payload?.state?.definition?.metadata?.taskDefinitionsByNodeId ||
          {},
      );
      const missing = persistedDefinitions.filter(
        (definition) => definition?.key && !registry.getTask(definition.key),
      );
      if (missing.length > 0) {
        const repaired = registry.addTasks(missing);
        if (!repaired?.ok) {
          throw adapterError(
            "CC_TEAM_GRAPH_LEGACY_PROJECTION_DIVERGED",
            `could not restore ${missing.length} Graph-owned Team task projection(s): ${repaired?.reason || "unknown"}`,
          );
        }
      }
    }
    const graph = compileTeamGraphDefinition(registry, {
      definitionId: `team-definition:${this.runId}`,
      revision: latest?.payload?.state?.definition?.revision || 1,
      executionMode,
      worktree,
      budget,
    });
    this.compiled = graph.compiled;
    this.taskToNode = graph.taskToNode;
    this.nodeToTask = graph.nodeToTask;
    this.taskDefinitions = new Map(
      registry
        .list()
        .map((task) => [task.key, persistedTeamTaskDefinition(task)]),
    );
    const previousAuthority =
      latest?.payload?.authority || latest?.payload?.state?.authority || null;
    if (
      previousAuthority &&
      previousAuthority.authorityMode !== authorityMode
    ) {
      throw adapterError(
        "CC_GRAPH_MIGRATION_REQUIRED",
        "Team Graph authority mode changed without a migration saga",
      );
    }
    const generation = previousAuthority
      ? Number(previousAuthority.authorityGeneration) + 1
      : 1;
    const writerId = safeIdentifier(
      `cli-team:${this.runId}:writer:${process.pid}:${generation}`,
      "team-writer",
    );
    const writerLeaseId = safeIdentifier(
      `cli-team:${this.runId}:lease:${this.createId()}`,
      "team-writer-lease",
    );
    this.kernel = new GraphKernel({
      eventStore: this.eventStore,
      now: this.now,
      writerId,
      writerLeaseId,
      authoritySource:
        authorityMode === "shadow" ? "graph_kernel_shadow" : "graph_kernel",
      authorityGeneration: generation,
      writerLeaseTtlMs: this.writerLeaseTtlMs,
    });
    let projection;
    if (!latest) {
      projection = this.kernel.startRun(this.compiled, {
        runId: this.runId,
        originSurface: "cli_team",
      });
    } else {
      const authority = createGraphAuthorityBinding({
        logicalRunId: this.runId,
        originSurface: "cli_team",
        authorityMode,
        authoritySource:
          authorityMode === "shadow" ? "graph_kernel_shadow" : "graph_kernel",
        authorityGeneration: generation,
        writerId,
        writerLeaseId,
        writerLeaseExpiresAt: new Date(
          this.now() + this.writerLeaseTtlMs,
        ).toISOString(),
        eventHead: latest.hash,
        projectionVersion: 1,
      });
      projection = this.kernel.recoverRun(this.runId, { authority });
      if (projection.revisionDigest !== this.compiled.revisionDigest) {
        throw adapterError(
          "CC_TEAM_GRAPH_REVISION_CONFLICT",
          "persisted canonical Team Graph does not match the resumed task definition",
        );
      }
    }
    if (projection.status === "reconciliation_required" && recoveryReceipts) {
      const receipts =
        recoveryReceipts instanceof Map
          ? recoveryReceipts
          : new Map(Object.entries(recoveryReceipts));
      for (const effect of this.kernel
        .effectState(this.runId)
        .filter((candidate) => candidate.status === "unknown")) {
        const key = this.nodeToTask.get(effect.nodeId);
        const recovery = key ? receipts.get(key) : null;
        if (!recovery) continue;
        const decision =
          recovery.decision ||
          (recovery.status === "completed" ? "committed" : "failed");
        const receiptDigest =
          recovery.receiptDigest ||
          recovery.terminalEvidence?.outputDigest ||
          null;
        this.kernel.reconcileEffect(this.runId, {
          effectId: effect.id,
          decision,
          receipt:
            decision === "committed"
              ? {
                  receiptDigest,
                  terminalEvidence: recovery.terminalEvidence || null,
                }
              : null,
          auditDecisionId: safeIdentifier(
            recovery.auditDecisionId ||
              `team-recovery:${graphDigest(
                {
                  runId: this.runId,
                  key,
                  effectId: effect.id,
                  decision,
                  receiptDigest,
                },
                "cc.team.recovery-decision/v1",
              ).slice(7, 39)}`,
            "team-recovery",
          ),
        });
      }
      projection = this.kernel.getRun(this.runId);
    }
    if (projection.status === "reconciliation_required") {
      throw adapterError(
        "CC_GRAPH_RECONCILIATION_REQUIRED",
        "Team Graph contains an unknown effect requiring audited reconciliation",
        { runId: this.runId },
      );
    }
    if (latest) {
      const effectsByAttempt = new Map();
      for (const effect of this.kernel.effectState(this.runId)) {
        const list = effectsByAttempt.get(effect.attemptId) || [];
        list.push(effect);
        effectsByAttempt.set(effect.attemptId, list);
      }
      const handoffsBySource = new Map();
      for (const handoff of this.kernel.collaborationState(this.runId)
        .handoffs) {
        if (!["offered", "accepted"].includes(handoff.status)) continue;
        const list = handoffsBySource.get(handoff.fromAttemptId) || [];
        list.push(handoff);
        handoffsBySource.set(handoff.fromAttemptId, list);
      }
      for (const attempt of projection.attempts.filter(
        (candidate) =>
          candidate.status === "active" ||
          (candidate.status === "expired" &&
            candidate.participationStatus === "reconciled"),
      )) {
        for (const handoff of handoffsBySource.get(attempt.id) || []) {
          this.kernel.expireHandoffForRecovery(this.runId, handoff.id);
        }
        const effects = effectsByAttempt.get(attempt.id) || [];
        if (
          effects.length > 0 &&
          effects.every((effect) =>
            ["committed", "failed"].includes(effect.status),
          )
        ) {
          // A failed audit decision for a dispatch that never received its
          // authorization response proves no executor side effect began. It
          // restores the node to pending without charging a second Graph
          // attempt; the still-live queue lease can request a fresh boundary.
          if (
            attempt.status === "expired" &&
            attempt.participationStatus === "reconciled" &&
            effects.every((effect) => effect.status === "failed")
          ) {
            continue;
          }
          const resumed = this.kernel.resumeAttempt(this.runId, attempt.id, {
            resumedAttemptId: safeIdentifier(
              `team-attempt-recovery:${graphDigest(
                {
                  runId: this.runId,
                  attemptId: attempt.id,
                  generation,
                },
                "cc.team.assignment-recovery/v1",
              ).slice(7, 39)}`,
              "team-attempt-recovery",
            ),
            leaseId: safeIdentifier(
              `team-lease-recovery:${this.runId}:${generation}:${attempt.nodeId}`,
              "team-lease-recovery",
            ),
            ttlMs: this.writerLeaseTtlMs,
          });
          const committed = effects.filter(
            (effect) => effect.status === "committed",
          );
          if (committed.length === effects.length) {
            const receiptDigest = committed[0]?.receipt?.receiptDigest;
            if (!DIGEST.test(String(receiptDigest || ""))) {
              throw adapterError(
                "CC_GRAPH_RECONCILIATION_REQUIRED",
                "Team Graph recovered a committed effect without an immutable receipt",
                { runId: this.runId, attemptId: attempt.id },
              );
            }
            this.kernel.settleAttempt(this.runId, {
              attemptId: resumed.id,
              leaseId: resumed.leaseId,
              fence: resumed.fence,
              outcome: "succeeded",
              evidence: { outputDigest: receiptDigest },
              usage: { turns: 0, tokens: 0 },
            });
          } else {
            this.kernel.settleAttempt(this.runId, {
              attemptId: resumed.id,
              leaseId: resumed.leaseId,
              fence: resumed.fence,
              outcome: "failed",
              error: "recovered terminal effect failure",
              usage: { turns: 0, tokens: 0 },
            });
          }
          continue;
        }
        try {
          this.kernel.reclaimAttempt(this.runId, attempt.id, {
            reason: "CLI Team writer generation takeover before effect start",
          });
        } catch (error) {
          if (error?.code === "CC_GRAPH_ASSIGNMENT_RECLAIM_UNSAFE") {
            throw adapterError(
              "CC_GRAPH_RECONCILIATION_REQUIRED",
              "Team Graph recovered an assignment that crossed the effect boundary",
              { runId: this.runId, attemptId: attempt.id, cause: error },
            );
          }
          throw error;
        }
      }
      projection = this.kernel.getRun(this.runId);
    }
    if (authorityMode === "canonical") {
      this._reconcileTerminalTaskProjection(registry, projection);
    }
    if (projection.phase === "open") {
      for (let index = 0; index < Math.max(1, teammates); index += 1) {
        const agentId = `teammate-${index + 1}`;
        this.agentIds.add(agentId);
        this.kernel.registerAgent(this.runId, {
          agentId,
          capacity: 1,
          resident: true,
        });
      }
      if (this.dynamic) {
        this.producerLease = this.kernel.acquireProducerLease(this.runId, {
          producerId: "cli-team-followup",
          ttlMs: this.writerLeaseTtlMs,
          leaseId: safeIdentifier(
            `team-producer:${this.runId}:${generation}`,
            "team-producer",
          ),
        });
        projection = this.kernel.getRun(this.runId);
      } else {
        projection = this.kernel.sealRun(this.runId);
      }
    }
    return projection;
  }

  _reconcileTerminalTaskProjection(registry, projection) {
    const terminal = new Set(["succeeded", "failed", "blocked", "cancelled"]);
    const attempts = new Map(
      projection.attempts.map((attempt) => [attempt.id, attempt]),
    );
    for (const node of projection.nodes) {
      if (!terminal.has(node.status)) continue;
      const key = this.nodeToTask.get(node.nodeId);
      if (!key) continue;
      if (typeof registry.applyCanonicalTaskProjection !== "function") {
        throw adapterError(
          "CC_TEAM_GRAPH_LEGACY_PROJECTION_UNSUPPORTED",
          "Team registry cannot repair a terminal canonical Graph projection",
          { key, nodeId: node.nodeId },
        );
      }
      const accepted = node.acceptedAttemptId
        ? attempts.get(node.acceptedAttemptId)
        : null;
      const result = registry.applyCanonicalTaskProjection(key, {
        runId: projection.id,
        nodeId: node.nodeId,
        graphStatus: node.status,
        authorityGeneration: projection.authorityGeneration,
        eventHead: projection.eventHead,
        revisionDigest: projection.revisionDigest,
        evidence: accepted?.terminalEvidence || null,
        now: this.now(),
      });
      if (!result?.ok) {
        throw adapterError(
          "CC_TEAM_GRAPH_LEGACY_PROJECTION_DIVERGED",
          `legacy Team task projection rejected canonical terminal state: ${result?.reason || "unknown"}`,
          { key, nodeId: node.nodeId, graphStatus: node.status },
        );
      }
    }
  }

  _mailboxRecipients(mailbox, request) {
    const declared = mailbox.status?.().recipients || [];
    const recipients = new Set([...this.agentIds, ...declared]);
    const from = String(request.from || "coordinator");
    if (request.to === "*") {
      return [...recipients].filter((recipient) => recipient !== from).sort();
    }
    const recipient = String(request.to || "").trim();
    if (!recipient) {
      throw adapterError(
        "CC_TEAM_GRAPH_MESSAGE_RECIPIENT_REQUIRED",
        "canonical Team message requires a recipient",
      );
    }
    if (declared.length > 0 && !recipients.has(recipient)) {
      throw adapterError(
        "CC_TEAM_GRAPH_MESSAGE_RECIPIENT_UNKNOWN",
        `canonical Team message recipient is not registered: ${recipient}`,
      );
    }
    return [recipient];
  }

  _messageSource(request) {
    const taskKey = request.senderAttempt?.taskKey || null;
    if (taskKey) {
      const active = this.attempts.get(taskKey);
      if (!active?.attempt) {
        throw adapterError(
          "CC_TEAM_GRAPH_MESSAGE_ATTEMPT_MISSING",
          `canonical Team message has no active Graph attempt for ${taskKey}`,
        );
      }
      return {
        fromAttemptId: active.attempt.id,
        leaseId: active.attempt.leaseId,
        fence: active.attempt.fence,
      };
    }
    if (String(request.from || "coordinator") !== "coordinator") {
      throw adapterError(
        "CC_TEAM_GRAPH_MESSAGE_AUTHORITY_REQUIRED",
        "non-coordinator Team messages require attempt-bound sender authority",
      );
    }
    return { systemSource: "team-coordinator" };
  }

  _sendMailboxMessage(mailbox, request) {
    const projectionKey = mailboxProjectionKey(
      this.runId,
      request,
      this.createId,
    );
    const payload = mailboxPayload(request, projectionKey);
    const source = this._messageSource(request);
    const messages = this._mailboxRecipients(mailbox, request).map(
      (recipient) =>
        this.kernel.sendMessage(this.runId, {
          messageId: graphMessageId(projectionKey, recipient),
          ...source,
          toAgentId: recipient,
          mode: payload.mode,
          payload,
          causationId: payload.causationId,
          correlationId: payload.correlationId,
          dataPolicy: {
            origin: `graph:${this.runId}`,
            trust: "trusted_host",
            sensitivity: "internal",
            allowedSinks: [`agent:${recipient}`],
          },
        }),
    );
    const projected = mailbox.send({
      ...request,
      idempotencyKey: projectionKey,
    });
    for (const message of messages) {
      this.kernel.deliverMessage(this.runId, message.id);
    }
    return projected;
  }

  _graphMessageIdForLegacy(message, recipient) {
    const projectionKey = String(message?.idempotencyKey || "");
    if (!projectionKey.startsWith("team-mail:")) {
      throw adapterError(
        "CC_TEAM_GRAPH_MESSAGE_PROJECTION_MISSING",
        `legacy Team message ${message?.id ?? "unknown"} is not bound to Graph authority`,
      );
    }
    return graphMessageId(projectionKey, recipient);
  }

  _receiveMailboxMessages(mailbox, recipient, options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
    const pending = mailbox.peek(recipient).slice(0, limit);
    for (const message of pending) {
      this.kernel.deliverMessage(
        this.runId,
        this._graphMessageIdForLegacy(message, recipient),
      );
    }
    if (pending.length > 0) {
      this.kernel.receiveMessages(this.runId, recipient, {
        markRead: options.markRead === true,
      });
    }
    return mailbox.receive(recipient, options);
  }

  _acknowledgeMailboxMessages(mailbox, recipient, options = {}) {
    const byId = new Map(mailbox.log().map((message) => [message.id, message]));
    const consumerKey = String(options.consumerKey || "").trim();
    for (const id of options.messageIds || []) {
      const message = byId.get(id);
      if (!message) {
        throw adapterError(
          "CC_TEAM_GRAPH_MESSAGE_PROJECTION_MISSING",
          `legacy Team message ${id} is outside the Graph projection window`,
        );
      }
      const graphId = this._graphMessageIdForLegacy(message, recipient);
      this.kernel.deliverMessage(this.runId, graphId);
      if (options.status === "dead_letter") {
        this.kernel.deadLetterMessage(
          this.runId,
          graphId,
          options.reason || "poison_message",
        );
      } else if (options.status === "read") {
        this.kernel.receiveMessages(this.runId, recipient, { markRead: true });
      } else {
        this.kernel.processMessage(this.runId, graphId, recipient, consumerKey);
      }
    }
    return mailbox.acknowledge(recipient, options);
  }

  _drainMailbox(mailbox, recipient) {
    const pending = mailbox.peek(recipient);
    for (const message of pending) {
      const graphId = this._graphMessageIdForLegacy(message, recipient);
      this.kernel.deliverMessage(this.runId, graphId);
      this.kernel.processMessage(
        this.runId,
        graphId,
        recipient,
        safeIdentifier(`legacy-drain:${recipient}:${message.id}`, "consumer"),
      );
    }
    return mailbox.drain(recipient);
  }

  _recordShadowDivergence(onDivergence, details, action) {
    try {
      return action();
    } catch (error) {
      try {
        onDivergence?.({
          ...details,
          code: error?.code || "CC_TEAM_GRAPH_SHADOW_DIVERGED",
          error: error?.message || String(error),
        });
      } catch {
        // Shadow reporting must never become an execution authority.
      }
      return null;
    }
  }

  _shadowGraphMessage(mailbox, request, projected) {
    const projectionKey = shadowMailboxProjectionKey(this.runId, projected);
    const payload = {
      ...mailboxPayload(request, projectionKey),
      legacyMessageId: projected.id,
      legacyPayloadDigest: projected.payloadDigest || null,
    };
    const source = this._messageSource(request);
    const messages = this._mailboxRecipients(mailbox, request).map(
      (recipient) =>
        this.kernel.sendMessage(this.runId, {
          messageId: graphMessageId(projectionKey, recipient),
          ...source,
          toAgentId: recipient,
          mode: payload.mode,
          payload,
          causationId: payload.causationId,
          correlationId: payload.correlationId,
          dataPolicy: {
            origin: `graph-shadow:${this.runId}`,
            trust: "trusted_host",
            sensitivity: "internal",
            allowedSinks: [`agent:${recipient}`],
          },
        }),
    );
    for (const message of messages) {
      this.kernel.deliverMessage(this.runId, message.id);
    }
    return messages;
  }

  _shadowGraphMessageId(message, recipient) {
    return graphMessageId(
      shadowMailboxProjectionKey(this.runId, message),
      recipient,
    );
  }

  _shadowBindMailbox(mailbox, onDivergence) {
    const adapter = this;
    const overrides = {
      send(request = {}) {
        const projected = mailbox.send(request);
        adapter._recordShadowDivergence(
          onDivergence,
          { phase: "message-send", messageId: projected?.id || null },
          () => adapter._shadowGraphMessage(mailbox, request, projected),
        );
        return projected;
      },
      receive(recipient, options = {}) {
        const messages = mailbox.receive(recipient, options);
        adapter._recordShadowDivergence(
          onDivergence,
          { phase: "message-receive", recipient },
          () => {
            for (const message of messages) {
              adapter.kernel.deliverMessage(
                adapter.runId,
                adapter._shadowGraphMessageId(message, recipient),
              );
            }
            if (messages.length > 0) {
              adapter.kernel.receiveMessages(adapter.runId, recipient, {
                markRead: options.markRead === true,
              });
            }
          },
        );
        return messages;
      },
      acknowledge(recipient, options = {}) {
        const result = mailbox.acknowledge(recipient, options);
        adapter._recordShadowDivergence(
          onDivergence,
          { phase: "message-ack", recipient },
          () => {
            const byId = new Map(
              mailbox.log().map((message) => [message.id, message]),
            );
            for (const id of options.messageIds || []) {
              const message = byId.get(id);
              if (!message) {
                throw adapterError(
                  "CC_TEAM_GRAPH_MESSAGE_PROJECTION_MISSING",
                  `shadow Team message ${id} is outside the legacy log`,
                );
              }
              const graphId = adapter._shadowGraphMessageId(message, recipient);
              adapter.kernel.deliverMessage(adapter.runId, graphId);
              if (options.status === "dead_letter") {
                adapter.kernel.deadLetterMessage(
                  adapter.runId,
                  graphId,
                  options.reason || "poison_message",
                );
              } else if (options.status === "read") {
                adapter.kernel.receiveMessages(adapter.runId, recipient, {
                  markRead: true,
                });
              } else {
                adapter.kernel.processMessage(
                  adapter.runId,
                  graphId,
                  recipient,
                  String(options.consumerKey || ""),
                );
              }
            }
          },
        );
        return result;
      },
      drain(recipient) {
        const messages = mailbox.drain(recipient);
        adapter._recordShadowDivergence(
          onDivergence,
          { phase: "message-drain", recipient },
          () => {
            for (const message of messages) {
              const graphId = adapter._shadowGraphMessageId(message, recipient);
              adapter.kernel.deliverMessage(adapter.runId, graphId);
              adapter.kernel.processMessage(
                adapter.runId,
                graphId,
                recipient,
                safeIdentifier(
                  `shadow-drain:${recipient}:${message.id}`,
                  "consumer",
                ),
              );
            }
          },
        );
        return messages;
      },
    };
    return new Proxy(mailbox, {
      get(target, property, receiver) {
        if (Object.hasOwn(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  _reconcileMailboxProjection(mailbox) {
    const collaboration = this.kernel.collaborationState(this.runId);
    const groups = new Map();
    for (const message of collaboration.messages) {
      const payload = message.payload;
      if (
        payload?.schema !== TEAM_MAILBOX_GRAPH_SCHEMA ||
        !payload.projectionKey
      ) {
        continue;
      }
      const group = groups.get(payload.projectionKey) || {
        payload,
        messages: [],
      };
      group.messages.push(message);
      groups.set(payload.projectionKey, group);
    }
    const consumers = new Map(
      collaboration.messageConsumers.map((receipt) => [
        receipt.messageId,
        receipt,
      ]),
    );
    for (const [projectionKey, group] of groups) {
      const projected = mailbox.send({
        from: group.payload.from,
        to: group.payload.to,
        subject: group.payload.subject,
        body: group.payload.body,
        mode: group.payload.mode,
        causationId: group.payload.causationId,
        correlationId: group.payload.correlationId,
        senderAttempt: group.payload.senderAttempt,
        idempotencyKey: projectionKey,
      });
      for (const message of group.messages) {
        if (message.status === "admitted") {
          this.kernel.deliverMessage(this.runId, message.id);
        }
        const receipt = consumers.get(message.id);
        if (receipt) {
          mailbox.acknowledge(message.toAgentId, {
            messageIds: [projected.id],
            consumerKey: receipt.consumerKey,
            status: "processed",
          });
        } else if (message.status === "dead_letter") {
          mailbox.acknowledge(message.toAgentId, {
            messageIds: [projected.id],
            consumerKey: `graph-dead-letter:${message.id}`,
            status: "dead_letter",
            reason: message.reason || "poison_message",
          });
        }
      }
    }
  }

  _activeHandoffAttempt(key) {
    const active = this.attempts.get(key)?.attempt;
    if (!active || active.status !== "active") {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_ATTEMPT_MISSING",
        `canonical Team handoff has no active Graph attempt for ${key}`,
      );
    }
    return active;
  }

  _offerRegistryHandoff(registry, key, options = {}) {
    const attempt = this._activeHandoffAttempt(key);
    const ttlMs =
      Number.isSafeInteger(Number(options.ttlMs)) && Number(options.ttlMs) > 0
        ? Number(options.ttlMs)
        : 5 * 60 * 1000;
    const handoffId = safeIdentifier(
      options.handoffId ||
        `team-handoff:${graphDigest(
          { runId: this.runId, key, nonce: this.createId() },
          "cc.team.handoff/v1",
        ).slice(7, 39)}`,
      "team-handoff",
    );
    this.kernel.offerHandoff(this.runId, {
      handoffId,
      fromAttemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      toAgentId: options.toHolder,
      artifactIds: [],
      preconditions: {
        ...(options.preconditions || {}),
        legacyArtifactIds: [...(options.artifactIds || [])],
        summary: options.summary ?? null,
        legacyProjection: {
          fromHolder: options.holder,
          fromLeaseId: options.leaseId,
          fromFence: attempt.grant?.legacyFence ?? options.leaseId,
          idempotencyKey: options.idempotencyKey ?? handoffId,
        },
      },
      ttlMs,
    });
    const projected = registry.offerHandoff(key, {
      ...options,
      handoffId,
      ttlMs,
      revisionDigest: this.kernel.getRun(this.runId).revisionDigest,
      authorityDigest: this.kernel.getRun(this.runId).authorityDigest,
    });
    if (!projected?.ok) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
        `legacy Team handoff offer rejected canonical custody: ${projected?.reason || "unknown"}`,
        { handoffId, key },
      );
    }
    return projected;
  }

  _acceptRegistryHandoff(registry, handoffId, options = {}) {
    this.kernel.acceptHandoff(this.runId, handoffId, options.holder);
    const projected = registry.acceptHandoff(handoffId, options);
    if (!projected?.ok) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
        `legacy Team handoff accept rejected canonical custody: ${projected?.reason || "unknown"}`,
        { handoffId },
      );
    }
    return projected;
  }

  _rejectRegistryHandoff(registry, handoffId, options = {}) {
    this.kernel.rejectHandoff(
      this.runId,
      handoffId,
      options.holder,
      options.reason,
    );
    const projected = registry.rejectHandoff(handoffId, options);
    if (!projected?.ok) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
        `legacy Team handoff reject rejected canonical custody: ${projected?.reason || "unknown"}`,
        { handoffId },
      );
    }
    return projected;
  }

  _commitRegistryHandoff(registry, handoffId, options = {}) {
    const found = registry.findHandoff(handoffId);
    if (!found) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_MISSING",
        `legacy Team handoff is missing: ${handoffId}`,
      );
    }
    const committed = this.kernel.commitHandoff(this.runId, handoffId, {
      attemptId: safeIdentifier(
        `team-attempt:${graphDigest(
          { runId: this.runId, handoffId, holder: found.handoff.toHolder },
          "cc.team.handoff-attempt/v1",
        ).slice(7, 39)}`,
        "team-attempt",
      ),
      leaseId: safeIdentifier(
        `graph-handoff-lease:${graphDigest(
          { runId: this.runId, handoffId },
          "cc.team.handoff-lease/v1",
        ).slice(7, 39)}`,
        "graph-handoff-lease",
      ),
      ttlMs: options.ttlMs || this.writerLeaseTtlMs,
    });
    this.attempts.set(found.key, {
      attempt: committed.assignmentAttempt,
      effect: null,
      handoffId,
    });
    const projected = registry.commitHandoff(handoffId, options);
    if (!projected?.ok) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
        `legacy Team handoff commit rejected canonical custody: ${projected?.reason || "unknown"}`,
        { handoffId, key: found.key },
      );
    }
    return projected;
  }

  _revokeRegistryHandoff(registry, handoffId, options = {}) {
    const found = registry.findHandoff(handoffId);
    if (!found) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_MISSING",
        `legacy Team handoff is missing: ${handoffId}`,
      );
    }
    const attempt = this._activeHandoffAttempt(found.key);
    this.kernel.revokeHandoff(
      this.runId,
      handoffId,
      attempt.id,
      attempt.leaseId,
      attempt.fence,
    );
    const projected = registry.revokeHandoff(handoffId, options);
    if (!projected?.ok) {
      throw adapterError(
        "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
        `legacy Team handoff revoke rejected canonical custody: ${projected?.reason || "unknown"}`,
        { handoffId, key: found.key },
      );
    }
    return projected;
  }

  _reconcileHandoffProjection(registry) {
    const handoffs = this.kernel.collaborationState(this.runId).handoffs;
    if (handoffs.length === 0) return;
    if (typeof registry.applyCanonicalHandoffProjection !== "function") {
      throw adapterError(
        "CC_TEAM_GRAPH_LEGACY_PROJECTION_UNSUPPORTED",
        "Team registry cannot repair canonical handoff custody",
      );
    }
    const projection = this.kernel.getRun(this.runId);
    const attempts = new Map(
      projection.attempts.map((attempt) => [attempt.id, attempt]),
    );
    for (const handoff of handoffs) {
      const key = this.nodeToTask.get(handoff.nodeId);
      const sourceAttempt = attempts.get(handoff.fromAttemptId);
      const legacy = handoff.preconditions?.legacyProjection || null;
      if (!key || !sourceAttempt || !legacy) {
        throw adapterError(
          "CC_TEAM_GRAPH_HANDOFF_PROJECTION_CORRUPT",
          `canonical Team handoff lacks its legacy projection binding: ${handoff.id}`,
          { handoffId: handoff.id, nodeId: handoff.nodeId },
        );
      }
      const {
        legacyArtifactIds = [],
        summary = null,
        legacyProjection: _legacyProjection,
        ...preconditions
      } = handoff.preconditions || {};
      const createdAt = Date.parse(handoff.createdAt);
      const updatedAt = Date.parse(handoff.updatedAt);
      const expiresAtMs = Number(handoff.expiresAtMs);
      const targetAttempt = handoff.committedAttemptId
        ? attempts.get(handoff.committedAttemptId)
        : null;
      if (
        !Number.isFinite(createdAt) ||
        !Number.isFinite(updatedAt) ||
        !Number.isFinite(expiresAtMs) ||
        (handoff.status === "committed" && !targetAttempt)
      ) {
        throw adapterError(
          "CC_TEAM_GRAPH_HANDOFF_PROJECTION_CORRUPT",
          `canonical Team handoff has invalid durable timestamps or target custody: ${handoff.id}`,
          { handoffId: handoff.id },
        );
      }
      const result = registry.applyCanonicalHandoffProjection(key, {
        handoff: {
          id: handoff.id,
          taskKey: key,
          fromHolder: legacy.fromHolder || sourceAttempt.agentId,
          fromLeaseId: legacy.fromLeaseId,
          fromFence: legacy.fromFence,
          toHolder: handoff.toAgentId,
          revisionDigest: handoff.revisionDigest,
          authorityDigest: handoff.authorityDigest,
          artifactIds: legacyArtifactIds,
          preconditions,
          summary,
          idempotencyKey: legacy.idempotencyKey || handoff.id,
          ttlMs: Math.max(1, expiresAtMs - createdAt),
          expiresAtMs,
          status: handoff.status,
          offeredAt: createdAt,
          acceptedAt:
            handoff.acceptedAt == null ? null : Date.parse(handoff.acceptedAt),
          rejectedAt:
            handoff.rejectedAt == null ? null : Date.parse(handoff.rejectedAt),
          committedAt:
            handoff.committedAt == null
              ? null
              : Date.parse(handoff.committedAt),
          revokedAt:
            handoff.revokedAt == null ? null : Date.parse(handoff.revokedAt),
          expiredAt:
            handoff.expiredAt == null ? null : Date.parse(handoff.expiredAt),
          reason: handoff.reason || null,
          updatedAt,
        },
        targetLease: targetAttempt
          ? {
              holder: targetAttempt.agentId,
              leaseId: targetAttempt.leaseId,
              fencingToken: targetAttempt.fence,
              acquiredAt: Date.parse(targetAttempt.createdAt),
              expiresAt: Date.parse(targetAttempt.expiresAt),
              renewals: 0,
              stolen: false,
              handoffId: handoff.id,
              transferredFromLeaseId: legacy.fromLeaseId,
              authorityGeneration: targetAttempt.authorityGeneration,
              writerId: targetAttempt.writerId,
            }
          : null,
        now: this.now(),
      });
      if (!result?.ok) {
        throw adapterError(
          "CC_TEAM_GRAPH_HANDOFF_PROJECTION_DIVERGED",
          `legacy Team handoff projection rejected canonical custody: ${result?.reason || "unknown"}`,
          { handoffId: handoff.id, key },
        );
      }
    }
  }

  _shadowBindRegistry(registry, onDivergence) {
    const adapter = this;
    const observe = (phase, details, action) =>
      adapter._recordShadowDivergence(
        onDivergence,
        { phase, ...details },
        action,
      );
    const overrides = {
      addTask(definition) {
        const result = registry.addTask(definition);
        if (result?.ok && !result.idempotent) {
          observe("task-append", { key: definition?.key || null }, () =>
            adapter.appendTask(registry.getTask(definition.key) || definition),
          );
        }
        return result;
      },
      offerHandoff(key, options = {}) {
        const result = registry.offerHandoff(key, options);
        if (result?.ok) {
          observe(
            "handoff-offer",
            { key, handoffId: result.handoff?.id || null },
            () => {
              const attempt = adapter._activeHandoffAttempt(key);
              const handoff = result.handoff;
              return adapter.kernel.offerHandoff(adapter.runId, {
                handoffId: handoff.id,
                fromAttemptId: attempt.id,
                leaseId: attempt.leaseId,
                fence: attempt.fence,
                toAgentId: handoff.toHolder,
                artifactIds: [],
                preconditions: {
                  ...(handoff.preconditions || {}),
                  legacyArtifactIds: [...(handoff.artifactIds || [])],
                  summary: handoff.summary ?? null,
                  legacyProjection: {
                    fromHolder: handoff.fromHolder,
                    fromLeaseId: handoff.fromLeaseId,
                    fromFence: handoff.fromFence,
                    idempotencyKey: handoff.idempotencyKey,
                  },
                },
                ttlMs: handoff.ttlMs,
              });
            },
          );
        }
        return result;
      },
      acceptHandoff(handoffId, options = {}) {
        const result = registry.acceptHandoff(handoffId, options);
        if (result?.ok) {
          observe("handoff-accept", { handoffId }, () =>
            adapter.kernel.acceptHandoff(
              adapter.runId,
              handoffId,
              options.holder,
            ),
          );
        }
        return result;
      },
      rejectHandoff(handoffId, options = {}) {
        const result = registry.rejectHandoff(handoffId, options);
        if (result?.ok) {
          observe("handoff-reject", { handoffId }, () =>
            adapter.kernel.rejectHandoff(
              adapter.runId,
              handoffId,
              options.holder,
              options.reason,
            ),
          );
        }
        return result;
      },
      commitHandoff(handoffId, options = {}) {
        const result = registry.commitHandoff(handoffId, options);
        if (result?.ok) {
          observe("handoff-commit", { handoffId, key: result.key }, () => {
            const committed = adapter.kernel.commitHandoff(
              adapter.runId,
              handoffId,
              {
                attemptId: safeIdentifier(
                  `team-shadow-attempt:${graphDigest(
                    {
                      runId: adapter.runId,
                      handoffId,
                      holder: result.handoff.toHolder,
                    },
                    "cc.team.shadow-handoff-attempt/v1",
                  ).slice(7, 39)}`,
                  "team-shadow-attempt",
                ),
                leaseId: safeIdentifier(
                  `team-shadow-lease:${graphDigest(
                    { runId: adapter.runId, handoffId },
                    "cc.team.shadow-handoff-lease/v1",
                  ).slice(7, 39)}`,
                  "team-shadow-lease",
                ),
                ttlMs: options.ttlMs || adapter.writerLeaseTtlMs,
              },
            );
            adapter.attempts.set(result.key, {
              attempt: committed.assignmentAttempt,
              effect: null,
              handoffId,
            });
            return committed;
          });
        }
        return result;
      },
      revokeHandoff(handoffId, options = {}) {
        const result = registry.revokeHandoff(handoffId, options);
        if (result?.ok) {
          observe("handoff-revoke", { handoffId, key: result.key }, () => {
            const found = registry.findHandoff(handoffId);
            const attempt = adapter._activeHandoffAttempt(
              result.key || found?.key,
            );
            return adapter.kernel.revokeHandoff(
              adapter.runId,
              handoffId,
              attempt.id,
              attempt.leaseId,
              attempt.fence,
            );
          });
        }
        return result;
      },
      expireHandoffs(...args) {
        const result = registry.expireHandoffs(...args);
        observe("handoff-expire", {}, () => adapter.kernel.tick(adapter.runId));
        return result;
      },
    };
    return new Proxy(registry, {
      get(target, property, receiver) {
        if (Object.hasOwn(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value, receiver) {
        return Reflect.set(target, property, value, receiver);
      },
    });
  }

  bindRegistry(registry, { onDivergence = null } = {}) {
    if (!registry || typeof registry.getTask !== "function") {
      throw new TypeError("bindRegistry requires a Team task registry");
    }
    if (this.authorityMode === "shadow") {
      return this._shadowBindRegistry(registry, onDivergence);
    }
    if (this.authorityMode !== "canonical") return registry;
    this._reconcileHandoffProjection(registry);
    const adapter = this;
    const overrides = {
      addTask(definition) {
        const appended = adapter.appendTask(definition);
        const projected = registry.addTask(appended.definition);
        if (!projected?.ok && !registry.getTask(definition?.key)) {
          throw adapterError(
            "CC_TEAM_GRAPH_LEGACY_PROJECTION_DIVERGED",
            `legacy Team registry rejected canonical dynamic task: ${projected?.reason || "unknown"}`,
            { key: definition?.key || null },
          );
        }
        return projected;
      },
      offerHandoff(key, options) {
        return adapter._offerRegistryHandoff(registry, key, options);
      },
      acceptHandoff(handoffId, options) {
        return adapter._acceptRegistryHandoff(registry, handoffId, options);
      },
      rejectHandoff(handoffId, options) {
        return adapter._rejectRegistryHandoff(registry, handoffId, options);
      },
      commitHandoff(handoffId, options) {
        return adapter._commitRegistryHandoff(registry, handoffId, options);
      },
      revokeHandoff(handoffId, options) {
        return adapter._revokeRegistryHandoff(registry, handoffId, options);
      },
      expireHandoffs(...args) {
        adapter.kernel.tick(adapter.runId);
        return registry.expireHandoffs(...args);
      },
    };
    return new Proxy(registry, {
      get(target, property, receiver) {
        if (Object.hasOwn(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value, receiver) {
        return Reflect.set(target, property, value, receiver);
      },
    });
  }

  bindMailbox(mailbox, { onDivergence = null } = {}) {
    if (!mailbox || typeof mailbox.send !== "function") {
      throw new TypeError("bindMailbox requires a Team mailbox adapter");
    }
    if (this.authorityMode === "shadow") {
      return this._shadowBindMailbox(mailbox, onDivergence);
    }
    if (this.authorityMode !== "canonical") return mailbox;
    this._reconcileMailboxProjection(mailbox);
    const adapter = this;
    const overrides = {
      send(request) {
        return adapter._sendMailboxMessage(mailbox, request || {});
      },
      receive(recipient, options) {
        return adapter._receiveMailboxMessages(mailbox, recipient, options);
      },
      acknowledge(recipient, options) {
        return adapter._acknowledgeMailboxMessages(mailbox, recipient, options);
      },
      drain(recipient) {
        return adapter._drainMailbox(mailbox, recipient);
      },
    };
    return new Proxy(mailbox, {
      get(target, property, receiver) {
        if (Object.hasOwn(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  nextReadyTaskKey({ excludeKeys = null } = {}) {
    if (!this.kernel || !this.runId) {
      throw adapterError(
        "CC_TEAM_GRAPH_NOT_OPEN",
        "canonical Team Graph adapter is not open",
      );
    }
    const excluded =
      excludeKeys instanceof Set ? excludeKeys : new Set(excludeKeys || []);
    for (const candidate of this.kernel.readyNodes(this.runId)) {
      const key = this.nodeToTask.get(candidate.nodeId);
      if (key && !excluded.has(key)) return key;
    }
    return null;
  }

  appendTask(task) {
    if (!this.dynamic || !this.producerLease) {
      throw adapterError(
        "CC_TEAM_GRAPH_DYNAMIC_DISABLED",
        "canonical Team Graph is not open for dynamic follow-up tasks",
      );
    }
    const definition = persistedTeamTaskDefinition(task || {});
    if (!definition.key || !definition.title) {
      throw adapterError(
        "CC_TEAM_GRAPH_DYNAMIC_TASK_INVALID",
        "dynamic Team task requires a stable key and title",
      );
    }
    const existing = this.taskDefinitions.get(definition.key);
    if (existing) {
      if (
        graphDigest(existing, "cc.team.task-definition/v1") !==
        graphDigest(definition, "cc.team.task-definition/v1")
      ) {
        throw adapterError(
          "CC_TEAM_GRAPH_DYNAMIC_TASK_CONFLICT",
          `dynamic Team task key was reused with different content: ${definition.key}`,
        );
      }
      return Object.freeze({
        idempotent: true,
        nodeId: this.taskToNode.get(definition.key),
        definition,
      });
    }
    const nodeId = safeIdentifier(definition.key, "team-node");
    if (this.nodeToTask.has(nodeId)) {
      throw adapterError(
        "CC_TEAM_GRAPH_NODE_COLLISION",
        `dynamic Team task collides with an existing Graph node: ${definition.key}`,
      );
    }
    if (this.executionMode !== "dry-run" && !this.worktree) {
      const ordered = new Set();
      const visit = (key) => {
        if (!key || ordered.has(key)) return;
        ordered.add(key);
        const dependency = this.taskDefinitions.get(key);
        for (const parent of dependency?.dependsOn || []) visit(parent);
      };
      for (const dependency of definition.dependsOn) visit(dependency);
      const nextScopes = taskWriteScopes(definition);
      for (const [key, candidate] of this.taskDefinitions) {
        if (
          !ordered.has(key) &&
          scopesOverlap(nextScopes, taskWriteScopes(candidate))
        ) {
          definition.dependsOn.push(key);
          visit(key);
        }
      }
      definition.dependsOn = [...new Set(definition.dependsOn)];
    }
    const nextTaskToNode = new Map(this.taskToNode);
    nextTaskToNode.set(definition.key, nodeId);
    const node = compileTeamTaskNode(definition, nextTaskToNode, {
      executionMode: this.executionMode,
      worktree: this.worktree,
      maxAttempts: this.maxAttempts,
    });
    const nextDefinitions = new Map(this.taskDefinitions);
    nextDefinitions.set(definition.key, definition);
    const requestId = safeIdentifier(
      `team-append:${graphDigest(
        { runId: this.runId, definition },
        "cc.team.dynamic-task/v1",
      ).slice(7, 39)}`,
      "team-append",
    );
    const result = this.kernel.appendGraph(this.runId, {
      expectedGraphRevision: this.kernel.getRun(this.runId).graphRevision,
      requestId,
      producerLeaseId: this.producerLease.id,
      producerFence: this.producerLease.fence,
      nodes: [node],
      metadataPatch: {
        taskKeyByNodeId: Object.fromEntries(
          [...nextTaskToNode].map(([taskKey, id]) => [id, taskKey]),
        ),
        taskDefinitionsByNodeId: Object.fromEntries(
          [...nextDefinitions].map(([taskKey, value]) => [
            nextTaskToNode.get(taskKey),
            value,
          ]),
        ),
      },
    });
    this.taskToNode = nextTaskToNode;
    this.nodeToTask.set(nodeId, definition.key);
    this.taskDefinitions = nextDefinitions;
    return Object.freeze({ ...result, nodeId, definition });
  }

  finalize() {
    if (!this.kernel || !this.runId) return null;
    const projection = this.kernel.getRun(this.runId);
    if (projection.phase !== "open") return projection;
    if (this.producerLease) {
      try {
        this.kernel.releaseProducerLease(
          this.runId,
          this.producerLease.id,
          this.producerLease.fence,
        );
      } catch (error) {
        if (error?.code !== "CC_GRAPH_STALE_PRODUCER_LEASE") throw error;
      }
      this.producerLease = null;
    }
    return this.kernel.sealRun(this.runId);
  }

  beforeTask({ key, holder, lease, task }) {
    if (!this.kernel) {
      throw adapterError(
        "CC_TEAM_GRAPH_NOT_OPEN",
        "canonical Team Graph adapter is not open",
      );
    }
    const nodeId = this.taskToNode.get(key);
    if (!nodeId) {
      throw adapterError(
        "CC_TEAM_GRAPH_TASK_UNKNOWN",
        `canonical Team Graph has no task ${key}`,
      );
    }
    const current = this.attempts.get(key);
    let attempt =
      current?.attempt?.status === "active" &&
      current.attempt.agentId === holder
        ? current.attempt
        : null;
    if (!attempt) {
      const attemptId = safeIdentifier(
        `team-attempt:${graphDigest(
          {
            runId: this.runId,
            key,
            holder,
            legacyLeaseId: lease?.leaseId || null,
            legacyFence: lease?.fencingToken ?? null,
            authorityGeneration: this.kernel.getRun(this.runId)
              .authorityGeneration,
          },
          "cc.team.assignment/v1",
        ).slice(7, 39)}`,
        "team-attempt",
      );
      attempt = this.kernel.assignNode(this.runId, nodeId, holder, {
        attemptId,
        leaseId: safeIdentifier(
          `graph-lease:${lease?.leaseId || this.createId()}`,
          "graph-lease",
        ),
        ttlMs: this.writerLeaseTtlMs,
        role: "executor",
        grant: {
          legacyLeaseId: lease?.leaseId || null,
          legacyFence: lease?.fencingToken ?? null,
        },
      });
    }
    let effect = current?.effect || null;
    if (attempt.effectIdempotencyKey) {
      effect = this.kernel.beginEffect(this.runId, {
        effectId: safeIdentifier(`team-effect:${attempt.id}`, "team-effect"),
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey: attempt.effectIdempotencyKey,
        operationDigest: graphDigest(
          {
            taskKey: key,
            nodeId,
            title: task?.title || key,
            scopePaths: task?.metadata?.scopePaths || [],
          },
          "cc.team.operation/v1",
        ),
      });
      if (effect.attemptId !== attempt.id || effect.status !== "started") {
        throw adapterError(
          "CC_TEAM_GRAPH_EFFECT_NOT_EXECUTABLE",
          "canonical Team effect was already owned or terminal under another attempt",
          { key, attemptId: attempt.id, effectId: effect.id },
        );
      }
    }
    this.attempts.set(key, { attempt, effect });
    return attempt;
  }

  settleTask({ key, task, status, result = null, error = null }) {
    const active = this.attempts.get(key);
    if (!active) {
      throw adapterError(
        "CC_TEAM_GRAPH_ATTEMPT_MISSING",
        `canonical Team Graph has no active attempt for ${key}`,
      );
    }
    const { attempt, effect } = active;
    if (status === "completed") {
      let evidence;
      try {
        evidence = terminalEvidence(result);
      } catch (error) {
        if (
          !["shell", "shell-worktree"].includes(this.executionMode) ||
          Number(result?.code) !== 0
        ) {
          throw error;
        }
        evidence = {
          outputDigest: graphDigest(
            {
              runId: this.runId,
              taskKey: key,
              nodeId: attempt.nodeId,
              operationDigest: effect?.operationDigest || null,
              exitCode: result.code,
            },
            "cc.team.shell-execution-receipt/v1",
          ),
        };
      }
      if (effect) {
        const receiptDigest =
          evidence.outputDigest ||
          graphDigest(evidence, "cc.team.effect-receipt/v1");
        this.kernel.settleEffect(this.runId, {
          effectId: effect.id,
          attemptId: attempt.id,
          leaseId: attempt.leaseId,
          fence: attempt.fence,
          outcome: "committed",
          receipt: { receiptDigest },
        });
      }
      const settled = this.kernel.settleAttempt(this.runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "succeeded",
        evidence,
        usage: graphUsage(result),
      });
      this.attempts.delete(key);
      return settled;
    }
    if (effect) {
      const retrySafe = task?.metadata?.retrySafe === true;
      this.kernel.settleEffect(this.runId, {
        effectId: effect.id,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: retrySafe ? "failed" : "unknown",
      });
      if (!retrySafe) {
        this.attempts.delete(key);
        return this.kernel.getRun(this.runId);
      }
    }
    const settled = this.kernel.settleAttempt(this.runId, {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "failed",
      usage: graphUsage(error),
      error: error?.message || String(error || "team task failed"),
    });
    this.attempts.delete(key);
    return settled;
  }

  abandonTask(key, error = null) {
    const active = this.attempts.get(key);
    if (!active) return this.status();
    const { attempt, effect } = active;
    if (effect) {
      this.kernel.settleEffect(this.runId, {
        effectId: effect.id,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "unknown",
      });
    } else {
      this.kernel.settleAttempt(this.runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "cancelled",
        error: error?.message || String(error || "legacy projection failed"),
      });
    }
    this.attempts.delete(key);
    return this.status();
  }

  status() {
    if (!this.kernel || !this.runId) return null;
    return this.kernel.getRun(this.runId);
  }

  events(options = {}) {
    if (!this.kernel || !this.runId) return [];
    return this.kernel.events(this.runId, options);
  }

  async cancel(reason = "team run cancelled") {
    if (!this.kernel || !this.runId) return null;
    return this.kernel.cancelRun(this.runId, { reason });
  }
}
