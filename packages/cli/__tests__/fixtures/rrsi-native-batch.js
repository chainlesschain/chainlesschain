/** Local accounting declarations and test signatures; never real paid-budget authority. */
import { sign } from "node:crypto";
import { rrsiNativeEvaluationFixture } from "./rrsi-native-evaluation.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiFixtureDigest as digest,
} from "./rrsi-shadow-fixture.js";
import { buildRrsiCandidate } from "../../src/lib/evolution/rrsi-contracts.js";
import { buildRrsiEvaluationMapping } from "../../src/lib/evolution/rrsi-evaluation-adapter.js";
import { buildSkillTargetMatrixEvalPlan } from "../../src/lib/evolution/skill-target-matrix-eval.js";
import { buildRrsiNativeEvaluationPlan } from "../../src/lib/evolution/rrsi-native-evaluation-plan.js";
import {
  RRSI_NATIVE_SETTLEMENT_SCHEMA,
  rrsiNativeUnitCount,
} from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import { buildRrsiSettlementMessage } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";

export function rrsiNativeBatchFixture({
  stage = "selection",
  targetCount = 1,
  campaignOverrides = {},
  versions,
  cellOverrides = {},
} = {}) {
  const defaults = rrsiCampaignInput();
  const planContext = rrsiNativeEvaluationFixture({
    stage,
    targetCount,
    versions,
    cellOverrides,
    campaignOverrides: {
      budget: {
        ...defaults.budget,
        selectionPerExploringArm: {
          ...defaults.budget.selectionPerExploringArm,
          maxExecutions: 14000,
        },
        totalPerArm: { ...defaults.budget.totalPerArm, maxExecutions: 100000 },
        finalEvaluationPerArm: {
          ...defaults.budget.finalEvaluationPerArm,
          maxExecutions: 50000,
        },
      },
      ...campaignOverrides,
    },
  });
  const plan = buildRrsiNativeEvaluationPlan(planContext);
  const candidate = buildRrsiCandidate(
    planContext.context.campaign,
    rrsiCandidateInput(planContext.context.campaign),
  );
  return {
    planContext,
    candidate,
    queryId: `test-native-${stage}`,
    allocations: plan.cases.flatMap((entry) =>
      entry.slots.map((slot) => {
        const count = Object.values(
          slot.plannedObservationsPerArmByPartition,
        ).reduce((sum, amount) => sum + amount, 0);
        const executionUnits = {
          actorInvocations: count,
          gradeInvocations: count,
          safetyInvocations: count,
          resetOperations: 1,
          providerRequests: count,
        };
        return {
          cohortId: slot.cohortId,
          slotId: slot.slotId,
          byArm: Object.fromEntries(
            [entry.candidateArm, entry.baselineArm].map((arm) => [
              arm,
              {
                budget: {
                  maxTokens: 1000,
                  maxToolCalls: 10,
                  maxWallClockMs: 1000,
                  maxCostMicrounits: 1000,
                  maxExecutions: rrsiNativeUnitCount(executionUnits) + 10,
                },
                executionUnits: { ...executionUnits },
                costInventoryDigest: digest(
                  `TEST frozen owned requests ${slot.cohortId}/${slot.slotId}/${arm}`,
                ),
              },
            ]),
          ),
        };
      }),
    ),
  };
}

/** A different candidate with genuine rebuilt native plans; optionally retain stale invocation IDs. */
export function rotateNativeBatchCandidate(
  input,
  { freshInvocations = false } = {},
) {
  const value = JSON.parse(JSON.stringify(input));
  const context = value.planContext.context;
  value.candidate = buildRrsiCandidate(
    context.campaign,
    rrsiCandidateInput(context.campaign, "second-native-candidate"),
  );
  value.queryId = "second-native-query";
  context.versions.rrsi = digest("TEST second native rrsi artifact");
  value.planContext.mapping = buildRrsiEvaluationMapping(context);
  for (const variant of value.planContext.variants) {
    variant.context = context;
    variant.mapping = value.planContext.mapping;
  }
  value.planContext.nativeCases = value.planContext.nativeCases.map((entry) => {
    const fields = { ...entry.plan };
    delete fields.schema;
    delete fields.planDigest;
    fields.matrixEvalId += "-second";
    fields.nonce += "-second";
    if (entry.pairId.startsWith("rrsi-")) {
      fields.candidateId = context.versions.rrsi;
      fields.candidateContentDigest = digest("TEST second native rrsi content");
    }
    if (freshInvocations)
      fields.cells = fields.cells.map((cell) => ({
        ...cell,
        invocationId: cell.invocationId + "-second",
        invocationNonce: cell.invocationNonce + "-second",
      }));
    return { ...entry, plan: buildSkillTargetMatrixEvalPlan(fields) };
  });
  const plan = buildRrsiNativeEvaluationPlan(value.planContext);
  value.allocations = plan.cases
    .flatMap((entry) => entry.slots)
    .map((slot, index) => ({
      ...value.allocations[index],
      cohortId: slot.cohortId,
      slotId: slot.slotId,
    }));
  return value;
}

export function signNativeChildSettlement(
  value,
  child,
  privateKey,
  overrides = {},
) {
  const core = {
    schema: RRSI_NATIVE_SETTLEMENT_SCHEMA,
    receiptId: `receipt.${child.childId.slice(6)}`,
    bindings: child.bindings,
    statusByArm: Object.fromEntries(
      child.reservations.map((reservation) => [
        reservation.bindings.arm,
        "succeeded",
      ]),
    ),
    cleanupConfirmedByArm: Object.fromEntries(
      child.reservations.map((reservation) => [reservation.bindings.arm, true]),
    ),
    usageByArm: Object.fromEntries(
      child.reservations.map((reservation) => [
        reservation.bindings.arm,
        {
          tokens: 100,
          toolCalls: 1,
          wallClockMs: 100,
          costMicrounits: 100,
          executions: reservation.plannedExecutions,
        },
      ]),
    ),
    executionUnitsByArm: Object.fromEntries(
      child.reservations.map((reservation) => [
        reservation.bindings.arm,
        { ...reservation.executionUnits },
      ]),
    ),
    sourceReceiptDigests: [
      digest(`TEST full paired Eval and attributed billing ${child.childId}`),
    ],
    issuedAt: new Date(value.store.clock()).toISOString(),
    validUntil: new Date(value.store.clock() + 60000).toISOString(),
    ...overrides,
  };
  return {
    core,
    attestation: {
      ...value.settlementVerifier.descriptor,
      signature: sign(
        null,
        buildRrsiSettlementMessage(core, value.settlementVerifier.descriptor),
        privateKey,
      ).toString("base64url"),
    },
  };
}
