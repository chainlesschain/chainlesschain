import { randomUUID } from "node:crypto";
import {
  assertCompiledGraph,
  compileGraphDefinition,
  executionAttemptId,
  graphDigest,
  validateGraphDefinitionMigrationEvidence,
  writeScopesOverlap,
} from "./compiler.js";
import { GraphEventStore } from "./event-store.js";
import {
  GRAPH_PROJECTION_VERSION,
  assertGraphAuthorityWriter,
  createGraphAuthorityBinding,
} from "./authority.js";

export const GRAPH_RUN_PHASES = Object.freeze(["open", "sealed"]);
export const GRAPH_RUN_STATUSES = Object.freeze([
  "running",
  "waiting_input",
  "waiting_external",
  "waiting_human",
  "reconciliation_required",
  "succeeded",
  "failed",
  "partial",
  "cancelled",
  "blocked",
  "deadlocked",
  "budget_exhausted",
]);
export const GRAPH_NODE_STATUSES = Object.freeze([
  "pending",
  "running",
  "waiting_human",
  "reconciliation_required",
  "succeeded",
  "failed",
  "skipped",
  "upstream_failed",
  "cancelled",
  "blocked",
  "timed_out",
  "budget_exhausted",
]);

const TERMINAL_RUN = new Set([
  "succeeded",
  "failed",
  "partial",
  "cancelled",
  "blocked",
  "deadlocked",
  "budget_exhausted",
]);
const TERMINAL_NODE = new Set([
  "succeeded",
  "failed",
  "skipped",
  "upstream_failed",
  "cancelled",
  "blocked",
  "timed_out",
  "budget_exhausted",
]);
const SUCCESS_NODE = new Set(["succeeded"]);
const FAILURE_NODE = new Set([
  "failed",
  "upstream_failed",
  "blocked",
  "timed_out",
  "budget_exhausted",
]);
const ACTIVE_ATTEMPT = new Set(["active", "waiting_human", "cancelling"]);
const SENSITIVITY_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
});
const TRUST_RANK = Object.freeze({
  unknown: 0,
  untrusted_content: 1,
  authenticated_user: 2,
  trusted_host: 3,
});
const BUDGET_FIELDS = Object.freeze([
  "turns",
  "tokens",
  "costUsd",
  "wallMs",
  "spawnCount",
]);

function kernelError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphKernelError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mapSnapshot(map) {
  return [...map.entries()].map(([key, value]) => [key, clone(value)]);
}

function mapRestore(entries) {
  return new Map((entries || []).map(([key, value]) => [key, clone(value)]));
}

function emptyBudgetUsage() {
  return Object.fromEntries(BUDGET_FIELDS.map((field) => [field, 0]));
}

function budgetValue(budget, field) {
  return Number(budget?.[field] || 0);
}

function persistedSubgraphRegistry(definitions = {}) {
  return new Map(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      {
        definition,
        revisionDigest: graphDigest(
          definition,
          `cc.graph.definition/${definition.schemaVersion}`,
        ),
      },
    ]),
  );
}

function idleCompensationState() {
  return {
    status: "idle",
    triggerNodeId: null,
    reason: null,
    terminalStatus: null,
    plan: [],
    currentIndex: 0,
    completedNodeIds: [],
    completedEntries: [],
    failure: null,
    startedAt: null,
    completedAt: null,
  };
}

function iterationFrameId(runId, regionId, iterationPath) {
  const digest = graphDigest(
    { runId, regionId, iterationPath },
    "cc.graph.iteration-frame/v1",
  );
  return `iteration-${digest.slice(7, 39)}`;
}

function deterministicSubgraphRunId(parentRunId, nodeId, revisionDigest) {
  const digest = graphDigest(
    { parentRunId, nodeId, revisionDigest },
    "cc.graph.subgraph-run/v1",
  );
  return `subgraph-${digest.slice(7, 39)}`;
}

export function iterationEffectIdempotencyKey(
  baseIdempotencyKey,
  iterationPath = [],
) {
  const base = String(baseIdempotencyKey || "").trim();
  if (!base) {
    throw kernelError(
      "CC_GRAPH_EFFECT_IDEMPOTENCY_REQUIRED",
      "effect idempotency key is required",
    );
  }
  if (!Array.isArray(iterationPath)) {
    throw kernelError(
      "CC_GRAPH_INVALID_ARGUMENT",
      "iterationPath must be an array",
    );
  }
  const path = iterationPath.map((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw kernelError(
        "CC_GRAPH_INVALID_ARGUMENT",
        "iterationPath must contain non-negative integers",
      );
    }
    return number;
  });
  if (path.length === 0) return base;
  return graphDigest(
    { baseIdempotencyKey: base, iterationPath: path },
    "cc.graph.iteration-effect-idempotency/v1",
  );
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeIdentifier(value, label = "identifier") {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)) {
    throw kernelError("CC_GRAPH_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return id;
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function attemptIsLive(attempt, now) {
  return (
    ACTIVE_ATTEMPT.has(attempt.status) && Number(attempt.expiresAtMs) > now
  );
}

function producerIsLive(lease, now) {
  return lease.status === "active" && Number(lease.expiresAtMs) > now;
}

function hasTerminalEvidence(evidence) {
  return Boolean(
    evidence &&
    (evidence.outputDigest ||
      evidence.commit ||
      (Array.isArray(evidence.artifactIds) && evidence.artifactIds.length) ||
      (Array.isArray(evidence.testReceiptIds) &&
        evidence.testReceiptIds.length)),
  );
}

function dependencySatisfied(policy, status) {
  if (policy === "always") return TERMINAL_NODE.has(status);
  if (policy === "failure") return FAILURE_NODE.has(status);
  if (policy === "timeout") return status === "timed_out";
  if (policy === "cancel") return status === "cancelled";
  return SUCCESS_NODE.has(status);
}

function dependencyMismatchStatus(policy, status) {
  if (policy === "success" && FAILURE_NODE.has(status)) {
    return "upstream_failed";
  }
  if (policy === "success" && status === "cancelled") return "cancelled";
  return "skipped";
}

function validateDataPolicy(policy) {
  if (
    !policy ||
    typeof policy.origin !== "string" ||
    !Object.hasOwn(TRUST_RANK, policy.trust) ||
    !Object.hasOwn(SENSITIVITY_RANK, policy.sensitivity) ||
    !Array.isArray(policy.allowedSinks)
  ) {
    throw kernelError(
      "CC_GRAPH_DATA_POLICY_REQUIRED",
      "origin/trust/sensitivity/allowedSinks must be assigned at a trusted boundary",
    );
  }
  return clone(policy);
}

function sinkAllowed(policy, sink) {
  return policy.allowedSinks.some(
    (allowed) =>
      allowed === "*" ||
      allowed === sink ||
      (allowed.endsWith("*") && sink.startsWith(allowed.slice(0, -1))),
  );
}

function containsAuthorityPayload(value, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 10_000) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsAuthorityPayload(item, state));
  }
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "approval",
        "capability",
        "permission",
        "controlEdge",
        "authority",
      ].includes(key)
    ) {
      return true;
    }
    if (containsAuthorityPayload(child, state)) return true;
  }
  return false;
}

export function deriveDataPolicy(policies, { declassification = null } = {}) {
  const values = policies.map(validateDataPolicy);
  if (!values.length) {
    throw kernelError(
      "CC_GRAPH_DATA_POLICY_REQUIRED",
      "at least one source data policy is required",
    );
  }
  const trust = values.reduce(
    (lowest, policy) =>
      TRUST_RANK[policy.trust] < TRUST_RANK[lowest] ? policy.trust : lowest,
    values[0].trust,
  );
  const sensitivity = values.reduce(
    (highest, policy) =>
      SENSITIVITY_RANK[policy.sensitivity] > SENSITIVITY_RANK[highest]
        ? policy.sensitivity
        : highest,
    values[0].sensitivity,
  );
  const allowedSinks = values
    .map((policy) => new Set(policy.allowedSinks))
    .reduce(
      (intersection, current) =>
        new Set([...intersection].filter((sink) => current.has(sink))),
    );
  const output = {
    origin: `derived:${graphDigest(values, "cc.graph.data-origin/v1")}`,
    trust,
    sensitivity,
    allowedSinks: [...allowedSinks].sort(),
  };
  if (declassification) {
    if (
      typeof declassification.decisionId !== "string" ||
      !Array.isArray(declassification.allowedSinks)
    ) {
      throw kernelError(
        "CC_GRAPH_DECLASSIFICATION_INVALID",
        "declassification requires an audited decision and explicit sinks",
      );
    }
    output.allowedSinks = [...new Set(declassification.allowedSinks)].sort();
    output.declassificationDecisionId = declassification.decisionId;
  }
  return Object.freeze(output);
}

function stateSnapshot(run) {
  return {
    version: 1,
    id: run.id,
    definition: run.compiled.definition,
    definitionMigration: clone(run.definitionMigration),
    subgraphDefinitions: run.compiled.subgraphDefinitions,
    phase: run.phase,
    status: run.status,
    graphRevision: run.graphRevision,
    revisionDigest: run.revisionDigest,
    occurrenceRef: run.occurrenceRef,
    authorityDigest: run.authorityDigest,
    authority: clone(run.authority),
    budget: run.budget,
    budgetUsed: run.budgetUsed,
    budgetReserved: run.budgetReserved,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    cancellationRequested: run.cancellationRequested,
    progressEpoch: run.progressEpoch,
    compensation: clone(run.compensation),
    parentRunRef: clone(run.parentRunRef),
    subgraphDepth: run.subgraphDepth,
    definitionPath: clone(run.definitionPath),
    loopStates: mapSnapshot(run.loopStates),
    iterationFrames: mapSnapshot(run.iterationFrames),
    loopDecisionCache: mapSnapshot(run.loopDecisionCache),
    subgraphRuns: mapSnapshot(run.subgraphRuns),
    nodeStates: mapSnapshot(run.nodeStates),
    attempts: mapSnapshot(run.attempts),
    agents: mapSnapshot(run.agents),
    producerLeases: mapSnapshot(run.producerLeases),
    artifacts: mapSnapshot(run.artifacts),
    effects: mapSnapshot(run.effects),
    messages: mapSnapshot(run.messages),
    messageConsumers: mapSnapshot(run.messageConsumers),
    handoffs: mapSnapshot(run.handoffs),
    humanTasks: mapSnapshot(run.humanTasks),
    waitReasons: mapSnapshot(run.waitReasons),
    timers: mapSnapshot(run.timers),
    requestCache: mapSnapshot(run.requestCache),
    progressDigests: mapSnapshot(run.progressDigests),
    fenceCounters: mapSnapshot(run.fenceCounters),
  };
}

function restoreState(run, snapshot, compiled = null) {
  run.compiled =
    compiled ||
    compileGraphDefinition(snapshot.definition, {
      subgraphs: persistedSubgraphRegistry(snapshot.subgraphDefinitions),
      allowUnresolvedSubgraphs: snapshot.subgraphDefinitions == null,
    });
  run.definitionMigration = snapshot.definitionMigration
    ? clone(
        validateGraphDefinitionMigrationEvidence(snapshot.definitionMigration),
      )
    : clone(run.compiled.definitionMigration || null);
  run.phase = snapshot.phase;
  run.status = snapshot.status;
  run.graphRevision = snapshot.graphRevision;
  run.revisionDigest = snapshot.revisionDigest;
  run.occurrenceRef = clone(snapshot.occurrenceRef);
  run.authorityDigest = snapshot.authorityDigest;
  if (!snapshot.authority) {
    throw kernelError(
      "CC_GRAPH_AUTHORITY_MIGRATION_REQUIRED",
      "legacy GraphRun snapshot has no writer authority; import it at a verified safe point",
    );
  }
  run.authority = createGraphAuthorityBinding(snapshot.authority);
  run.budget = clone(snapshot.budget);
  run.budgetUsed = clone(snapshot.budgetUsed);
  run.budgetReserved = clone(snapshot.budgetReserved || emptyBudgetUsage());
  run.createdAt = snapshot.createdAt;
  run.completedAt = snapshot.completedAt;
  run.cancellationRequested = snapshot.cancellationRequested === true;
  run.progressEpoch = snapshot.progressEpoch;
  run.compensation = clone(snapshot.compensation || idleCompensationState());
  run.compensation.completedEntries ||= [];
  run.parentRunRef = clone(snapshot.parentRunRef || null);
  run.subgraphDepth = Number(snapshot.subgraphDepth || 0);
  run.definitionPath = clone(
    snapshot.definitionPath || [run.compiled.definitionId],
  );
  for (const field of [
    "loopStates",
    "iterationFrames",
    "loopDecisionCache",
    "subgraphRuns",
    "nodeStates",
    "attempts",
    "agents",
    "producerLeases",
    "artifacts",
    "effects",
    "messages",
    "messageConsumers",
    "handoffs",
    "humanTasks",
    "waitReasons",
    "timers",
    "requestCache",
    "progressDigests",
    "fenceCounters",
  ]) {
    run[field] = mapRestore(snapshot[field]);
  }
  return run;
}

function nodeProjection(run, nodeId) {
  const state = run.nodeStates.get(nodeId);
  return Object.freeze({
    nodeId,
    status: state.status,
    attemptIds: Object.freeze([...state.attemptIds]),
    acceptedAttemptId: state.acceptedAttemptId,
    blockedRoot: state.blockedRoot,
    iterationPath: Object.freeze([...(state.iterationPath || [])]),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  });
}

function attemptProjection(attempt) {
  return Object.freeze(clone(attempt));
}

function humanTaskProjection(task) {
  const projected = clone(task);
  if (
    projected.claimExpiresAt == null &&
    Number.isFinite(projected.claimExpiresAtMs)
  ) {
    projected.claimExpiresAt = nowIso(() => projected.claimExpiresAtMs);
  }
  delete projected.claimExpiresAtMs;
  delete projected.expiresAtMs;
  return Object.freeze(projected);
}

function runProjection(run) {
  return Object.freeze({
    id: run.id,
    definitionId: run.compiled.definitionId,
    revision: run.compiled.revision,
    revisionDigest: run.revisionDigest,
    definitionMigration: run.definitionMigration
      ? Object.freeze({
          schema: run.definitionMigration.schema,
          fromVersion: run.definitionMigration.fromVersion,
          toVersion: run.definitionMigration.toVersion,
          revisionDigest: run.definitionMigration.revisionDigest,
          rollbackDigest: run.definitionMigration.rollbackDigest,
          backupAvailable: true,
        })
      : null,
    occurrenceRef: clone(run.occurrenceRef),
    phase: run.phase,
    status: run.status,
    graphRevision: run.graphRevision,
    authorityDigest: run.authorityDigest,
    originSurface: run.authority.originSurface,
    authoritySource: run.authority.authoritySource,
    authorityMode: run.authority.authorityMode,
    authorityGeneration: run.authority.authorityGeneration,
    writerId: run.authority.writerId,
    writerLeaseId: run.authority.writerLeaseId,
    writerLeaseExpiresAt: run.authority.writerLeaseExpiresAt,
    eventHead: run.authority.eventHead,
    projectionVersion: run.authority.projectionVersion,
    budget: clone(run.budget),
    budgetUsed: clone(run.budgetUsed),
    budgetReserved: clone(run.budgetReserved),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    progressEpoch: run.progressEpoch,
    compensation: Object.freeze(clone(run.compensation)),
    parentRunRef: Object.freeze(clone(run.parentRunRef)),
    subgraphDepth: run.subgraphDepth,
    definitionPath: Object.freeze([...run.definitionPath]),
    loops: Object.freeze(
      [...run.loopStates.values()]
        .sort((left, right) => left.regionId.localeCompare(right.regionId))
        .map((state) => Object.freeze(clone(state))),
    ),
    iterationFrames: Object.freeze(
      [...run.iterationFrames.values()]
        .sort((left, right) =>
          left.iterationPath
            .join(".")
            .localeCompare(right.iterationPath.join(".")),
        )
        .map((frame) => Object.freeze(clone(frame))),
    ),
    subgraphRuns: Object.freeze(
      [...run.subgraphRuns.values()]
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
        .map((relation) => Object.freeze(clone(relation))),
    ),
    nodes: Object.freeze(
      run.compiled.topologicalOrder.map((id) => nodeProjection(run, id)),
    ),
    attempts: Object.freeze(
      [...run.attempts.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(attemptProjection),
    ),
    artifactIds: Object.freeze([...run.artifacts.keys()].sort()),
    effectIds: Object.freeze([...run.effects.keys()].sort()),
    reconciliationEffectIds: Object.freeze(
      [...run.effects.values()]
        .filter((effect) => effect.status === "unknown")
        .map((effect) => effect.id)
        .sort(),
    ),
    pendingHumanTaskIds: Object.freeze(
      [...run.humanTasks.values()]
        .filter((task) => ["open", "claimed"].includes(task.status))
        .map((task) => task.id)
        .sort(),
    ),
  });
}

function buildRun(compiled, options, now, writerIdentity, writerLeaseTtlMs) {
  const createdAt = nowIso(now);
  const id = safeIdentifier(options.runId || randomUUID(), "runId");
  const authority = createGraphAuthorityBinding(
    options.authority || {
      logicalRunId: id,
      originSurface: options.originSurface || "cli_team",
      authorityMode:
        writerIdentity.authoritySource === "graph_kernel_shadow"
          ? "shadow"
          : "canonical",
      authoritySource: writerIdentity.authoritySource,
      authorityGeneration:
        options.authorityGeneration || writerIdentity.authorityGeneration,
      writerId: writerIdentity.writerId,
      writerLeaseId: writerIdentity.writerLeaseId,
      writerLeaseExpiresAt: new Date(
        now() + Math.max(1, Number(writerLeaseTtlMs)),
      ).toISOString(),
      eventHead: null,
      projectionVersion: GRAPH_PROJECTION_VERSION,
    },
  );
  if (authority.logicalRunId !== id) {
    throw kernelError(
      "CC_GRAPH_AUTHORITY_RUN_MISMATCH",
      "Graph authority must be bound to the exact logical run id",
    );
  }
  if (authority.authorityMode === "legacy") {
    throw kernelError(
      "CC_GRAPH_NON_CANONICAL_WRITER",
      "legacy authority cannot mutate Graph Kernel state",
    );
  }
  assertGraphAuthorityWriter(authority, writerIdentity, {
    now: now(),
    requireCanonical: false,
  });
  const run = {
    id,
    compiled,
    definitionMigration: clone(compiled.definitionMigration || null),
    phase: "open",
    status: "running",
    graphRevision: compiled.revision,
    revisionDigest: compiled.revisionDigest,
    occurrenceRef: clone(options.occurrenceRef || null),
    authorityDigest:
      options.authorityDigest ||
      graphDigest(
        {
          definition: compiled.revisionDigest,
          capabilities: compiled.definition.allowedCapabilities,
          workspace: options.workspaceDigest || null,
        },
        "cc.graph.authority/v1",
      ),
    authority,
    budget: clone(options.budget || compiled.definition.budget || {}),
    budgetUsed: emptyBudgetUsage(),
    budgetReserved: emptyBudgetUsage(),
    createdAt,
    completedAt: null,
    cancellationRequested: false,
    progressEpoch: 0,
    compensation: idleCompensationState(),
    parentRunRef: clone(options.parentRunRef || null),
    subgraphDepth: Number(options.subgraphDepth || 0),
    definitionPath: clone(options.definitionPath || [compiled.definitionId]),
    loopStates: new Map(),
    iterationFrames: new Map(),
    loopDecisionCache: new Map(),
    subgraphRuns: new Map(),
    nodeStates: new Map(),
    attempts: new Map(),
    agents: new Map(),
    producerLeases: new Map(),
    artifacts: new Map(),
    effects: new Map(),
    messages: new Map(),
    messageConsumers: new Map(),
    handoffs: new Map(),
    humanTasks: new Map(),
    waitReasons: new Map(),
    timers: new Map(),
    requestCache: new Map(),
    progressDigests: new Map(),
    fenceCounters: new Map(),
    lastEvent: null,
  };
  for (const loop of compiled.definition.loops || []) {
    const iterationPath = [0];
    const frameId = iterationFrameId(run.id, loop.id, iterationPath);
    run.loopStates.set(loop.id, {
      regionId: loop.id,
      status: "active",
      iteration: 0,
      iterationPath,
      frameId,
      maxIterations: loop.maxIterations,
      condition: loop.condition || null,
      conditionEvidenceDigest: null,
    });
    run.iterationFrames.set(frameId, {
      id: frameId,
      runId: run.id,
      regionId: loop.id,
      parentFrameId: null,
      iterationPath,
      status: "active",
      startedAt: createdAt,
      completedAt: null,
    });
  }
  const compensationNodeIds = new Set(compiled.compensationNodeIds || []);
  for (const nodeId of compiled.topologicalOrder) {
    const loopId = compiled.loopByNode?.[nodeId];
    run.nodeStates.set(nodeId, {
      status: compensationNodeIds.has(nodeId) ? "skipped" : "pending",
      attemptIds: [],
      acceptedAttemptId: null,
      blockedRoot: null,
      iterationPath: loopId
        ? [...run.loopStates.get(loopId).iterationPath]
        : [],
      createdAt,
      updatedAt: createdAt,
    });
    run.fenceCounters.set(nodeId, 0);
  }
  return run;
}

function eventDetails(value) {
  if (value === undefined) return null;
  return clone(value);
}

function checkBudget(run, usage) {
  for (const field of BUDGET_FIELDS) {
    const delta = Number(usage?.[field] || 0);
    if (!Number.isFinite(delta) || delta < 0) {
      throw kernelError(
        "CC_GRAPH_USAGE_INVALID",
        `usage.${field} must be a non-negative finite number`,
      );
    }
    const cap = run.budget?.[field];
    const reserved = budgetValue(run.budgetReserved, field);
    if (cap != null && run.budgetUsed[field] + reserved + delta > cap) {
      throw kernelError(
        "CC_GRAPH_BUDGET_EXHAUSTED",
        `GraphRun ${field} budget would be exceeded`,
        {
          field,
          cap,
          used: run.budgetUsed[field],
          reserved,
          requested: delta,
        },
      );
    }
  }
}

function addUsage(run, usage) {
  checkBudget(run, usage);
  for (const field of BUDGET_FIELDS) {
    run.budgetUsed[field] += Number(usage?.[field] || 0);
  }
}

function reserveBudget(run, budget) {
  checkBudget(run, budget);
  for (const field of BUDGET_FIELDS) {
    run.budgetReserved[field] += budgetValue(budget, field);
  }
}

function settleSubgraphBudget(run, relation, usage) {
  if (relation.budgetSettled === true) return;
  for (const field of BUDGET_FIELDS) {
    const reserved = budgetValue(relation.budgetSlice, field);
    const actual = budgetValue(usage, field);
    if (actual > reserved) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_BUDGET_INVARIANT",
        `child ${field} usage exceeds its reserved budget slice`,
        { field, reserved, actual, childRunId: relation.childRunId },
      );
    }
    run.budgetReserved[field] = Math.max(
      0,
      budgetValue(run.budgetReserved, field) - reserved,
    );
  }
  addUsage(run, usage);
  relation.budgetUsed = Object.fromEntries(
    BUDGET_FIELDS.map((field) => [field, budgetValue(usage, field)]),
  );
  relation.budgetSettled = true;
}

function effectiveDependencyStatus(run, dependency) {
  const status = run.nodeStates.get(dependency).status;
  const loopId = run.compiled.loopByExitNode?.[dependency];
  const loopState = loopId ? run.loopStates.get(loopId) : null;
  if (loopState && ["active", "waiting_condition"].includes(loopState.status)) {
    return "running";
  }
  if (loopState?.status === "failed") return "failed";
  if (loopState?.status === "cancelled") return "cancelled";
  if (loopState?.status === "exhausted") return "budget_exhausted";
  return status;
}

function refreshLoopStates(run, now) {
  let changed = false;
  for (const loop of run.compiled.definition.loops || []) {
    const loopState = run.loopStates.get(loop.id);
    if (!loopState || loopState.status !== "active") continue;
    const statuses = loop.nodeIds.map(
      (nodeId) => run.nodeStates.get(nodeId).status,
    );
    const failure = statuses.find((status) => FAILURE_NODE.has(status));
    const cancelled = statuses.find((status) => status === "cancelled");
    const frame = run.iterationFrames.get(loopState.frameId);
    if (failure || cancelled) {
      loopState.status = failure ? "failed" : "cancelled";
      if (frame) {
        frame.status = failure ? "failed" : "cancelled";
        frame.completedAt = nowIso(now);
      }
      changed = true;
    } else if (statuses.every((status) => status === "succeeded")) {
      loopState.status = "waiting_condition";
      if (frame) {
        frame.status = "succeeded";
        frame.completedAt = nowIso(now);
      }
      changed = true;
    }
  }
  return changed;
}

function nodeReadiness(run, nodeId) {
  const node = run.compiled.nodes[nodeId];
  const dependencies = run.compiled.dependencies[nodeId] || [];
  if (!dependencies.length) return { ready: true };
  const policies = run.compiled.dependencyPolicies[nodeId] || {};
  const observations = dependencies.map((dependency) => {
    const status = effectiveDependencyStatus(run, dependency);
    const policy = policies[dependency] || "success";
    return {
      dependency,
      status,
      policy,
      terminal: TERMINAL_NODE.has(status),
      satisfied: dependencySatisfied(policy, status),
    };
  });
  const satisfied = observations.filter((entry) => entry.satisfied).length;
  const possible = observations.filter(
    (entry) => entry.satisfied || !entry.terminal,
  ).length;
  const join = node.join || "all";
  const threshold =
    join === "any" || join === "race"
      ? 1
      : join === "quorum"
        ? Math.min(node.quorum || dependencies.length, dependencies.length)
        : dependencies.length;
  if (satisfied >= threshold) return { ready: true, observations };
  if (possible >= threshold)
    return { ready: false, waiting: true, observations };
  const mismatch = observations.find(
    (entry) => entry.terminal && !entry.satisfied,
  );
  return {
    ready: false,
    waiting: false,
    terminalStatus: dependencyMismatchStatus(
      mismatch?.policy || "success",
      mismatch?.status || "blocked",
    ),
    blockedRoot: mismatch?.dependency || null,
    observations,
  };
}

function propagate(run, now) {
  let changed = false;
  for (;;) {
    let passChanged = false;
    for (const nodeId of run.compiled.topologicalOrder) {
      const state = run.nodeStates.get(nodeId);
      if (state.status !== "pending") continue;
      const readiness = nodeReadiness(run, nodeId);
      if (!readiness.terminalStatus) continue;
      state.status = readiness.terminalStatus;
      state.blockedRoot = readiness.blockedRoot;
      state.updatedAt = nowIso(now);
      passChanged = true;
      changed = true;
    }
    if (!passChanged) break;
  }
  return changed;
}

function effectivePriority(run, nodeId, now, agingWindowMs) {
  const node = run.compiled.nodes[nodeId];
  const state = run.nodeStates.get(nodeId);
  const base = Number(node.priority || 0);
  const ageMs = Math.max(0, now - Date.parse(state.createdAt));
  const aging = Math.min(1000, Math.floor(ageMs / agingWindowMs));
  let donation = base;
  for (const descendantId of run.compiled.descendants[nodeId] || []) {
    const descendantState = run.nodeStates.get(descendantId);
    if (!TERMINAL_NODE.has(descendantState.status)) {
      donation = Math.max(
        donation,
        Number(run.compiled.nodes[descendantId].priority || 0),
      );
    }
  }
  const criticalPathBoost = (run.compiled.descendants[nodeId] || []).filter(
    (id) => !TERMINAL_NODE.has(run.nodeStates.get(id).status),
  ).length;
  return {
    base,
    donation: Math.max(0, donation - base),
    aging,
    criticalPathBoost,
    total: Math.max(base, donation) + aging + criticalPathBoost,
    queueWaitMs: ageMs,
  };
}

function activeAttemptsForAgent(run, agentId, now) {
  return [...run.attempts.values()].filter(
    (attempt) => attempt.agentId === agentId && attemptIsLive(attempt, now),
  );
}

function activeWriteConflict(run, node, now) {
  if (node.effectClass !== "workspace_write") return null;
  if (node.workspaceIsolation === "worktree") return null;
  for (const attempt of run.attempts.values()) {
    if (!attemptIsLive(attempt, now) || attempt.role !== "executor") continue;
    const activeNode = run.compiled.nodes[attempt.nodeId];
    if (!activeNode || activeNode.effectClass !== "workspace_write") continue;
    if (
      (node.writeSet || []).some((left) =>
        (activeNode.writeSet || []).some((right) =>
          writeScopesOverlap(left, right),
        ),
      )
    ) {
      return attempt;
    }
  }
  return null;
}

function sweepExpirations(run, now) {
  let changed = false;
  for (const lease of run.producerLeases.values()) {
    if (lease.status === "active" && lease.expiresAtMs <= now) {
      lease.status = "expired";
      lease.updatedAt = nowIso(() => now);
      changed = true;
    }
  }
  for (const attempt of run.attempts.values()) {
    if (ACTIVE_ATTEMPT.has(attempt.status) && attempt.expiresAtMs <= now) {
      attempt.status = "expired";
      attempt.updatedAt = nowIso(() => now);
      const nodeState = run.nodeStates.get(attempt.nodeId);
      if (
        nodeState.status === "running" &&
        nodeState.acceptedAttemptId == null
      ) {
        nodeState.status = "pending";
        nodeState.updatedAt = nowIso(() => now);
      }
      changed = true;
    }
  }
  for (const handoff of run.handoffs.values()) {
    if (
      ["offered", "accepted"].includes(handoff.status) &&
      handoff.expiresAtMs <= now
    ) {
      handoff.status = "expired";
      handoff.expiredAt = nowIso(() => now);
      handoff.updatedAt = nowIso(() => now);
      changed = true;
    }
  }
  for (const task of run.humanTasks.values()) {
    if (["open", "claimed"].includes(task.status) && task.expiresAtMs <= now) {
      task.status = "expired";
      task.updatedAt = nowIso(() => now);
      const state = run.nodeStates.get(task.nodeId);
      state.status = "failed";
      state.blockedRoot = task.id;
      state.updatedAt = nowIso(() => now);
      changed = true;
    } else if (task.status === "claimed" && task.claimExpiresAtMs <= now) {
      task.status = "open";
      task.claimActorId = null;
      task.claimLeaseId = null;
      task.claimExpiresAt = null;
      task.claimExpiresAtMs = null;
      task.updatedAt = nowIso(() => now);
      changed = true;
    }
  }
  for (const timer of run.timers.values()) {
    if (timer.status === "pending" && timer.dueAtMs <= now) {
      timer.status = "ready";
      timer.updatedAt = nowIso(() => now);
      changed = true;
    }
  }
  return changed;
}

function waitGraphCycles(run) {
  const adjacency = new Map();
  for (const [nodeId, reason] of run.waitReasons) {
    if (reason.ownerNodeId) {
      const values = adjacency.get(nodeId) || [];
      values.push(reason.ownerNodeId);
      adjacency.set(nodeId, values);
    }
  }
  let index = 0;
  const stack = [];
  const state = new Map();
  const components = [];
  const visit = (node) => {
    const entry = { index, low: index, onStack: true };
    index += 1;
    state.set(node, entry);
    stack.push(node);
    for (const target of adjacency.get(node) || []) {
      if (!state.has(target)) {
        visit(target);
        entry.low = Math.min(entry.low, state.get(target).low);
      } else if (state.get(target).onStack) {
        entry.low = Math.min(entry.low, state.get(target).index);
      }
    }
    if (entry.low === entry.index) {
      const component = [];
      for (;;) {
        const value = stack.pop();
        state.get(value).onStack = false;
        component.push(value);
        if (value === node) break;
      }
      if (
        component.length > 1 ||
        (component.length === 1 &&
          (adjacency.get(component[0]) || []).includes(component[0]))
      ) {
        components.push(component.sort());
      }
    }
  };
  for (const node of adjacency.keys()) if (!state.has(node)) visit(node);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function currentCompensationEntry(run) {
  if (run.compensation?.status !== "running") return null;
  return run.compensation.plan[run.compensation.currentIndex] || null;
}

function compensationAssignment(run, nodeId) {
  const entry = currentCompensationEntry(run);
  return entry?.compensationNodeId === nodeId ? entry : null;
}

function sameIterationPath(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function compareIterationPath(left, right) {
  const a = left || [];
  const b = right || [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] == null) return -1;
    if (b[index] == null) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function committedEffectsForNode(run, nodeId, iterationPath = null) {
  return [...run.effects.values()]
    .filter(
      (effect) =>
        effect.nodeId === nodeId &&
        effect.status === "committed" &&
        (iterationPath == null ||
          sameIterationPath(effect.iterationPath, iterationPath)),
    )
    .sort(
      (left, right) =>
        compareIterationPath(left.iterationPath, right.iterationPath) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

function completeCompensationStep(run, entry, now) {
  const compensationEffects = committedEffectsForNode(
    run,
    entry.compensationNodeId,
    entry.iterationPath,
  );
  if (compensationEffects.length === 0) {
    throw kernelError(
      "CC_GRAPH_COMPENSATION_RECEIPT_REQUIRED",
      `compensation node requires a committed effect receipt: ${entry.compensationNodeId}`,
    );
  }
  const compensationEffect = compensationEffects.at(-1);
  const sourceEffects = entry.effectIds.map((effectId) =>
    run.effects.get(effectId),
  );
  if (
    sourceEffects.some(
      (effect) =>
        !effect ||
        effect.status !== "committed" ||
        !sameIterationPath(effect.iterationPath, entry.iterationPath),
    )
  ) {
    throw kernelError(
      "CC_GRAPH_COMPENSATION_SOURCE_RECEIPT_INVALID",
      `compensation source receipts changed for ${entry.nodeId}`,
    );
  }
  for (const effect of sourceEffects) {
    effect.status = "compensated";
    effect.compensationEffectId = compensationEffect.id;
    effect.updatedAt = nowIso(() => now);
  }
  run.compensation.completedNodeIds.push(entry.nodeId);
  run.compensation.completedEntries.push({
    nodeId: entry.nodeId,
    iterationPath: [...entry.iterationPath],
    effectIds: [...entry.effectIds],
    compensationEffectId: compensationEffect.id,
  });
  run.compensation.currentIndex += 1;
  if (run.compensation.currentIndex >= run.compensation.plan.length) {
    run.compensation.status = "completed";
    run.compensation.completedAt = nowIso(() => now);
    run.status = run.compensation.terminalStatus;
    run.completedAt = nowIso(() => now);
  } else {
    const next = run.compensation.plan[run.compensation.currentIndex];
    const state = run.nodeStates.get(next.compensationNodeId);
    state.status = "pending";
    state.acceptedAttemptId = null;
    state.blockedRoot = null;
    state.iterationPath = [...next.iterationPath];
    state.updatedAt = nowIso(() => now);
    run.status = "running";
  }
}

function failCompensation(run, entry, error, now) {
  run.compensation.status = "failed";
  run.compensation.failure = {
    nodeId: entry.nodeId,
    compensationNodeId: entry.compensationNodeId,
    iterationPath: [...entry.iterationPath],
    effectIds: [...entry.effectIds],
    error: String(error || "compensation_failed").slice(0, 4096),
  };
  run.compensation.completedAt = nowIso(() => now);
  run.status = "reconciliation_required";
  run.completedAt = null;
}

function terminalAlgebra(run) {
  const statuses = [...run.nodeStates.values()].map((state) => state.status);
  const successes = statuses.filter((status) => status === "succeeded").length;
  const failures = statuses.filter((status) => FAILURE_NODE.has(status)).length;
  const cancelled = statuses.filter((status) => status === "cancelled").length;
  const skipped = statuses.filter((status) => status === "skipped").length;
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.every((status) => status === "skipped")) return "blocked";
  if (failures > 0 && successes > 0) return "partial";
  if (failures > 0) return "failed";
  if (cancelled > 0 && successes > 0) return "partial";
  if (cancelled > 0) return "cancelled";
  if (successes > 0 || skipped > 0) return "succeeded";
  return "blocked";
}

function classifyQuiescence(run, now) {
  if (run.compensation?.status === "failed") {
    return "reconciliation_required";
  }
  if (run.compensation?.status === "completed") {
    return run.compensation.terminalStatus || "failed";
  }
  if (TERMINAL_RUN.has(run.status)) return run.status;
  if (run.phase === "open") return "running";
  if (
    [...run.producerLeases.values()].some((lease) => producerIsLive(lease, now))
  ) {
    return "running";
  }
  if (
    [...run.attempts.values()].some((attempt) =>
      ACTIVE_ATTEMPT.has(attempt.status),
    )
  ) {
    return "running";
  }
  if ([...run.effects.values()].some((effect) => effect.status === "started")) {
    return "running";
  }
  if (
    [...run.attempts.values()].some(
      (attempt) => attempt.status === "unknown",
    ) ||
    [...run.effects.values()].some((effect) => effect.status === "unknown") ||
    [...run.nodeStates.values()].some(
      (state) => state.status === "reconciliation_required",
    )
  ) {
    return "reconciliation_required";
  }
  if (
    [...run.humanTasks.values()].some((task) =>
      ["open", "claimed"].includes(task.status),
    )
  ) {
    return "waiting_human";
  }
  if (
    [...run.messages.values()].some((message) =>
      ["admitted", "delivered", "read"].includes(message.status),
    ) ||
    [...run.timers.values()].some((timer) => timer.status === "pending")
  ) {
    return "waiting_external";
  }
  if (
    [...run.loopStates.values()].some(
      (loopState) => loopState.status === "waiting_condition",
    ) ||
    [...run.subgraphRuns.values()].some((relation) =>
      ["starting", "running"].includes(relation.status),
    )
  ) {
    return "waiting_external";
  }
  const cycles = waitGraphCycles(run);
  if (cycles.length) return "deadlocked";
  const pending = [...run.nodeStates.entries()].filter(
    ([, state]) => state.status === "pending",
  );
  const ready = pending.filter(([nodeId]) => nodeReadiness(run, nodeId).ready);
  if (ready.length) return "running";
  if (pending.length) {
    const reasons = pending.map(([nodeId]) => run.waitReasons.get(nodeId));
    if (reasons.some((reason) => reason?.kind === "input"))
      return "waiting_input";
    if (reasons.some(Boolean)) return "waiting_external";
    return "blocked";
  }
  if (
    [...run.nodeStates.values()].every((state) =>
      TERMINAL_NODE.has(state.status),
    )
  ) {
    return terminalAlgebra(run);
  }
  return "running";
}

export class GraphKernel {
  constructor({
    eventStore = new GraphEventStore(),
    now = Date.now,
    createId = randomUUID,
    agingWindowMs = 1000,
    maxPendingMessagesPerAgent = 100,
    maxLivelockRepeats = 8,
    writerId = `graph-kernel:${process.pid}:${randomUUID()}`,
    writerLeaseId = `graph-kernel-lease:${randomUUID()}`,
    authoritySource = "graph_kernel",
    authorityGeneration = 1,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
  } = {}) {
    this.eventStore = eventStore;
    this.now = now;
    this.createId = createId;
    this.agingWindowMs = Math.max(1, Number(agingWindowMs) || 1000);
    this.maxPendingMessagesPerAgent = Math.max(
      1,
      Number(maxPendingMessagesPerAgent) || 100,
    );
    this.maxLivelockRepeats = Math.max(2, Number(maxLivelockRepeats) || 8);
    this.writerIdentity = Object.freeze({
      authoritySource,
      authorityGeneration: Math.max(1, Number(authorityGeneration) || 1),
      writerId: safeIdentifier(writerId, "writerId"),
      writerLeaseId: safeIdentifier(writerLeaseId, "writerLeaseId"),
    });
    this.writerLeaseTtlMs = Math.max(1, Number(writerLeaseTtlMs) || 1);
    this.runs = new Map();
    this.occurrences = new Map();
  }

  _run(runId) {
    const run = this.runs.get(safeIdentifier(runId, "runId"));
    if (!run) {
      throw kernelError(
        "CC_GRAPH_RUN_NOT_FOUND",
        `GraphRun not found: ${runId}`,
      );
    }
    return run;
  }

  _loadRun(runId) {
    const id = safeIdentifier(runId, "runId");
    if (this.runs.has(id)) return this.runs.get(id);
    try {
      if (this.eventStore.read(id).length > 0) {
        this.recoverRun(id);
        return this.runs.get(id);
      }
    } catch (error) {
      if (error?.code !== "CC_ROLLOUT_THREAD_NOT_FOUND") throw error;
    }
    return null;
  }

  _transaction(run, type, details, mutator, options = {}) {
    if (TERMINAL_RUN.has(run.status) && options.allowTerminal !== true) {
      throw kernelError(
        "CC_GRAPH_RUN_TERMINAL",
        `GraphRun is terminal: ${run.status}`,
      );
    }
    const expectedHeadHash = run.lastEvent?.hash || run.authority.eventHead;
    const expectedRevision = run.lastEvent?.seq;
    if (run.authority.authorityMode === "legacy") {
      throw kernelError(
        "CC_GRAPH_NON_CANONICAL_WRITER",
        "legacy authority cannot mutate Graph Kernel state",
      );
    }
    assertGraphAuthorityWriter(run.authority, this.writerIdentity, {
      now: this.now(),
      expectedEventHead: expectedHeadHash,
      requireCanonical: false,
    });
    const before = stateSnapshot(run);
    try {
      const result = mutator();
      run.progressEpoch += 1;
      const snapshot = stateSnapshot(run);
      const event = this.eventStore.append(
        run.id,
        type,
        { details: eventDetails(details), state: snapshot },
        {
          idempotencyKey: options.idempotencyKey || null,
          traceId: options.traceId || null,
          authority: run.authority,
          expectedRevision,
          expectedHeadHash,
        },
      );
      run.lastEvent = event;
      run.authority = createGraphAuthorityBinding({
        ...run.authority,
        eventHead: event.hash,
      });
      return result;
    } catch (error) {
      restoreState(run, before);
      throw error;
    }
  }

  startRun(compiledGraph, options = {}) {
    const compiled = assertCompiledGraph(compiledGraph);
    const occurrence = options.occurrenceRef || null;
    const occurrenceKey = occurrence
      ? `${occurrence.jobRevision || ""}\0${occurrence.occurrenceId || occurrence.idempotencyKey || ""}`
      : null;
    if (occurrenceKey && this.occurrences.has(occurrenceKey)) {
      const existing = this._run(this.occurrences.get(occurrenceKey));
      if (existing.revisionDigest !== compiled.revisionDigest) {
        throw kernelError(
          "CC_GRAPH_OCCURRENCE_CONFLICT",
          "occurrence was already bound to a different GraphRevision",
        );
      }
      return runProjection(existing);
    }
    const run = buildRun(
      compiled,
      options,
      this.now,
      this.writerIdentity,
      this.writerLeaseTtlMs,
    );
    if (this.runs.has(run.id)) {
      throw kernelError(
        "CC_GRAPH_RUN_CONFLICT",
        `GraphRun id already exists: ${run.id}`,
      );
    }
    const initialHead = this.eventStore.start(run.id, {
      definitionId: compiled.definitionId,
      revisionDigest: compiled.revisionDigest,
      originSurface: run.authority.originSurface,
      authorityMode: run.authority.authorityMode,
      authorityGeneration: run.authority.authorityGeneration,
      writerId: run.authority.writerId,
      projectionVersion: run.authority.projectionVersion,
    });
    run.lastEvent = initialHead;
    run.authority = createGraphAuthorityBinding({
      ...run.authority,
      eventHead: initialHead.hash,
    });
    this.runs.set(run.id, run);
    try {
      this._transaction(
        run,
        "run.started",
        {
          definitionId: compiled.definitionId,
          revisionDigest: compiled.revisionDigest,
          occurrenceRef: occurrence,
          parentRunRef: run.parentRunRef,
          subgraphDepth: run.subgraphDepth,
          definitionPath: run.definitionPath,
        },
        () => {},
        { idempotencyKey: `run-start:${run.id}` },
      );
    } catch (error) {
      this.runs.delete(run.id);
      throw error;
    }
    if (occurrenceKey) this.occurrences.set(occurrenceKey, run.id);
    return runProjection(run);
  }

  recoverRun(runId, { authority = null } = {}) {
    const id = safeIdentifier(runId, "runId");
    const events = this.eventStore.read(id);
    const latest = [...events]
      .reverse()
      .find((event) => event.payload?.state?.version === 1);
    if (!latest) {
      throw kernelError(
        "CC_GRAPH_RECOVERY_UNAVAILABLE",
        `GraphRun has no recoverable state: ${id}`,
      );
    }
    const snapshot = latest.payload.state;
    const run = { id, lastEvent: latest };
    restoreState(run, snapshot);
    run.lastEvent = latest;
    run.authority = createGraphAuthorityBinding({
      ...run.authority,
      eventHead: latest.hash,
    });
    this.runs.set(id, run);
    if (authority) {
      const nextAuthority = createGraphAuthorityBinding({
        ...authority,
        logicalRunId: id,
        eventHead: latest.hash,
      });
      const previousAuthority = run.authority;
      if (
        nextAuthority.authorityGeneration <=
        previousAuthority.authorityGeneration
      ) {
        this.runs.delete(id);
        throw kernelError(
          "CC_GRAPH_STALE_GENERATION",
          "recovery authority must use a higher writer generation",
        );
      }
      assertGraphAuthorityWriter(nextAuthority, this.writerIdentity, {
        now: this.now(),
        expectedEventHead: latest.hash,
        requireCanonical: false,
      });
      run.authority = nextAuthority;
      try {
        this._transaction(
          run,
          "run.authority_transferred",
          {
            previousAuthoritySource: previousAuthority.authoritySource,
            previousAuthorityGeneration: previousAuthority.authorityGeneration,
            previousWriterId: previousAuthority.writerId,
            authorityGeneration: nextAuthority.authorityGeneration,
            writerId: nextAuthority.writerId,
          },
          () => {},
          {
            allowTerminal: true,
            idempotencyKey: `authority-transfer:${nextAuthority.authorityGeneration}`,
          },
        );
      } catch (error) {
        this.runs.delete(id);
        throw error;
      }
    } else {
      try {
        assertGraphAuthorityWriter(run.authority, this.writerIdentity, {
          now: this.now(),
          expectedEventHead: latest.hash,
          requireCanonical: false,
        });
      } catch (error) {
        this.runs.delete(id);
        throw error;
      }
    }
    if (run.occurrenceRef) {
      const key = `${run.occurrenceRef.jobRevision || ""}\0${run.occurrenceRef.occurrenceId || run.occurrenceRef.idempotencyKey || ""}`;
      this.occurrences.set(key, id);
    }
    const uncertainEffects = [...run.effects.values()].filter(
      (effect) => effect.status === "started",
    );
    if (uncertainEffects.length) {
      this._transaction(
        run,
        "effect.recovery_unknown",
        { effectIds: uncertainEffects.map((effect) => effect.id).sort() },
        () => {
          for (const effect of uncertainEffects) {
            effect.status = "unknown";
            effect.updatedAt = nowIso(this.now);
            const attempt = run.attempts.get(effect.attemptId);
            if (attempt && ACTIVE_ATTEMPT.has(attempt.status)) {
              attempt.status = "unknown";
              attempt.participationStatus = "reconciliation_required";
              attempt.updatedAt = nowIso(this.now);
            }
            const state = run.nodeStates.get(effect.nodeId);
            if (state) {
              state.status = "reconciliation_required";
              state.updatedAt = nowIso(this.now);
            }
          }
          run.status = "reconciliation_required";
        },
        { idempotencyKey: `effect-recovery:${latest.hash}` },
      );
    }
    return runProjection(run);
  }

  getRun(runId) {
    return runProjection(this._run(runId));
  }

  events(runId, options = {}) {
    return this.eventStore.read(safeIdentifier(runId, "runId"), options);
  }

  collaborationState(runId) {
    const run = this._run(runId);
    return Object.freeze({
      messages: Object.freeze(
        [...run.messages.values()]
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          )
          .map((message) => Object.freeze(clone(message))),
      ),
      messageConsumers: Object.freeze(
        [...run.messageConsumers.values()]
          .sort(
            (left, right) =>
              left.processedAt.localeCompare(right.processedAt) ||
              left.messageId.localeCompare(right.messageId),
          )
          .map((receipt) => Object.freeze(clone(receipt))),
      ),
      handoffs: Object.freeze(
        [...run.handoffs.values()]
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          )
          .map((handoff) => Object.freeze(clone(handoff))),
      ),
    });
  }

  effectState(runId) {
    const run = this._run(runId);
    return Object.freeze(
      [...run.effects.values()]
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .map((effect) => Object.freeze(clone(effect))),
    );
  }

  humanTasks(runId) {
    const run = this._run(runId);
    return Object.freeze(
      [...run.humanTasks.values()]
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .map(humanTaskProjection),
    );
  }

  registerAgent(runId, { agentId, capacity = 1, resident = true } = {}) {
    const run = this._run(runId);
    const id = safeIdentifier(agentId, "agentId");
    return this._transaction(
      run,
      "agent.registered",
      { agentId: id, capacity, resident },
      () => {
        const existing = run.agents.get(id);
        const agent = {
          id,
          capacity: Math.max(1, Number(capacity) || 1),
          resident: resident !== false,
          status: "idle",
          registeredAt: existing?.registeredAt || nowIso(this.now),
          updatedAt: nowIso(this.now),
        };
        run.agents.set(id, agent);
        return Object.freeze(clone(agent));
      },
      {},
    );
  }

  acquireProducerLease(
    runId,
    { producerId, ttlMs = 60_000, leaseId = this.createId() } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(leaseId, "leaseId");
    const owner = safeIdentifier(producerId, "producerId");
    return this._transaction(
      run,
      "producer.acquired",
      { producerId: owner, leaseId: id },
      () => {
        if (run.phase !== "open") {
          throw kernelError(
            "CC_GRAPH_SEALED",
            "producer leases cannot be acquired after the graph is sealed",
          );
        }
        const now = this.now();
        sweepExpirations(run, now);
        const existing = [...run.producerLeases.values()].find(
          (lease) => lease.producerId === owner && producerIsLive(lease, now),
        );
        if (existing) return Object.freeze(clone(existing));
        const fence =
          Math.max(
            0,
            ...[...run.producerLeases.values()]
              .filter((lease) => lease.producerId === owner)
              .map((lease) => lease.fence),
          ) + 1;
        const lease = {
          id,
          producerId: owner,
          fence,
          status: "active",
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 60_000)),
          expiresAtMs: now + finitePositive(ttlMs, 60_000),
        };
        run.producerLeases.set(id, lease);
        return Object.freeze(clone(lease));
      },
      { idempotencyKey: `producer-acquire:${id}` },
    );
  }

  releaseProducerLease(runId, leaseId, fence) {
    const run = this._run(runId);
    const id = safeIdentifier(leaseId, "leaseId");
    return this._transaction(run, "producer.released", { leaseId: id }, () => {
      const lease = run.producerLeases.get(id);
      if (
        !lease ||
        lease.fence !== Number(fence) ||
        lease.status !== "active"
      ) {
        throw kernelError(
          "CC_GRAPH_STALE_PRODUCER_LEASE",
          "producer lease is missing, stale, or inactive",
        );
      }
      lease.status = "released";
      lease.updatedAt = nowIso(this.now);
      return Object.freeze(clone(lease));
    });
  }

  appendGraph(
    runId,
    {
      expectedGraphRevision,
      requestId,
      producerLeaseId,
      producerFence,
      nodes = [],
      edges = [],
      loops = [],
      subgraphCalls = [],
      metadataPatch = {},
    } = {},
  ) {
    const run = this._run(runId);
    const key = safeIdentifier(requestId, "requestId");
    const request = {
      expectedGraphRevision,
      producerLeaseId,
      producerFence,
      nodes,
      edges,
      loops,
      subgraphCalls,
      metadataPatch,
    };
    const requestDigest = graphDigest(request, "cc.graph.append-request/v1");
    const replay = run.requestCache.get(key);
    if (replay) {
      if (replay.digest !== requestDigest) {
        throw kernelError(
          "CC_GRAPH_REQUEST_ID_CONFLICT",
          "dynamic graph requestId was reused with different content",
        );
      }
      return Object.freeze(clone(replay.result));
    }
    return this._transaction(
      run,
      "graph.revised",
      { requestId: key, requestDigest },
      () => {
        if (run.phase !== "open") {
          throw kernelError(
            "CC_GRAPH_SEALED",
            "a sealed GraphRun cannot be extended",
          );
        }
        if (Number(expectedGraphRevision) !== run.graphRevision) {
          throw kernelError(
            "CC_GRAPH_REVISION_CONFLICT",
            "expectedGraphRevision does not match the current revision",
            { expectedGraphRevision, currentGraphRevision: run.graphRevision },
          );
        }
        const now = this.now();
        sweepExpirations(run, now);
        const lease = run.producerLeases.get(
          safeIdentifier(producerLeaseId, "producerLeaseId"),
        );
        if (
          !lease ||
          lease.fence !== Number(producerFence) ||
          !producerIsLive(lease, now)
        ) {
          throw kernelError(
            "CC_GRAPH_STALE_PRODUCER_LEASE",
            "dynamic graph mutation requires the current producer lease",
          );
        }
        const definition = {
          ...clone(run.compiled.definition),
          revision: run.compiled.definition.revision + 1,
          nodes: [...clone(run.compiled.definition.nodes), ...clone(nodes)],
          edges: [...clone(run.compiled.definition.edges), ...clone(edges)],
          loops: [...clone(run.compiled.definition.loops), ...clone(loops)],
          subgraphCalls: [
            ...clone(run.compiled.definition.subgraphCalls),
            ...clone(subgraphCalls),
          ],
          metadata: {
            ...clone(run.compiled.definition.metadata || {}),
            ...clone(metadataPatch || {}),
          },
        };
        const compiled = compileGraphDefinition(definition, {
          subgraphs: persistedSubgraphRegistry(
            run.compiled.subgraphDefinitions,
          ),
        });
        const createdAt = nowIso(() => now);
        const compensationNodeIds = new Set(compiled.compensationNodeIds || []);
        const addedNodeIds = new Set(nodes.map((node) => node.id));
        for (const loop of loops) {
          if (loop.nodeIds.some((nodeId) => !addedNodeIds.has(nodeId))) {
            throw kernelError(
              "CC_GRAPH_DYNAMIC_LOOP_BOUNDARY",
              "a dynamic loop must be added atomically with all of its nodes",
              { loopId: loop.id },
            );
          }
          const iterationPath = [0];
          const frameId = iterationFrameId(run.id, loop.id, iterationPath);
          run.loopStates.set(loop.id, {
            regionId: loop.id,
            status: "active",
            iteration: 0,
            iterationPath,
            frameId,
            maxIterations: loop.maxIterations,
            condition: loop.condition || null,
            conditionEvidenceDigest: null,
          });
          run.iterationFrames.set(frameId, {
            id: frameId,
            runId: run.id,
            regionId: loop.id,
            parentFrameId: null,
            iterationPath,
            status: "active",
            startedAt: createdAt,
            completedAt: null,
          });
        }
        for (const node of nodes) {
          const loopId = compiled.loopByNode?.[node.id];
          run.nodeStates.set(node.id, {
            status: compensationNodeIds.has(node.id) ? "skipped" : "pending",
            attemptIds: [],
            acceptedAttemptId: null,
            blockedRoot: null,
            iterationPath: loopId
              ? [...run.loopStates.get(loopId).iterationPath]
              : [],
            createdAt,
            updatedAt: createdAt,
          });
          run.fenceCounters.set(node.id, 0);
        }
        for (const compensationNodeId of compensationNodeIds) {
          const state = run.nodeStates.get(compensationNodeId);
          if (!state || state.status === "skipped") continue;
          if (state.status !== "pending" || state.attemptIds.length > 0) {
            throw kernelError(
              "CC_GRAPH_COMPENSATION_TARGET_ACTIVE",
              `dynamic revision cannot convert an active node into a compensation target: ${compensationNodeId}`,
            );
          }
          state.status = "skipped";
          state.updatedAt = createdAt;
        }
        run.compiled = compiled;
        run.graphRevision += 1;
        run.revisionDigest = compiled.revisionDigest;
        const result = {
          runId: run.id,
          graphRevision: run.graphRevision,
          revisionDigest: run.revisionDigest,
          addedNodeIds: nodes.map((node) => node.id).sort(),
        };
        run.requestCache.set(key, { digest: requestDigest, result });
        return Object.freeze(clone(result));
      },
      { idempotencyKey: `graph-append:${key}` },
    );
  }

  sealRun(runId) {
    const run = this._run(runId);
    return this._transaction(
      run,
      "graph.sealed",
      { graphRevision: run.graphRevision },
      () => {
        const now = this.now();
        sweepExpirations(run, now);
        const active = [...run.producerLeases.values()].filter((lease) =>
          producerIsLive(lease, now),
        );
        if (active.length) {
          throw kernelError(
            "CC_GRAPH_PRODUCERS_ACTIVE",
            "GraphRun cannot be sealed while producer leases are active",
            { producerLeaseIds: active.map((lease) => lease.id) },
          );
        }
        run.phase = "sealed";
        propagate(run, () => now);
        if (refreshLoopStates(run, () => now)) propagate(run, () => now);
        run.status = classifyQuiescence(run, now);
        if (TERMINAL_RUN.has(run.status)) run.completedAt = nowIso(() => now);
        return runProjection(run);
      },
      { idempotencyKey: `graph-seal:${run.id}:${run.graphRevision}` },
    );
  }

  tick(runId) {
    const run = this._run(runId);
    return this._transaction(run, "run.ticked", {}, () => {
      const now = this.now();
      sweepExpirations(run, now);
      propagate(run, () => now);
      if (refreshLoopStates(run, () => now)) propagate(run, () => now);
      run.status = classifyQuiescence(run, now);
      if (TERMINAL_RUN.has(run.status)) run.completedAt ||= nowIso(() => now);
      return runProjection(run);
    });
  }

  advanceLoop(
    runId,
    { regionId, continueLoop, conditionEvidenceDigest, requestId = null } = {},
  ) {
    const run = this._run(runId);
    const safeRegionId = safeIdentifier(regionId, "regionId");
    const evidenceDigest = String(conditionEvidenceDigest || "");
    if (!/^sha256:[a-f0-9]{64}$/u.test(evidenceDigest)) {
      throw kernelError(
        "CC_GRAPH_LOOP_EVIDENCE_REQUIRED",
        "loop advancement requires a sha256 condition evidence digest",
      );
    }
    if (typeof continueLoop !== "boolean") {
      throw kernelError(
        "CC_GRAPH_LOOP_DECISION_INVALID",
        "continueLoop must be a boolean",
      );
    }
    const loop = run.compiled.loops?.[safeRegionId];
    const loopState = run.loopStates.get(safeRegionId);
    if (!loop || !loopState) {
      throw kernelError(
        "CC_GRAPH_LOOP_NOT_FOUND",
        `loop region not found: ${safeRegionId}`,
      );
    }
    if (requestId == null) {
      throw kernelError(
        "CC_GRAPH_LOOP_REQUEST_ID_REQUIRED",
        "loop advancement requires a stable requestId for crash-safe replay",
      );
    }
    const decisionKey = safeIdentifier(requestId, "requestId");
    const decisionDigest = graphDigest(
      {
        regionId: safeRegionId,
        continueLoop,
        conditionEvidenceDigest: evidenceDigest,
      },
      "cc.graph.loop-decision/v1",
    );
    const replay = run.loopDecisionCache.get(decisionKey);
    if (replay) {
      if (replay.digest !== decisionDigest) {
        throw kernelError(
          "CC_GRAPH_REQUEST_ID_CONFLICT",
          "loop requestId was reused with a different decision",
        );
      }
      return runProjection(run);
    }
    this._transaction(
      run,
      continueLoop ? "loop.continued" : "loop.exited",
      {
        regionId: safeRegionId,
        iteration: loopState.iteration,
        continueLoop,
        conditionEvidenceDigest: evidenceDigest,
        requestId: decisionKey,
      },
      () => {
        if (loopState.status !== "waiting_condition") {
          throw kernelError(
            "CC_GRAPH_LOOP_NOT_WAITING",
            `loop body is not awaiting a condition decision: ${safeRegionId}`,
          );
        }
        const now = this.now();
        loopState.conditionEvidenceDigest = evidenceDigest;
        if (!continueLoop) {
          loopState.status = "succeeded";
          run.loopDecisionCache.set(decisionKey, {
            digest: decisionDigest,
            result: "exited",
          });
          propagate(run, () => now);
          refreshLoopStates(run, () => now);
          run.status = classifyQuiescence(run, now);
          if (TERMINAL_RUN.has(run.status)) {
            run.completedAt = nowIso(() => now);
          }
          return runProjection(run);
        }

        const nextIteration = loopState.iteration + 1;
        if (nextIteration >= loop.maxIterations) {
          loopState.status = "exhausted";
          const frame = run.iterationFrames.get(loopState.frameId);
          if (frame) frame.status = "exhausted";
          const exitState = run.nodeStates.get(loop.exitNodeId);
          exitState.status = "budget_exhausted";
          exitState.blockedRoot = loop.id;
          exitState.updatedAt = nowIso(() => now);
          run.loopDecisionCache.set(decisionKey, {
            digest: decisionDigest,
            result: "exhausted",
          });
          propagate(run, () => now);
          run.status = "budget_exhausted";
          run.completedAt = nowIso(() => now);
          return runProjection(run);
        }

        const iterationPath = [nextIteration];
        const frameId = iterationFrameId(run.id, safeRegionId, iterationPath);
        loopState.status = "active";
        loopState.iteration = nextIteration;
        loopState.iterationPath = iterationPath;
        loopState.frameId = frameId;
        loopState.conditionEvidenceDigest = null;
        run.iterationFrames.set(frameId, {
          id: frameId,
          runId: run.id,
          regionId: safeRegionId,
          parentFrameId: null,
          iterationPath,
          status: "active",
          startedAt: nowIso(() => now),
          completedAt: null,
        });
        for (const nodeId of loop.nodeIds) {
          const state = run.nodeStates.get(nodeId);
          state.status = "pending";
          state.acceptedAttemptId = null;
          state.blockedRoot = null;
          state.iterationPath = [...iterationPath];
          state.updatedAt = nowIso(() => now);
        }
        run.loopDecisionCache.set(decisionKey, {
          digest: decisionDigest,
          result: "continued",
        });
        run.status = "running";
        run.completedAt = null;
        return runProjection(run);
      },
      { idempotencyKey: `loop-decision:${decisionKey}` },
    );
    return runProjection(run);
  }

  startSubgraph(
    parentRunId,
    nodeId,
    compiledGraph,
    { childRunId = null, seal = true } = {},
  ) {
    const childCompiled = assertCompiledGraph(compiledGraph);
    const parent = this._run(parentRunId);
    const safeNodeId = safeIdentifier(nodeId, "nodeId");
    const call = parent.compiled.subgraphCalls?.[safeNodeId];
    const state = parent.nodeStates.get(safeNodeId);
    if (!call || !state) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_CALL_NOT_FOUND",
        `subgraph call not found: ${safeNodeId}`,
      );
    }
    if (
      call.definitionId !== childCompiled.definitionId ||
      call.revisionDigest !== childCompiled.revisionDigest
    ) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_DIGEST_MISMATCH",
        `subgraph definition does not match the pinned call: ${safeNodeId}`,
      );
    }
    const childDepth = parent.subgraphDepth + 1;
    if (childDepth > call.maxDepth) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_DEPTH_EXCEEDED",
        `subgraph depth ${childDepth} exceeds maxDepth ${call.maxDepth}`,
      );
    }
    if (parent.definitionPath.includes(childCompiled.definitionId)) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_RECURSION",
        `recursive subgraph call rejected: ${[
          ...parent.definitionPath,
          childCompiled.definitionId,
        ].join(" -> ")}`,
      );
    }
    const id = safeIdentifier(
      childRunId ||
        deterministicSubgraphRunId(
          parent.id,
          safeNodeId,
          childCompiled.revisionDigest,
        ),
      "childRunId",
    );
    let relation = parent.subgraphRuns.get(safeNodeId);
    if (relation) {
      if (
        relation.childRunId !== id ||
        relation.revisionDigest !== childCompiled.revisionDigest
      ) {
        throw kernelError(
          "CC_GRAPH_SUBGRAPH_CALL_CONFLICT",
          "subgraph call was already bound to a different child run",
        );
      }
    } else {
      if (parent.phase !== "sealed") {
        throw kernelError(
          "CC_GRAPH_SUBGRAPH_REQUIRES_SEALED_PARENT",
          "subgraph calls require a sealed parent GraphRun",
        );
      }
      if (
        state.status !== "pending" ||
        !nodeReadiness(parent, safeNodeId).ready
      ) {
        throw kernelError(
          "CC_GRAPH_NODE_NOT_READY",
          `Graph node is not ready: ${safeNodeId}`,
        );
      }
      relation = this._transaction(
        parent,
        "subgraph.starting",
        {
          nodeId: safeNodeId,
          childRunId: id,
          definitionId: childCompiled.definitionId,
          revisionDigest: childCompiled.revisionDigest,
          depth: childDepth,
          budgetSlice: call.budget,
          inputBindings: call.inputBindings || [],
          outputBindings: call.outputBindings || [],
        },
        () => {
          const createdAt = nowIso(this.now);
          reserveBudget(parent, call.budget || {});
          const value = {
            nodeId: safeNodeId,
            childRunId: id,
            definitionId: childCompiled.definitionId,
            revisionDigest: childCompiled.revisionDigest,
            depth: childDepth,
            inputBindings: clone(call.inputBindings || []),
            outputBindings: clone(call.outputBindings || []),
            budgetSlice: clone(call.budget || {}),
            budgetUsed: null,
            budgetSettled: false,
            status: "starting",
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
          };
          parent.subgraphRuns.set(safeNodeId, value);
          state.status = "running";
          state.updatedAt = createdAt;
          parent.status = "waiting_external";
          return clone(value);
        },
        { idempotencyKey: `subgraph-starting:${safeNodeId}:${id}` },
      );
    }

    let child = this._loadRun(id);
    if (child) {
      if (
        child.revisionDigest !== childCompiled.revisionDigest ||
        child.parentRunRef?.runId !== parent.id ||
        child.parentRunRef?.nodeId !== safeNodeId
      ) {
        throw kernelError(
          "CC_GRAPH_SUBGRAPH_RUN_CONFLICT",
          `child run id is already bound to another call: ${id}`,
        );
      }
    } else {
      this.startRun(childCompiled, {
        runId: id,
        originSurface: parent.authority.originSurface,
        authority: {
          ...parent.authority,
          logicalRunId: id,
          eventHead: null,
        },
        parentRunRef: {
          runId: parent.id,
          nodeId: safeNodeId,
          revisionDigest: parent.revisionDigest,
        },
        subgraphDepth: childDepth,
        definitionPath: [...parent.definitionPath, childCompiled.definitionId],
        budget: call.budget || {},
      });
      child = this._run(id);
    }
    if (seal !== false && child.phase === "open") this.sealRun(id);

    relation = parent.subgraphRuns.get(safeNodeId);
    if (relation.status === "starting") {
      this._transaction(
        parent,
        "subgraph.started",
        { nodeId: safeNodeId, childRunId: id },
        () => {
          relation.status = "running";
          relation.updatedAt = nowIso(this.now);
          parent.status = "waiting_external";
        },
        { idempotencyKey: `subgraph-started:${safeNodeId}:${id}` },
      );
    }
    return Object.freeze({
      relation: Object.freeze(clone(parent.subgraphRuns.get(safeNodeId))),
      parentRun: runProjection(parent),
      childRun: runProjection(child),
    });
  }

  settleSubgraph(parentRunId, nodeId) {
    const parent = this._run(parentRunId);
    const safeNodeId = safeIdentifier(nodeId, "nodeId");
    const relation = parent.subgraphRuns.get(safeNodeId);
    if (!relation) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_NOT_STARTED",
        `subgraph has not been started: ${safeNodeId}`,
      );
    }
    if (["succeeded", "failed", "cancelled"].includes(relation.status)) {
      return runProjection(parent);
    }
    const child = this._loadRun(relation.childRunId);
    if (!child) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_RUN_NOT_FOUND",
        `subgraph child run not found: ${relation.childRunId}`,
      );
    }
    if (!TERMINAL_RUN.has(child.status)) {
      throw kernelError(
        "CC_GRAPH_SUBGRAPH_ACTIVE",
        `subgraph child run is not terminal: ${child.status}`,
      );
    }
    return this._transaction(
      parent,
      "subgraph.settled",
      {
        nodeId: safeNodeId,
        childRunId: child.id,
        childStatus: child.status,
      },
      () => {
        const now = this.now();
        const state = parent.nodeStates.get(safeNodeId);
        const succeeded = child.status === "succeeded";
        relation.status = succeeded
          ? "succeeded"
          : child.status === "cancelled"
            ? "cancelled"
            : "failed";
        relation.updatedAt = nowIso(() => now);
        relation.completedAt = nowIso(() => now);
        relation.childStatus = child.status;
        settleSubgraphBudget(parent, relation, child.budgetUsed);
        state.status = succeeded
          ? "succeeded"
          : child.status === "cancelled"
            ? "cancelled"
            : child.status === "budget_exhausted"
              ? "budget_exhausted"
              : "failed";
        state.blockedRoot = succeeded ? null : child.id;
        state.updatedAt = nowIso(() => now);
        propagate(parent, () => now);
        refreshLoopStates(parent, () => now);
        parent.status = classifyQuiescence(parent, now);
        if (TERMINAL_RUN.has(parent.status)) {
          parent.completedAt = nowIso(() => now);
        }
        return runProjection(parent);
      },
      {
        idempotencyKey: `subgraph-settle:${safeNodeId}:${child.id}:${child.status}`,
      },
    );
  }

  readyNodes(runId) {
    const run = this._run(runId);
    const now = this.now();
    const compensationEntry = currentCompensationEntry(run);
    if (compensationEntry) {
      const state = run.nodeStates.get(compensationEntry.compensationNodeId);
      if (state?.status !== "pending") return [];
      return [
        Object.freeze({
          nodeId: compensationEntry.compensationNodeId,
          compensationForNodeId: compensationEntry.nodeId,
          iterationPath: Object.freeze([...compensationEntry.iterationPath]),
          effectIdempotencyKey: iterationEffectIdempotencyKey(
            run.compiled.nodes[compensationEntry.compensationNodeId]
              .idempotencyKey,
            compensationEntry.iterationPath,
          ),
          priority: Object.freeze({
            base: 1000,
            donation: 0,
            aging: 0,
            criticalPathBoost: 0,
            total: 1000,
            queueWaitMs: 0,
          }),
        }),
      ];
    }
    return run.compiled.topologicalOrder
      .filter((nodeId) => {
        const state = run.nodeStates.get(nodeId);
        return state.status === "pending" && nodeReadiness(run, nodeId).ready;
      })
      .map((nodeId) => ({
        nodeId,
        iterationPath: Object.freeze([
          ...(run.nodeStates.get(nodeId)?.iterationPath || []),
        ]),
        ...(["workspace_write", "external"].includes(
          run.compiled.nodes[nodeId].effectClass,
        )
          ? {
              effectIdempotencyKey: iterationEffectIdempotencyKey(
                run.compiled.nodes[nodeId].idempotencyKey,
                run.nodeStates.get(nodeId)?.iterationPath || [],
              ),
            }
          : {}),
        ...(run.compiled.subgraphCalls?.[nodeId]
          ? {
              dispatch: "subgraph",
              definitionId: run.compiled.subgraphCalls[nodeId].definitionId,
              revisionDigest: run.compiled.subgraphCalls[nodeId].revisionDigest,
              maxDepth: run.compiled.subgraphCalls[nodeId].maxDepth,
              inputBindings:
                run.compiled.subgraphCalls[nodeId].inputBindings || [],
              outputBindings:
                run.compiled.subgraphCalls[nodeId].outputBindings || [],
              budget: run.compiled.subgraphCalls[nodeId].budget || {},
            }
          : {}),
        priority: effectivePriority(run, nodeId, now, this.agingWindowMs),
      }))
      .sort(
        (left, right) =>
          right.priority.total - left.priority.total ||
          left.nodeId.localeCompare(right.nodeId),
      )
      .map((entry) => Object.freeze(entry));
  }

  assignNext(runId, agentId, options = {}) {
    const ready = this.readyNodes(runId);
    if (!ready.length) return null;
    let lastConflict = null;
    for (const candidate of ready) {
      if (candidate.dispatch === "subgraph") continue;
      try {
        return this.assignNode(runId, candidate.nodeId, agentId, options);
      } catch (error) {
        if (
          ["CC_GRAPH_WRITE_SCOPE_BUSY", "CC_GRAPH_AGENT_CAPACITY"].includes(
            error?.code,
          )
        ) {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }
    if (lastConflict) throw lastConflict;
    return null;
  }

  assignNode(
    runId,
    nodeId,
    agentId,
    {
      role = "executor",
      ttlMs = 60_000,
      leaseId = this.createId(),
      attemptId = null,
      grant = {},
    } = {},
  ) {
    const run = this._run(runId);
    const safeNodeId = safeIdentifier(nodeId, "nodeId");
    const safeAgentId = safeIdentifier(agentId, "agentId");
    const plannedCompensation = compensationAssignment(run, safeNodeId);
    const iterationPath = [
      ...(plannedCompensation?.iterationPath ||
        run.nodeStates.get(safeNodeId)?.iterationPath ||
        []),
    ];
    const attemptNumber =
      [...run.attempts.values()].filter(
        (candidate) =>
          candidate.nodeId === safeNodeId &&
          JSON.stringify(candidate.iterationPath || []) ===
            JSON.stringify(iterationPath),
      ).length + 1;
    const requestedAttemptId = safeIdentifier(
      attemptId || executionAttemptId(safeNodeId, iterationPath, attemptNumber),
      "attemptId",
    );
    return this._transaction(
      run,
      "assignment.started",
      { nodeId: safeNodeId, agentId: safeAgentId, role },
      () => {
        const now = this.now();
        sweepExpirations(run, now);
        propagate(run, () => now);
        refreshLoopStates(run, () => now);
        const node = run.compiled.nodes[safeNodeId];
        const state = run.nodeStates.get(safeNodeId);
        if (!node || !state) {
          throw kernelError(
            "CC_GRAPH_NODE_NOT_FOUND",
            `Graph node not found: ${safeNodeId}`,
          );
        }
        if (run.compiled.subgraphCalls?.[safeNodeId]) {
          throw kernelError(
            "CC_GRAPH_SUBGRAPH_DISPATCH_REQUIRED",
            `subgraph nodes must be started through startSubgraph(): ${safeNodeId}`,
          );
        }
        const compensationEntry = compensationAssignment(run, safeNodeId);
        const ready = compensationEntry
          ? state.status === "pending"
          : run.compensation.status !== "running" &&
            state.status === "pending" &&
            nodeReadiness(run, safeNodeId).ready;
        if (!ready) {
          throw kernelError(
            "CC_GRAPH_NODE_NOT_READY",
            `Graph node is not ready: ${safeNodeId}`,
          );
        }
        let agent = run.agents.get(safeAgentId);
        if (!agent) {
          agent = {
            id: safeAgentId,
            capacity: 1,
            resident: true,
            status: "idle",
            registeredAt: nowIso(() => now),
            updatedAt: nowIso(() => now),
          };
          run.agents.set(safeAgentId, agent);
        }
        if (
          activeAttemptsForAgent(run, safeAgentId, now).length >= agent.capacity
        ) {
          throw kernelError(
            "CC_GRAPH_AGENT_CAPACITY",
            `agent capacity is exhausted: ${safeAgentId}`,
          );
        }
        if (role === "executor") {
          const conflict = activeWriteConflict(run, node, now);
          if (conflict) {
            throw kernelError(
              "CC_GRAPH_WRITE_SCOPE_BUSY",
              `write scope is held by attempt ${conflict.id}`,
              { holderAttemptId: conflict.id },
            );
          }
        }
        const fence = (run.fenceCounters.get(safeNodeId) || 0) + 1;
        run.fenceCounters.set(safeNodeId, fence);
        const id = requestedAttemptId;
        const attempt = {
          id,
          runId: run.id,
          nodeId: safeNodeId,
          iterationPath,
          attempt: attemptNumber,
          agentId: safeAgentId,
          role: compensationEntry ? "executor" : role,
          compensationForNodeId: compensationEntry?.nodeId || null,
          effectIdempotencyKey: ["workspace_write", "external"].includes(
            node.effectClass,
          )
            ? iterationEffectIdempotencyKey(node.idempotencyKey, iterationPath)
            : null,
          leaseId: safeIdentifier(leaseId, "leaseId"),
          fence,
          authorityGeneration: run.authority.authorityGeneration,
          writerId: run.authority.writerId,
          status: "active",
          participationStatus: "active",
          grant: clone(grant),
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 60_000)),
          expiresAtMs: now + finitePositive(ttlMs, 60_000),
          terminalEvidence: null,
          usage: null,
          error: null,
        };
        run.attempts.set(id, attempt);
        state.attemptIds.push(id);
        state.status = "running";
        state.updatedAt = nowIso(() => now);
        agent.status = "busy";
        agent.updatedAt = nowIso(() => now);
        return attemptProjection(attempt);
      },
      { idempotencyKey: `assignment:${requestedAttemptId}` },
    );
  }

  renewAttempt(runId, attemptId, leaseId, fence, ttlMs = 60_000) {
    const run = this._run(runId);
    return this._transaction(run, "assignment.renewed", { attemptId }, () => {
      const attempt = this._requireAttemptLease(run, attemptId, leaseId, fence);
      const now = this.now();
      attempt.expiresAtMs = now + finitePositive(ttlMs, 60_000);
      attempt.expiresAt = nowIso(() => attempt.expiresAtMs);
      attempt.updatedAt = nowIso(() => now);
      return attemptProjection(attempt);
    });
  }

  /**
   * Recover a dispatch that was durably assigned by an older writer but never
   * crossed the effect boundary.  Once an effect record exists its outcome can
   * no longer be inferred from the absence of a terminal attempt, so recovery
   * must go through reconciliation instead of silently replaying the task.
   */
  reclaimAttempt(
    runId,
    attemptId,
    { reason = "writer generation takeover" } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(attemptId, "attemptId");
    return this._transaction(
      run,
      "assignment.reclaimed",
      { attemptId: id, reason },
      () => {
        const attempt = run.attempts.get(id);
        if (!attempt) {
          throw kernelError(
            "CC_GRAPH_ATTEMPT_NOT_FOUND",
            `assignment attempt not found: ${id}`,
          );
        }
        if (
          attempt.status === "expired" &&
          attempt.participationStatus === "lost"
        ) {
          return attemptProjection(attempt);
        }
        if (!ACTIVE_ATTEMPT.has(attempt.status)) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RECLAIM_TERMINAL",
            "only an active assignment can be reclaimed",
          );
        }
        if (
          Number(attempt.authorityGeneration || 0) >=
          run.authority.authorityGeneration
        ) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RECLAIM_STALE_WRITER",
            "an assignment can only be reclaimed by a higher authority generation",
          );
        }
        const effects = [...run.effects.values()].filter(
          (effect) => effect.attemptId === attempt.id,
        );
        if (effects.length > 0) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RECLAIM_UNSAFE",
            "an assignment with an effect record requires audited reconciliation",
            { effectIds: effects.map((effect) => effect.id).sort() },
          );
        }
        const state = run.nodeStates.get(attempt.nodeId);
        if (
          !state ||
          state.acceptedAttemptId ||
          !["running", "pending"].includes(state.status)
        ) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RECLAIM_UNSAFE",
            "assignment state is not safe to return to the ready frontier",
          );
        }
        const now = this.now();
        attempt.status = "expired";
        attempt.participationStatus = "lost";
        attempt.error = String(reason).slice(0, 4096);
        attempt.updatedAt = nowIso(() => now);
        state.status = "pending";
        state.updatedAt = nowIso(() => now);
        const agent = run.agents.get(attempt.agentId);
        if (agent) {
          agent.status = "idle";
          agent.updatedAt = nowIso(() => now);
        }
        propagate(run, () => now);
        if (refreshLoopStates(run, () => now)) propagate(run, () => now);
        run.status = classifyQuiescence(run, now);
        run.completedAt = TERMINAL_RUN.has(run.status)
          ? nowIso(() => now)
          : null;
        return attemptProjection(attempt);
      },
      {
        idempotencyKey: `assignment-reclaim:${id}:${run.authority.authorityGeneration}`,
      },
    );
  }

  /**
   * Rotate a safely recoverable assignment into the current writer generation.
   * A persisted attempt is never reused after takeover: callers receive a new
   * lease/fence, while terminal effect receipts retain an explicit custody
   * chain. An in-flight/unknown effect remains reconciliation-only.
   */
  resumeAttempt(
    runId,
    attemptId,
    {
      resumedAttemptId = this.createId(),
      leaseId = this.createId(),
      ttlMs = 60_000,
      reason = "writer generation takeover",
    } = {},
  ) {
    const run = this._run(runId);
    const sourceId = safeIdentifier(attemptId, "attemptId");
    const successorId = safeIdentifier(resumedAttemptId, "attemptId");
    return this._transaction(
      run,
      "assignment.resumed",
      { attemptId: sourceId, resumedAttemptId: successorId, reason },
      () => {
        const existing = [...run.attempts.values()].find(
          (candidate) =>
            candidate.resumedFromAttemptId === sourceId &&
            candidate.authorityGeneration ===
              run.authority.authorityGeneration &&
            candidate.writerId === run.authority.writerId,
        );
        if (existing) return attemptProjection(existing);
        const source = run.attempts.get(sourceId);
        if (!source) {
          throw kernelError(
            "CC_GRAPH_ATTEMPT_NOT_FOUND",
            `assignment attempt not found: ${sourceId}`,
          );
        }
        const auditedRecovery =
          source.status === "expired" &&
          source.participationStatus === "reconciled";
        if (!ACTIVE_ATTEMPT.has(source.status) && !auditedRecovery) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RESUME_TERMINAL",
            "only an active or audited-reconciled assignment can be resumed",
          );
        }
        if (
          Number(source.authorityGeneration || 0) >=
          run.authority.authorityGeneration
        ) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RESUME_STALE_WRITER",
            "an assignment can only be resumed by a higher authority generation",
          );
        }
        const effects = [...run.effects.values()].filter(
          (effect) => effect.attemptId === source.id,
        );
        const unsafe = effects.filter((effect) =>
          ["started", "unknown"].includes(effect.status),
        );
        if (unsafe.length > 0) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RESUME_UNSAFE",
            "an assignment with an unresolved effect requires audited reconciliation",
            { effectIds: unsafe.map((effect) => effect.id).sort() },
          );
        }
        const state = run.nodeStates.get(source.nodeId);
        if (
          !state ||
          state.acceptedAttemptId ||
          !["running", "pending"].includes(state.status)
        ) {
          throw kernelError(
            "CC_GRAPH_ASSIGNMENT_RESUME_UNSAFE",
            "assignment state is not safe to rotate into the new generation",
          );
        }
        if (run.attempts.has(successorId)) {
          throw kernelError(
            "CC_GRAPH_ATTEMPT_ID_CONFLICT",
            `assignment attempt already exists: ${successorId}`,
          );
        }
        const now = this.now();
        source.status = "expired";
        source.participationStatus = "superseded";
        source.error = String(reason).slice(0, 4096);
        source.updatedAt = nowIso(() => now);
        const fence = (run.fenceCounters.get(source.nodeId) || 0) + 1;
        run.fenceCounters.set(source.nodeId, fence);
        const successor = {
          ...clone(source),
          id: successorId,
          attempt:
            [...run.attempts.values()].filter(
              (candidate) =>
                candidate.nodeId === source.nodeId &&
                JSON.stringify(candidate.iterationPath || []) ===
                  JSON.stringify(source.iterationPath || []),
            ).length + 1,
          leaseId: safeIdentifier(leaseId, "leaseId"),
          fence,
          authorityGeneration: run.authority.authorityGeneration,
          writerId: run.authority.writerId,
          status: "active",
          participationStatus: "active",
          resumedFromAttemptId: source.id,
          resumeReason: String(reason).slice(0, 4096),
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 60_000)),
          expiresAtMs: now + finitePositive(ttlMs, 60_000),
          terminalEvidence: null,
          usage: null,
          error: null,
        };
        for (const effect of effects) {
          effect.custodyHistory ||= [];
          effect.custodyHistory.push({
            fromAttemptId: source.id,
            fromLeaseId: source.leaseId,
            fromFence: source.fence,
            toAttemptId: successor.id,
            toLeaseId: successor.leaseId,
            toFence: successor.fence,
            reason: "authority_generation_takeover",
            transferredAt: nowIso(() => now),
          });
          effect.attemptId = successor.id;
          effect.leaseId = successor.leaseId;
          effect.fence = successor.fence;
          effect.updatedAt = nowIso(() => now);
        }
        run.attempts.set(successor.id, successor);
        state.attemptIds.push(successor.id);
        state.status = "running";
        state.updatedAt = nowIso(() => now);
        return attemptProjection(successor);
      },
      {
        idempotencyKey: `assignment-resume:${sourceId}:${run.authority.authorityGeneration}`,
      },
    );
  }

  _requireAttemptLease(run, attemptId, leaseId, fence, statuses = ["active"]) {
    const attempt = run.attempts.get(safeIdentifier(attemptId, "attemptId"));
    const now = this.now();
    if (
      attempt &&
      (attempt.authorityGeneration !== run.authority.authorityGeneration ||
        attempt.writerId !== run.authority.writerId)
    ) {
      throw kernelError(
        "CC_GRAPH_STALE_ATTEMPT_AUTHORITY",
        "attempt belongs to a stale authority generation or writer",
      );
    }
    if (
      !attempt ||
      attempt.leaseId !== safeIdentifier(leaseId, "leaseId") ||
      attempt.fence !== Number(fence) ||
      !statuses.includes(attempt.status) ||
      attempt.expiresAtMs <= now
    ) {
      throw kernelError(
        "CC_GRAPH_STALE_ATTEMPT_LEASE",
        "attempt lease is missing, expired, fenced, or inactive",
      );
    }
    return attempt;
  }

  beginEffect(
    runId,
    {
      effectId = this.createId(),
      attemptId,
      leaseId,
      fence,
      idempotencyKey,
      operationDigest,
      compensationEffectId = null,
    } = {},
  ) {
    const run = this._run(runId);
    const key = String(idempotencyKey || "").trim();
    const matching = [...run.effects.values()].filter(
      (effect) => effect.idempotencyKey === key,
    );
    if (matching.length > 0) {
      if (
        matching.some((effect) => effect.operationDigest !== operationDigest)
      ) {
        throw kernelError(
          "CC_GRAPH_EFFECT_IDEMPOTENCY_CONFLICT",
          "effect idempotency key was reused for a different operation",
        );
      }
      // A proved/audited failure means the operation did not commit, so a
      // later fenced attempt must receive a fresh effect boundary. Started,
      // unknown, and committed effects continue to deduplicate fail-closed.
      const authoritative = [...matching]
        .reverse()
        .find((effect) => effect.status !== "failed");
      if (authoritative) return Object.freeze(clone(authoritative));
    }
    const id = safeIdentifier(effectId, "effectId");
    return this._transaction(
      run,
      "effect.started",
      { effectId: id, attemptId },
      () => {
        const attempt = this._requireAttemptLease(
          run,
          attemptId,
          leaseId,
          fence,
        );
        const node = run.compiled.nodes[attempt.nodeId];
        if (
          !node ||
          !["workspace_write", "external"].includes(node.effectClass)
        ) {
          throw kernelError(
            "CC_GRAPH_EFFECT_NOT_DECLARED",
            "node did not declare an effectful execution class",
          );
        }
        const authenticatedKey = iterationEffectIdempotencyKey(
          node.idempotencyKey,
          attempt.iterationPath,
        );
        if (!key || key !== authenticatedKey) {
          throw kernelError(
            "CC_GRAPH_EFFECT_IDEMPOTENCY_REQUIRED",
            "effect must use the idempotency key authenticated by Graph Compiler",
          );
        }
        if (!/^sha256:[a-f0-9]{64}$/u.test(String(operationDigest || ""))) {
          throw kernelError(
            "CC_GRAPH_EFFECT_OPERATION_DIGEST_INVALID",
            "effect operationDigest must be sha256",
          );
        }
        const effect = {
          id,
          runId: run.id,
          nodeId: attempt.nodeId,
          attemptId: attempt.id,
          iterationPath: [...attempt.iterationPath],
          leaseId: attempt.leaseId,
          fence: attempt.fence,
          idempotencyKey: key,
          baseIdempotencyKey: node.idempotencyKey,
          operationDigest,
          status: "started",
          receipt: null,
          compensationEffectId:
            compensationEffectId == null
              ? null
              : safeIdentifier(compensationEffectId, "compensationEffectId"),
          createdAt: nowIso(this.now),
          updatedAt: nowIso(this.now),
        };
        run.effects.set(id, effect);
        return Object.freeze(clone(effect));
      },
      { idempotencyKey: `effect-start:${id}` },
    );
  }

  settleEffect(
    runId,
    { effectId, attemptId, leaseId, fence, outcome, receipt = null } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(effectId, "effectId");
    const current = run.effects.get(id);
    if (current && current.status !== "started") {
      if (current.status === outcome) return Object.freeze(clone(current));
      throw kernelError(
        "CC_GRAPH_EFFECT_TERMINAL_CONFLICT",
        "effect already has a different terminal outcome",
      );
    }
    return this._transaction(
      run,
      "effect.settled",
      { effectId: id, outcome },
      () => {
        const effect = run.effects.get(id);
        if (!effect || effect.attemptId !== attemptId) {
          throw kernelError(
            "CC_GRAPH_EFFECT_NOT_FOUND",
            `effect was not started by this attempt: ${id}`,
          );
        }
        this._requireAttemptLease(run, attemptId, leaseId, fence);
        if (!["committed", "failed", "unknown"].includes(outcome)) {
          throw kernelError(
            "CC_GRAPH_EFFECT_OUTCOME_INVALID",
            `unsupported effect outcome: ${outcome}`,
          );
        }
        if (
          outcome === "committed" &&
          !/^sha256:[a-f0-9]{64}$/u.test(String(receipt?.receiptDigest || ""))
        ) {
          throw kernelError(
            "CC_GRAPH_EFFECT_RECEIPT_REQUIRED",
            "committed effect requires an immutable receipt digest",
          );
        }
        effect.status = outcome;
        effect.receipt = receipt
          ? {
              ...clone(receipt),
              recordedAt: receipt.recordedAt || nowIso(this.now),
            }
          : null;
        effect.updatedAt = nowIso(this.now);
        if (outcome === "unknown") {
          const attempt = run.attempts.get(effect.attemptId);
          attempt.status = "unknown";
          attempt.participationStatus = "reconciliation_required";
          const state = run.nodeStates.get(effect.nodeId);
          state.status = "reconciliation_required";
          state.updatedAt = nowIso(this.now);
          run.status = "reconciliation_required";
        }
        return Object.freeze(clone(effect));
      },
      { idempotencyKey: `effect-settle:${id}:${outcome}` },
    );
  }

  reconcileEffect(
    runId,
    { effectId, decision, receipt = null, auditDecisionId } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(effectId, "effectId");
    if (!auditDecisionId) {
      throw kernelError(
        "CC_GRAPH_RECONCILIATION_AUDIT_REQUIRED",
        "effect reconciliation requires an audited decision",
      );
    }
    return this._transaction(
      run,
      "effect.reconciled",
      { effectId: id, decision, auditDecisionId },
      () => {
        const effect = run.effects.get(id);
        if (!effect || effect.status !== "unknown") {
          throw kernelError(
            "CC_GRAPH_EFFECT_NOT_RECONCILABLE",
            "only an unknown effect can be reconciled",
          );
        }
        if (!["committed", "failed"].includes(decision)) {
          throw kernelError(
            "CC_GRAPH_EFFECT_OUTCOME_INVALID",
            "reconciliation decision must be committed or failed",
          );
        }
        if (
          decision === "committed" &&
          !/^sha256:[a-f0-9]{64}$/u.test(String(receipt?.receiptDigest || ""))
        ) {
          throw kernelError(
            "CC_GRAPH_EFFECT_RECEIPT_REQUIRED",
            "committed reconciliation requires an immutable receipt digest",
          );
        }
        effect.status = decision;
        effect.receipt = receipt
          ? {
              ...clone(receipt),
              recordedAt: receipt.recordedAt || nowIso(this.now),
            }
          : null;
        effect.auditDecisionId = String(auditDecisionId);
        effect.updatedAt = nowIso(this.now);
        const attempt = run.attempts.get(effect.attemptId);
        if (attempt?.status === "unknown") {
          attempt.status = "expired";
          attempt.participationStatus = "reconciled";
          attempt.updatedAt = nowIso(this.now);
          const agent = run.agents.get(attempt.agentId);
          if (agent) agent.status = "idle";
        }
        const state = run.nodeStates.get(effect.nodeId);
        state.status = "pending";
        state.updatedAt = nowIso(this.now);
        run.status = classifyQuiescence(run, this.now());
        return Object.freeze(clone(effect));
      },
      { idempotencyKey: `effect-reconcile:${id}:${auditDecisionId}` },
    );
  }

  registerArtifact(
    runId,
    {
      artifactId = this.createId(),
      attemptId,
      leaseId,
      fence,
      digest: artifactDigest,
      schema = {},
      commit = null,
      validationEvidence = [],
      consumerNodeIds = [],
      dataPolicy,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(artifactId, "artifactId");
    return this._transaction(
      run,
      "artifact.recorded",
      { artifactId: id, attemptId },
      () => {
        const existing = run.artifacts.get(id);
        if (existing) {
          if (existing.digest !== artifactDigest) {
            throw kernelError(
              "CC_GRAPH_ARTIFACT_IMMUTABLE",
              "artifact id was reused with a different digest",
            );
          }
          return Object.freeze(clone(existing));
        }
        const attempt = this._requireAttemptLease(
          run,
          attemptId,
          leaseId,
          fence,
        );
        if (!/^sha256:[a-f0-9]{64}$/u.test(String(artifactDigest))) {
          throw kernelError(
            "CC_GRAPH_ARTIFACT_DIGEST_INVALID",
            "artifact digest must be sha256",
          );
        }
        const policy = validateDataPolicy(dataPolicy);
        const artifact = {
          id,
          digest: artifactDigest,
          producerNodeId: attempt.nodeId,
          producerAttemptId: attempt.id,
          producerLeaseId: attempt.leaseId,
          producerFence: attempt.fence,
          schema: clone(schema),
          commit,
          validationEvidence: [...validationEvidence],
          consumerNodeIds: [...consumerNodeIds],
          dataPolicy: policy,
          createdAt: nowIso(this.now),
        };
        run.artifacts.set(id, artifact);
        return Object.freeze(clone(artifact));
      },
      { idempotencyKey: `artifact:${id}` },
    );
  }

  settleAttempt(
    runId,
    {
      attemptId,
      leaseId,
      fence,
      outcome,
      evidence = null,
      usage = {},
      error = null,
    } = {},
  ) {
    const run = this._run(runId);
    return this._transaction(
      run,
      "assignment.settled",
      { attemptId, outcome },
      () => {
        const attempt = this._requireAttemptLease(
          run,
          attemptId,
          leaseId,
          fence,
        );
        const state = run.nodeStates.get(attempt.nodeId);
        const node = run.compiled.nodes[attempt.nodeId];
        const compensationEntry = compensationAssignment(run, attempt.nodeId);
        if (state.acceptedAttemptId && state.acceptedAttemptId !== attempt.id) {
          attempt.status = "rejected";
          attempt.participationStatus = "loser";
          throw kernelError(
            "CC_GRAPH_ATTEMPT_LOST_RACE",
            "another attempt already finalized this task",
            { acceptedAttemptId: state.acceptedAttemptId },
          );
        }
        addUsage(run, usage);
        attempt.usage = clone(usage);
        attempt.updatedAt = nowIso(this.now);
        if (outcome === "unknown") {
          attempt.status = "unknown";
          attempt.participationStatus = "reconciliation_required";
          attempt.terminalEvidence = clone(evidence);
          state.status = "reconciliation_required";
          state.updatedAt = nowIso(this.now);
          if (compensationEntry) {
            failCompensation(
              run,
              compensationEntry,
              error || "compensation outcome is unknown",
              this.now(),
            );
          } else {
            run.status = "reconciliation_required";
          }
          return attemptProjection(attempt);
        }
        if (outcome === "succeeded") {
          const unresolvedEffect = [...run.effects.values()].find(
            (effect) =>
              effect.attemptId === attempt.id && effect.status !== "committed",
          );
          if (unresolvedEffect) {
            throw kernelError(
              "CC_GRAPH_EFFECT_RECEIPT_REQUIRED",
              `attempt cannot succeed before effect receipt is committed: ${unresolvedEffect.id}`,
            );
          }
          if (!hasTerminalEvidence(evidence)) {
            throw kernelError(
              "CC_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
              "successful attempts require output/artifact/commit/test evidence",
            );
          }
          for (const artifactId of evidence.artifactIds || []) {
            const artifact = run.artifacts.get(artifactId);
            if (
              !artifact ||
              artifact.producerAttemptId !== attempt.id ||
              artifact.producerLeaseId !== attempt.leaseId ||
              artifact.producerFence !== attempt.fence
            ) {
              throw kernelError(
                "CC_GRAPH_ARTIFACT_PROVENANCE_INVALID",
                `terminal artifact is not owned by the settling attempt: ${artifactId}`,
              );
            }
          }
          attempt.status = "accepted";
          attempt.participationStatus = "accepted_winner";
          attempt.terminalEvidence = clone(evidence);
          state.status = "succeeded";
          state.acceptedAttemptId = attempt.id;
          state.updatedAt = nowIso(this.now);
          for (const other of run.attempts.values()) {
            if (
              other.nodeId === attempt.nodeId &&
              other.id !== attempt.id &&
              ACTIVE_ATTEMPT.has(other.status)
            ) {
              other.status = "cancelled";
              other.participationStatus = "loser";
              other.updatedAt = nowIso(this.now);
            }
          }
        } else if (outcome === "failed" || outcome === "timed_out") {
          attempt.status = "rejected";
          attempt.participationStatus = "failed";
          attempt.error = error == null ? null : String(error).slice(0, 4096);
          attempt.terminalEvidence = clone(evidence);
          if (attempt.attempt <= Number(node.retryLimit || 0)) {
            state.status = "pending";
          } else {
            state.status = outcome === "timed_out" ? "timed_out" : "failed";
            state.blockedRoot = attempt.nodeId;
          }
          state.updatedAt = nowIso(this.now);
        } else if (outcome === "cancelled") {
          attempt.status = "cancelled";
          attempt.participationStatus = "cancelled";
          state.status = run.cancellationRequested ? "cancelled" : "pending";
          state.updatedAt = nowIso(this.now);
        } else {
          throw kernelError(
            "CC_GRAPH_OUTCOME_INVALID",
            `unsupported attempt outcome: ${outcome}`,
          );
        }
        const agent = run.agents.get(attempt.agentId);
        if (agent) {
          agent.status = "idle";
          agent.updatedAt = nowIso(this.now);
        }
        if (compensationEntry) {
          if (outcome === "succeeded") {
            completeCompensationStep(run, compensationEntry, this.now());
          } else if (state.status !== "pending") {
            failCompensation(
              run,
              compensationEntry,
              error || outcome,
              this.now(),
            );
          }
        } else {
          propagate(run, this.now);
          if (refreshLoopStates(run, this.now)) propagate(run, this.now);
          run.status = classifyQuiescence(run, this.now());
        }
        if (TERMINAL_RUN.has(run.status)) run.completedAt = nowIso(this.now);
        return attemptProjection(attempt);
      },
      { idempotencyKey: `attempt-settle:${attemptId}:${outcome}` },
    );
  }

  async cancelRun(runId, { reason = "cancelled", interrupt = null } = {}) {
    const run = this._run(runId);
    const active = this._transaction(
      run,
      "run.cancel_requested",
      { reason },
      () => {
        run.cancellationRequested = true;
        run.phase = "sealed";
        for (const lease of run.producerLeases.values()) {
          if (lease.status === "active") lease.status = "revoked";
        }
        const attempts = [];
        for (const attempt of run.attempts.values()) {
          if (attempt.status === "active") {
            attempt.status = "cancelling";
            attempt.updatedAt = nowIso(this.now);
            attempts.push(clone(attempt));
          }
        }
        for (const state of run.nodeStates.values()) {
          if (state.status === "pending") {
            state.status = "cancelled";
            state.updatedAt = nowIso(this.now);
          }
        }
        return attempts;
      },
    );
    const failures = [];
    await Promise.all(
      active.map(async (attempt) => {
        try {
          if (typeof interrupt === "function") await interrupt(attempt);
        } catch (error) {
          failures.push({
            attemptId: attempt.id,
            error: String(error?.message || error).slice(0, 4096),
          });
        }
      }),
    );
    for (const relation of run.subgraphRuns.values()) {
      if (!["starting", "running"].includes(relation.status)) continue;
      try {
        const child = this._loadRun(relation.childRunId);
        if (child && !TERMINAL_RUN.has(child.status)) {
          await this.cancelRun(child.id, { reason, interrupt });
        }
      } catch (error) {
        failures.push({
          subgraphRunId: relation.childRunId,
          error: String(error?.message || error).slice(0, 4096),
        });
      }
    }
    return this._transaction(
      run,
      failures.length ? "run.cancel_reconciliation" : "run.cancelled",
      { reason, failures },
      () => {
        for (const attempt of run.attempts.values()) {
          if (attempt.status !== "cancelling") continue;
          const failure = failures.find(
            (entry) => entry.attemptId === attempt.id,
          );
          attempt.status = failure ? "unknown" : "cancelled";
          attempt.participationStatus = failure
            ? "reconciliation_required"
            : "cancelled";
          attempt.updatedAt = nowIso(this.now);
          const state = run.nodeStates.get(attempt.nodeId);
          state.status = failure ? "reconciliation_required" : "cancelled";
          state.updatedAt = nowIso(this.now);
        }
        for (const relation of run.subgraphRuns.values()) {
          if (!["starting", "running"].includes(relation.status)) continue;
          const failure = failures.find(
            (entry) => entry.subgraphRunId === relation.childRunId,
          );
          const child = this._loadRun(relation.childRunId);
          if (!failure) {
            settleSubgraphBudget(
              run,
              relation,
              child?.budgetUsed || emptyBudgetUsage(),
            );
          }
          relation.status = failure ? "failed" : "cancelled";
          relation.updatedAt = nowIso(this.now);
          relation.completedAt = failure ? null : nowIso(this.now);
          const state = run.nodeStates.get(relation.nodeId);
          state.status = failure ? "reconciliation_required" : "cancelled";
          state.blockedRoot = relation.childRunId;
          state.updatedAt = nowIso(this.now);
        }
        const unsettledEffects = [...run.effects.values()].filter(
          (effect) => effect.status === "started",
        );
        for (const effect of unsettledEffects) {
          effect.status = "unknown";
          effect.updatedAt = nowIso(this.now);
          const state = run.nodeStates.get(effect.nodeId);
          state.status = "reconciliation_required";
          state.updatedAt = nowIso(this.now);
        }
        refreshLoopStates(run, this.now);
        const requiresReconciliation =
          failures.length > 0 || unsettledEffects.length > 0;
        run.status = requiresReconciliation
          ? "reconciliation_required"
          : "cancelled";
        run.completedAt = requiresReconciliation ? null : nowIso(this.now);
        return runProjection(run);
      },
    );
  }

  beginCompensation(
    runId,
    { triggerNodeId = null, reason = "forward_failure" } = {},
  ) {
    const run = this._run(runId);
    const trigger =
      triggerNodeId == null
        ? null
        : safeIdentifier(triggerNodeId, "triggerNodeId");
    if (run.compensation.status !== "idle") {
      if (
        run.compensation.triggerNodeId === trigger &&
        run.compensation.reason === String(reason)
      ) {
        return runProjection(run);
      }
      throw kernelError(
        "CC_GRAPH_COMPENSATION_ALREADY_STARTED",
        "compensation has already been started for this run",
      );
    }
    return this._transaction(
      run,
      "compensation.started",
      { triggerNodeId: trigger, reason },
      () => {
        if (
          !["failed", "partial", "cancelled", "budget_exhausted"].includes(
            run.status,
          )
        ) {
          throw kernelError(
            "CC_GRAPH_COMPENSATION_NOT_AVAILABLE",
            "compensation requires a failed, partial, cancelled, or budget-exhausted terminal run",
          );
        }
        if (trigger && !run.compiled.nodes[trigger]) {
          throw kernelError(
            "CC_GRAPH_NODE_NOT_FOUND",
            `Graph node not found: ${trigger}`,
          );
        }
        const activeAttempts = [...run.attempts.values()].filter((attempt) =>
          ACTIVE_ATTEMPT.has(attempt.status),
        );
        const unsettledEffects = [...run.effects.values()].filter((effect) =>
          ["started", "unknown"].includes(effect.status),
        );
        if (activeAttempts.length || unsettledEffects.length) {
          throw kernelError(
            "CC_GRAPH_COMPENSATION_UNSETTLED",
            "compensation cannot start before attempts and effects are settled",
            {
              attemptIds: activeAttempts.map((attempt) => attempt.id).sort(),
              effectIds: unsettledEffects.map((effect) => effect.id).sort(),
            },
          );
        }
        const plan = (run.compiled.forwardTopologicalOrder || [])
          .filter((nodeId) => run.compiled.compensationByNode?.[nodeId])
          .reverse()
          .flatMap((nodeId) =>
            committedEffectsForNode(run, nodeId)
              .reverse()
              .map((effect) => ({
                nodeId,
                compensationNodeId: run.compiled.compensationByNode[nodeId],
                iterationPath: [...(effect.iterationPath || [])],
                effectIds: [effect.id],
              })),
          );
        if (plan.length === 0) {
          throw kernelError(
            "CC_GRAPH_COMPENSATION_NOT_REQUIRED",
            "run has no committed compensatable effects",
          );
        }
        const now = this.now();
        const preparedTargets = new Set();
        for (const entry of plan) {
          if (preparedTargets.has(entry.compensationNodeId)) continue;
          const state = run.nodeStates.get(entry.compensationNodeId);
          if (!state || state.status !== "skipped") {
            throw kernelError(
              "CC_GRAPH_COMPENSATION_TARGET_INVALID",
              `compensation target is not isolated and idle: ${entry.compensationNodeId}`,
            );
          }
          state.status = "pending";
          state.blockedRoot = null;
          state.iterationPath = [...entry.iterationPath];
          state.updatedAt = nowIso(() => now);
          preparedTargets.add(entry.compensationNodeId);
        }
        run.compensation = {
          status: "running",
          triggerNodeId: trigger,
          reason: String(reason),
          terminalStatus: run.status,
          plan,
          currentIndex: 0,
          completedNodeIds: [],
          completedEntries: [],
          failure: null,
          startedAt: nowIso(() => now),
          completedAt: null,
        };
        run.status = "running";
        run.completedAt = null;
        run.phase = "sealed";
        return runProjection(run);
      },
      {
        allowTerminal: true,
        idempotencyKey: `compensation-start:${run.id}:${trigger || "terminal"}`,
      },
    );
  }

  sendMessage(
    runId,
    {
      messageId = this.createId(),
      fromAttemptId,
      leaseId,
      fence,
      toAgentId,
      mode = "send",
      payload,
      dataPolicy,
      causationId = null,
      correlationId = null,
      systemSource = null,
      ttlMs = 24 * 60 * 60 * 1000,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(messageId, "messageId");
    const recipient = safeIdentifier(toAgentId, "toAgentId");
    const contentDigest = graphDigest(
      {
        recipient,
        mode,
        payload,
        causationId,
        correlationId,
        fromAttemptId: fromAttemptId || null,
        systemSource: systemSource || null,
      },
      "cc.graph.message/v1",
    );
    const existing = run.messages.get(id);
    if (existing) {
      if (existing.payloadDigest !== contentDigest) {
        throw kernelError(
          "CC_GRAPH_MESSAGE_ID_CONFLICT",
          "messageId was reused with different content",
        );
      }
      return Object.freeze(clone(existing));
    }
    return this._transaction(
      run,
      "message.admitted",
      { messageId: id, toAgentId: recipient, mode },
      () => {
        const source =
          systemSource == null
            ? null
            : safeIdentifier(systemSource, "systemSource");
        const attempt = source
          ? null
          : this._requireAttemptLease(run, fromAttemptId, leaseId, fence);
        const policy = validateDataPolicy(dataPolicy);
        const sink = `agent:${recipient}`;
        if (!sinkAllowed(policy, sink)) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_SINK_DENIED",
            `message data policy does not allow ${sink}`,
          );
        }
        if (
          policy.trust === "untrusted_content" &&
          containsAuthorityPayload(payload)
        ) {
          throw kernelError(
            "CC_GRAPH_UNTRUSTED_AUTHORITY_PAYLOAD",
            "untrusted content cannot create approval, capability, or control authority",
          );
        }
        const pending = [...run.messages.values()].filter(
          (message) =>
            message.toAgentId === recipient &&
            ["admitted", "delivered", "read"].includes(message.status),
        );
        if (pending.length >= this.maxPendingMessagesPerAgent) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_BACKPRESSURE",
            `message queue is full for ${recipient}`,
            { retryAfterMs: 100 },
          );
        }
        const now = this.now();
        const message = {
          id,
          runId: run.id,
          fromAttemptId: attempt?.id || null,
          fromLeaseId: attempt?.leaseId || null,
          fromFence: attempt?.fence ?? null,
          systemSource: source,
          sourceAuthorityGeneration: run.authority.authorityGeneration,
          sourceWriterId: run.authority.writerId,
          toAgentId: recipient,
          causationId,
          correlationId,
          mode: mode === "followup" ? "followup" : "send",
          status: "admitted",
          payload: clone(payload),
          payloadDigest: contentDigest,
          dataPolicy: policy,
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 86_400_000)),
          expiresAtMs: now + finitePositive(ttlMs, 86_400_000),
          deliveryCount: 0,
          readAt: null,
          processedAt: null,
        };
        run.messages.set(id, message);
        return Object.freeze(clone(message));
      },
      { idempotencyKey: `message:${id}` },
    );
  }

  deliverMessage(runId, messageId) {
    const run = this._run(runId);
    const id = safeIdentifier(messageId, "messageId");
    return this._transaction(
      run,
      "message.delivered",
      { messageId: id },
      () => {
        const message = run.messages.get(id);
        if (!message) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_NOT_FOUND",
            `message not found: ${id}`,
          );
        }
        if (message.status === "processed")
          return Object.freeze(clone(message));
        if (message.expiresAtMs <= this.now()) {
          message.status = "dead_letter";
          message.reason = "expired";
        } else {
          message.status = "delivered";
          message.deliveryCount += 1;
        }
        message.updatedAt = nowIso(this.now);
        return Object.freeze(clone(message));
      },
    );
  }

  receiveMessages(runId, agentId, { markRead = true } = {}) {
    const run = this._run(runId);
    const recipient = safeIdentifier(agentId, "agentId");
    return this._transaction(
      run,
      markRead ? "message.read" : "message.received",
      { agentId: recipient },
      () => {
        const messages = [...run.messages.values()]
          .filter(
            (message) =>
              message.toAgentId === recipient &&
              ["delivered", "read"].includes(message.status),
          )
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          );
        if (markRead) {
          for (const message of messages) {
            message.status = "read";
            message.readAt ||= nowIso(this.now);
            message.updatedAt = nowIso(this.now);
          }
        }
        return Object.freeze(
          messages.map((message) => Object.freeze(clone(message))),
        );
      },
    );
  }

  processMessage(runId, messageId, agentId, consumerKey) {
    const run = this._run(runId);
    const id = safeIdentifier(messageId, "messageId");
    const recipient = safeIdentifier(agentId, "agentId");
    const key = safeIdentifier(consumerKey, "consumerKey");
    const dedupKey = `${recipient}\0${id}\0${key}`;
    if (run.messageConsumers.has(dedupKey)) {
      return Object.freeze(clone(run.messageConsumers.get(dedupKey)));
    }
    const priorConsumer = [...run.messageConsumers.values()].find(
      (receipt) => receipt.messageId === id && receipt.agentId === recipient,
    );
    if (priorConsumer) {
      throw kernelError(
        "CC_GRAPH_MESSAGE_CONSUMER_CONFLICT",
        "message was already processed by another consumer key",
        { consumerKey: priorConsumer.consumerKey },
      );
    }
    return this._transaction(
      run,
      "message.processed",
      { messageId: id, agentId: recipient, consumerKey: key },
      () => {
        const message = run.messages.get(id);
        if (!message || message.toAgentId !== recipient) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_NOT_FOUND",
            `message is not addressed to ${recipient}`,
          );
        }
        if (!["delivered", "read", "processed"].includes(message.status)) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_NOT_DELIVERED",
            "message must be delivered before processing",
          );
        }
        message.status = "processed";
        message.readAt ||= nowIso(this.now);
        message.processedAt ||= nowIso(this.now);
        message.updatedAt = nowIso(this.now);
        const receipt = {
          messageId: id,
          agentId: recipient,
          consumerKey: key,
          payloadDigest: message.payloadDigest,
          processedAt: message.processedAt,
        };
        run.messageConsumers.set(dedupKey, receipt);
        return Object.freeze(clone(receipt));
      },
      {
        idempotencyKey: `message-processed:${graphDigest(
          dedupKey,
          "cc.graph.message-consumer/v1",
        )}`,
      },
    );
  }

  deadLetterMessage(runId, messageId, reason = "poison_message") {
    const run = this._run(runId);
    const id = safeIdentifier(messageId, "messageId");
    return this._transaction(
      run,
      "message.dead_lettered",
      { messageId: id, reason },
      () => {
        const message = run.messages.get(id);
        if (!message) {
          throw kernelError(
            "CC_GRAPH_MESSAGE_NOT_FOUND",
            `message not found: ${id}`,
          );
        }
        message.status = "dead_letter";
        message.reason = String(reason).slice(0, 1024);
        message.updatedAt = nowIso(this.now);
        return Object.freeze(clone(message));
      },
    );
  }

  offerHandoff(
    runId,
    {
      handoffId = this.createId(),
      fromAttemptId,
      leaseId,
      fence,
      toAgentId,
      artifactIds = [],
      preconditions = {},
      ttlMs = 60_000,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    const requestDigest = graphDigest(
      {
        fromAttemptId,
        leaseId,
        fence,
        toAgentId,
        artifactIds,
        preconditions,
        ttlMs,
      },
      "cc.graph.handoff-request/v1",
    );
    return this._transaction(
      run,
      "handoff.offered",
      { handoffId: id, fromAttemptId, toAgentId },
      () => {
        const existing = run.handoffs.get(id);
        if (existing) {
          if (existing.requestDigest !== requestDigest) {
            throw kernelError(
              "CC_GRAPH_HANDOFF_ID_CONFLICT",
              "handoffId was reused with different custody content",
            );
          }
          return Object.freeze(clone(existing));
        }
        const attempt = this._requireAttemptLease(
          run,
          fromAttemptId,
          leaseId,
          fence,
        );
        for (const artifactId of artifactIds) {
          if (!run.artifacts.has(artifactId)) {
            throw kernelError(
              "CC_GRAPH_ARTIFACT_NOT_FOUND",
              `handoff artifact not found: ${artifactId}`,
            );
          }
        }
        const now = this.now();
        const handoff = {
          id,
          runId: run.id,
          nodeId: attempt.nodeId,
          fromAttemptId: attempt.id,
          fromLeaseId: attempt.leaseId,
          fromFence: attempt.fence,
          toAgentId: safeIdentifier(toAgentId, "toAgentId"),
          revisionDigest: run.revisionDigest,
          authorityDigest: run.authorityDigest,
          artifactIds: [...artifactIds],
          preconditions: clone(preconditions),
          requestDigest,
          status: "offered",
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 60_000)),
          expiresAtMs: now + finitePositive(ttlMs, 60_000),
        };
        run.handoffs.set(id, handoff);
        return Object.freeze(clone(handoff));
      },
      { idempotencyKey: `handoff:${id}` },
    );
  }

  acceptHandoff(runId, handoffId, agentId) {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    const recipient = safeIdentifier(agentId, "agentId");
    return this._transaction(
      run,
      "handoff.accepted",
      { handoffId: id, agentId: recipient },
      () => {
        const handoff = run.handoffs.get(id);
        if (handoff?.status === "accepted" && handoff.toAgentId === recipient) {
          return Object.freeze(clone(handoff));
        }
        if (
          !handoff ||
          handoff.status !== "offered" ||
          handoff.toAgentId !== recipient ||
          handoff.expiresAtMs <= this.now()
        ) {
          throw kernelError(
            "CC_GRAPH_HANDOFF_NOT_ACCEPTABLE",
            "handoff is missing, expired, or addressed to another agent",
          );
        }
        handoff.status = "accepted";
        handoff.acceptedAt = nowIso(this.now);
        handoff.updatedAt = handoff.acceptedAt;
        return Object.freeze(clone(handoff));
      },
    );
  }

  rejectHandoff(runId, handoffId, agentId, reason = "rejected") {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    const recipient = safeIdentifier(agentId, "agentId");
    return this._transaction(
      run,
      "handoff.rejected",
      { handoffId: id, reason },
      () => {
        const handoff = run.handoffs.get(id);
        if (handoff?.status === "rejected" && handoff.toAgentId === recipient) {
          return Object.freeze(clone(handoff));
        }
        if (
          !handoff ||
          handoff.status !== "offered" ||
          handoff.toAgentId !== recipient
        ) {
          throw kernelError(
            "CC_GRAPH_HANDOFF_NOT_REJECTABLE",
            "handoff cannot be rejected in its current state",
          );
        }
        handoff.status = "rejected";
        handoff.reason = String(reason).slice(0, 1024);
        handoff.rejectedAt = nowIso(this.now);
        handoff.updatedAt = handoff.rejectedAt;
        return Object.freeze(clone(handoff));
      },
    );
  }

  commitHandoff(
    runId,
    handoffId,
    {
      leaseId = this.createId(),
      attemptId = this.createId(),
      ttlMs = 60_000,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    return this._transaction(
      run,
      "handoff.committed",
      { handoffId: id },
      () => {
        const handoff = run.handoffs.get(id);
        if (handoff?.status === "committed") {
          const assignmentAttempt = run.attempts.get(
            handoff.committedAttemptId,
          );
          if (!assignmentAttempt) {
            throw kernelError(
              "CC_GRAPH_HANDOFF_COMMIT_CORRUPT",
              "committed handoff is missing its assignment attempt",
            );
          }
          return Object.freeze({
            handoff: Object.freeze(clone(handoff)),
            assignmentAttempt: attemptProjection(assignmentAttempt),
          });
        }
        if (!handoff || handoff.status !== "accepted") {
          throw kernelError(
            "CC_GRAPH_HANDOFF_NOT_COMMITTABLE",
            "handoff must be accepted before custody can transfer",
          );
        }
        if (
          handoff.revisionDigest !== run.revisionDigest ||
          handoff.authorityDigest !== run.authorityDigest
        ) {
          throw kernelError(
            "CC_GRAPH_HANDOFF_BINDING_STALE",
            "handoff binding no longer matches the GraphRun",
          );
        }
        const sender = this._requireAttemptLease(
          run,
          handoff.fromAttemptId,
          handoff.fromLeaseId,
          handoff.fromFence,
        );
        const now = this.now();
        sender.status = "expired";
        sender.participationStatus = "handed_off";
        sender.updatedAt = nowIso(() => now);
        const fence = (run.fenceCounters.get(sender.nodeId) || 0) + 1;
        run.fenceCounters.set(sender.nodeId, fence);
        const iterationPath = [...(sender.iterationPath || [])];
        const attemptNumber =
          [...run.attempts.values()].filter(
            (candidate) =>
              candidate.nodeId === sender.nodeId &&
              JSON.stringify(candidate.iterationPath || []) ===
                JSON.stringify(iterationPath),
          ).length + 1;
        const newAttempt = {
          id: safeIdentifier(attemptId, "attemptId"),
          runId: run.id,
          nodeId: sender.nodeId,
          iterationPath,
          attempt: attemptNumber,
          agentId: handoff.toAgentId,
          role: "executor",
          compensationForNodeId: sender.compensationForNodeId || null,
          effectIdempotencyKey: sender.effectIdempotencyKey || null,
          leaseId: safeIdentifier(leaseId, "leaseId"),
          fence,
          authorityGeneration: run.authority.authorityGeneration,
          writerId: run.authority.writerId,
          status: "active",
          participationStatus: "active",
          grant: clone(sender.grant),
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 60_000)),
          expiresAtMs: now + finitePositive(ttlMs, 60_000),
          terminalEvidence: null,
          usage: null,
        };
        for (const effect of run.effects.values()) {
          if (effect.attemptId !== sender.id) continue;
          if (effect.status !== "started") {
            throw kernelError(
              "CC_GRAPH_HANDOFF_EFFECT_TERMINAL",
              "custody cannot transfer after the source effect became terminal",
              { effectId: effect.id, effectStatus: effect.status },
            );
          }
          effect.custodyHistory ||= [];
          effect.custodyHistory.push({
            fromAttemptId: sender.id,
            fromLeaseId: sender.leaseId,
            fromFence: sender.fence,
            toAttemptId: newAttempt.id,
            toLeaseId: newAttempt.leaseId,
            toFence: newAttempt.fence,
            handoffId: handoff.id,
            transferredAt: nowIso(() => now),
          });
          effect.attemptId = newAttempt.id;
          effect.leaseId = newAttempt.leaseId;
          effect.fence = newAttempt.fence;
          effect.updatedAt = nowIso(() => now);
        }
        run.attempts.set(newAttempt.id, newAttempt);
        run.nodeStates.get(sender.nodeId).attemptIds.push(newAttempt.id);
        handoff.status = "committed";
        handoff.committedAttemptId = newAttempt.id;
        handoff.committedAt = nowIso(() => now);
        handoff.updatedAt = handoff.committedAt;
        return Object.freeze({
          handoff: Object.freeze(clone(handoff)),
          assignmentAttempt: attemptProjection(newAttempt),
        });
      },
    );
  }

  expireHandoffForRecovery(
    runId,
    handoffId,
    { reason = "source writer generation was superseded" } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    return this._transaction(
      run,
      "handoff.expired",
      { handoffId: id, reason },
      () => {
        const handoff = run.handoffs.get(id);
        if (handoff?.status === "expired") {
          return Object.freeze(clone(handoff));
        }
        if (!handoff || !["offered", "accepted"].includes(handoff.status)) {
          throw kernelError(
            "CC_GRAPH_HANDOFF_NOT_RECOVERY_EXPIRABLE",
            "only an open handoff can expire during writer recovery",
          );
        }
        const source = run.attempts.get(handoff.fromAttemptId);
        if (
          !source ||
          Number(source.authorityGeneration || 0) >=
            run.authority.authorityGeneration
        ) {
          throw kernelError(
            "CC_GRAPH_HANDOFF_RECOVERY_AUTHORITY_INVALID",
            "handoff recovery requires a source from an older authority generation",
          );
        }
        const now = this.now();
        handoff.status = "expired";
        handoff.reason = String(reason).slice(0, 1024);
        handoff.expiredAt = nowIso(() => now);
        handoff.updatedAt = nowIso(() => now);
        return Object.freeze(clone(handoff));
      },
      {
        idempotencyKey: `handoff-recovery-expire:${id}:${run.authority.authorityGeneration}`,
      },
    );
  }

  revokeHandoff(runId, handoffId, fromAttemptId, leaseId, fence) {
    const run = this._run(runId);
    const id = safeIdentifier(handoffId, "handoffId");
    return this._transaction(run, "handoff.revoked", { handoffId: id }, () => {
      const handoff = run.handoffs.get(id);
      if (handoff?.status === "revoked") {
        return Object.freeze(clone(handoff));
      }
      if (!handoff || !["offered", "accepted"].includes(handoff.status)) {
        throw kernelError(
          "CC_GRAPH_HANDOFF_NOT_REVOKABLE",
          "committed or terminal handoffs cannot be revoked",
        );
      }
      this._requireAttemptLease(run, fromAttemptId, leaseId, fence);
      if (handoff.fromAttemptId !== fromAttemptId) {
        throw kernelError(
          "CC_GRAPH_HANDOFF_SENDER_MISMATCH",
          "only the current custody holder can revoke the handoff",
        );
      }
      handoff.status = "revoked";
      handoff.revokedAt = nowIso(this.now);
      handoff.updatedAt = handoff.revokedAt;
      return Object.freeze(clone(handoff));
    });
  }

  createHumanTask(
    runId,
    {
      humanTaskId = this.createId(),
      attemptId,
      leaseId,
      fence,
      operation,
      nonce = this.createId(),
      ttlMs = 24 * 60 * 60 * 1000,
      quorum = 1,
      separationOfDuties = false,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(humanTaskId, "humanTaskId");
    return this._transaction(
      run,
      "human_task.created",
      { humanTaskId: id, attemptId },
      () => {
        const attempt = this._requireAttemptLease(
          run,
          attemptId,
          leaseId,
          fence,
        );
        const now = this.now();
        attempt.status = "waiting_human";
        attempt.participationStatus = "waiting_human";
        attempt.updatedAt = nowIso(() => now);
        const state = run.nodeStates.get(attempt.nodeId);
        state.status = "waiting_human";
        state.updatedAt = nowIso(() => now);
        const agent = run.agents.get(attempt.agentId);
        if (agent) {
          agent.status = "idle";
          agent.updatedAt = nowIso(() => now);
        }
        const task = {
          id,
          runId: run.id,
          revisionDigest: run.revisionDigest,
          nodeId: attempt.nodeId,
          attemptId: attempt.id,
          operation: clone(operation),
          operationDigest: graphDigest(
            operation,
            "cc.graph.human-operation/v1",
          ),
          authorityDigest: run.authorityDigest,
          status: "open",
          nonce: safeIdentifier(nonce, "nonce"),
          quorum: Math.min(64, Math.max(1, Math.trunc(Number(quorum)) || 1)),
          separationOfDuties: separationOfDuties === true,
          decisions: [],
          claimActorId: null,
          claimLeaseId: null,
          claimExpiresAt: null,
          claimExpiresAtMs: null,
          createdAt: nowIso(() => now),
          updatedAt: nowIso(() => now),
          expiresAt: nowIso(() => now + finitePositive(ttlMs, 86_400_000)),
          expiresAtMs: now + finitePositive(ttlMs, 86_400_000),
          decision: null,
        };
        run.humanTasks.set(id, task);
        run.status = "waiting_human";
        return humanTaskProjection(task);
      },
      { idempotencyKey: `human-task:${id}` },
    );
  }

  claimHumanTask(
    runId,
    humanTaskId,
    actorId,
    { claimLeaseId = this.createId(), ttlMs = 5 * 60 * 1000 } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(humanTaskId, "humanTaskId");
    const actor = safeIdentifier(actorId, "actorId");
    return this._transaction(
      run,
      "human_task.claimed",
      { humanTaskId: id, actorId: actor },
      () => {
        const task = run.humanTasks.get(id);
        const now = this.now();
        if (
          !task ||
          !["open", "claimed"].includes(task.status) ||
          task.expiresAtMs <= now
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_TASK_NOT_CLAIMABLE",
            "human task is missing, expired, or terminal",
          );
        }
        if (
          task.status === "claimed" &&
          task.claimExpiresAtMs > now &&
          task.claimActorId !== actor
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_TASK_CLAIMED",
            "human task is already claimed",
          );
        }
        task.status = "claimed";
        task.claimActorId = actor;
        task.claimLeaseId = safeIdentifier(claimLeaseId, "claimLeaseId");
        task.claimExpiresAtMs = now + finitePositive(ttlMs, 300_000);
        task.claimExpiresAt = nowIso(() => task.claimExpiresAtMs);
        task.updatedAt = nowIso(() => now);
        return humanTaskProjection(task);
      },
    );
  }

  decideHumanTask(
    runId,
    humanTaskId,
    {
      actorId,
      claimLeaseId,
      revisionDigest,
      operationDigest,
      nonce,
      decision,
    } = {},
  ) {
    const run = this._run(runId);
    const id = safeIdentifier(humanTaskId, "humanTaskId");
    return this._transaction(
      run,
      "human_task.decided",
      { humanTaskId: id, actorId },
      () => {
        const task = run.humanTasks.get(id);
        const now = this.now();
        if (
          !task ||
          task.status !== "claimed" ||
          task.claimActorId !== safeIdentifier(actorId, "actorId") ||
          task.claimLeaseId !== safeIdentifier(claimLeaseId, "claimLeaseId") ||
          task.claimExpiresAtMs <= now
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_TASK_STALE_CLAIM",
            "human task claim is stale or owned by another actor",
          );
        }
        if (
          task.revisionDigest !== revisionDigest ||
          task.operationDigest !== operationDigest ||
          task.nonce !== nonce ||
          task.authorityDigest !== run.authorityDigest
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_TASK_BINDING_MISMATCH",
            "human decision does not match the bound revision, operation, nonce, or authority",
          );
        }
        if (
          !decision ||
          ![
            "acceptOnce",
            "acceptForTurn",
            "acceptForSession",
            "decline",
            "cancel",
          ].includes(decision.kind)
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_DECISION_INVALID",
            "human decision kind is invalid",
          );
        }
        if (
          task.separationOfDuties &&
          task.decisions.some((entry) => entry.actorId === actorId)
        ) {
          throw kernelError(
            "CC_GRAPH_HUMAN_SEPARATION_OF_DUTIES",
            "the same actor cannot satisfy multiple separated decisions",
          );
        }
        task.decisions.push({
          actorId,
          decision: clone(decision),
          decidedAt: nowIso(() => now),
        });
        const accepted = task.decisions.filter((entry) =>
          ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
            entry.decision.kind,
          ),
        ).length;
        const isDecline = ["decline", "cancel"].includes(decision.kind);
        if (isDecline || accepted >= task.quorum) {
          task.status = "decided";
          task.decision = clone(decision);
          const attempt = run.attempts.get(task.attemptId);
          if (attempt && attempt.status === "waiting_human") {
            attempt.status = "expired";
            attempt.participationStatus = "human_decided";
            attempt.updatedAt = nowIso(() => now);
          }
          const state = run.nodeStates.get(task.nodeId);
          state.status = isDecline
            ? decision.kind === "cancel"
              ? "cancelled"
              : "failed"
            : "pending";
          state.blockedRoot = isDecline ? task.id : null;
          state.updatedAt = nowIso(() => now);
        } else {
          task.status = "open";
          task.claimActorId = null;
          task.claimLeaseId = null;
          task.claimExpiresAt = null;
          task.claimExpiresAtMs = null;
        }
        task.updatedAt = nowIso(() => now);
        run.status = classifyQuiescence(run, now);
        return humanTaskProjection(task);
      },
    );
  }

  cancelHumanTask(runId, humanTaskId, reason = "cancelled") {
    const run = this._run(runId);
    const id = safeIdentifier(humanTaskId, "humanTaskId");
    return this._transaction(
      run,
      "human_task.cancelled",
      { humanTaskId: id, reason },
      () => {
        const task = run.humanTasks.get(id);
        if (!task || !["open", "claimed"].includes(task.status)) {
          throw kernelError(
            "CC_GRAPH_HUMAN_TASK_TERMINAL",
            "human task is already terminal",
          );
        }
        const now = this.now();
        task.status = "cancelled";
        task.reason = String(reason).slice(0, 1024);
        task.updatedAt = nowIso(() => now);
        const attempt = run.attempts.get(task.attemptId);
        if (attempt && attempt.status === "waiting_human") {
          attempt.status = "cancelled";
          attempt.participationStatus = "human_cancelled";
          attempt.updatedAt = nowIso(() => now);
        }
        const state = run.nodeStates.get(task.nodeId);
        state.status = "cancelled";
        state.blockedRoot = task.id;
        state.updatedAt = nowIso(() => now);
        run.status = classifyQuiescence(run, now);
        if (TERMINAL_RUN.has(run.status)) {
          run.completedAt = nowIso(() => now);
        }
        return humanTaskProjection(task);
      },
    );
  }

  setWaitReason(runId, nodeId, reason) {
    const run = this._run(runId);
    const id = safeIdentifier(nodeId, "nodeId");
    return this._transaction(
      run,
      "wait.updated",
      { nodeId: id, reason },
      () => {
        if (!run.nodeStates.has(id)) {
          throw kernelError(
            "CC_GRAPH_NODE_NOT_FOUND",
            `Graph node not found: ${id}`,
          );
        }
        if (reason == null) {
          run.waitReasons.delete(id);
          return null;
        }
        const normalized = {
          kind: String(reason.kind || "external"),
          resourceId:
            reason.resourceId == null
              ? null
              : String(reason.resourceId).slice(0, 256),
          ownerNodeId:
            reason.ownerNodeId == null
              ? null
              : safeIdentifier(reason.ownerNodeId, "ownerNodeId"),
          since: nowIso(this.now),
        };
        run.waitReasons.set(id, normalized);
        return Object.freeze(clone(normalized));
      },
    );
  }

  recordProgressDigest(runId, value) {
    const run = this._run(runId);
    const digest = graphDigest(value, "cc.graph.progress/v1");
    return this._transaction(run, "progress.observed", { digest }, () => {
      const count = (run.progressDigests.get(digest) || 0) + 1;
      run.progressDigests.set(digest, count);
      if (count >= this.maxLivelockRepeats) {
        run.status = "reconciliation_required";
      }
      return Object.freeze({
        digest,
        count,
        livelockSuspected: count >= this.maxLivelockRepeats,
      });
    });
  }

  classify(runId) {
    const run = this._run(runId);
    return Object.freeze({
      status: classifyQuiescence(run, this.now()),
      waitCycles: Object.freeze(waitGraphCycles(run).map(Object.freeze)),
      readyNodeIds: Object.freeze(
        this.readyNodes(runId).map((entry) => entry.nodeId),
      ),
    });
  }
}

export const _graphKernelInternals = Object.freeze({
  classifyQuiescence,
  dependencySatisfied,
  nodeReadiness,
  propagate,
  restoreState,
  stateSnapshot,
  terminalAlgebra,
  waitGraphCycles,
});
