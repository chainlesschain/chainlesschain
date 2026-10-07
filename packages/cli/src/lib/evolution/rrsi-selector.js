/** Synthetic replay only. No aggregate supplied here is authenticated evidence. */
import { verifyRrsiCampaign, verifyRrsiCandidate } from "./rrsi-contracts.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiInteger,
  rrsiFinite,
  rrsiBoolean,
  rrsiId,
  rrsiFail,
  rrsiEnvelope,
} from "./rrsi-data.js";

export const RRSI_REPLAY_SCHEMA = "chainlesschain.rrsi-selection-replay/v1";
const OBSERVATION_KEYS = [
  "candidateDigest",
  "trainDelta",
  "selectionDelta",
  "baselineCostMicrounits",
  "candidateCostMicrounits",
  "baselineP95LatencyMs",
  "candidateP95LatencyMs",
  "baselineTokens",
  "candidateTokens",
  "baselineToolCalls",
  "candidateToolCalls",
  "perturbationDeltas",
  "wallClockMs",
  "executions",
  "history",
  "plannedSlots",
  "completedSlots",
  "independentGroups",
  "safetyViolations",
  "permissionViolations",
  "dataLeakage",
  "environmentMatches",
  "cleanupConfirmed",
  "costComplete",
  "ancestorPassed",
];
const COST_METRICS = [
  "baselineCostMicrounits",
  "candidateCostMicrounits",
  "baselineP95LatencyMs",
  "candidateP95LatencyMs",
  "baselineTokens",
  "candidateTokens",
  "baselineToolCalls",
  "candidateToolCalls",
];

function observation(input, campaign) {
  rrsiExact(input, OBSERVATION_KEYS, "synthetic observation");
  const result = {
    candidateDigest: rrsiDigest(input.candidateDigest, "candidate digest"),
  };
  result.trainDelta =
    input.trainDelta === null
      ? null
      : rrsiFinite(input.trainDelta, "training delta", -1, 1);
  if (input.selectionDelta === null) result.selectionDelta = null;
  else {
    result.selectionDelta = Object.fromEntries(
      ["mean", "lower", "upper"].map((key) => {
        rrsiExact(
          input.selectionDelta,
          ["mean", "lower", "upper"],
          "synthetic delta interval",
        );
        return [
          key,
          rrsiFinite(input.selectionDelta[key], `delta ${key}`, -1, 1),
        ];
      }),
    );
    if (
      result.selectionDelta.lower > result.selectionDelta.mean ||
      result.selectionDelta.mean > result.selectionDelta.upper
    )
      rrsiFail("invalid synthetic delta interval");
  }
  for (const key of COST_METRICS)
    result[key] = input[key] === null ? null : rrsiInteger(input[key], key);
  for (const key of ["wallClockMs", "executions"])
    result[key] = input[key] === null ? null : rrsiInteger(input[key], key);
  for (const key of [
    "plannedSlots",
    "completedSlots",
    "independentGroups",
    "safetyViolations",
    "permissionViolations",
  ])
    result[key] = rrsiInteger(input[key], key);
  if (
    result.completedSlots > result.plannedSlots ||
    result.independentGroups > campaign.dataset.pools.select.componentCount ||
    result.independentGroups > campaign.dataset.pools.select.taskCount
  )
    rrsiFail("synthetic observation invents slots or independent groups");
  for (const key of [
    "dataLeakage",
    "environmentMatches",
    "cleanupConfirmed",
    "costComplete",
    "ancestorPassed",
  ])
    result[key] = rrsiBoolean(input[key], key);
  rrsiExact(
    input.history,
    ["oscillations", "repeatedFailures"],
    "synthetic history",
  );
  result.history = {
    oscillations: rrsiInteger(
      input.history.oscillations,
      "oscillations",
      0,
      1000,
    ),
    repeatedFailures: rrsiInteger(
      input.history.repeatedFailures,
      "repeated failures",
      0,
      1000,
    ),
  };
  if (
    !Array.isArray(input.perturbationDeltas) ||
    input.perturbationDeltas.length > 8
  )
    rrsiFail("invalid synthetic perturbations");
  const seen = new Set();
  result.perturbationDeltas = input.perturbationDeltas
    .map((entry) => {
      rrsiExact(entry, ["id", "mean"], "synthetic perturbation");
      const id = rrsiId(entry.id, "perturbation ID");
      if (seen.has(id) || !campaign.experiment.perturbations.includes(id))
        rrsiFail("duplicate or unregistered perturbation");
      seen.add(id);
      return {
        id,
        mean:
          entry.mean === null
            ? null
            : rrsiFinite(entry.mean, "perturbation delta", -1, 1),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

function decision(candidate, raw, policy, campaign) {
  const result = {
    candidateDigest: candidate.candidateDigest,
    contentDigest: candidate.contentDigest,
    status: "hold",
    reasons: [],
    rawMetrics: raw,
    penalties: null,
    contributions: null,
    score: null,
  };
  if (!raw) {
    result.reasons.push("INSUFFICIENT_EVIDENCE");
    return result;
  }
  const rejects = [];
  if (raw.safetyViolations || raw.permissionViolations)
    rejects.push("SAFETY_HARD_GATE");
  if (raw.dataLeakage) rejects.push("DATA_LEAKAGE");
  if (!raw.ancestorPassed) rejects.push("ANCESTOR_REGRESSION");
  const expectedSlots =
    campaign.dataset.pools.select.taskCount *
    campaign.experiment.seeds.length *
    (1 + campaign.experiment.perturbations.length);
  if (
    raw.plannedSlots !== expectedSlots ||
    raw.completedSlots !== expectedSlots ||
    raw.independentGroups < policy.thresholds.minIndependentGroups ||
    raw.trainDelta === null ||
    raw.selectionDelta === null ||
    raw.perturbationDeltas.length !==
      campaign.experiment.perturbations.length ||
    raw.perturbationDeltas.some((entry) => entry.mean === null)
  )
    result.reasons.push("INSUFFICIENT_EVIDENCE");
  if (!raw.costComplete || COST_METRICS.some((key) => raw[key] === null))
    result.reasons.push("COST_UNKNOWN");
  if (raw.executions === null || raw.wallClockMs === null)
    result.reasons.push("BUDGET_UNKNOWN");
  else if (raw.executions < 2 * raw.completedSlots)
    result.reasons.push("INSUFFICIENT_EVIDENCE");
  if (!raw.environmentMatches) result.reasons.push("ENVIRONMENT_DRIFT");
  if (!raw.cleanupConfirmed) result.reasons.push("CLEANUP_UNCONFIRMED");
  if (!policy.calibrated) result.reasons.push("POLICY_NOT_CALIBRATED");
  if (rejects.length)
    return {
      ...result,
      status: "rejected",
      reasons: [...rejects, ...result.reasons],
    };
  if (result.reasons.length) return result;
  const noise = Math.max(
    ...raw.perturbationDeltas.map((entry) =>
      Math.max(0, raw.selectionDelta.mean - entry.mean),
    ),
  );
  const size = candidate.artifacts.reduce(
    (sum, artifact) => sum + artifact.bytes,
    0,
  );
  const nodes = candidate.artifacts.reduce(
    (sum, artifact) => sum + artifact.workflowNodes,
    0,
  );
  const excess = (actual, target) => Math.max(0, (actual - target) / target);
  const penalties = {
    generalization: Math.max(0, raw.trainDelta - raw.selectionDelta.mean),
    cost:
      policy.cost.costWeight *
        Math.max(
          0,
          (raw.candidateCostMicrounits - raw.baselineCostMicrounits) /
            policy.cost.costScaleMicrounits,
        ) +
      policy.cost.latencyWeight *
        Math.max(
          0,
          (raw.candidateP95LatencyMs - raw.baselineP95LatencyMs) /
            policy.cost.latencyScaleMs,
        ),
    noise,
    history:
      (policy.history.oscillationWeight * raw.history.oscillations) /
        policy.history.maxOscillations +
      (policy.history.repeatedFailureWeight * raw.history.repeatedFailures) /
        policy.history.maxRepeatedFailures,
    complexity:
      policy.complexity.bytesWeight *
        excess(size, policy.complexity.targetArtifactBytes) +
      policy.complexity.nodesWeight *
        excess(nodes, policy.complexity.targetWorkflowNodes) +
      policy.complexity.filesWeight *
        excess(
          candidate.artifacts.length,
          policy.complexity.targetChangedFiles,
        ),
  };
  const contributions = Object.fromEntries(
    Object.keys(penalties).map((key) => [
      key,
      penalties[key] * policy.weights[key],
    ]),
  );
  const score =
    raw.selectionDelta.lower -
    Object.values(contributions).reduce((sum, term) => sum + term, 0);
  const reduction = (base, next) => (base > 0 ? (base - next) / base : 0);
  const efficient =
    raw.selectionDelta.lower >= 0 &&
    raw.candidateCostMicrounits <= raw.baselineCostMicrounits &&
    Math.max(
      reduction(raw.baselineTokens, raw.candidateTokens),
      reduction(raw.baselineP95LatencyMs, raw.candidateP95LatencyMs),
      reduction(raw.baselineToolCalls, raw.candidateToolCalls),
    ) >= policy.thresholds.minimumEfficiencyReduction;
  const reasons = [];
  if (noise > policy.thresholds.maxNoiseRegression)
    reasons.push("NO_ROBUST_GAIN");
  if (
    raw.selectionDelta.lower < policy.thresholds.minimumQualityDelta &&
    !efficient
  )
    reasons.push("NO_ROBUST_GAIN");
  if (score < 0) reasons.push("REGULARIZED_GAIN_NOT_MET");
  if (
    raw.history.oscillations >= policy.history.maxOscillations ||
    raw.history.repeatedFailures >= policy.history.maxRepeatedFailures
  )
    reasons.push("HISTORY_LIMIT");
  if (
    raw.candidateCostMicrounits + raw.baselineCostMicrounits >
      campaign.budget.selectionPerExploringArm.maxCostMicrounits ||
    raw.candidateTokens + raw.baselineTokens >
      campaign.budget.selectionPerExploringArm.maxTokens ||
    raw.candidateToolCalls + raw.baselineToolCalls >
      campaign.budget.selectionPerExploringArm.maxToolCalls
  )
    reasons.push("BUDGET_EXCEEDED");
  return {
    ...result,
    penalties,
    contributions,
    score,
    reasons: [...new Set(reasons)],
    status: reasons.length ? "rejected" : "shadow-eligible",
  };
}

/** Caller aggregates are synthetic examples, never a production Gate receipt. */
export function replayRrsiSelection(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["campaign", "candidates", "observations"],
    "RRSI replay input",
  );
  const campaign = verifyRrsiCampaign(value.campaign);
  if (
    !Array.isArray(value.candidates) ||
    value.candidates.length < 1 ||
    value.candidates.length > campaign.policy.limits.maxCandidates ||
    value.candidates.length > campaign.policy.limits.maxSelectionQueries
  )
    rrsiFail("replay exceeds the frozen candidate or query limit");
  const candidates = value.candidates.map((candidate) =>
    verifyRrsiCandidate(campaign, candidate),
  );
  const digests = new Set();
  const ids = new Set();
  for (const candidate of candidates) {
    if (
      digests.has(candidate.candidateDigest) ||
      ids.has(candidate.candidateId)
    )
      rrsiFail("duplicate candidate identity");
    digests.add(candidate.candidateDigest);
    ids.add(candidate.candidateId);
  }
  if (
    !Array.isArray(value.observations) ||
    value.observations.length > candidates.length
  )
    rrsiFail("invalid observation count");
  const observed = new Map();
  for (const input of value.observations) {
    const raw = observation(input, campaign);
    if (!digests.has(raw.candidateDigest) || observed.has(raw.candidateDigest))
      rrsiFail("unknown or duplicate observed candidate");
    observed.set(raw.candidateDigest, raw);
  }
  const contentCounts = new Map();
  for (const candidate of candidates)
    contentCounts.set(
      candidate.contentDigest,
      (contentCounts.get(candidate.contentDigest) ?? 0) + 1,
    );
  const decisions = candidates.map((candidate) => {
    const result = decision(
      candidate,
      observed.get(candidate.candidateDigest) ?? null,
      campaign.policy,
      campaign,
    );
    if (contentCounts.get(candidate.contentDigest) > 1)
      return {
        ...result,
        status: "rejected",
        reasons: [...result.reasons, "DUPLICATE_CONTENT"],
      };
    return result;
  });
  const incompleteCodes = new Set([
    "INSUFFICIENT_EVIDENCE",
    "COST_UNKNOWN",
    "BUDGET_UNKNOWN",
    "ENVIRONMENT_DRIFT",
    "CLEANUP_UNCONFIRMED",
    "POLICY_NOT_CALIBRATED",
  ]);
  const blockingReasons = new Set(
    decisions.flatMap((result) =>
      result.reasons.filter((reason) => incompleteCodes.has(reason)),
    ),
  );
  for (const [resource, fields] of [
    [
      "maxCostMicrounits",
      ["baselineCostMicrounits", "candidateCostMicrounits"],
    ],
    ["maxTokens", ["baselineTokens", "candidateTokens"]],
    ["maxToolCalls", ["baselineToolCalls", "candidateToolCalls"]],
    ["maxWallClockMs", ["wallClockMs"]],
    ["maxExecutions", ["executions"]],
  ]) {
    let total = 0n;
    for (const raw of observed.values())
      for (const field of fields)
        if (raw[field] !== null) total += BigInt(raw[field]);
    if (total > BigInt(campaign.budget.selectionPerExploringArm[resource]))
      blockingReasons.add("BUDGET_EXCEEDED");
  }
  // A partial campaign cannot quietly drop an expensive or uncertain competitor.
  const held = blockingReasons.size > 0;
  const ranked = held
    ? []
    : decisions
        .filter((result) => result.status === "shadow-eligible")
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.rawMetrics.candidateCostMicrounits -
              b.rawMetrics.candidateCostMicrounits ||
            candidates
              .find((c) => c.candidateDigest === a.candidateDigest)
              .artifacts.reduce((n, x) => n + x.bytes, 0) -
              candidates
                .find((c) => c.candidateDigest === b.candidateDigest)
                .artifacts.reduce((n, x) => n + x.bytes, 0) ||
            (a.contentDigest < b.contentDigest
              ? -1
              : a.contentDigest > b.contentDigest
                ? 1
                : 0),
        );
  return rrsiEnvelope(RRSI_REPLAY_SCHEMA, "replayDigest", {
    campaignDigest: campaign.campaignDigest,
    evidenceKind: "synthetic-offline",
    statisticalProtocolValidated: false,
    budgetCoverage: "synthetic-all-five-resource-aggregates",
    blockingReasons: [...blockingReasons].sort(),
    status: held || !ranked.length ? "hold" : "shadow-selected",
    selectedCandidateDigest: ranked[0]?.candidateDigest ?? null,
    decisions: decisions.sort((a, b) =>
      a.candidateDigest < b.candidateDigest
        ? -1
        : a.candidateDigest > b.candidateDigest
          ? 1
          : 0,
    ),
  });
}
