import { describe, expect, it, vi } from "vitest";
import { rrsiPmBridgeData } from "../fixtures/rrsi-pm-bridge.js";
import {
  rrsiDatasetInput,
  rrsiCampaignInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";
import {
  buildRrsiCampaign,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import { createPmExplorationPlan } from "../../src/lib/evolution/pm-exploration-rounds.js";
import { buildEvolutionEvalSuite } from "../../src/lib/evolution/evolution-eval-gate.js";
import {
  projectRrsiPmTrainingReferences,
  buildRrsiPmTrainingMapping,
  verifyRrsiPmTrainingMapping,
} from "../../src/lib/evolution/rrsi-pm-training-mapping.js";

function planWith(plan, overrides) {
  const input = { ...plan, ...overrides };
  delete input.schema;
  delete input.planDigest;
  return createPmExplorationPlan(input);
}
function campaignWith(campaign, dataset) {
  return buildRrsiCampaign({
    ...rrsiCampaignInput(),
    execution: campaign.execution,
    dataset: buildRrsiDatasetManifest(dataset),
  });
}

describe("RRSI PM structural training mapping", () => {
  it("retains both digest semantics and every accessible source without exposing tasks", () => {
    const data = rrsiPmBridgeData();
    expect(
      verifyRrsiPmTrainingMapping(data.mapping, {
        campaign: data.campaign,
        suite: data.suite,
        plan: data.plan,
      }),
    ).toEqual(data.mapping);
    expect(data.mapping).toMatchObject({
      correspondenceVerified: true,
      mappingAuthenticated: false,
      parentProvenanceVerified: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    expect(data.mapping.mappings).toHaveLength(2);
    expect(data.mapping.pmTrainingPartitionDigest).not.toBe(
      data.mapping.rrsiTrainingPartitionDigest,
    );
    for (const row of data.mapping.mappings) {
      expect(row.pmTaskDigest).not.toBe(row.contentDigest);
      expect(row).not.toHaveProperty("publicInput");
      expect(row).not.toHaveProperty("privateExpected");
    }
    expect(JSON.stringify(data.mapping)).not.toContain(
      "TEST ONLY complete project",
    );
    expect(Object.isFrozen(data.mapping.mappings[0].groups)).toBe(true);
  });

  it("keeps content identity across PM task renaming while retaining distinct task identities", () => {
    const data = rrsiPmBridgeData();
    const renamed = buildEvolutionEvalSuite({
      suiteId: "renamed-suite",
      datasetVersion: data.suite.datasetVersion,
      tasks: data.suite.tasks.map((task) => {
        const input = { ...task, id: `alias-${task.id}` };
        delete input.schema;
        delete input.taskDigest;
        return input;
      }),
    });
    const projection = projectRrsiPmTrainingReferences(renamed);
    expect(projection.tasks.map((task) => task.contentDigest)).toEqual(
      data.references.tasks.map((task) => task.contentDigest),
    );
    expect(projection.tasks[0].pmTaskDigest).not.toBe(
      data.references.tasks[0].pmTaskDigest,
    );
  });

  it.each(["content", "groups", "partition"])(
    "rejects mismatched RRSI training %s",
    (change) => {
      const data = rrsiPmBridgeData();
      const dataset = rrsiDatasetInput();
      data.references.tasks.forEach((task, index) => {
        dataset.tasks[index].contentDigest = task.contentDigest;
        dataset.tasks[index].groups = task.groups;
      });
      if (change === "content")
        dataset.tasks[0].contentDigest = rrsiFixtureDigest("changed content");
      if (change === "groups")
        dataset.tasks[0].groups = {
          ...dataset.tasks[0].groups,
          project: rrsiFixtureDigest("changed group"),
        };
      if (change === "partition") {
        const selected = dataset.tasks.find(
          (task) => task.partition === "select",
        );
        [selected.contentDigest, dataset.tasks[0].contentDigest] = [
          dataset.tasks[0].contentDigest,
          selected.contentDigest,
        ];
        [selected.groups, dataset.tasks[0].groups] = [
          dataset.tasks[0].groups,
          selected.groups,
        ];
      }
      const campaign = campaignWith(data.campaign, dataset);
      expect(() =>
        buildRrsiPmTrainingMapping({
          campaign,
          suite: data.suite,
          plan: data.plan,
        }),
      ).toThrow(/do not match/);
    },
  );

  it("rejects a plan with holdout-access or different suite/partition/environment bindings", () => {
    const data = rrsiPmBridgeData();
    for (const overrides of [
      { trainingTaskIds: ["pm-task-0", "pm-task-2"] },
      { suiteDigest: rrsiFixtureDigest("wrong suite") },
      { trainingPartitionDigest: rrsiFixtureDigest("wrong partition") },
      { environmentDigest: rrsiFixtureDigest("wrong environment") },
    ])
      expect(() =>
        buildRrsiPmTrainingMapping({
          campaign: data.campaign,
          suite: data.suite,
          plan: planWith(data.plan, overrides),
        }),
      ).toThrow();
  });

  it("rejects changed mapping bytes, verification flags, malformed data and accessors", () => {
    const data = rrsiPmBridgeData();
    const context = {
      campaign: data.campaign,
      suite: data.suite,
      plan: data.plan,
    };
    const changed = structuredClone(data.mapping);
    changed.mappingAuthenticated = true;
    expect(() => verifyRrsiPmTrainingMapping(changed, context)).toThrow(
      /flags differ/,
    );
    const getter = vi.fn(() => data.suite);
    const accessed = { campaign: data.campaign, plan: data.plan };
    Object.defineProperty(accessed, "suite", { get: getter, enumerable: true });
    expect(() => buildRrsiPmTrainingMapping(accessed)).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy(data.suite, {
      ownKeys: () => {
        throw new Error("proxy trap executed");
      },
    });
    expect(() => projectRrsiPmTrainingReferences(proxy)).toThrow(/plain data/);
    const stale = structuredClone(data.suite);
    stale.tasks[0].publicInput.prompt += " changed";
    expect(() => projectRrsiPmTrainingReferences(stale)).toThrow(
      /verification failed/,
    );
  });
});
