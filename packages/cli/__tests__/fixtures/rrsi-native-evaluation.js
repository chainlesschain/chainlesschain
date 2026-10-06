/** Synthetic native matrices and variant recipes; no signed launch/budget authority. */
import { rrsiEvaluationFixture } from "./rrsi-evaluation.js";
import {
  rrsiCampaignInput,
  rrsiFixtureDigest as digest,
} from "./rrsi-shadow-fixture.js";
import {
  buildEvolutionEvalSuite,
  buildEvolutionEvalTask,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { buildSkillTargetMatrixEvalPlan } from "../../src/lib/evolution/skill-target-matrix-eval.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  buildRrsiEvaluationVariantMapping,
  RRSI_IDENTITY_RECIPE_DIGEST,
} from "../../src/lib/evolution/rrsi-evaluation-variants.js";

export function rrsiNativeEvaluationFixture({
  stage = "generalization",
  targetCount = 1,
  fullBudget = true,
  campaignOverrides = {},
} = {}) {
  const defaults = rrsiCampaignInput();
  const value = rrsiEvaluationFixture({
    campaignOverrides: {
      ...(fullBudget
        ? {
            budget: {
              ...defaults.budget,
              totalPerArm: {
                ...defaults.budget.totalPerArm,
                maxExecutions: 10000 + 3000 * targetCount,
              },
              finalEvaluationPerArm: {
                ...defaults.budget.finalEvaluationPerArm,
                maxExecutions: 3000 * targetCount,
              },
            },
          }
        : {}),
      ...campaignOverrides,
    },
  });
  const variants = [
    "clean",
    ...value.context.campaign.experiment.perturbations,
  ].map((variant) => ({
    context: value.context,
    mapping: value.mapping,
    variant,
    recipeDigest:
      variant === "clean"
        ? RRSI_IDENTITY_RECIPE_DIGEST
        : digest(`TEST ${variant} recipe`),
    suites: Object.fromEntries(
      Object.entries(value.context.suites).map(([role, suite]) => [
        role,
        variant !== "paraphrase"
          ? suite
          : buildEvolutionEvalSuite({
              suiteId: `${suite.suiteId}-paraphrase`,
              datasetVersion: suite.datasetVersion,
              tasks: suite.tasks.map((task) => {
                if (task.split === "training") return task;
                const input = {
                  ...task,
                  publicInput: {
                    prompt: `TEST alternate instruction ${task.publicInput.prompt}`,
                  },
                };
                delete input.schema;
                delete input.taskDigest;
                return buildEvolutionEvalTask(input);
              }),
            }),
      ]),
    ),
  }));
  const roles = stage === "selection" ? ["selection"] : ["gate", "audit"];
  const dependencyLock = buildSkillDependencyLock({
    tenantId: value.context.campaign.tenantId,
    lock: { packages: { fixture: "TEST-only" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: value.context.campaign.tenantId,
    runtimes: Array.from({ length: targetCount }, (_, index) => ({
      runtimeId: `test-runtime-${index}`,
      descriptor: {
        platform: "TEST-only",
        runtime: "node-fixture",
        sandboxPolicyDigest: digest(`TEST sandbox ${index}`),
      },
    })),
  });
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: value.context.campaign.tenantId,
    dependencyLock,
    runtimeManifest,
    cells: Array.from({ length: targetCount }, (_, index) => ({
      cellId: `target-${index}`,
      runtimeId: `test-runtime-${index}`,
      targetEnvironmentRef: `test-environment-${index}`,
      environmentDigest: value.context.campaign.execution.environmentDigest,
    })),
  });
  const nativeCases = variants.flatMap((variantInput) => {
    const mapping = buildRrsiEvaluationVariantMapping(variantInput);
    return roles.flatMap((role) =>
      [
        ["rrsi-vs-rsi", "rrsi", "rsi"],
        ["rrsi-vs-baseline", "rrsi", "baseline"],
        ["rsi-vs-baseline", "rsi", "baseline"],
      ].map(([pairId, candidateArm, baselineArm]) => {
        const key = `${role}-${variantInput.variant}-${pairId}`;
        const source = mapping.roles.find((entry) => entry.role === role);
        return {
          role,
          variant: variantInput.variant,
          pairId,
          plan: buildSkillTargetMatrixEvalPlan({
            matrixEvalId: `TEST-${key}`,
            nonce: `TEST-nonce-${key}`,
            tenantId: value.context.campaign.tenantId,
            skillName: value.context.campaign.goalId,
            candidateId: value.context.versions[candidateArm],
            candidateContentDigest: digest(`TEST ${candidateArm} content`),
            baselineId: value.context.versions[baselineArm],
            baselineReleaseDigest:
              baselineArm === "baseline"
                ? value.context.campaign.parentReleaseDigest
                : null,
            expectedActiveContentDigest: digest("TEST parent content"),
            expectedActiveRevision: 1,
            dependencyLockDigest: dependencyLock.dependencyLockDigest,
            runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
            targetMatrixRoot: targetMatrix.targetMatrixRoot,
            matrixAuthorityRoot: digest(`TEST native authority ${key}`),
            maxTotalWallClockMs: 60000,
            aggregateReceiptTtlMs: 60000,
            familywiseErrorRate: 0.05,
            comparisonCorrection: "bonferroni-two-sided",
            issuedAt: "2026-10-07T00:00:00.000Z",
            expiresAt: "2026-10-07T01:00:00.000Z",
            cells: Array.from({ length: targetCount }, (_, index) => ({
              cellId: `target-${index}`,
              invocationId: `TEST-invocation-${key}-${index}`,
              invocationNonce: `TEST-invocation-nonce-${key}-${index}`,
              runtimeId: `test-runtime-${index}`,
              targetEnvironmentRef: `test-environment-${index}`,
              environmentDigest:
                value.context.campaign.execution.environmentDigest,
              suiteRef: `test-suite-${source.suiteDigest.slice(7)}`,
              suiteDigest: source.suiteDigest,
              policyDigest: source.policyDigest,
              evaluationAuthorityRoot: digest(
                `TEST ${role} ${variantInput.variant} authority`,
              ),
              provenanceAudience: "TEST-eval",
              trainerAuthority: "TEST-trainer",
              trainerRevision: "TEST-trainer-v1",
              maximumCellSettlementMs: 30000,
            })),
          }),
        };
      }),
    );
  });
  return {
    context: value.context,
    mapping: value.mapping,
    variants,
    nativeCases,
    stage,
    lifecycleDigests: Object.fromEntries(
      value.context.campaign.experiment.arms.map((arm) => [
        arm,
        digest(`TEST ${arm} lifecycle`),
      ]),
    ),
    executionContract: { dependencyLock, runtimeManifest, targetMatrix },
  };
}
