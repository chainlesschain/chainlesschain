/** Frozen planning contracts only. Digests do not authenticate source metadata. */
import {
  RrsiContractError,
  snapshotRrsiData,
  rrsiExact,
  rrsiId,
  rrsiDigest,
  rrsiInteger,
  rrsiFinite,
  rrsiBoolean,
  rrsiHash,
  rrsiFail,
  rrsiEnvelope,
  verifyRrsiEnvelope,
  freezeRrsiData,
} from "./rrsi-data.js";

export { RrsiContractError };
export const RRSI_POLICY_SCHEMA = "chainlesschain.rrsi-policy/v1";
export const RRSI_DATASET_SCHEMA = "chainlesschain.rrsi-dataset-manifest/v1";
export const RRSI_CAMPAIGN_SCHEMA = "chainlesschain.rrsi-campaign/v1";
export const RRSI_CANDIDATE_SCHEMA = "chainlesschain.rrsi-candidate/v1";
export const RRSI_PARTITIONS = Object.freeze([
  "train",
  "select",
  "gate-validation",
  "gate-test",
  "audit",
]);
export const RRSI_GROUP_DIMENSIONS = Object.freeze([
  "template",
  "project",
  "principal",
  "timeWindow",
]);
export const RRSI_BUDGET_FIELDS = Object.freeze([
  "maxTokens",
  "maxToolCalls",
  "maxWallClockMs",
  "maxCostMicrounits",
  "maxExecutions",
]);
const POLICY_KEYS = [
  "policyId",
  "limits",
  "weights",
  "cost",
  "history",
  "complexity",
  "thresholds",
  "calibrated",
];
const DATASET_KEYS = ["manifestId", "datasetVersion", "tasks"];
const CAMPAIGN_KEYS = [
  "campaignId",
  "tenantId",
  "goalId",
  "candidateKind",
  "sourceCommitSha",
  "parentReleaseDigest",
  "anchorReleaseDigest",
  "policy",
  "dataset",
  "execution",
  "experiment",
  "budget",
];
const CANDIDATE_KEYS = [
  "candidateId",
  "parentReleaseDigest",
  "kind",
  "targetId",
  "lineageDepth",
  "sourceTaskIds",
  "artifacts",
  "hypothesisDigest",
];

function numericRecord(input, keys, label, validator) {
  rrsiExact(input, keys, label);
  return Object.fromEntries(
    keys.map((key) => [key, validator(input[key], `${label}.${key}`)]),
  );
}

function uniqueList(values, label, min, max, validator = rrsiId) {
  if (!Array.isArray(values) || values.length < min || values.length > max)
    rrsiFail(`${label} has an invalid entry count`);
  const result = values.map((value) => validator(value, label));
  if (new Set(result).size !== result.length)
    rrsiFail(`${label} has duplicate entries`);
  return result;
}

function kind(value) {
  if (!["skill", "memory-policy"].includes(value))
    rrsiFail("invalid candidate kind");
  return value;
}

export function buildRrsiPolicy(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, POLICY_KEYS, "RRSI policy");
  const limits = numericRecord(
    value.limits,
    [
      "maxRounds",
      "maxCandidatesPerRound",
      "maxCandidates",
      "maxChangedFiles",
      "maxArtifactBytes",
      "maxLineageDepth",
      "maxSelectionQueries",
      "maxConsecutiveNoGainRounds",
    ],
    "limits",
    (number, label) => rrsiInteger(number, label, 1, 1_000_000),
  );
  if (
    limits.maxRounds > 32 ||
    limits.maxCandidatesPerRound > 8 ||
    limits.maxCandidates > limits.maxRounds * limits.maxCandidatesPerRound ||
    limits.maxChangedFiles > 3 ||
    limits.maxSelectionQueries > limits.maxCandidates ||
    limits.maxConsecutiveNoGainRounds > limits.maxRounds ||
    limits.maxLineageDepth > 32
  )
    rrsiFail("RRSI limits are inconsistent or exceed the bounded pilot");
  const weights = numericRecord(
    value.weights,
    ["generalization", "cost", "noise", "history", "complexity"],
    "weights",
    (number, label) => rrsiFinite(number, label, 0, 100),
  );
  if (Object.values(weights).every((weight) => weight === 0))
    rrsiFail("RRSI policy requires a nonzero regularizer");
  rrsiExact(
    value.cost,
    ["costScaleMicrounits", "latencyScaleMs", "costWeight", "latencyWeight"],
    "cost",
  );
  const cost = {
    costScaleMicrounits: rrsiInteger(
      value.cost.costScaleMicrounits,
      "cost scale",
      1,
    ),
    latencyScaleMs: rrsiInteger(value.cost.latencyScaleMs, "latency scale", 1),
    costWeight: rrsiFinite(value.cost.costWeight, "cost weight"),
    latencyWeight: rrsiFinite(value.cost.latencyWeight, "latency weight"),
  };
  rrsiExact(
    value.history,
    [
      "window",
      "maxOscillations",
      "maxRepeatedFailures",
      "oscillationWeight",
      "repeatedFailureWeight",
    ],
    "history",
  );
  const history = {
    window: rrsiInteger(value.history.window, "history window", 1, 1000),
    maxOscillations: rrsiInteger(
      value.history.maxOscillations,
      "oscillation maximum",
      1,
      1000,
    ),
    maxRepeatedFailures: rrsiInteger(
      value.history.maxRepeatedFailures,
      "failure maximum",
      1,
      1000,
    ),
    oscillationWeight: rrsiFinite(
      value.history.oscillationWeight,
      "oscillation weight",
    ),
    repeatedFailureWeight: rrsiFinite(
      value.history.repeatedFailureWeight,
      "failure weight",
    ),
  };
  rrsiExact(
    value.complexity,
    [
      "targetArtifactBytes",
      "targetWorkflowNodes",
      "targetChangedFiles",
      "bytesWeight",
      "nodesWeight",
      "filesWeight",
    ],
    "complexity",
  );
  const complexity = {
    targetArtifactBytes: rrsiInteger(
      value.complexity.targetArtifactBytes,
      "target bytes",
      1,
      limits.maxArtifactBytes,
    ),
    targetWorkflowNodes: rrsiInteger(
      value.complexity.targetWorkflowNodes,
      "target nodes",
      1,
      1000,
    ),
    targetChangedFiles: rrsiInteger(
      value.complexity.targetChangedFiles,
      "target files",
      1,
      limits.maxChangedFiles,
    ),
    bytesWeight: rrsiFinite(value.complexity.bytesWeight, "bytes weight"),
    nodesWeight: rrsiFinite(value.complexity.nodesWeight, "nodes weight"),
    filesWeight: rrsiFinite(value.complexity.filesWeight, "files weight"),
  };
  rrsiExact(
    value.thresholds,
    [
      "minimumQualityDelta",
      "minimumEfficiencyReduction",
      "maxNoiseRegression",
      "minIndependentGroups",
    ],
    "thresholds",
  );
  const thresholds = {
    minimumQualityDelta: rrsiFinite(
      value.thresholds.minimumQualityDelta,
      "minimum quality delta",
      0.05,
      1,
    ),
    minimumEfficiencyReduction: rrsiFinite(
      value.thresholds.minimumEfficiencyReduction,
      "minimum efficiency reduction",
      0.1,
      1,
    ),
    maxNoiseRegression: rrsiFinite(
      value.thresholds.maxNoiseRegression,
      "noise limit",
    ),
    minIndependentGroups: rrsiInteger(
      value.thresholds.minIndependentGroups,
      "minimum groups",
      20,
      5000,
    ),
  };
  return rrsiEnvelope(RRSI_POLICY_SCHEMA, "policyDigest", {
    policyId: rrsiId(value.policyId, "policyId"),
    limits,
    weights,
    cost,
    history,
    complexity,
    thresholds,
    calibrated: rrsiBoolean(value.calibrated, "calibrated"),
  });
}

export function verifyRrsiPolicy(value) {
  return verifyRrsiEnvelope(
    value,
    RRSI_POLICY_SCHEMA,
    "policyDigest",
    POLICY_KEYS,
    buildRrsiPolicy,
  );
}

export function buildRrsiDatasetManifest(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, DATASET_KEYS, "RRSI dataset");
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length < 5 ||
    value.tasks.length > 5000
  )
    rrsiFail("RRSI dataset requires 5..5000 task references");
  const seenIds = new Set();
  const seenContent = new Set();
  const owners = new Map();
  const parents = new Map();
  const find = (id) => {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current);
    while (id !== current) {
      const previous = parents.get(id);
      parents.set(id, current);
      id = previous;
    }
    return current;
  };
  const tasks = value.tasks
    .map((task) => {
      rrsiExact(
        task,
        ["id", "partition", "contentDigest", "groups"],
        "task reference",
      );
      const id = rrsiId(task.id, "task ID");
      const contentDigest = rrsiDigest(
        task.contentDigest,
        "task content digest",
      );
      if (!RRSI_PARTITIONS.includes(task.partition))
        rrsiFail("invalid task partition");
      if (seenIds.has(id) || seenContent.has(contentDigest))
        rrsiFail("duplicate task ID or content", "CC_RRSI_DATA_LEAKAGE");
      seenIds.add(id);
      seenContent.add(contentDigest);
      parents.set(id, id);
      const groups = numericRecord(
        task.groups,
        RRSI_GROUP_DIMENSIONS,
        "task groups",
        rrsiDigest,
      );
      return { id, partition: task.partition, contentDigest, groups };
    })
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  for (const task of tasks) {
    for (const dimension of RRSI_GROUP_DIMENSIONS) {
      const key = `${dimension}:${task.groups[dimension]}`;
      const owner = owners.get(key);
      if (owner && owner.partition !== task.partition)
        rrsiFail(
          "declared source group crosses RRSI partitions",
          "CC_RRSI_DATA_LEAKAGE",
        );
      if (owner) parents.set(find(task.id), find(owner.id));
      else owners.set(key, task);
    }
  }
  const pools = Object.fromEntries(
    RRSI_PARTITIONS.map((partition) => {
      const members = tasks.filter((task) => task.partition === partition);
      if (!members.length)
        rrsiFail("RRSI dataset must contain every partition");
      return [
        partition,
        {
          taskCount: members.length,
          componentCount: new Set(members.map((task) => find(task.id))).size,
          partitionDigest: rrsiHash("chainlesschain.rrsi-partition/v1", {
            partition,
            tasks: members,
          }),
        },
      ];
    }),
  );
  return rrsiEnvelope(RRSI_DATASET_SCHEMA, "datasetDigest", {
    manifestId: rrsiId(value.manifestId, "manifestId"),
    datasetVersion: rrsiId(value.datasetVersion, "datasetVersion"),
    tasks,
    pools,
    sourceMetadataAuthenticated: false,
  });
}

export function verifyRrsiDatasetManifest(value) {
  return verifyRrsiEnvelope(
    value,
    RRSI_DATASET_SCHEMA,
    "datasetDigest",
    DATASET_KEYS,
    buildRrsiDatasetManifest,
    ["pools", "sourceMetadataAuthenticated"],
  );
}

export function projectRrsiTrainingView(input) {
  const dataset = verifyRrsiDatasetManifest(input);
  return freezeRrsiData({
    trainingPartitionDigest: dataset.pools.train.partitionDigest,
    tasks: dataset.tasks
      .filter((task) => task.partition === "train")
      .map(({ id, contentDigest }) => ({ id, contentDigest })),
    sourceMetadataAuthenticated: false,
  });
}

function budgetRecord(input, label) {
  return numericRecord(input, RRSI_BUDGET_FIELDS, label, (number, name) =>
    rrsiInteger(number, name, 1),
  );
}

export function buildRrsiCampaign(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, CAMPAIGN_KEYS, "RRSI campaign");
  if (
    typeof value.goalId !== "string" ||
    !/^[a-z][a-z0-9-]{0,127}$/u.test(value.goalId)
  )
    rrsiFail("campaign goalId must be a canonical artifact target");
  const policy = verifyRrsiPolicy(value.policy);
  const dataset = verifyRrsiDatasetManifest(value.dataset);
  const minimumTasks = {
    train: 60,
    select: 40,
    "gate-validation": 40,
    "gate-test": 40,
    audit: 40,
  };
  for (const partition of RRSI_PARTITIONS) {
    if (
      dataset.pools[partition].taskCount < minimumTasks[partition] ||
      dataset.pools[partition].componentCount <
        policy.thresholds.minIndependentGroups
    )
      rrsiFail(
        "RRSI campaign needs sufficient tasks and independent declared source groups",
      );
  }
  if (
    typeof value.sourceCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.sourceCommitSha)
  )
    rrsiFail("campaign sourceCommitSha must be an exact Git commit");
  const execution = numericRecord(
    value.execution,
    ["modelDigest", "pricingDigest", "environmentDigest", "graderDigest"],
    "execution",
    rrsiDigest,
  );
  rrsiExact(
    value.experiment,
    [
      "arms",
      "comparisons",
      "seeds",
      "perturbations",
      "familyAlpha",
      "power",
      "bootstrapSamples",
      "randomnessCommitment",
    ],
    "experiment",
  );
  const arms = uniqueList(
    value.experiment.arms,
    "experiment arms",
    3,
    3,
  ).sort();
  if (arms.join(",") !== "baseline,rrsi,rsi")
    rrsiFail("experiment requires baseline, RSI and RRSI");
  const comparisons = uniqueList(
    value.experiment.comparisons,
    "comparisons",
    2,
    32,
  ).sort();
  if (
    !comparisons.includes("rrsi-vs-baseline") ||
    !comparisons.includes("rrsi-vs-rsi")
  )
    rrsiFail("experiment must preregister both RRSI comparisons");
  const seeds = uniqueList(
    value.experiment.seeds,
    "seeds",
    3,
    32,
    (seed, label) => rrsiInteger(seed, label, 0, 0x7fffffff),
  ).sort((a, b) => a - b);
  const familyAlpha = rrsiFinite(
    value.experiment.familyAlpha,
    "family alpha",
    0.0001,
    0.05,
  );
  const bootstrapSamples = rrsiInteger(
    value.experiment.bootstrapSamples,
    "bootstrap samples",
    1000,
    2_000_000,
  );
  if ((bootstrapSamples * familyAlpha) / comparisons.length / 2 < 25)
    rrsiFail(
      "bootstrap plan has too few tail replicates for its comparison count",
    );
  const experiment = {
    arms,
    comparisons,
    seeds,
    perturbations: uniqueList(
      value.experiment.perturbations,
      "perturbations",
      1,
      8,
    ).sort(),
    familyAlpha,
    power: rrsiFinite(value.experiment.power, "planned power", 0.8, 0.99),
    bootstrapSamples,
    randomnessCommitment: rrsiDigest(
      value.experiment.randomnessCommitment,
      "randomness commitment",
    ),
  };
  rrsiExact(
    value.budget,
    [
      "totalPerArm",
      "proposalPerExploringArm",
      "selectionPerExploringArm",
      "finalEvaluationPerArm",
    ],
    "campaign budget",
  );
  const budget = Object.fromEntries(
    Object.keys(value.budget).map((key) => [
      key,
      budgetRecord(value.budget[key], key),
    ]),
  );
  for (const field of RRSI_BUDGET_FIELDS) {
    const allocated =
      budget.proposalPerExploringArm[field] +
      budget.selectionPerExploringArm[field] +
      budget.finalEvaluationPerArm[field];
    if (
      !Number.isSafeInteger(allocated) ||
      allocated > budget.totalPerArm[field]
    )
      rrsiFail(`campaign stage budgets exceed per-arm ${field}`);
  }
  const plannedFinalExecutions =
    seeds.length *
    (dataset.pools["gate-validation"].taskCount +
      dataset.pools["gate-test"].taskCount +
      dataset.pools.audit.taskCount);
  if (budget.finalEvaluationPerArm.maxExecutions < plannedFinalExecutions)
    rrsiFail("final evaluation reserve cannot cover the frozen denominator");
  const plannedSelectionExecutions =
    2 *
    policy.limits.maxSelectionQueries *
    dataset.pools.select.taskCount *
    seeds.length *
    (1 + experiment.perturbations.length);
  if (
    budget.selectionPerExploringArm.maxExecutions < plannedSelectionExecutions
  )
    rrsiFail("selection reserve cannot cover frozen baseline/candidate pairs");
  return rrsiEnvelope(RRSI_CAMPAIGN_SCHEMA, "campaignDigest", {
    campaignId: rrsiId(value.campaignId, "campaignId"),
    tenantId: rrsiId(value.tenantId, "tenantId"),
    goalId: rrsiId(value.goalId, "goalId"),
    candidateKind: kind(value.candidateKind),
    sourceCommitSha: value.sourceCommitSha,
    parentReleaseDigest: rrsiDigest(
      value.parentReleaseDigest,
      "parent release",
    ),
    anchorReleaseDigest: rrsiDigest(
      value.anchorReleaseDigest,
      "anchor release",
    ),
    policy,
    dataset,
    execution,
    experiment,
    budget,
    plannedFinalExecutionsPerArm: plannedFinalExecutions,
    plannedSelectionExecutionsPerExploringArm: plannedSelectionExecutions,
    alphaPerComparison: familyAlpha / comparisons.length,
    statisticalProtocolValidated: false,
  });
}

export function verifyRrsiCampaign(value) {
  return verifyRrsiEnvelope(
    value,
    RRSI_CAMPAIGN_SCHEMA,
    "campaignDigest",
    CAMPAIGN_KEYS,
    buildRrsiCampaign,
    [
      "plannedFinalExecutionsPerArm",
      "plannedSelectionExecutionsPerExploringArm",
      "alphaPerComparison",
      "statisticalProtocolValidated",
    ],
  );
}

function artifactPath(path, candidateKind, targetId) {
  if (
    typeof path !== "string" ||
    path.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(path)
  )
    rrsiFail("invalid artifact path");
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    rrsiFail("artifact path contains traversal or reserved segments");
  const root = candidateKind === "skill" ? "skills" : "memory-policies";
  if (
    parts.length < 3 ||
    parts[0] !== root ||
    parts[1] !== targetId ||
    !(candidateKind === "skill" ? /\.(md|json)$/u : /\.json$/u).test(path)
  )
    rrsiFail("artifact path is outside the declared candidate target");
  return path;
}

export function buildRrsiCandidate(campaignInput, input) {
  const campaign = verifyRrsiCampaign(campaignInput);
  const value = snapshotRrsiData(input);
  rrsiExact(value, CANDIDATE_KEYS, "RRSI candidate");
  if (
    value.parentReleaseDigest !== campaign.parentReleaseDigest ||
    value.kind !== campaign.candidateKind ||
    value.targetId !== campaign.goalId
  )
    rrsiFail("candidate differs from its frozen campaign");
  const sourceTaskIds = uniqueList(
    value.sourceTaskIds,
    "training source tasks",
    1,
    5000,
  ).sort();
  const allowed = new Set(
    campaign.dataset.tasks
      .filter((task) => task.partition === "train")
      .map((task) => task.id),
  );
  if (sourceTaskIds.some((id) => !allowed.has(id)))
    rrsiFail(
      "candidate source is outside the training pool",
      "CC_RRSI_DATA_LEAKAGE",
    );
  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    value.artifacts.length > campaign.policy.limits.maxChangedFiles
  )
    rrsiFail("candidate exceeds its file limit");
  const paths = new Set();
  const artifacts = value.artifacts
    .map((artifact) => {
      rrsiExact(
        artifact,
        ["path", "baseDigest", "contentDigest", "bytes", "workflowNodes"],
        "candidate artifact",
      );
      const path = artifactPath(artifact.path, value.kind, value.targetId);
      if (paths.has(path.toLowerCase()))
        rrsiFail("artifact paths collide after case folding");
      paths.add(path.toLowerCase());
      return {
        path,
        baseDigest: rrsiDigest(artifact.baseDigest, "base artifact digest"),
        contentDigest: rrsiDigest(
          artifact.contentDigest,
          "artifact content digest",
        ),
        bytes: rrsiInteger(
          artifact.bytes,
          "artifact bytes",
          1,
          campaign.policy.limits.maxArtifactBytes,
        ),
        workflowNodes: rrsiInteger(
          artifact.workflowNodes,
          "workflow nodes",
          0,
          1000,
        ),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    artifacts.reduce((total, artifact) => total + artifact.bytes, 0) >
    campaign.policy.limits.maxArtifactBytes
  )
    rrsiFail("candidate exceeds its artifact byte limit");
  const contentDigest = rrsiHash("chainlesschain.rrsi-candidate-content/v1", {
    kind: value.kind,
    targetId: value.targetId,
    artifacts: artifacts.map(({ path, contentDigest }) => ({
      path,
      contentDigest,
    })),
  });
  return rrsiEnvelope(RRSI_CANDIDATE_SCHEMA, "candidateDigest", {
    candidateId: rrsiId(value.candidateId, "candidateId"),
    parentReleaseDigest: value.parentReleaseDigest,
    kind: value.kind,
    targetId: value.targetId,
    lineageDepth: rrsiInteger(
      value.lineageDepth,
      "lineage depth",
      1,
      campaign.policy.limits.maxLineageDepth,
    ),
    sourceTaskIds,
    artifacts,
    hypothesisDigest: rrsiDigest(value.hypothesisDigest, "hypothesis digest"),
    campaignDigest: campaign.campaignDigest,
    tenantId: campaign.tenantId,
    policyDigest: campaign.policy.policyDigest,
    datasetDigest: campaign.dataset.datasetDigest,
    contentDigest,
  });
}

export function verifyRrsiCandidate(campaign, candidate) {
  return verifyRrsiEnvelope(
    candidate,
    RRSI_CANDIDATE_SCHEMA,
    "candidateDigest",
    CANDIDATE_KEYS,
    (input) => buildRrsiCandidate(campaign, input),
    [
      "campaignDigest",
      "tenantId",
      "policyDigest",
      "datasetDigest",
      "contentDigest",
    ],
  );
}
