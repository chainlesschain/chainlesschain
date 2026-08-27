import { createHash } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function writerError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TeamDistributedGraphWriterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stable(value))}`, "utf8")
    .digest("hex")}`;
}

function leaseForTask(task) {
  return task?.lease || task?.metadata?.lease || null;
}

function sameLease(left, right) {
  return (
    left?.holder === right?.holder &&
    left?.leaseId === right?.leaseId &&
    Number(left?.fencingToken) === Number(right?.fencingToken)
  );
}

function terminalEvidence(value) {
  const source = value?.terminalEvidence || value || {};
  const evidence = {};
  if (DIGEST.test(String(source.outputDigest || ""))) {
    evidence.outputDigest = source.outputDigest;
  }
  const commit = source.commit || value?.commitOid || null;
  if (commit) evidence.commit = String(commit);
  if (Array.isArray(source.artifactIds) && source.artifactIds.length > 0) {
    evidence.artifactIds = source.artifactIds.map(String);
  }
  if (
    Array.isArray(source.testReceiptIds) &&
    source.testReceiptIds.length > 0
  ) {
    evidence.testReceiptIds = source.testReceiptIds.map(String);
  }
  if (Object.keys(evidence).length === 0) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_EVIDENCE_REQUIRED",
      "canonical distributed Team success requires immutable terminal evidence",
    );
  }
  return evidence;
}

function graphResult(value) {
  const output = { terminalEvidence: terminalEvidence(value) };
  if (value?.usage && typeof value.usage === "object") {
    output.usage = stable(value.usage);
  }
  return output;
}

function graphError(value) {
  const output = new Error(
    String(value?.message || value || "distributed Team task failed").slice(
      0,
      4096,
    ),
  );
  if (value?.usage && typeof value.usage === "object") {
    output.usage = stable(value.usage);
  }
  return output;
}

export function distributedTeamGraphRunId({ queueId, runId }) {
  return `team-distributed:${createHash("sha256")
    .update(`${queueId}\0${runId}`, "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

export function distributedTeamGraphRequestId(type, binding) {
  return `graph-${type}:${createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          type,
          queueId: binding.queueId,
          taskKey: binding.taskKey,
          holder: binding.lease?.holder,
          leaseId: binding.lease?.leaseId,
          fencingToken: binding.lease?.fencingToken,
        }),
      ),
      "utf8",
    )
    .digest("hex")
    .slice(0, 40)}`;
}

export function distributedTeamGraphSettlementPayload(settlement) {
  const status = settlement?.status;
  if (status === "completed") {
    return Object.freeze({
      status,
      effectDecision: "committed",
      result: graphResult(settlement.result),
      error: null,
    });
  }
  if (!["failed", "cancelled"].includes(status)) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_SETTLEMENT_INVALID",
      `unsupported canonical distributed Team settlement: ${status}`,
    );
  }
  const retrySafe = settlement.task?.metadata?.retrySafe === true;
  return Object.freeze({
    status: "failed",
    effectDecision: retrySafe ? "failed" : "unknown",
    result: null,
    error: {
      message: String(
        settlement.error?.message ||
          settlement.error ||
          "distributed Team task failed",
      ).slice(0, 4096),
      ...(settlement.error?.usage
        ? { usage: stable(settlement.error.usage) }
        : {}),
    },
  });
}

export function distributedTeamGraphRecoveryReceipts(snapshot) {
  const responses = new Map(
    (snapshot?.responses || []).map((response) => [
      response.requestId,
      response,
    ]),
  );
  const receipts = new Map();
  for (const request of snapshot?.requests || []) {
    if (request.type !== "dispatch") continue;
    const response = responses.get(request.requestId);
    if (!response || response.status === "rejected") {
      receipts.set(request.taskKey, {
        decision: "failed",
        auditDecisionId: `bridge-no-dispatch:${request.requestId}`,
      });
    }
  }
  for (const request of snapshot?.requests || []) {
    if (!["settle", "cancel"].includes(request.type)) continue;
    if (request.payload?.effectDecision === "committed") {
      const evidence = terminalEvidence(request.payload?.result);
      receipts.set(request.taskKey, {
        status: "completed",
        decision: "committed",
        terminalEvidence: evidence,
        receiptDigest:
          evidence.outputDigest ||
          digest(evidence, "cc.team.distributed-effect-receipt/v1"),
        auditDecisionId: `bridge-settlement:${request.requestId}`,
      });
    } else if (request.payload?.effectDecision === "failed") {
      receipts.set(request.taskKey, {
        status: "failed",
        decision: "failed",
        auditDecisionId: `bridge-settlement:${request.requestId}`,
      });
    } else {
      receipts.delete(request.taskKey);
    }
  }
  return receipts;
}

function snapshotMap(value) {
  return new Map(Array.isArray(value) ? value : []);
}

export function verifyDistributedTeamGraphResponse({
  response,
  request,
  eventStore,
  runId,
}) {
  if (response?.status !== "applied") {
    throw writerError(
      response?.error?.code || "CC_TEAM_DISTRIBUTED_GRAPH_REJECTED",
      response?.error?.message ||
        "canonical distributed Graph request rejected",
    );
  }
  const binding = response.graphAuthority;
  if (
    binding?.runId !== runId ||
    binding?.authoritySource !== "graph_kernel" ||
    binding?.authorityMode !== "canonical" ||
    !Number.isSafeInteger(binding?.authorityGeneration) ||
    binding.authorityGeneration < 1 ||
    !DIGEST.test(String(binding?.eventHead || "")) ||
    !DIGEST.test(String(binding?.revisionDigest || ""))
  ) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      "canonical distributed Graph response has an invalid authority binding",
    );
  }
  const event = eventStore
    .read(runId, { limit: 100_000 })
    .find((candidate) => candidate.hash === binding.eventHead);
  const state = event?.payload?.state;
  if (
    !state ||
    state.id !== runId ||
    state.revisionDigest !== binding.revisionDigest ||
    state.authority?.authorityGeneration !== binding.authorityGeneration ||
    state.authority?.writerId !== binding.writerId ||
    state.authority?.writerLeaseId !== binding.writerLeaseId
  ) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      "canonical distributed Graph response is absent from the verified event chain",
    );
  }
  const attempts = snapshotMap(state.attempts);
  const effects = snapshotMap(state.effects);
  const nodes = snapshotMap(state.nodeStates);
  const attempt = attempts.get(binding.attemptId);
  const effect = effects.get(binding.effectId);
  const node = nodes.get(binding.nodeId);
  if (
    !attempt ||
    attempt.nodeId !== binding.nodeId ||
    attempt.agentId !== request.lease.holder ||
    attempt.grant?.legacyLeaseId !== request.lease.leaseId ||
    Number(attempt.grant?.legacyFence) !== Number(request.lease.fencingToken) ||
    !effect ||
    effect.attemptId !== attempt.id ||
    effect.nodeId !== binding.nodeId ||
    node?.status !== binding.nodeStatus
  ) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      "canonical distributed Graph response is not bound to the exact task attempt",
    );
  }
  if (request.type === "dispatch" && effect.status !== "started") {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      "canonical dispatch response has no active effect boundary",
    );
  }
  if (
    ["settle", "cancel"].includes(request.type) &&
    ((request.payload?.effectDecision === "committed" &&
      (effect.status !== "committed" || node.status !== "succeeded")) ||
      (request.payload?.effectDecision === "failed" &&
        effect.status !== "failed") ||
      (request.payload?.effectDecision === "unknown" &&
        effect.status !== "unknown"))
  ) {
    throw writerError(
      "CC_TEAM_DISTRIBUTED_GRAPH_RESPONSE_FORGED",
      "canonical settlement response conflicts with its durable effect outcome",
    );
  }
  return Object.freeze({ event, state, attempt, effect, node });
}

function nodeFor(adapter, taskKey) {
  const nodeId = adapter.taskToNode.get(taskKey);
  const projection = adapter.status();
  return {
    nodeId,
    node: projection.nodes.find((candidate) => candidate.nodeId === nodeId),
    projection,
  };
}

function attemptsForRequest(adapter, request, nodeId) {
  return adapter
    .status()
    .attempts.filter(
      (attempt) =>
        attempt.nodeId === nodeId &&
        attempt.agentId === request.lease.holder &&
        attempt.grant?.legacyLeaseId === request.lease.leaseId &&
        Number(attempt.grant?.legacyFence) ===
          Number(request.lease.fencingToken),
    );
}

function alreadyApplied(adapter, request) {
  const { nodeId, node } = nodeFor(adapter, request.taskKey);
  if (!node) return null;
  const attempts = attemptsForRequest(adapter, request, nodeId);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const effects = adapter.kernel
    .effectState(adapter.runId)
    .filter((effect) => attemptIds.has(effect.attemptId));
  if (request.type === "dispatch") {
    const authorizedEffect = effects.find((effect) =>
      ["started", "committed", "unknown"].includes(effect.status),
    );
    if (authorizedEffect) {
      return { attempt: attempts.at(-1) || null, effect: authorizedEffect };
    }
  }
  if (request.type === "settle" || request.type === "cancel") {
    const decision = request.payload?.effectDecision;
    if (
      (decision === "committed" &&
        effects.some((effect) => effect.status === "committed")) ||
      (decision === "failed" &&
        effects.some((effect) => effect.status === "failed")) ||
      (decision === "committed" && node.status === "succeeded") ||
      (decision !== "committed" &&
        ["failed", "blocked", "cancelled"].includes(node.status))
    ) {
      return {
        attempt: attempts.at(-1) || null,
        effect: effects.at(-1) || null,
      };
    }
  }
  return null;
}

function authorityBinding(adapter, taskKey, applied = {}) {
  const { nodeId, node, projection } = nodeFor(adapter, taskKey);
  return {
    runId: projection.id,
    authoritySource: projection.authoritySource,
    authorityMode: projection.authorityMode,
    authorityGeneration: projection.authorityGeneration,
    writerId: projection.writerId,
    writerLeaseId: projection.writerLeaseId,
    eventHead: projection.eventHead,
    revisionDigest: projection.revisionDigest,
    nodeId,
    nodeStatus: node?.status || null,
    attemptId: applied.attempt?.id || null,
    effectId: applied.effect?.id || null,
  };
}

export class TeamDistributedGraphWriter {
  constructor({
    queue,
    bridge,
    adapter,
    runId,
    executionMode,
    budget = {},
  } = {}) {
    if (!queue || !bridge || !adapter || !runId || !executionMode) {
      throw new TypeError(
        "distributed Team Graph writer requires queue, bridge, adapter, runId, and executionMode",
      );
    }
    this.queue = queue;
    this.bridge = bridge;
    this.adapter = adapter;
    this.runId = runId;
    this.executionMode = executionMode;
    this.budget = budget;
    this.opened = false;
  }

  open() {
    if (this.opened) return this.adapter.status();
    const recoveryReceipts = distributedTeamGraphRecoveryReceipts(
      this.bridge.snapshot(),
    );
    const projection = this.adapter.open({
      registry: this.queue,
      runId: this.runId,
      executionMode: this.executionMode,
      worktree: true,
      teammates: 1,
      budget: this.budget,
      authorityMode: "canonical",
      dynamic: false,
      recoveryReceipts,
    });
    this.opened = true;
    return projection;
  }

  process(request) {
    if (!this.opened) this.open();
    const prior = alreadyApplied(this.adapter, request);
    if (prior) {
      return this.bridge.respond(request, {
        status: "applied",
        graphAuthority: authorityBinding(this.adapter, request.taskKey, prior),
        result: { recovered: true },
      });
    }
    const task = this.queue.getTask(request.taskKey);
    const lease = leaseForTask(task);
    if (
      !task ||
      task.status !== "in_progress" ||
      !sameLease(lease, request.lease)
    ) {
      return this.bridge.respond(request, {
        status: "rejected",
        graphAuthority: authorityBinding(this.adapter, request.taskKey),
        error: writerError(
          "CC_TEAM_DISTRIBUTED_GRAPH_STALE_LEASE",
          `distributed Graph request lost its exact queue lease: ${request.taskKey}`,
        ),
      });
    }
    let applied;
    if (request.type === "dispatch") {
      const attempt = this.adapter.beforeTask({
        key: request.taskKey,
        holder: request.lease.holder,
        lease: request.lease,
        task,
      });
      applied = {
        attempt,
        effect: this.adapter.attempts.get(request.taskKey)?.effect || null,
      };
    } else if (request.type === "settle" || request.type === "cancel") {
      if (!this.adapter.attempts.has(request.taskKey)) {
        this.adapter.beforeTask({
          key: request.taskKey,
          holder: request.lease.holder,
          lease: request.lease,
          task,
        });
      }
      const active = this.adapter.attempts.get(request.taskKey);
      const settled = this.adapter.settleTask({
        key: request.taskKey,
        task,
        status: request.payload?.status,
        result:
          request.payload?.status === "completed"
            ? graphResult(request.payload?.result)
            : null,
        error:
          request.payload?.status === "completed"
            ? null
            : graphError(request.payload?.error),
      });
      applied = {
        attempt: active?.attempt || settled,
        effect: active?.effect || null,
      };
    } else {
      return this.bridge.respond(request, {
        status: "rejected",
        graphAuthority: authorityBinding(this.adapter, request.taskKey),
        error: writerError(
          "CC_TEAM_DISTRIBUTED_GRAPH_REQUEST_INVALID",
          `unsupported distributed Graph request: ${request.type}`,
        ),
      });
    }
    return this.bridge.respond(request, {
      status: "applied",
      graphAuthority: authorityBinding(this.adapter, request.taskKey, applied),
      result: { recovered: false },
    });
  }

  processPending() {
    const responses = [];
    for (const request of this.bridge.pending()) {
      responses.push(this.process(request));
    }
    return responses;
  }

  status() {
    return {
      graph: this.adapter.status(),
      bridge: this.bridge.snapshot(),
    };
  }
}
