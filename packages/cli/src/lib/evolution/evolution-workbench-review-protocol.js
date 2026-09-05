import {
  buildEvolutionWorkbenchBatchPlan,
  EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
} from "./evolution-workbench-projection.js";
import {
  verifySkillPromotionReviewDecision,
  verifySkillPromotionReviewPacketArtifact,
} from "./skill-promotion-review.js";
import {
  capturePruningData as captureData,
  pruningDigest as digest,
} from "./governed-wiki-pruning-journal.js";

export const EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA =
  "chainlesschain.evolution-workbench-batch-item-request/v1";
export const EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA =
  "chainlesschain.evolution-workbench-human-decision/v1";
export const EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA =
  "chainlesschain.evolution-workbench-batch-execution/v2";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function verifyWorkbenchBatchPlan(input, tenantId, projection = null) {
  const plan = captureData(input);
  const { planDigest, ...core } = plan;
  if (
    plan.schema !== EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA ||
    plan.tenantId !== tenantId ||
    !DIGEST.test(planDigest ?? "") ||
    digest(EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA, core) !== planDigest
  )
    throw new TypeError("Workbench batch plan is invalid");
  if (projection) {
    const rebuilt = buildEvolutionWorkbenchBatchPlan(projection, {
      packetDigests: plan.packetDigests,
      decision: plan.decision,
      reason: plan.reason,
      requestedBy: plan.requestedBy,
    });
    if (rebuilt.planDigest !== plan.planDigest)
      throw new Error("Workbench batch source projection changed");
  }
  return plan;
}

export function buildWorkbenchBatchItemRequest(plan, input) {
  const packet = verifySkillPromotionReviewPacketArtifact(input);
  if (
    packet.tenantId !== plan.tenantId ||
    packet.skillName !== plan.skillName ||
    !plan.packetDigests.includes(packet.packetDigest)
  )
    throw new Error("Workbench batch packet was substituted");
  const core = {
    schema: EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA,
    tenantId: plan.tenantId,
    planDigest: plan.planDigest,
    sourceProjectionDigest: plan.sourceProjectionDigest,
    packetDigest: packet.packetDigest,
    candidateId: packet.candidateId,
    candidateContentDigest: packet.candidateContentDigest,
    decision: plan.decision,
    reason: plan.reason,
    requestedBy: plan.requestedBy,
    requiredHumanQuorum: packet.requiredHumanQuorum,
    contentRiskDigest: packet.contentRisk.contentRiskDigest,
    contentRiskDetected: packet.contentRisk.detected,
  };
  return captureData({
    ...core,
    requestDigest: digest(EVOLUTION_WORKBENCH_BATCH_ITEM_REQUEST_SCHEMA, core),
  });
}

export function digestWorkbenchHumanDecisionResponse(core) {
  return digest(EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA, captureData(core));
}

// The binding is a separately signed envelope. Never add Workbench fields to
// the canonical Review decision or strip fields from something already signed.
export function verifyWorkbenchHumanDecisionResponse(
  input,
  request,
  packet,
  now,
) {
  const response = captureData(input);
  const keys = [
    "schema",
    "tenantId",
    "requestDigest",
    "decision",
    "responseDigest",
    "signature",
  ];
  if (
    Object.keys(response).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(response, key))
  )
    throw new TypeError("Workbench human decision envelope is invalid");
  const { responseDigest, signature, ...core } = response;
  if (
    response.schema !== EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA ||
    response.tenantId !== request.tenantId ||
    response.requestDigest !== request.requestDigest ||
    !DIGEST.test(responseDigest ?? "") ||
    digestWorkbenchHumanDecisionResponse(core) !== responseDigest ||
    typeof signature !== "string" ||
    signature.length < 32 ||
    signature.length > 16_384
  )
    throw new Error("Workbench human decision is not exactly bound");
  const decision = verifySkillPromotionReviewDecision(
    response.decision,
    packet,
    now,
  );
  if (
    decision.reason !== request.reason ||
    decision.decision !==
      (request.decision === "approve" ? "approved" : "rejected") ||
    !decision.reviewerIds.includes(request.requestedBy)
  )
    throw new Error(
      "Workbench human decision is not exactly bound to the initiating reviewer",
    );
  return response;
}

export function buildWorkbenchExecutionItem(request, response) {
  const core = {
    packetDigest: request.packetDigest,
    requestDigest: request.requestDigest,
    decisionReceiptDigest: response.decision.receiptDigest,
    humanResponseDigest: response.responseDigest,
  };
  return captureData({
    ...core,
    itemDigest: digest(
      "chainlesschain.evolution-workbench-batch-execution-item/v2",
      core,
    ),
  });
}

export function buildWorkbenchBatchExecution(plan, items) {
  const core = {
    schema: EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA,
    tenantId: plan.tenantId,
    planDigest: plan.planDigest,
    sourceProjectionDigest: plan.sourceProjectionDigest,
    items,
  };
  return captureData({
    ...core,
    executionDigest: digest(EVOLUTION_WORKBENCH_BATCH_EXECUTION_SCHEMA, core),
  });
}
