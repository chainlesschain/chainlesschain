/** Five RRSI pools over existing strict Eval Suites; no runner or signing factory. */
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import {
  verifyEvolutionEvalPolicy,
  isEvolutionEvalReceiptVerifier,
  verifyEvolutionEvalResultEvidence,
  computeEvolutionEvalContextDigest,
} from "./evolution-eval-gate.js";
import { projectRrsiPmTaskReferences } from "./rrsi-pm-training-mapping.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_EVALUATION_MAPPING_SCHEMA =
  "chainlesschain.rrsi-evaluation-mapping/v1";
export const RRSI_EVAL_ROW_EVIDENCE_SCHEMA =
  "chainlesschain.rrsi-eval-row-evidence/v1";
const ROLES = ["gate", "selection", "audit"];
const MAPPINGS = new WeakSet();
const PARTITIONS = {
  gate: { training: "train", validation: "gate-validation", test: "gate-test" },
  selection: { training: "train", validation: "select", test: "select" },
  audit: { training: "train", validation: "audit", test: "audit" },
};

/** Selection and audit use disjoint whole components within their own pool. */
export function buildRrsiEvaluationMapping(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["campaign", "suites", "policies", "versions"],
    "five-pool mapping input",
  );
  const campaign = verifyRrsiCampaign(value.campaign);
  rrsiExact(
    value.versions,
    campaign.experiment.arms,
    "frozen evaluation arm artifacts",
  );
  for (const arm of campaign.experiment.arms)
    rrsiDigest(value.versions[arm], `${arm} evaluation artifact`);
  rrsiExact(value.suites, ROLES, "independent evaluation suites");
  rrsiExact(value.policies, ROLES, "frozen evaluation policies");
  const sources = new Map(
    campaign.dataset.tasks.map((task) => [task.contentDigest, task]),
  );
  const roles = ROLES.map((role) => {
    const projection = projectRrsiPmTaskReferences(value.suites[role]);
    const policy = verifyEvolutionEvalPolicy(value.policies[role]);
    if (
      rrsiCanonical([...policy.seeds].sort((a, b) => a - b)) !==
      rrsiCanonical(campaign.experiment.seeds)
    )
      rrsiFail("Eval repeats differ from the frozen RRSI denominator");
    const counts = Object.fromEntries(
      ["training", "validation", "test"].map((split) => [
        split,
        projection.tasks.filter((task) => task.split === split).length,
      ]),
    );
    for (const [split, field, floor] of [
      ["training", "minTrainingTasks", 30],
      ["validation", "minValidationTasks", 20],
      ["test", "minTestTasks", 20],
    ])
      if (counts[split] < Math.max(floor, policy[field]))
        rrsiFail("Eval Suite does not satisfy the original sample floors");
    const mappings = projection.tasks.map((task) => {
      const source = sources.get(task.contentDigest);
      if (
        !source ||
        source.partition !== PARTITIONS[role][task.split] ||
        rrsiCanonical(source.groups) !== rrsiCanonical(task.groups)
      )
        rrsiFail(
          "Eval task content, source or pool differs from RRSI",
          "CC_RRSI_DATA_LEAKAGE",
        );
      return {
        ...task,
        rrsiTaskId: source.id,
        rrsiPartition: source.partition,
      };
    });
    if (new Set(mappings.map((row) => row.rrsiTaskId)).size !== mappings.length)
      rrsiFail("evaluation suite maps multiple aliases to one RRSI task");
    const expectedPartitions = new Set(Object.values(PARTITIONS[role]));
    const expectedIds = campaign.dataset.tasks
      .filter((task) => expectedPartitions.has(task.partition))
      .map((task) => task.id)
      .sort();
    if (
      rrsiCanonical(mappings.map((row) => row.rrsiTaskId).sort()) !==
      rrsiCanonical(expectedIds)
    )
      rrsiFail("evaluation mapping omits part of the frozen pool denominator");
    return {
      role,
      suiteDigest: projection.suiteDigest,
      policyDigest: policy.policyDigest,
      pmTrainingPartitionDigest: projection.pmTrainingPartitionDigest,
      splitCounts: counts,
      mappings,
    };
  });
  const mapping = rrsiEnvelope(
    RRSI_EVALUATION_MAPPING_SCHEMA,
    "evaluationMappingDigest",
    {
      campaignDigest: campaign.campaignDigest,
      datasetDigest: campaign.dataset.datasetDigest,
      versions: value.versions,
      rrsiTrainingPartitionDigest: campaign.dataset.pools.train.partitionDigest,
      roles,
      sourceProvenanceVerified: false,
      independentExecutionContextsVerified: false,
      mappingAuthenticated: false,
    },
  );
  MAPPINGS.add(mapping);
  return mapping;
}

export function verifyRrsiEvaluationMapping(mapping, context) {
  const rebuilt = buildRrsiEvaluationMapping(context);
  if (rrsiCanonical(snapshotRrsiData(mapping)) !== rrsiCanonical(rebuilt))
    rrsiFail("five-pool mapping differs from frozen sources or policy");
  return rebuilt;
}

/** Explicit training-only data plane. Selection/Gate/audit summaries are absent. */
export function projectRrsiEvaluationTrainingView(input) {
  if (!MAPPINGS.has(input))
    rrsiFail("training projection requires a verified evaluation mapping");
  const mapping = snapshotRrsiData(input);
  if (mapping.schema !== RRSI_EVALUATION_MAPPING_SCHEMA)
    rrsiFail("unknown evaluation mapping schema");
  const gate = mapping.roles.find((role) => role.role === "gate");
  if (!gate) rrsiFail("evaluation mapping has no gate training view");
  return freezeRrsiData({
    trainingPartitionDigest: mapping.rrsiTrainingPartitionDigest,
    tasks: gate.mappings
      .filter((row) => row.rrsiPartition === "train")
      .map((row) => ({
        taskId: row.rrsiTaskId,
        contentDigest: row.contentDigest,
      })),
    sourceProvenanceVerified: false,
    qualifiesForPromotion: false,
  });
}

/** Authenticate raw rows through the existing branded final-receipt verifier. */
export async function collectRrsiEvalRowEvidence(verifier, input) {
  if (!isEvolutionEvalReceiptVerifier(verifier))
    rrsiFail("RRSI evaluation requires the existing branded Eval verifier");
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    [
      "context",
      "mapping",
      "role",
      "bundle",
      "expectedReceipt",
      "evaluationContext",
      "armBindings",
    ],
    "RRSI signed row collection",
  );
  const mapping = verifyRrsiEvaluationMapping(value.mapping, value.context);
  if (
    value.evaluationContext.planDigest !== mapping.evaluationMappingDigest ||
    computeEvolutionEvalContextDigest(value.evaluationContext) !==
      value.expectedReceipt.evaluationContextDigest
  )
    rrsiFail("Eval run context was not bound to the frozen RRSI mapping");
  const role = mapping.roles.find((entry) => entry.role === value.role);
  if (!role) rrsiFail("unknown evaluation evidence role");
  rrsiExact(
    value.armBindings,
    ["baseline", "candidate"],
    "paired Eval arm binding",
  );
  if (
    !Object.values(value.armBindings).every((arm) =>
      ["baseline", "rsi", "rrsi"].includes(arm),
    ) ||
    value.armBindings.baseline === value.armBindings.candidate
  )
    rrsiFail("Eval evidence requires two different preregistered arms");
  rrsiExact(
    value.bundle,
    ["receipt", "resultEvidence", "suite", "policy"],
    "existing Eval evidence bundle",
  );
  if (
    value.bundle.suite.suiteDigest !== role.suiteDigest ||
    value.bundle.policy.policyDigest !== role.policyDigest
  )
    rrsiFail("signed Eval evidence differs from frozen five-pool mapping");
  if (
    value.bundle.receipt.baselineId !==
      mapping.versions[value.armBindings.baseline] ||
    value.bundle.receipt.candidateId !==
      mapping.versions[value.armBindings.candidate] ||
    value.bundle.receipt.environmentDigest !==
      value.context.campaign.execution.environmentDigest ||
    value.bundle.receipt.tenantId !== value.context.campaign.tenantId ||
    value.bundle.receipt.trainingPartitionDigest !==
      role.pmTrainingPartitionDigest
  )
    rrsiFail(
      "signed Eval arms, tenant, environment or training binding differ",
    );
  const evidence = await verifyEvolutionEvalResultEvidence(
    verifier,
    value.bundle,
    value.expectedReceipt,
  );
  const indexed = new Map(role.mappings.map((row) => [row.pmTaskDigest, row]));
  const rows = ["validation", "test"].flatMap((split) =>
    ["baseline", "candidate"].flatMap((arm) =>
      evidence[split][arm].map((row) => {
        const task = indexed.get(row.taskDigest);
        if (!task || task.split !== split)
          rrsiFail("signed row has foreign task mapping");
        return {
          rrsiTaskId: task.rrsiTaskId,
          rrsiPartition: task.rrsiPartition,
          pmTaskDigest: row.taskDigest,
          seed: row.seed,
          arm: value.armBindings[arm],
          versionDigest: mapping.versions[value.armBindings[arm]],
          reportedPass: row.pass,
          strictPass:
            row.pass &&
            row.securityViolations === 0 &&
            row.permissionViolations === 0,
          securityViolations: row.securityViolations,
          permissionViolations: row.permissionViolations,
          executionDigest: row.executionDigest,
          gradeDigest: row.gradeDigest,
          safetyDigest: row.safetyDigest,
          metrics: row.metrics,
          rowDigest: rrsiHash("chainlesschain.rrsi-signed-eval-row/v1", row),
        };
      }),
    ),
  );
  return rrsiEnvelope(RRSI_EVAL_ROW_EVIDENCE_SCHEMA, "rowEvidenceDigest", {
    evaluationMappingDigest: mapping.evaluationMappingDigest,
    role: role.role,
    finalReceiptDigest: evidence.receiptDigest,
    rows,
    finalReceiptRowsAuthenticated: true,
    runContextBoundToMapping: true,
    ledgerReservationVerified: false,
    armLifecycleVerified: false,
    perturbationIdentityVerified: false,
    launchSlotVerified: false,
    underlyingExecutionReceiptsReverified: false,
    sourceProvenanceVerified: false,
    completeLifecycleCostVerified: false,
    cleanupReverified: false,
    qualityVerdictVerified: false,
  });
}
