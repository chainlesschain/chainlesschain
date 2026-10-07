import { createHash } from "node:crypto";
import {
  RRSI_PARTITIONS,
  RRSI_GROUP_DIMENSIONS,
  buildRrsiPolicy,
  buildRrsiDatasetManifest,
  buildRrsiCampaign,
  buildRrsiCandidate,
} from "../../src/lib/evolution/rrsi-contracts.js";

export const rrsiFixtureDigest = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

export function rrsiPolicyInput() {
  return {
    policyId: "rrsi-synthetic-policy",
    limits: {
      maxRounds: 3,
      maxCandidatesPerRound: 2,
      maxCandidates: 6,
      maxChangedFiles: 3,
      maxArtifactBytes: 16_384,
      maxLineageDepth: 3,
      maxSelectionQueries: 6,
      maxConsecutiveNoGainRounds: 2,
    },
    weights: {
      generalization: 0.25,
      cost: 0.1,
      noise: 0.25,
      history: 0.1,
      complexity: 0.1,
    },
    cost: {
      costScaleMicrounits: 100_000,
      latencyScaleMs: 1000,
      costWeight: 0.5,
      latencyWeight: 0.5,
    },
    history: {
      window: 10,
      maxOscillations: 2,
      maxRepeatedFailures: 3,
      oscillationWeight: 0.5,
      repeatedFailureWeight: 0.5,
    },
    complexity: {
      targetArtifactBytes: 4096,
      targetWorkflowNodes: 5,
      targetChangedFiles: 1,
      bytesWeight: 0.5,
      nodesWeight: 0.25,
      filesWeight: 0.25,
    },
    thresholds: {
      minimumQualityDelta: 0.05,
      minimumEfficiencyReduction: 0.1,
      maxNoiseRegression: 0.03,
      minIndependentGroups: 20,
    },
    // A fixture constant, not evidence of calibration on real developer data.
    calibrated: true,
  };
}

export function rrsiDatasetInput() {
  return {
    manifestId: "rrsi-synthetic-dataset",
    datasetVersion: "synthetic-v1",
    tasks: RRSI_PARTITIONS.flatMap((partition) =>
      Array.from({ length: partition === "train" ? 60 : 40 }, (_, index) => ({
        id: `${partition}-task-${index}`,
        partition,
        contentDigest: rrsiFixtureDigest(
          `SYNTHETIC task content ${partition} ${index}`,
        ),
        groups: Object.fromEntries(
          RRSI_GROUP_DIMENSIONS.map((dimension) => [
            dimension,
            rrsiFixtureDigest(
              `SYNTHETIC source ${dimension} ${partition} ${index}`,
            ),
          ]),
        ),
      })),
    ),
  };
}

export function rrsiCampaignInput() {
  const allocation = (
    maxTokens,
    maxToolCalls,
    maxWallClockMs,
    maxCostMicrounits,
    maxExecutions,
  ) => ({
    maxTokens,
    maxToolCalls,
    maxWallClockMs,
    maxCostMicrounits,
    maxExecutions,
  });
  return {
    campaignId: "rrsi-synthetic-campaign",
    tenantId: "synthetic-tenant",
    goalId: "pm-task-change-export",
    candidateKind: "skill",
    // Fixed fixture binding; not a claim that a deployment runs this commit.
    sourceCommitSha: "1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b",
    parentReleaseDigest: rrsiFixtureDigest(
      "SYNTHETIC parent, not a production release",
    ),
    anchorReleaseDigest: rrsiFixtureDigest(
      "SYNTHETIC anchor, not a production release",
    ),
    policy: buildRrsiPolicy(rrsiPolicyInput()),
    dataset: buildRrsiDatasetManifest(rrsiDatasetInput()),
    execution: {
      modelDigest: rrsiFixtureDigest("SYNTHETIC no model"),
      pricingDigest: rrsiFixtureDigest("SYNTHETIC no billing"),
      environmentDigest: rrsiFixtureDigest("SYNTHETIC no execution host"),
      graderDigest: rrsiFixtureDigest("SYNTHETIC no production grader"),
    },
    experiment: {
      arms: ["baseline", "rsi", "rrsi"],
      comparisons: ["rrsi-vs-rsi", "rrsi-vs-baseline"],
      seeds: [11, 22, 33],
      perturbations: ["paraphrase", "tool-order", "tool-delay"],
      familyAlpha: 0.05,
      power: 0.8,
      bootstrapSamples: 10_000,
      randomnessCommitment: rrsiFixtureDigest("SYNTHETIC planned randomness"),
    },
    budget: {
      totalPerArm: allocation(1_000_000, 10_000, 3_600_000, 5_000_000, 8000),
      proposalPerExploringArm: allocation(100_000, 1000, 600_000, 500_000, 50),
      selectionPerExploringArm: allocation(
        500_000,
        5000,
        1_800_000,
        2_500_000,
        7000,
      ),
      finalEvaluationPerArm: allocation(
        300_000,
        3000,
        1_000_000,
        1_500_000,
        400,
      ),
    },
  };
}

export function rrsiCandidateInput(campaign, candidateId = "robust-candidate") {
  return {
    candidateId,
    parentReleaseDigest: campaign.parentReleaseDigest,
    kind: "skill",
    targetId: campaign.goalId,
    lineageDepth: 1,
    sourceTaskIds: ["train-task-0"],
    artifacts: [
      {
        path: `skills/${campaign.goalId}/strategy.md`,
        baseDigest: rrsiFixtureDigest("SYNTHETIC previous strategy"),
        contentDigest: rrsiFixtureDigest(
          `SYNTHETIC proposed strategy ${candidateId}`,
        ),
        bytes: 1024,
        workflowNodes: 3,
      },
    ],
    hypothesisDigest: rrsiFixtureDigest(
      "SYNTHETIC objective result verification",
    ),
  };
}

export function rrsiObservation(candidate, overrides = {}) {
  return {
    candidateDigest: candidate.candidateDigest,
    trainDelta: 0.12,
    selectionDelta: { mean: 0.1, lower: 0.07, upper: 0.13 },
    baselineCostMicrounits: 100_000,
    candidateCostMicrounits: 95_000,
    baselineP95LatencyMs: 1000,
    candidateP95LatencyMs: 950,
    baselineTokens: 10_000,
    candidateTokens: 9000,
    baselineToolCalls: 100,
    candidateToolCalls: 90,
    wallClockMs: 60_000,
    executions: 960,
    perturbationDeltas: [
      { id: "paraphrase", mean: 0.09 },
      { id: "tool-order", mean: 0.09 },
      { id: "tool-delay", mean: 0.09 },
    ],
    history: { oscillations: 0, repeatedFailures: 0 },
    plannedSlots: 480,
    completedSlots: 480,
    independentGroups: 40,
    safetyViolations: 0,
    permissionViolations: 0,
    dataLeakage: false,
    environmentMatches: true,
    cleanupConfirmed: true,
    costComplete: true,
    ancestorPassed: true,
    ...overrides,
  };
}

/** Reproducible plumbing example; creates no genuine execution evidence. */
export function createRrsiShadowFixture() {
  const campaign = buildRrsiCampaign(rrsiCampaignInput());
  const robust = buildRrsiCandidate(campaign, rrsiCandidateInput(campaign));
  const overfit = buildRrsiCandidate(
    campaign,
    rrsiCandidateInput(campaign, "overfit-candidate"),
  );
  return {
    campaign,
    candidates: [overfit, robust],
    observations: [
      rrsiObservation(overfit, {
        trainDelta: 0.5,
        selectionDelta: { mean: -0.04, lower: -0.1, upper: 0.02 },
        perturbationDeltas: [
          { id: "paraphrase", mean: -0.05 },
          { id: "tool-order", mean: -0.05 },
          { id: "tool-delay", mean: -0.05 },
        ],
      }),
      rrsiObservation(robust),
    ],
  };
}
