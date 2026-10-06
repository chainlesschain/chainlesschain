/** Preregistered PM variants retain original task/source identity and objective. */
import { isProxy } from "node:util/types";
import { verifyEvolutionEvalSuite } from "./evolution-eval-gate.js";
import { verifyRrsiEvaluationMapping } from "./rrsi-evaluation-adapter.js";
import { projectRrsiPmTaskReferences } from "./rrsi-pm-training-mapping.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
  freezeRrsiData,
} from "./rrsi-data.js";

export const RRSI_EVALUATION_VARIANT_MAPPING_SCHEMA =
  "chainlesschain.rrsi-evaluation-variant-mapping/v1";
export const RRSI_IDENTITY_RECIPE_DIGEST = rrsiHash(
  "chainlesschain.rrsi-identity-variant-recipe/v1",
  { operation: "identity" },
);
const MAPPINGS = new WeakSet();
const ROLES = ["gate", "selection", "audit"];

function registerPublicInput(index, publicInput, partition) {
  const digest = rrsiHash(
    "chainlesschain.rrsi-variant-public-input/v1",
    publicInput,
  );
  if (index.has(digest) && index.get(digest) !== partition)
    rrsiFail(
      "variant public input duplicates another frozen pool",
      "CC_RRSI_DATA_LEAKAGE",
    );
  index.set(digest, partition);
}

export function buildRrsiEvaluationVariantMapping(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["context", "mapping", "variant", "recipeDigest", "suites"],
    "evaluation variant mapping",
  );
  const base = verifyRrsiEvaluationMapping(value.mapping, value.context);
  if (
    !["clean", ...value.context.campaign.experiment.perturbations].includes(
      value.variant,
    )
  )
    rrsiFail("evaluation variant is not preregistered");
  if (
    !["clean", "paraphrase", "tool-order", "tool-delay"].includes(value.variant)
  )
    rrsiFail(
      "evaluation variant needs an explicit supported derivation contract",
    );
  rrsiDigest(value.recipeDigest, "variant recipe digest");
  if (
    value.variant === "clean" &&
    value.recipeDigest !== RRSI_IDENTITY_RECIPE_DIGEST
  )
    rrsiFail("clean evaluation must bind the fixed identity recipe");
  if (
    value.variant !== "clean" &&
    value.recipeDigest === RRSI_IDENTITY_RECIPE_DIGEST
  )
    rrsiFail("perturbation cannot use the clean identity recipe");
  rrsiExact(value.suites, ROLES, "variant evaluation suites");
  const publicInputs = new Map();
  for (const baseRole of base.roles) {
    const sources = new Map(
      baseRole.mappings.map((row) => [row.pmTaskId, row]),
    );
    for (const task of value.context.suites[baseRole.role].tasks)
      registerPublicInput(
        publicInputs,
        task.publicInput,
        sources.get(task.id).rrsiPartition,
      );
  }
  const roles = ROLES.map((role) => {
    const original = verifyEvolutionEvalSuite(value.context.suites[role]);
    const derived = verifyEvolutionEvalSuite(value.suites[role]);
    if (derived.datasetVersion !== original.datasetVersion)
      rrsiFail("variant changes the frozen dataset version");
    if (
      value.variant !== "paraphrase" &&
      derived.suiteDigest !== original.suiteDigest
    )
      rrsiFail("non-textual variant must retain the original Suite identity");
    const originalTasks = new Map(
      original.tasks.map((task) => [task.id, task]),
    );
    const baseRole = base.roles.find((entry) => entry.role === role);
    const sourceRows = new Map(
      baseRole.mappings.map((row) => [row.pmTaskId, row]),
    );
    if (derived.tasks.length !== original.tasks.length)
      rrsiFail("variant suite changes the frozen task denominator");
    let changedPublicInputs = 0;
    for (const task of derived.tasks) {
      const source = originalTasks.get(task.id);
      if (
        !source ||
        ["split", "taskType", "graderId", "privateExpected", "groupKeys"].some(
          (key) => rrsiCanonical(task[key]) !== rrsiCanonical(source[key]),
        )
      )
        rrsiFail(
          "variant changes task identity, source, grader or hidden objective",
          "CC_RRSI_DATA_LEAKAGE",
        );
      const changed =
        rrsiCanonical(task.publicInput) !== rrsiCanonical(source.publicInput);
      if (
        changed &&
        (task.split === "training" || value.variant !== "paraphrase")
      )
        rrsiFail(
          "variant modifies training or a non-textual variant input",
          "CC_RRSI_DATA_LEAKAGE",
        );
      if (value.variant === "paraphrase") {
        rrsiExact(task.publicInput, ["prompt"], "PM paraphrase input");
        rrsiExact(source.publicInput, ["prompt"], "original PM instruction");
      }
      if (changed) changedPublicInputs++;
      registerPublicInput(
        publicInputs,
        task.publicInput,
        sourceRows.get(task.id).rrsiPartition,
      );
    }
    if (value.variant === "paraphrase" && changedPublicInputs === 0)
      rrsiFail("paraphrase variant has no transformed evaluation input");
    const projected = projectRrsiPmTaskReferences(derived);
    // Eval v1 includes the WHOLE suite digest in its training context digest.
    // A changed holdout therefore needs a new native provenance binding even
    // though the verified original training tasks and RRSI pool are unchanged.
    return {
      role,
      baseSuiteDigest: baseRole.suiteDigest,
      suiteDigest: derived.suiteDigest,
      policyDigest: baseRole.policyDigest,
      basePmTrainingPartitionDigest: baseRole.pmTrainingPartitionDigest,
      pmTrainingPartitionDigest: projected.pmTrainingPartitionDigest,
      splitCounts: baseRole.splitCounts,
      changedPublicInputs,
      mappings: projected.tasks.map((task) => {
        const source = sourceRows.get(task.pmTaskId);
        return {
          pmTaskId: task.pmTaskId,
          split: task.split,
          pmTaskDigest: task.pmTaskDigest,
          basePmTaskDigest: source.pmTaskDigest,
          rrsiTaskId: source.rrsiTaskId,
          rrsiPartition: source.rrsiPartition,
          baseContentDigest: source.contentDigest,
          variantContentDigest: task.contentDigest,
          groups: source.groups,
        };
      }),
    };
  });
  const mapping = rrsiEnvelope(
    RRSI_EVALUATION_VARIANT_MAPPING_SCHEMA,
    "variantMappingDigest",
    {
      campaignDigest: base.campaignDigest,
      evaluationMappingDigest: base.evaluationMappingDigest,
      variant: value.variant,
      recipeDigest: value.recipeDigest,
      versions: base.versions,
      rrsiTrainingPartitionDigest: base.rrsiTrainingPartitionDigest,
      roles,
      hiddenObjectivesUnchanged: true,
      semanticEquivalenceVerified: false,
      promptLeakageReviewVerified: false,
      recipeExecutionVerified: false,
      sourceProvenanceVerified: false,
      derivationAuthenticated: false,
    },
  );
  MAPPINGS.add(mapping);
  return mapping;
}

export function verifyRrsiEvaluationVariantMapping(mapping, context) {
  const rebuilt = buildRrsiEvaluationVariantMapping(context);
  if (rrsiCanonical(snapshotRrsiData(mapping)) !== rrsiCanonical(rebuilt))
    rrsiFail(
      "variant mapping differs from frozen recipe, objective or sources",
    );
  return rebuilt;
}

/** Root-level launch aggregation must also reject collisions across variants. */
export function assertRrsiVariantSetInputIsolation(inputs) {
  const values = snapshotRrsiVariantContexts(inputs);
  const publicInputs = new Map();
  let campaignDigest = null,
    mappingDigest = null;
  for (const input of values) {
    const mapping = buildRrsiEvaluationVariantMapping(input);
    campaignDigest ??= mapping.campaignDigest;
    mappingDigest ??= mapping.evaluationMappingDigest;
    if (
      mapping.campaignDigest !== campaignDigest ||
      mapping.evaluationMappingDigest !== mappingDigest
    )
      rrsiFail("variant set belongs to different frozen campaigns or mappings");
    for (const role of mapping.roles) {
      const refs = new Map(role.mappings.map((row) => [row.pmTaskId, row]));
      for (const suite of [
        input.context.suites[role.role],
        input.suites[role.role],
      ])
        for (const task of suite.tasks)
          registerPublicInput(
            publicInputs,
            task.publicInput,
            refs.get(task.id).rrsiPartition,
          );
    }
  }
  return true; // Deterministic exact-input check only, not semantic review.
}

/** Private source contexts are bounded individually, never duplicated in plan JSON. */
export function snapshotRrsiVariantContexts(input) {
  if (
    !input ||
    isProxy(input) ||
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 1 ||
    input.length > 16 ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    rrsiFail("variant contexts must be a bounded dense list");
  return Array.from({ length: input.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(input, String(index));
    if (!field || !("value" in field))
      rrsiFail("variant contexts cannot use accessors");
    return snapshotRrsiData(field.value);
  });
}

/** The proposer receives only the unchanged base training references. */
export function projectRrsiVariantTrainingView(mapping) {
  if (!MAPPINGS.has(mapping))
    rrsiFail("a verified live variant mapping is required");
  return freezeRrsiData({
    trainingPartitionDigest: mapping.rrsiTrainingPartitionDigest,
    tasks: mapping.roles
      .find((role) => role.role === "gate")
      .mappings.filter((row) => row.split === "training")
      .map((row) => ({
        taskId: row.rrsiTaskId,
        contentDigest: row.baseContentDigest,
      })),
    sourceProvenanceVerified: false,
    qualifiesForPromotion: false,
  });
}
