import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  rrsiCampaignInput,
  rrsiDatasetInput,
  rrsiFixtureDigest as digest,
} from "../fixtures/rrsi-shadow-fixture.js";
import {
  rrsiNativeBatchFixture,
  rotateNativeBatchCandidate,
} from "../fixtures/rrsi-native-batch.js";
import { rrsiStatisticsFixture } from "../fixtures/rrsi-group-statistics.js";
import {
  buildRrsiCampaign,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import { buildRrsiNativeEvaluationBatch } from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import {
  buildRrsiNativeStatisticsScopeProtocol,
  verifyRrsiNativeStatisticsScopeProtocol,
  assertRrsiNativeStatisticsScopeBatch,
  normalizeRrsiNativeStatisticsExecutionContract,
} from "../../src/lib/evolution/rrsi-native-statistics-protocol.js";
import {
  buildRrsiNativeGroupStatisticsPlan,
  verifyRrsiNativeGroupStatisticsPlan,
} from "../../src/lib/evolution/rrsi-native-group-statistics-plan.js";
import {
  buildRrsiNativeGroupStatisticsPlan as compatibilityBuild,
  analyzeRrsiNativeGroupStatistics,
} from "../../src/lib/evolution/rrsi-native-group-statistics.js";
import {
  buildRrsiGroupStatisticsPlan,
  analyzeRrsiGroupStatistics,
} from "../../src/lib/evolution/rrsi-group-statistics.js";
import {
  rrsiCanonical,
  rrsiEnvelope,
  snapshotRrsiData,
} from "../../src/lib/evolution/rrsi-data.js";

const sha = (value) =>
  createHash("sha256").update(rrsiCanonical(value)).digest("hex");
const campaignInput = (campaign, overrides = {}) => ({
  ...Object.fromEntries(
    Object.keys(rrsiCampaignInput()).map((field) => [field, campaign[field]]),
  ),
  ...overrides,
});

// Only campaign and execution manifests: no candidate, native plan or batch.
function beforePreparation({ targetCount = 1, overrides = {} } = {}) {
  const campaign = buildRrsiCampaign({ ...rrsiCampaignInput(), ...overrides });
  const dependencyLock = buildSkillDependencyLock({
    tenantId: campaign.tenantId,
    lock: { packages: { fixture: "TEST-only" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: campaign.tenantId,
    runtimes: Array.from({ length: targetCount }, (_, index) => ({
      runtimeId: `test-runtime-${index}`,
      descriptor: { platform: "TEST-only", runtime: "node-fixture" },
    })),
  });
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: campaign.tenantId,
    dependencyLock,
    runtimeManifest,
    cells: Array.from({ length: targetCount }, (_, index) => ({
      cellId: `target-${index}`,
      runtimeId: `test-runtime-${index}`,
      targetEnvironmentRef: `test-environment-${index}`,
      environmentDigest: campaign.execution.environmentDigest,
    })),
  });
  return {
    campaign,
    execution: { dependencyLock, runtimeManifest, targetMatrix },
  };
}

describe("candidate-independent native statistics scope", () => {
  let raw, campaign, batch, context, protocol;
  beforeAll(() => {
    raw = rrsiNativeBatchFixture();
    campaign = raw.planContext.context.campaign;
    batch = buildRrsiNativeEvaluationBatch(raw);
    context = { campaign, execution: raw.planContext.executionContract };
    protocol = buildRrsiNativeStatisticsScopeProtocol(context);
  }, 120000);

  it("builds before preparation and freezes all stage families without claiming authority", () => {
    const input = beforePreparation();
    const value = buildRrsiNativeStatisticsScopeProtocol(input);
    expect(value).toMatchObject({
      maxBootstrapSamples: 1000000,
      maxResampleOperations: 50000000,
      fixedPairReplicasPerTaskSeedArm: 2,
      decision: "HOLD",
      authenticated: false,
      preObservationRegistrationVerified: false,
      statisticalProtocolValidated: false,
      readyForExecution: false,
    });
    expect(value.campaignScope).not.toHaveProperty("campaignId");
    expect(value).not.toHaveProperty("candidate");
    expect(value).not.toHaveProperty("batchDigest");
    expect(Object.keys(value.stages)).toEqual([
      "training",
      "selection",
      "generalization",
    ]);
    expect(value.stages.training.hypothesisCount).toBe(2);
    expect(value.stages.selection.hypothesisCount).toBe(8);
    expect(value.stages.generalization.hypothesisCount).toBe(24);
    expect(value.stages.generalization).toMatchObject({
      bootstrapTailResolutionSufficient: false,
      blockingReasons: ["INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION"],
      decision: "HOLD",
    });
    expect(
      Object.isFrozen(value.stages.generalization.pools[0].components),
    ).toBe(true);
    expect(verifyRrsiNativeStatisticsScopeProtocol(value, input)).toEqual(
      value,
    );
  });

  it("binds every target into hypotheses and work, without adding independent groups", () => {
    const one = buildRrsiNativeStatisticsScopeProtocol(beforePreparation());
    const two = buildRrsiNativeStatisticsScopeProtocol(
      beforePreparation({ targetCount: 2 }),
    );
    for (const stage of Object.keys(one.stages)) {
      expect(two.stages[stage].pools).toEqual(one.stages[stage].pools);
      expect(two.stages[stage].hypothesisCount).toBe(
        2 * one.stages[stage].hypothesisCount,
      );
      expect(two.stages[stage].resampleOperations).toBe(
        2 * one.stages[stage].resampleOperations,
      );
      expect(two.stages[stage].alphaPerHypothesis).toBe(
        one.stages[stage].alphaPerHypothesis / 2,
      );
    }
    expect(two.stages.generalization.hypothesisCount).toBe(48);
    expect(() =>
      buildRrsiNativeStatisticsScopeProtocol(
        beforePreparation({ targetCount: 6 }),
      ),
    ).toThrow(/generalization family exceeds resampling operation limit/);
  });

  it("rejects future-stage operation overflow and interval kernel overflow before preparation", () => {
    for (const [bootstrapSamples, message] of [
      [60000, /generalization family exceeds resampling operation limit/],
      [1000001, /interval kernel bound/],
    ]) {
      const input = beforePreparation({
        overrides: {
          experiment: { ...rrsiCampaignInput().experiment, bootstrapSamples },
        },
      });
      expect(() => buildRrsiNativeStatisticsScopeProtocol(input)).toThrow(
        message,
      );
    }
  });

  it("reuses the original transitive source components and fixed task weights", () => {
    const dataset = rrsiDatasetInput();
    const selected = dataset.tasks.filter(
      (task) => task.partition === "select",
    );
    selected[1].groups.template = selected[0].groups.template;
    selected[2].groups.project = selected[1].groups.project;
    const input = beforePreparation({
      overrides: { dataset: buildRrsiDatasetManifest(dataset) },
    });
    const scope = buildRrsiNativeStatisticsScopeProtocol(input);
    const legacy = buildRrsiGroupStatisticsPlan({
      campaign: input.campaign,
      stage: "selection",
      versions: Object.fromEntries(
        input.campaign.experiment.arms.map((arm) => [arm, digest(arm)]),
      ),
    });
    expect(scope.stages.selection.pools).toEqual(legacy.pools);
    expect(
      scope.stages.selection.pools[0].components.find(
        (group) => group.taskCount === 3,
      ).weight,
    ).toBe(3 / 40);
  });

  it("rejects recomputed protocol envelopes with changed methods, caps or scientific design", () => {
    const mutations = [
      (v) => {
        v.aggregationMethod += "-changed";
      },
      (v) => {
        v.successDefinition += "-changed";
      },
      (v) => {
        v.fixedPairReplicasPerTaskSeedArm = 1;
      },
      (v) => {
        v.maxResampleOperations++;
      },
      (v) => {
        v.maxBootstrapSamples++;
      },
      (v) => {
        v.randomnessCommitment = digest("other seed commitment");
      },
      (v) => {
        v.execution.targets = [];
      },
      (v) => {
        v.stages.generalization.comparisons.pop();
      },
      (v) => {
        v.stages.generalization.familyAlpha /= 2;
      },
      (v) => {
        v.stages.generalization.bootstrapSamples++;
      },
      (v) => {
        v.stages.generalization.pools[0].components[0].weight *= 2;
      },
      (v) => {
        v.preObservationRegistrationVerified = true;
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(protocol);
      mutate(changed);
      const schema = changed.schema;
      const core = { ...changed };
      delete core.schema;
      delete core.protocolDigest;
      const rehashed = rrsiEnvelope(schema, "protocolDigest", core);
      expect(() =>
        verifyRrsiNativeStatisticsScopeProtocol(rehashed, context),
      ).toThrow(/protocol differs/);
      expect(() =>
        assertRrsiNativeStatisticsScopeBatch(rehashed, { campaign, batch }),
      ).toThrow(/scope protocol/);
    }
  });

  it("permits campaign aliases but rejects metadata and execution resets", () => {
    const alias = buildRrsiCampaign(
      campaignInput(campaign, { campaignId: "another-campaign" }),
    );
    expect(
      buildRrsiNativeStatisticsScopeProtocol({ ...context, campaign: alias }),
    ).toEqual(protocol);
    const changedCampaign = buildRrsiCampaign(
      campaignInput(campaign, {
        experiment: {
          ...campaign.experiment,
          randomnessCommitment: digest("new campaign cannot reset seed"),
        },
      }),
    );
    expect(() =>
      verifyRrsiNativeStatisticsScopeProtocol(protocol, {
        ...context,
        campaign: changedCampaign,
      }),
    ).toThrow(/protocol differs/);
    const otherExecution = beforePreparation({ targetCount: 2 }).execution;
    expect(() =>
      verifyRrsiNativeStatisticsScopeProtocol(protocol, {
        campaign,
        execution: otherExecution,
      }),
    ).toThrow(/protocol differs/);
    const otherScope = buildRrsiNativeStatisticsScopeProtocol({
      campaign,
      execution: otherExecution,
    });
    expect(() =>
      assertRrsiNativeStatisticsScopeBatch(otherScope, { campaign, batch }),
    ).toThrow(/scope protocol/);
  });

  it("allows a new candidate and native plan per query while retaining the scope", () => {
    const original = assertRrsiNativeStatisticsScopeBatch(protocol, {
      campaign,
      batch,
    });
    const rotated = rotateNativeBatchCandidate(raw, { freshInvocations: true });
    const nextBatch = buildRrsiNativeEvaluationBatch(rotated);
    const next = assertRrsiNativeStatisticsScopeBatch(protocol, {
      campaign,
      batch: nextBatch,
    });
    expect(next.statisticsPlanDigest).not.toBe(original.statisticsPlanDigest);
    expect(next.nativeEvaluationPlanDigest).not.toBe(
      original.nativeEvaluationPlanDigest,
    );
    expect(next.pools).toEqual(original.pools);
    expect(next.targets).toEqual(original.targets);
    expect(
      verifyRrsiNativeGroupStatisticsPlan(next, { campaign, batch: nextBatch }),
    ).toEqual(next);
    expect(compatibilityBuild).toBe(buildRrsiNativeGroupStatisticsPlan);
  }, 120000);

  it("uses original manifest validation and rejects accessors and proxies without invoking them", () => {
    const getter = vi.fn();
    const execution = { ...context.execution };
    Object.defineProperty(execution, "targetMatrix", {
      get: getter,
      enumerable: true,
    });
    expect(() =>
      buildRrsiNativeStatisticsScopeProtocol({ campaign, execution }),
    ).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn();
    expect(() =>
      buildRrsiNativeStatisticsScopeProtocol(
        new Proxy(context, { ownKeys: trap }),
      ),
    ).toThrow(/plain own/);
    expect(trap).not.toHaveBeenCalled();
    const tampered = JSON.parse(JSON.stringify(context.execution));
    tampered.targetMatrix.cells[0].environmentDigest = digest(
      "altered environment",
    );
    expect(() =>
      buildRrsiNativeStatisticsScopeProtocol({ campaign, execution: tampered }),
    ).toThrow();
    expect(() =>
      buildRrsiNativeStatisticsScopeProtocol({
        campaign,
        execution: {
          ...context.execution,
          targetMatrix: new Proxy(context.execution.targetMatrix, {
            get: trap,
          }),
        },
      }),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
  });

  it("normalizes original null-prototype manifests into independent retainable plain data", () => {
    expect(Object.getPrototypeOf(context.execution.dependencyLock.lock)).toBe(
      null,
    );
    expect(() => snapshotRrsiData(context.execution)).toThrow(/prototype/);
    const normalized = normalizeRrsiNativeStatisticsExecutionContract(context);
    expect(Object.keys(normalized)).toEqual([
      "dependencyLock",
      "runtimeManifest",
      "targetMatrix",
    ]);
    expect(Object.getPrototypeOf(normalized.dependencyLock.lock)).toBe(
      Object.prototype,
    );
    expect(() => snapshotRrsiData(normalized)).not.toThrow();
    expect(rrsiCanonical(normalized)).toBe(rrsiCanonical(context.execution));
    expect(normalized.dependencyLock).not.toBe(
      context.execution.dependencyLock,
    );
    expect(normalized.runtimeManifest.runtimes[0].descriptor).not.toBe(
      context.execution.runtimeManifest.runtimes[0].descriptor,
    );
    expect(Object.isFrozen(normalized.dependencyLock.lock)).toBe(true);
    expect(
      buildRrsiNativeStatisticsScopeProtocol({
        campaign,
        execution: normalized,
      }),
    ).toEqual(protocol);
    expect(
      normalizeRrsiNativeStatisticsExecutionContract({
        campaign,
        execution: normalized,
      }),
    ).toEqual(normalized);
  });

  it("never invokes malicious normalization getters, toJSON hooks or Proxy traps", () => {
    const hook = vi.fn(() => {
      throw new Error("caller hook must not execute");
    });
    const plain = () => JSON.parse(JSON.stringify(context.execution));
    const outerGetter = { ...context };
    Object.defineProperty(outerGetter, "execution", {
      get: hook,
      enumerable: true,
    });
    const cases = [
      outerGetter,
      new Proxy(context, { ownKeys: hook, get: hook }),
    ];
    for (const field of ["dependencyLock", "runtimeManifest", "targetMatrix"]) {
      const execution = plain();
      execution[field] = new Proxy(execution[field], {
        ownKeys: hook,
        get: hook,
      });
      cases.push({ campaign, execution });
    }
    const nestedGetter = plain();
    Object.defineProperty(nestedGetter.dependencyLock.lock, "packages", {
      get: hook,
      enumerable: true,
    });
    cases.push({ campaign, execution: nestedGetter });
    const toJsonValue = plain();
    toJsonValue.dependencyLock.lock.toJSON = hook;
    cases.push({ campaign, execution: toJsonValue });
    const toJsonGetter = plain();
    Object.defineProperty(
      toJsonGetter.runtimeManifest.runtimes[0].descriptor,
      "toJSON",
      { get: hook, enumerable: true },
    );
    cases.push({ campaign, execution: toJsonGetter });
    const matrixGetter = plain();
    Object.defineProperty(matrixGetter.targetMatrix, "cells", {
      get: hook,
      enumerable: true,
    });
    cases.push({ campaign, execution: matrixGetter });
    for (const input of cases)
      expect(() =>
        normalizeRrsiNativeStatisticsExecutionContract(input),
      ).toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("statistics extraction preserves committed canonical bytes", () => {
  const golden = {
    selection: [
      "8b097796d03ec2c2756e0455a508cd6b0856bf3f6a123ef267157230cf56b123",
      "cb953fa7cbc6353c4f0903fba39168c3361fe4c5bc29f8ebc658fb6831dfd0f3",
      "2e4a59d6a2d9c97c08316db354b851a19ce1386a69c4e9099a4994ffd3c60b29",
      "d38cf034142dde37e4443bae6ad4828efc9916b9c15eb162ed96687f0d366f49",
    ],
    generalization: [
      "3378103b81cd7ba57a2d6312cca911efa30770d09e68259838d7beb49d9fcf8e",
      "3fb8a4eb97b3a66c9c38a75b816973900b2d97b109087c8d617595aafbd136b4",
      "a530f3fc3d00e5169fceb23937db0e0b8bd287d645f00974e63d20541aa9ae50",
      "d194771bae4806a7c97d0ff8dcab98911da814f27117e11cb47da6d4453687ee",
    ],
  };
  it.each(["selection", "generalization"])(
    "retains v1/v2 %s plan/report golden bytes",
    (stage) => {
      const legacy = rrsiStatisticsFixture({ stage });
      const raw = rrsiNativeBatchFixture({ stage });
      const campaign = raw.planContext.context.campaign;
      const batch = buildRrsiNativeEvaluationBatch(raw);
      const plan = buildRrsiNativeGroupStatisticsPlan({ campaign, batch });
      const values = [
        legacy.plan,
        analyzeRrsiGroupStatistics({
          campaign: legacy.campaign,
          plan: legacy.plan,
          rows: legacy.rows,
        }),
        plan,
        analyzeRrsiNativeGroupStatistics({
          campaign,
          batch,
          plan,
          childRows: [],
        }),
      ];
      expect(values.map(sha)).toEqual(golden[stage]);
    },
    180000,
  );
});
