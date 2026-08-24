import { graphDigest } from "./compiler.js";

function artifactOutcome(projection) {
  return Object.fromEntries(
    projection.artifactGraph.artifacts
      .map((artifact) => [artifact.id, artifact.digest])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function terminalNodes(projection) {
  return Object.fromEntries(
    projection.taskGraph.nodes
      .map((node) => [node.id, node.status])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function scheduleEquivalence(left, right) {
  const leftOutcome = {
    status: left.status,
    nodes: terminalNodes(left),
    artifacts: artifactOutcome(left),
  };
  const rightOutcome = {
    status: right.status,
    nodes: terminalNodes(right),
    artifacts: artifactOutcome(right),
  };
  return Object.freeze({
    equivalent: JSON.stringify(leftOutcome) === JSON.stringify(rightOutcome),
    leftDigest: graphDigest(leftOutcome, "cc.graph.eval-outcome/v1"),
    rightDigest: graphDigest(rightOutcome, "cc.graph.eval-outcome/v1"),
    left: leftOutcome,
    right: rightOutcome,
  });
}

export function evaluateGraphProjection(projection) {
  const attemptsByNode = new Map();
  for (const attempt of projection.attempts) {
    const values = attemptsByNode.get(attempt.nodeId) || [];
    values.push(attempt);
    attemptsByNode.set(attempt.nodeId, values);
  }
  const accepted = projection.attempts.filter(
    (attempt) => attempt.status === "accepted",
  ).length;
  const duplicateAttempts = [...attemptsByNode.values()].reduce(
    (total, attempts) => total + Math.max(0, attempts.length - 1),
    0,
  );
  const visibleMessages = projection.messageGraph.edges.length;
  const sentMessages = projection.messageGraph.messages.length;
  const completedHandoffs = projection.handoffs.filter(
    (handoff) => handoff.status === "committed",
  ).length;
  const terminalHandoffs = projection.handoffs.filter((handoff) =>
    ["committed", "rejected", "revoked", "expired"].includes(handoff.status),
  ).length;
  const durations = projection.attempts.map((attempt) =>
    Math.max(0, Date.parse(attempt.updatedAt) - Date.parse(attempt.createdAt)),
  );
  const totalWorkMs = durations.reduce((total, value) => total + value, 0);
  const criticalMs = projection.criticalPath.durationMs;
  const metrics = {
    terminalSuccess: projection.status === "succeeded" ? 1 : 0,
    acceptedAttempts: accepted,
    duplicateAttempts,
    duplicateWorkRatio:
      projection.attempts.length === 0
        ? 0
        : duplicateAttempts / projection.attempts.length,
    messageVisibilityRate:
      sentMessages === 0 ? 1 : visibleMessages / sentMessages,
    handoffCompletionRate:
      projection.handoffs.length === 0
        ? 1
        : terminalHandoffs / projection.handoffs.length,
    custodyCommitRate:
      projection.handoffs.length === 0
        ? 1
        : completedHandoffs / projection.handoffs.length,
    criticalPathUtilization:
      totalWorkMs === 0 ? 1 : Math.min(1, criticalMs / totalWorkMs),
    totalWorkMs,
    criticalPathMs: criticalMs,
    deadlocked: projection.status === "deadlocked" ? 1 : 0,
    reconciliationRequired:
      projection.status === "reconciliation_required" ? 1 : 0,
  };
  return Object.freeze({
    schema: "chainlesschain.graph-eval/v1",
    runId: projection.runId,
    revisionDigest: projection.revisionDigest,
    projectionDigest: projection.projectionDigest,
    metrics: Object.freeze(metrics),
  });
}

export function enforceGraphEvalThresholds(report, thresholds = {}) {
  const failures = [];
  for (const [metric, constraint] of Object.entries(thresholds)) {
    const actual = report.metrics[metric];
    if (typeof actual !== "number") {
      failures.push({ metric, actual: null, reason: "metric_missing" });
      continue;
    }
    if (constraint.min != null && actual < constraint.min) {
      failures.push({ metric, actual, expected: `>= ${constraint.min}` });
    }
    if (constraint.max != null && actual > constraint.max) {
      failures.push({ metric, actual, expected: `<= ${constraint.max}` });
    }
  }
  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures.map(Object.freeze)),
  });
}

export async function runGraphEvalSuite({
  suiteId,
  commitSha,
  cases,
  execute,
  thresholds = {},
} = {}) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(String(commitSha || ""))) {
    throw new TypeError(
      "Graph Eval suite requires an exact 40 or 64 character commit SHA",
    );
  }
  if (!Array.isArray(cases) || !cases.length || typeof execute !== "function") {
    throw new TypeError(
      "Graph Eval suite requires cases and an execute function",
    );
  }
  const results = [];
  for (const definition of [...cases].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const seeds = [...new Set(definition.seeds || [0])].sort(
      (left, right) => left - right,
    );
    for (const seed of seeds) {
      const control = await execute({
        caseId: definition.id,
        seed,
        mode: "single_agent_control",
        fault: null,
      });
      const candidate = await execute({
        caseId: definition.id,
        seed,
        mode: "graph_candidate",
        fault: definition.fault || null,
      });
      const controlEval = evaluateGraphProjection(control);
      const candidateEval = evaluateGraphProjection(candidate);
      const equivalence = scheduleEquivalence(control, candidate);
      results.push({
        caseId: definition.id,
        seed,
        fault: definition.fault || null,
        controlProjectionDigest: control.projectionDigest,
        candidateProjectionDigest: candidate.projectionDigest,
        scheduleEquivalent: equivalence.equivalent,
        metrics: candidateEval.metrics,
        controlMetrics: controlEval.metrics,
      });
    }
  }
  const total = results.length;
  const sum = (field) =>
    results.reduce(
      (value, result) => value + Number(result.metrics[field] || 0),
      0,
    );
  const metrics = {
    caseRuns: total,
    successRate: sum("terminalSuccess") / total,
    scheduleEquivalenceRate:
      results.filter((result) => result.scheduleEquivalent).length / total,
    deadlockRate: sum("deadlocked") / total,
    reconciliationRate: sum("reconciliationRequired") / total,
    meanDuplicateWorkRatio: sum("duplicateWorkRatio") / total,
    meanMessageVisibilityRate: sum("messageVisibilityRate") / total,
    meanHandoffCompletionRate: sum("handoffCompletionRate") / total,
    totalWorkMs: sum("totalWorkMs"),
    totalCriticalPathMs: sum("criticalPathMs"),
  };
  const gate = enforceGraphEvalThresholds({ metrics }, thresholds);
  const body = {
    schema: "chainlesschain.graph-eval-suite/v1",
    suiteId: String(suiteId || "graph-eval"),
    commitSha,
    thresholds,
    metrics,
    gate,
    results,
  };
  return Object.freeze({
    ...body,
    reportDigest: graphDigest(body, "cc.graph.eval-suite/v1"),
  });
}
