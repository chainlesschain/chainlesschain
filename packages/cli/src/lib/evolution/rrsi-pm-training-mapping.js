/** Structural PM/RRSI correspondence, without dataset provenance authority. */
import { verifyEvolutionEvalSuite } from "./evolution-eval-gate.js";
import { projectPmExplorationTrainingView } from "./pm-exploration-benchmark.js";
import { verifyPmExplorationPlan } from "./pm-exploration-rounds.js";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import { rrsiTrainingSourcesDigest } from "./rrsi-preparation-contracts.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
  freezeRrsiData,
} from "./rrsi-data.js";

export const RRSI_PM_TRAINING_MAPPING_SCHEMA =
  "chainlesschain.rrsi-pm-training-mapping/v1";
const DIMENSIONS = ["template", "project", "principal", "timeWindow"];
const PREFIXES = ["template", "project", "principal", "time-window"];

/** Operator-only hash references; never supply holdout references to the proposer. */
export function projectRrsiPmTaskReferences(input) {
  const suite = verifyEvolutionEvalSuite(snapshotRrsiData(input));
  const training = projectPmExplorationTrainingView(suite);
  return freezeRrsiData({
    suiteDigest: suite.suiteDigest,
    pmTrainingPartitionDigest: training.trainingPartitionDigest,
    provenanceAuthenticated: false,
    tasks: suite.tasks
      .map((task) => ({
        pmTaskId: task.id,
        split: task.split,
        pmTaskDigest: task.taskDigest,
        // Eval taskDigest includes IDs and split. This content identity does not.
        contentDigest: rrsiHash("chainlesschain.rrsi-pm-task-content/v1", {
          taskType: task.taskType,
          publicInput: task.publicInput,
          graderId: task.graderId,
          privateExpected: task.privateExpected,
        }),
        groups: Object.fromEntries(
          DIMENSIONS.map((dimension, index) => [
            dimension,
            `sha256:${task.groupKeys[index].slice(PREFIXES[index].length + 1)}`,
          ]),
        ),
      }))
      .sort((left, right) => (left.pmTaskId < right.pmTaskId ? -1 : 1)),
  });
}

/** Preserve the original training-only envelope and digest semantics. */
export function projectRrsiPmTrainingReferences(input) {
  const projected = projectRrsiPmTaskReferences(input);
  return freezeRrsiData({
    suiteDigest: projected.suiteDigest,
    pmTrainingPartitionDigest: projected.pmTrainingPartitionDigest,
    provenanceAuthenticated: false,
    tasks: projected.tasks
      .filter((task) => task.split === "training")
      .map((task) => {
        const reference = { ...task };
        delete reference.split;
        return reference;
      }),
  });
}

export function buildRrsiPmTrainingMapping(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["campaign", "suite", "plan"], "PM training mapping input");
  const campaign = verifyRrsiCampaign(value.campaign);
  verifyPmExplorationPlan(value.plan);
  const plan = value.plan;
  const projection = projectRrsiPmTrainingReferences(value.suite);
  if (
    plan.suiteDigest !== projection.suiteDigest ||
    plan.trainingPartitionDigest !== projection.pmTrainingPartitionDigest
  )
    rrsiFail("PM plan differs from verified training suite");
  if (plan.environmentDigest !== campaign.execution.environmentDigest)
    rrsiFail("PM plan environment differs from campaign");
  if (plan.trainingTaskIds.length > 256)
    rrsiFail("PM accessible training set exceeds preparation source limit");
  const pmTasks = new Map(
    projection.tasks.map((task) => [task.pmTaskId, task]),
  );
  const rrsiTasks = new Map(
    campaign.dataset.tasks
      .filter((task) => task.partition === "train")
      .map((task) => [task.contentDigest, task]),
  );
  const mappings = [...plan.trainingTaskIds].sort().map((id) => {
    const task = pmTasks.get(id);
    if (!task) rrsiFail("PM accessible task is outside verified training");
    const source = rrsiTasks.get(task.contentDigest);
    if (!source || rrsiCanonical(source.groups) !== rrsiCanonical(task.groups))
      rrsiFail(
        "PM training content or source groups do not match RRSI training",
      );
    return { ...task, rrsiTaskId: source.id };
  });
  if (new Set(mappings.map((row) => row.rrsiTaskId)).size !== mappings.length)
    rrsiFail("PM training mapping is not one to one");
  return rrsiEnvelope(
    RRSI_PM_TRAINING_MAPPING_SCHEMA,
    "trainingMappingDigest",
    {
      campaignDigest: campaign.campaignDigest,
      suiteDigest: projection.suiteDigest,
      planDigest: plan.planDigest,
      rrsiTrainingPartitionDigest: campaign.dataset.pools.train.partitionDigest,
      pmTrainingPartitionDigest: projection.pmTrainingPartitionDigest,
      trainingSourceDigest: rrsiTrainingSourcesDigest(
        campaign,
        mappings.map((row) => row.rrsiTaskId),
      ),
      parentReleaseDigest: campaign.parentReleaseDigest,
      initialMemoryDigest: plan.initialMemoryDigest,
      mappings,
      correspondenceVerified: true,
      mappingAuthenticated: false,
      parentProvenanceVerified: false,
    },
  );
}

export function verifyRrsiPmTrainingMapping(mapping, context) {
  const normalized = buildRrsiPmTrainingMapping(context);
  if (rrsiCanonical(snapshotRrsiData(mapping)) !== rrsiCanonical(normalized))
    rrsiFail("PM training mapping or structural flags differ");
  return normalized;
}
