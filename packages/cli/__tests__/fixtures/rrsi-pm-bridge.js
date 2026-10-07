/** Local callback/key fixtures only. These are not production isolation evidence. */
import fs from "node:fs";
import path from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { openRrsiHistoryStore } from "./rrsi-history-store.js";
import {
  rrsiCampaignInput,
  rrsiDatasetInput,
  rrsiFixtureDigest,
} from "./rrsi-shadow-fixture.js";
import {
  buildRrsiCampaign,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import {
  buildPmExplorationSuite,
  buildPmExplorationRoundPlan,
} from "../../src/lib/evolution/pm-exploration-benchmark.js";
import { createPmExplorationJournal } from "../../src/lib/evolution/pm-exploration-rounds.js";
import {
  projectRrsiPmTrainingReferences,
  buildRrsiPmTrainingMapping,
} from "../../src/lib/evolution/rrsi-pm-training-mapping.js";
import { createRrsiPmExplorationBridge } from "../../src/lib/evolution/rrsi-pm-execution-bridge.js";
import {
  createPmExplorationReceiptSigner,
  inspectPmExplorationReceiptAuthority,
} from "../../src/lib/evolution/pm-exploration-receipts.js";
import {
  createPmExplorationRunner,
  createPmExplorationGrader,
  createPmExplorationMerger,
  createPmExplorationEvaluator,
  createPmExplorationExecutionManifest,
  createPmExplorationExecutionHost,
} from "../../src/lib/evolution/pm-exploration-execution-host.js";

export function rrsiPmBridgeData(planOverrides = {}, campaignOverrides = {}) {
  const suite = buildPmExplorationSuite({
    suiteId: "rrsi-pm-local-suite",
    datasetVersion: "test-only-v1",
    tasks: ["training", "training", "validation", "test"].map(
      (split, index) => ({
        id: `pm-task-${index}`,
        split,
        groups: Object.fromEntries(
          ["template", "project", "principal", "timeWindow"].map((key) => [
            key,
            `TEST ${split} ${index} ${key}`,
          ]),
        ),
        prompt: `TEST ONLY complete project ${index}`,
        expected: {
          kind: "project-state",
          id: `project-${index}`,
          name: `TEST project ${index}`,
          status: "completed",
        },
      }),
    ),
  });
  const references = projectRrsiPmTrainingReferences(suite);
  const dataset = rrsiDatasetInput();
  references.tasks.forEach((task, index) => {
    dataset.tasks[index].contentDigest = task.contentDigest;
    dataset.tasks[index].groups = task.groups;
  });
  const campaign = buildRrsiCampaign({
    ...rrsiCampaignInput(),
    ...campaignOverrides,
    dataset: buildRrsiDatasetManifest(dataset),
  });
  const plan = buildPmExplorationRoundPlan(suite, {
    planId: "rrsi-pm-local-plan",
    environmentDigest: campaign.execution.environmentDigest,
    initialMemoryDigest: rrsiFixtureDigest("TEST ONLY PM initial memory"),
    broadBranchIds: ["workflow", "other"],
    maxRounds: 4,
    maxTokens: 100,
    maxToolCalls: 4,
    maxWallClockMs: 10_000,
    maxConsecutiveNoGain: 2,
    ...planOverrides,
  });
  const mapping = buildRrsiPmTrainingMapping({ campaign, suite, plan });
  return { suite, campaign, plan, mapping, references };
}

export function openRrsiPmBridgeFixture(
  root,
  {
    initialize = true,
    run = null,
    grade = null,
    crashHook = null,
    planOverrides = {},
    campaignOverrides = {},
    historyStore = null,
  } = {},
) {
  const base =
    historyStore ??
    openRrsiHistoryStore(root, {
      initialize,
      crashHook,
      campaignOverrides,
    });
  const data = rrsiPmBridgeData(planOverrides, campaignOverrides);
  function signer(role) {
    const file = path.join(root, "test-control", `pm-${role}.pem`);
    if (initialize) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const keys = generateKeyPairSync("ed25519");
      fs.writeFileSync(
        file,
        keys.privateKey.export({ format: "pem", type: "pkcs8" }),
        { flag: "wx", mode: 0o600 },
      );
    }
    const privateKey = createPrivateKey(fs.readFileSync(file));
    return createPmExplorationReceiptSigner({
      role,
      authorityId: `rrsi-test-${role}`,
      revision: 1,
      handlerArtifactDigest: rrsiFixtureDigest(`TEST ONLY ${role} handler`),
      privateKey,
      publicKey: createPublicKey(privateKey),
    });
  }
  const executionSigner = signer("execution"),
    graderSigner = signer("grader"),
    mergerSigner = signer("merge"),
    evaluatorSigner = signer("evaluator");
  const calls = { run: 0, grade: 0, tool: 0 };
  const runner = createPmExplorationRunner({
    signer: executionSigner,
    run: async (request, runtime) => {
      calls.run++;
      if (run) return run(request, runtime);
      runtime.recordTokens(7);
      await runtime.invokeTool("project:get", { projectId: "test-project" });
      return {
        outputMemoryDigest: rrsiFixtureDigest(`TEST memory ${request.roundId}`),
        traceDigest: rrsiFixtureDigest(`TEST trace ${request.roundId}`),
      };
    },
  });
  const grader = createPmExplorationGrader({
    signer: graderSigner,
    grade: async (request, runtime) => {
      calls.grade++;
      if (grade) return grade(request, runtime);
      runtime.recordTokens(2);
      return {
        decision: request.executionStatus === "succeeded" ? "accept" : "unsafe",
        scoreBasisPoints: 9000,
        resultDigest: rrsiFixtureDigest(`TEST grade ${request.roundId}`),
      };
    },
  });
  const merger = createPmExplorationMerger({
    signer: mergerSigner,
    merge: async () => ({
      outputMemoryDigest: rrsiFixtureDigest("TEST merged memory"),
      conflictResolutionDigest: rrsiFixtureDigest("TEST conflicts"),
    }),
  });
  const evaluator = createPmExplorationEvaluator({
    signer: evaluatorSigner,
    evaluate: async () => ({
      decision: "accept",
      scoreBasisPoints: 9000,
      evaluationDigest: rrsiFixtureDigest("TEST evaluation"),
    }),
  });
  const manifest = createPmExplorationExecutionManifest({
    planDigest: data.plan.planDigest,
    environmentDigest: data.plan.environmentDigest,
    runner: inspectPmExplorationReceiptAuthority(executionSigner),
    grader: inspectPmExplorationReceiptAuthority(graderSigner),
    merger: inspectPmExplorationReceiptAuthority(mergerSigner),
    evaluator: inspectPmExplorationReceiptAuthority(evaluatorSigner),
    toolIds: ["project:get"],
    toolPolicyDigest: rrsiFixtureDigest("TEST ONLY PM tools"),
    preRunSealDigest: rrsiFixtureDigest("TEST ONLY PM seal"),
  });
  const host = createPmExplorationExecutionHost({
    plan: data.plan,
    manifest,
    runner,
    grader,
    merger,
    evaluator,
    invokeTool: async () => {
      calls.tool++;
      return { status: "completed" };
    },
    now: base.store.clock,
  });
  base.adapter.registerCampaign(data.campaign);
  base.adapter.registerPreparationPlan(
    base.preparationPlan({
      campaignDigest: data.campaign.campaignDigest,
      planDigest: data.plan.planDigest,
      manifestDigest: manifest.manifestDigest,
      trainingMappingDigest: data.mapping.trainingMappingDigest,
      pmTrainingPartitionDigest: data.mapping.pmTrainingPartitionDigest,
    }),
  );
  const composition = { history: base.adapter, host, ...data, manifest };
  delete composition.references;
  const bridge = createRrsiPmExplorationBridge(composition);
  return {
    ...base,
    ...data,
    host,
    manifest,
    bridge,
    calls,
    composition,
    journal: createPmExplorationJournal(data.plan),
    roundInput: (overrides = {}) => ({
      roundId: "pm-round-1",
      stage: "broad",
      branchId: "workflow",
      taskId: "pm-task-0",
      inputMemoryDigest: data.plan.initialMemoryDigest,
      slotId: "pm-slot-1",
      executionId: "pm-execution-1",
      budget: {
        maxTokens: data.plan.maxTokens,
        maxToolCalls: data.plan.maxToolCalls,
        maxWallClockMs: data.plan.maxWallClockMs,
        maxCostMicrounits: 100_000,
        maxExecutions: 2,
      },
      ...overrides,
    }),
  };
}
