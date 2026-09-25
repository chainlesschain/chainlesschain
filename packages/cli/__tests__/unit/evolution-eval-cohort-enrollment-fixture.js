import { createHash } from "node:crypto";
import { setupEvalLaunchAdmissionFixture } from "./evolution-eval-launch-admission-fixture.js";
import { buildEvolutionEvalPolicy } from "../../src/lib/evolution/evolution-eval-gate.js";
import {
  buildPmExplorationSuite,
  buildPmExplorationEffectPlan,
  buildPmExplorationEffectSlotManifest,
} from "../../src/lib/evolution/pm-exploration-benchmark.js";

export const cohortDigest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function setupEvalCohortEnrollmentFixture(options) {
  const fixture = setupEvalLaunchAdmissionFixture(options);
  const suite = buildPmExplorationSuite({
    suiteId: "pm-cohort-test",
    datasetVersion: "v1",
    tasks: ["training", "validation", "test", "test-other"].map((id) => ({
      id: `pm-${id}`,
      split: id === "test-other" ? "test" : id,
      groups: {
        template: `${id}-template`,
        project: `${id}-project`,
        principal: `${id}-principal`,
        timeWindow: `${id}-time`,
      },
      prompt: `Complete ${id} project lifecycle`,
      expected: {
        kind: "project-state",
        id: `private-${id}`,
        name: `private-name-${id}`,
        status: "completed",
      },
    })),
  });
  const policy = buildEvolutionEvalPolicy({
    policyId: "pm-cohort-test",
    minTrainingTasks: 30,
    minValidationTasks: 20,
    minTestTasks: 20,
    seeds: [101, 202, 303],
    minimumAbsoluteImprovement: 0.05,
    minimumEfficiencyImprovement: 0.1,
    confidenceZ: 1.96,
    maxAverageTokens: 10_000,
    maxAverageLatencyMs: 60_000,
    maxAverageToolCalls: 100,
    maxTotalTokens: 1_000_000,
    maxTotalLatencyMs: 10_000_000,
    maxTotalToolCalls: 100_000,
    maxTotalCostMicrounits: 1_000_000,
    maxExecutions: 240,
    maxWallClockMs: 30_000,
    portReceiptTtlMs: 60_000,
    receiptTtlMs: 60_000,
  });
  const plan = buildPmExplorationEffectPlan({
    experimentId: "pm-cohort-test",
    suite,
    policy,
    baselineVersion: {
      id: "baseline",
      artifactDigest: cohortDigest("baseline"),
    },
    candidateVersion: {
      id: "candidate",
      artifactDigest: cohortDigest("candidate"),
    },
    actorConfigDigest: cohortDigest("actor"),
    modelConfigDigest: cohortDigest("model"),
    toolPolicyDigest: cohortDigest("tools"),
    permissionPolicyDigest: cohortDigest("permissions"),
    environmentDigest: cohortDigest("environment"),
    resetProtocolDigest: cohortDigest("reset"),
    seeds: [101, 202, 303],
    budgetPerArmPerSeed: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 60_000,
      maxCostMicrounits: 100_000,
    },
    minimumPassRateDelta: 0.05,
    minimumIndependentGroups: 2,
  });
  const manifest = buildPmExplorationEffectSlotManifest({
    plan,
    cohortId: "cohort:one",
    slotIds: ["slot:one", "slot:two", "slot:three"],
  });
  const slots = manifest.slotIds.map((slotId, index) => ({
    slotId,
    evaluationPlanDigest: cohortDigest("independent-matrix-plan"),
    requestDigest:
      index === 0
        ? fixture.input.requestDigest
        : cohortDigest(`request:${slotId}`),
    policyDigest: fixture.input.policyDigest,
    evaluationAuthorityRoot: fixture.input.evaluationAuthorityRoot,
  }));
  const descriptor = Object.fromEntries(
    [
      "tenantId",
      "artifactTenantId",
      "streamId",
      "audience",
      "purpose",
      "authorityId",
      "keyId",
      "trustPolicyDigest",
    ].map((key) => [key, fixture.options.descriptor[key]]),
  );
  return {
    ...fixture,
    cohortOptions: { ...fixture.options, descriptor },
    registration: { plan, manifest, slots },
  };
}
