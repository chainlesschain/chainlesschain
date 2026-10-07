/** Complete synthetic PM tasks across five pools; not an admitted private corpus. */
import {
  buildRrsiCampaign,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import { buildEvolutionEvalPolicy } from "../../src/lib/evolution/evolution-eval-gate.js";
import { buildPmExplorationSuite } from "../../src/lib/evolution/pm-exploration-benchmark.js";
import { projectRrsiPmTaskReferences } from "../../src/lib/evolution/rrsi-pm-training-mapping.js";
import { buildRrsiEvaluationMapping } from "../../src/lib/evolution/rrsi-evaluation-adapter.js";
import { rrsiCampaignInput, rrsiFixtureDigest } from "./rrsi-shadow-fixture.js";

export function rrsiEvaluationFixture({
  campaignOverrides = {},
  versions = null,
} = {}) {
  const pools = Object.fromEntries(
    ["train", "select", "gate-validation", "gate-test", "audit"].map(
      (partition) => [
        partition,
        Array.from({ length: partition === "train" ? 60 : 40 }, (_, index) => ({
          id: `${partition}-task-${index}`,
          groups: Object.fromEntries(
            ["template", "project", "principal", "timeWindow"].map(
              (dimension) => [
                dimension,
                `TEST ${partition}/${index}/${dimension}`,
              ],
            ),
          ),
          prompt: `TEST ONLY private ${partition} instruction ${index}`,
          expected: {
            kind: "project-state",
            id: `project-${partition}-${index}`,
            name: `TEST private ${partition} ${index}`,
            status: "completed",
          },
        })),
      ],
    ),
  );
  const training = pools.train.map((task) => ({ ...task, split: "training" }));
  const suites = {
    gate: buildPmExplorationSuite({
      suiteId: "rrsi-gate-suite",
      datasetVersion: "test-v1",
      tasks: [
        ...training,
        ...pools["gate-validation"].map((task) => ({
          ...task,
          split: "validation",
        })),
        ...pools["gate-test"].map((task) => ({ ...task, split: "test" })),
      ],
    }),
    ...Object.fromEntries(
      [
        ["selection", "select"],
        ["audit", "audit"],
      ].map(([role, partition]) => [
        role,
        buildPmExplorationSuite({
          suiteId: `rrsi-${role}-suite`,
          datasetVersion: "test-v1",
          tasks: [
            ...training,
            ...pools[partition].map((task, index) => ({
              ...task,
              split: index < 20 ? "validation" : "test",
            })),
          ],
        }),
      ]),
    ),
  };
  const sourceRefs = new Map();
  for (const [role, suite] of Object.entries(suites))
    for (const task of projectRrsiPmTaskReferences(suite).tasks) {
      const partition =
        task.split === "training"
          ? "train"
          : role === "gate"
            ? task.split === "validation"
              ? "gate-validation"
              : "gate-test"
            : role === "selection"
              ? "select"
              : "audit";
      sourceRefs.set(task.pmTaskId, {
        id: task.pmTaskId,
        partition,
        contentDigest: task.contentDigest,
        groups: task.groups,
      });
    }
  const campaign = buildRrsiCampaign({
    ...rrsiCampaignInput(),
    ...campaignOverrides,
    dataset: buildRrsiDatasetManifest({
      manifestId: "rrsi-full-five-pool-fixture",
      datasetVersion: "test-v1",
      tasks: [...sourceRefs.values()],
    }),
  });
  const policies = Object.fromEntries(
    Object.keys(suites).map((role) => [
      role,
      buildEvolutionEvalPolicy({
        policyId: `rrsi-${role}-test-policy`,
        minTrainingTasks: 30,
        minValidationTasks: 20,
        minTestTasks: 20,
        seeds: campaign.experiment.seeds,
        minimumAbsoluteImprovement: 0.05,
        minimumEfficiencyImprovement: 0.1,
        confidenceZ: 1.96,
        maxAverageTokens: 10000,
        maxAverageLatencyMs: 60000,
        maxAverageToolCalls: 100,
        maxTotalTokens: 1000000,
        maxTotalLatencyMs: 10000000,
        maxTotalToolCalls: 100000,
        maxTotalCostMicrounits: 1000000,
        maxExecutions: 1000,
        maxWallClockMs: 30000,
        portReceiptTtlMs: 60000,
        receiptTtlMs: 60000,
      }),
    ]),
  );
  versions ??= Object.fromEntries(
    campaign.experiment.arms.map((arm) => [
      arm,
      rrsiFixtureDigest(`TEST ONLY ${arm} artifact`),
    ]),
  );
  const context = { campaign, suites, policies, versions };
  return { context, mapping: buildRrsiEvaluationMapping(context), pools };
}
