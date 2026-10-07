import { describe, expect, it, vi } from "vitest";
import {
  buildRrsiPolicy,
  verifyRrsiPolicy,
  buildRrsiDatasetManifest,
  verifyRrsiDatasetManifest,
  buildRrsiCampaign,
  verifyRrsiCampaign,
  buildRrsiCandidate,
  verifyRrsiCandidate,
  projectRrsiTrainingView,
  RrsiContractError,
} from "../../src/lib/evolution/rrsi-contracts.js";
import {
  rrsiPolicyInput,
  rrsiDatasetInput,
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";

const clone = (value) => structuredClone(value);

describe("RRSI frozen planning contracts", () => {
  it("detaches and deeply freezes policy inputs without creating authority", () => {
    const input = rrsiPolicyInput();
    const policy = buildRrsiPolicy(input);
    input.weights.cost = 99;
    expect(policy.weights.cost).toBe(0.1);
    expect(Object.isFrozen(policy.weights)).toBe(true);
    expect(verifyRrsiPolicy(JSON.parse(JSON.stringify(policy)))).toEqual(
      policy,
    );
    expect(policy).toMatchObject({
      structuralOnly: true,
      authenticated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
  });

  it.each(["authenticated", "readyForExecution", "qualifiesForPromotion"])(
    "rejects forged %s flags",
    (key) => {
      const value = clone(buildRrsiPolicy(rrsiPolicyInput()));
      value[key] = true;
      expect(() => verifyRrsiPolicy(value)).toThrow(RrsiContractError);
    },
  );

  it.each([0, -1, Infinity, NaN, -0, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid positive budget scale %s",
    (number) => {
      const input = rrsiPolicyInput();
      input.cost.costScaleMicrounits = number;
      expect(() => buildRrsiPolicy(input)).toThrow(RrsiContractError);
    },
  );

  it("rejects getters and proxies without running input code", () => {
    const getter = vi.fn();
    const input = rrsiPolicyInput();
    Object.defineProperty(input, "policyId", { get: getter, enumerable: true });
    expect(() => buildRrsiPolicy(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn();
    expect(() => buildRrsiPolicy(new Proxy({}, { ownKeys: trap }))).toThrow();
    expect(trap).not.toHaveBeenCalled();
  });

  it.each([
    (input) => {
      input.extra = input;
    },
    (input) => {
      input.extra = () => {};
    },
    (input) => {
      input[Symbol("hidden")] = 1;
    },
    (input) => {
      Object.defineProperty(input, "extra", { value: 1 });
    },
    (input) => {
      Object.setPrototypeOf(input, null);
    },
    (input) => {
      input.extra = new Date();
    },
    (input) => {
      input.extra = new Array(2);
    },
    (input) => {
      const entries = [1];
      entries.extra = 1;
      input.extra = entries;
    },
    (input) => {
      input.extra = "x".repeat(8193);
    },
  ])("rejects hostile or ambiguous plain-data shape %#", (mutate) => {
    const input = rrsiPolicyInput();
    mutate(input);
    expect(() => buildRrsiPolicy(input)).toThrow(RrsiContractError);
  });

  it("rejects excessive nesting and arrays before normalization", () => {
    const input = rrsiPolicyInput();
    let nested = {};
    for (let index = 0; index < 20; index++) nested = { nested };
    input.extra = nested;
    expect(() => buildRrsiPolicy(input)).toThrow(/structural limits/);
    input.extra = Array.from({ length: 5001 }, () => 1);
    expect(() => buildRrsiPolicy(input)).toThrow(/array exceeds/);
  });

  it("counts transitive source components rather than repeated tasks", () => {
    const input = rrsiDatasetInput();
    const train = input.tasks.filter((task) => task.partition === "train");
    train[1].groups.template = train[0].groups.template;
    train[2].groups.project = train[1].groups.project;
    const dataset = buildRrsiDatasetManifest(input);
    expect(dataset.pools.train).toMatchObject({
      taskCount: 60,
      componentCount: 58,
    });
    expect(
      verifyRrsiDatasetManifest(JSON.parse(JSON.stringify(dataset))),
    ).toEqual(dataset);
    input.tasks.reverse();
    expect(buildRrsiDatasetManifest(input).datasetDigest).toBe(
      dataset.datasetDigest,
    );
  });

  it.each(["template", "project", "principal", "timeWindow"])(
    "rejects cross-pool overlap in %s",
    (dimension) => {
      const input = rrsiDatasetInput();
      input.tasks.find((task) => task.partition === "audit").groups[dimension] =
        input.tasks[0].groups[dimension];
      expect(() => buildRrsiDatasetManifest(input)).toThrow(/crosses/);
    },
  );

  it("rejects copied task content even under a new ID and source claims", () => {
    const input = rrsiDatasetInput();
    input.tasks.at(-1).contentDigest = input.tasks[0].contentDigest;
    expect(() => buildRrsiDatasetManifest(input)).toThrow(/duplicate task/);
  });

  it("projects only training refs without hidden task IDs or source groups", () => {
    const view = projectRrsiTrainingView(
      buildRrsiDatasetManifest(rrsiDatasetInput()),
    );
    expect(view.tasks).toHaveLength(60);
    expect(view.tasks.every((task) => task.id.startsWith("train-"))).toBe(true);
    expect(Object.keys(view.tasks[0]).sort()).toEqual(["contentDigest", "id"]);
    expect(JSON.stringify(view)).not.toContain("gate-test-task");
    expect(view.sourceMetadataAuthenticated).toBe(false);
  });

  it("freezes equal three-arm budgets, comparison alpha and perturbation reserves", () => {
    const campaign = buildRrsiCampaign(rrsiCampaignInput());
    expect(campaign.alphaPerComparison).toBe(0.025);
    expect(campaign.plannedFinalExecutionsPerArm).toBe(360);
    expect(campaign.plannedSelectionExecutionsPerExploringArm).toBe(5760);
    expect(campaign.statisticalProtocolValidated).toBe(false);
    expect(verifyRrsiCampaign(JSON.parse(JSON.stringify(campaign)))).toEqual(
      campaign,
    );
  });

  it.each([
    (input) => {
      input.budget.selectionPerExploringArm.maxTokens =
        input.budget.totalPerArm.maxTokens;
    },
    (input) => {
      input.budget.finalEvaluationPerArm.maxExecutions = 359;
    },
    (input) => {
      input.budget.selectionPerExploringArm.maxExecutions = 2000;
    },
    (input) => {
      input.experiment.comparisons = ["rrsi-vs-rsi", "invented-comparison"];
    },
    (input) => {
      input.experiment.seeds = [1, 1, 2];
    },
    (input) => {
      input.experiment.bootstrapSamples = 1000;
    },
    (input) => {
      input.experiment.familyAlpha = 0.1;
    },
    (input) => {
      input.sourceCommitSha = "1de6f0f8d0";
    },
  ])("rejects an inconsistent frozen campaign %#", (mutate) => {
    const input = rrsiCampaignInput();
    mutate(input);
    expect(() => buildRrsiCampaign(input)).toThrow(RrsiContractError);
  });

  it("rejects unsafe arithmetic across stage allocations", () => {
    const input = rrsiCampaignInput();
    for (const stage of Object.values(input.budget))
      stage.maxTokens = Number.MAX_SAFE_INTEGER;
    expect(() => buildRrsiCampaign(input)).toThrow(/stage budgets/);
  });

  it("does not mistake many repeated tasks for independent source groups", () => {
    const input = rrsiDatasetInput();
    const select = input.tasks.filter((task) => task.partition === "select");
    for (const task of select) task.groups.template = select[0].groups.template;
    const campaign = rrsiCampaignInput();
    campaign.dataset = buildRrsiDatasetManifest(input);
    expect(() => buildRrsiCampaign(campaign)).toThrow(/independent declared/);
  });

  it("binds candidates to campaign and only permits training sources", () => {
    const campaign = buildRrsiCampaign(rrsiCampaignInput());
    const input = rrsiCandidateInput(campaign);
    const candidate = buildRrsiCandidate(campaign, input);
    expect(verifyRrsiCandidate(campaign, candidate)).toEqual(candidate);
    input.sourceTaskIds = ["audit-task-0"];
    expect(() => buildRrsiCandidate(campaign, input)).toThrow(/training pool/);
    input.sourceTaskIds = ["train-task-0"];
    input.parentReleaseDigest = rrsiFixtureDigest("other parent");
    expect(() => buildRrsiCandidate(campaign, input)).toThrow(
      /frozen campaign/,
    );
  });

  it.each([
    "../grader.js",
    "C:/grader.json",
    "//server/share.json",
    "skills/pm-task-change-export/../grader.json",
    "skills/pm-task-change-export/strategy.md:stream",
    "skills/pm-task-change-export/sub./strategy.md",
    "skills/pm-task-change-export/NUL.json",
    "skills/pm-task-change-export/runtime.js",
    "skills/other-skill/strategy.md",
  ])("rejects an out-of-scope or aliased artifact path %s", (path) => {
    const campaign = buildRrsiCampaign(rrsiCampaignInput());
    const input = rrsiCandidateInput(campaign);
    input.artifacts[0].path = path;
    expect(() => buildRrsiCandidate(campaign, input)).toThrow(
      RrsiContractError,
    );
  });

  it("rejects case-colliding artifacts and total artifact size overflow", () => {
    const campaign = buildRrsiCampaign(rrsiCampaignInput());
    const input = rrsiCandidateInput(campaign);
    input.artifacts.push({
      ...input.artifacts[0],
      path: "skills/pm-task-change-export/STRATEGY.md",
    });
    expect(() => buildRrsiCandidate(campaign, input)).toThrow(/collide/);
    input.artifacts[1].path = "skills/pm-task-change-export/extra.md";
    input.artifacts.forEach((artifact) => {
      artifact.bytes = 10_000;
    });
    expect(() => buildRrsiCandidate(campaign, input)).toThrow(/byte limit/);
  });

  it("uses content identity independent of IDs, hypothesis and size assertions", () => {
    const campaign = buildRrsiCampaign(rrsiCampaignInput());
    const input = rrsiCandidateInput(campaign);
    const first = buildRrsiCandidate(campaign, input);
    input.candidateId = "renamed-candidate";
    input.hypothesisDigest = rrsiFixtureDigest("new hypothesis");
    input.artifacts[0].bytes++;
    input.artifacts[0].workflowNodes++;
    const second = buildRrsiCandidate(campaign, input);
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(second.candidateDigest).not.toBe(first.candidateDigest);
  });
});
