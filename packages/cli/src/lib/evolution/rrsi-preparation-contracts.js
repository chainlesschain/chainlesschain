/** Frozen preparation declarations; these do not authenticate a PM mapping. */
import { RRSI_BUDGET_FIELDS } from "./rrsi-contracts.js";
import {
  rrsiExact,
  rrsiId,
  rrsiDigest,
  rrsiInteger,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_PREPARATION_PLAN_SCHEMA =
  "chainlesschain.rrsi-preparation-plan/v1";
export const RRSI_PREPARATION_RESERVATION_SCHEMA =
  "chainlesschain.rrsi-preparation-reservation/v1";
export const RRSI_PREPARATION_RESERVATION_SCHEMA_V2 =
  "chainlesschain.rrsi-preparation-reservation/v2";
export function isRrsiPreparationReservation(value) {
  return (
    value.schema === RRSI_PREPARATION_RESERVATION_SCHEMA ||
    value.schema === RRSI_PREPARATION_RESERVATION_SCHEMA_V2
  );
}
export const RRSI_PREPARATION_SETTLEMENT_SCHEMA =
  "chainlesschain.rrsi-preparation-settlement/v1";
export const RRSI_PREPARATION_PHASES = Object.freeze([
  "curriculum-planning",
  "exploration",
  "candidate-proposal",
  "memory-distillation",
  "failure-retry",
  "environment-reset",
]);
export const RRSI_PREPARATION_BINDING_FIELDS = Object.freeze([
  "phase",
  "preparationPlanDigest",
  "trainingPartitionDigest",
  "trainingSourceDigest",
  "inputDigest",
  "requestDigest",
  "roundId",
  "branchId",
]);

function sources(campaign, taskIds = null) {
  const training = campaign.dataset.tasks.filter(
    (task) => task.partition === "train",
  );
  if (taskIds !== null) {
    if (!Array.isArray(taskIds) || taskIds.length < 1 || taskIds.length > 256)
      rrsiFail("preparation sources must be a bounded nonempty list");
    const allowed = new Set(training.map((task) => task.id));
    for (const id of taskIds) {
      rrsiId(id, "preparation training task ID");
      if (!allowed.has(id)) rrsiFail("preparation source is outside training");
    }
    if (new Set(taskIds).size !== taskIds.length)
      rrsiFail("preparation sources contain duplicate IDs");
  }
  // IDs and ordering are deliberately excluded from source identity.
  return training
    .filter((task) => taskIds === null || taskIds.includes(task.id))
    .map((task) => ({ contentDigest: task.contentDigest, groups: task.groups }))
    .sort((a, b) =>
      rrsiCanonical(a) < rrsiCanonical(b)
        ? -1
        : rrsiCanonical(a) > rrsiCanonical(b)
          ? 1
          : 0,
    );
}

export function rrsiTrainingSourcesDigest(campaign, taskIds = null) {
  return rrsiHash(
    "chainlesschain.rrsi-training-sources/v1",
    sources(campaign, taskIds),
  );
}

export function normalizeRrsiPreparationPlan(payload, rootCampaign) {
  rrsiExact(
    payload,
    [
      "campaignDigest",
      "maxAttempts",
      "planDigest",
      "manifestDigest",
      "trainingMappingDigest",
      "pmTrainingPartitionDigest",
    ],
    "preparation plan registration",
  );
  rrsiDigest(payload.campaignDigest, "preparation campaign digest");
  rrsiInteger(payload.maxAttempts, "preparation attempt limit", 1);
  if (
    payload.maxAttempts >
    rootCampaign.budget.proposalPerExploringArm.maxExecutions
  )
    rrsiFail("preparation attempt limit exceeds frozen proposal allocation");
  const context = Object.fromEntries(
    [
      "planDigest",
      "manifestDigest",
      "trainingMappingDigest",
      "pmTrainingPartitionDigest",
    ].map((key) => [key, rrsiDigest(payload[key], key)]),
  );
  return rrsiEnvelope(RRSI_PREPARATION_PLAN_SCHEMA, "preparationPlanDigest", {
    maxAttempts: payload.maxAttempts,
    ...context,
    trainingPartitionDigest: rootCampaign.dataset.pools.train.partitionDigest,
    trainingSourcesDigest: rrsiTrainingSourcesDigest(rootCampaign),
    executionDigest: rrsiHash(
      "chainlesschain.rrsi-execution-bindings/v1",
      rootCampaign.execution,
    ),
    mappingAuthenticated: false,
  });
}

export function normalizeRrsiPreparationRequest(payload, campaign, plan) {
  const versioned = Object.hasOwn(payload, "plannedExecutions");
  rrsiExact(
    payload,
    [
      "campaignDigest",
      "phase",
      "sourceTaskIds",
      "inputs",
      "roundId",
      "branchId",
      "slotId",
      "executionId",
      "budget",
      ...(versioned ? ["plannedExecutions"] : []),
    ],
    "preparation reservation",
  );
  if (!RRSI_PREPARATION_PHASES.includes(payload.phase))
    rrsiFail("invalid preparation phase");
  for (const key of ["roundId", "branchId", "slotId", "executionId"])
    rrsiId(payload[key], key);
  if (rrsiTrainingSourcesDigest(campaign) !== plan.trainingSourcesDigest)
    rrsiFail("preparation campaign training sources differ from frozen plan");
  const trainingSourceDigest = rrsiTrainingSourcesDigest(
    campaign,
    payload.sourceTaskIds,
  );
  rrsiExact(
    payload.inputs,
    ["instructionDigest", "memoryDigest", "artifactDigests"],
    "preparation inputs",
  );
  for (const key of ["instructionDigest", "memoryDigest"])
    rrsiDigest(payload.inputs[key], key);
  const artifacts = payload.inputs.artifactDigests;
  if (!Array.isArray(artifacts) || artifacts.length > 64)
    rrsiFail("preparation artifacts must be a bounded list");
  const artifactDigests = artifacts
    .map((entry) => rrsiDigest(entry, "input artifact digest"))
    .sort();
  if (new Set(artifactDigests).size !== artifactDigests.length)
    rrsiFail("preparation artifacts contain duplicate digests");
  const inputDigest = rrsiHash("chainlesschain.rrsi-preparation-inputs/v1", {
    instructionDigest: payload.inputs.instructionDigest,
    memoryDigest: payload.inputs.memoryDigest,
    artifactDigests,
  });
  // A new campaign/slot/round/branch/execution name cannot replay the same work.
  const requestDigest = rrsiHash("chainlesschain.rrsi-preparation-request/v1", {
    phase: payload.phase,
    trainingSourceDigest,
    inputDigest,
    preparationPlanDigest: plan.preparationPlanDigest,
    executionDigest: plan.executionDigest,
  });
  rrsiExact(payload.budget, RRSI_BUDGET_FIELDS, "preparation budget");
  const ceiling = Object.fromEntries(
    RRSI_BUDGET_FIELDS.map((key) => [
      key,
      rrsiInteger(payload.budget[key], key),
    ]),
  );
  const plannedExecutions = versioned
    ? rrsiInteger(
        payload.plannedExecutions,
        "planned preparation executions",
        1,
        64,
      )
    : 1;
  if (ceiling.maxExecutions < plannedExecutions)
    rrsiFail("preparation reservation must cover its planned executions");
  return {
    schema: versioned
      ? RRSI_PREPARATION_RESERVATION_SCHEMA_V2
      : RRSI_PREPARATION_RESERVATION_SCHEMA,
    plannedExecutions,
    budget: ceiling,
    bindings: {
      phase: payload.phase,
      preparationPlanDigest: plan.preparationPlanDigest,
      trainingPartitionDigest: campaign.dataset.pools.train.partitionDigest,
      trainingSourceDigest,
      inputDigest,
      requestDigest,
      roundId: payload.roundId,
      branchId: payload.branchId,
    },
  };
}
