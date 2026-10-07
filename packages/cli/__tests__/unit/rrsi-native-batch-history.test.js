import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createPrivateKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRrsiNativeEvaluationBatch,
  normalizeRrsiNativeEvaluationBatch,
  rrsiNativeUnitCount,
} from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import {
  buildRrsiCampaign,
  buildRrsiCandidate,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import { rrsiEnvelope } from "../../src/lib/evolution/rrsi-data.js";
import {
  rrsiNativeBatchFixture,
  signNativeChildSettlement,
  rotateNativeBatchCandidate,
} from "../fixtures/rrsi-native-batch.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiFixtureDigest as digest,
} from "../fixtures/rrsi-shadow-fixture.js";

const roots = [];
const clone = (input) => JSON.parse(JSON.stringify(input));
// Contextual compilation is expensive: share immutable inputs, never receipt capabilities.
const selection = rrsiNativeBatchFixture();
const generalization = rrsiNativeBatchFixture({ stage: "generalization" });
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), "rrsi-native-batch-"));
  roots.push(root);
  const value = openRrsiHistoryStore(root, {
    initialize: true,
    campaignOverrides: {
      budget: selection.planContext.context.campaign.budget,
    },
  });
  value.adapter.registerCampaign(selection.planContext.context.campaign);
  const privateKey = createPrivateKey(
    fs.readFileSync(path.join(root, "test-control", "settlement-private.pem")),
  );
  return {
    ...value,
    root,
    sign: (child, overrides) =>
      signNativeChildSettlement(value, child, privateKey, overrides),
  };
}
function dispatchAndSettle(value, response) {
  for (const child of response.children) {
    value.adapter.recordNativeDispatch(child);
    value.adapter.settle(value.sign(child));
  }
}
function rehash(batch) {
  const core = clone(batch);
  for (const name of [
    "schema",
    "batchDigest",
    "structuralOnly",
    "authenticated",
    "readyForExecution",
    "qualifiesForPromotion",
  ])
    delete core[name];
  return rrsiEnvelope(batch.schema, "batchDigest", core);
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        path.resolve(tmpdir()) + path.sep + "rrsi-native-batch-",
      )
    )
      throw new Error("unsafe cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("native batch declarations", () => {
  it("freezes all triangle attempts, units and distinct native identities without private task copies", () => {
    const batch = buildRrsiNativeEvaluationBatch(selection);
    expect(batch.children).toHaveLength(12);
    expect(batch).toMatchObject({
      readyForExecution: false,
      readyForNativeAdmission: false,
      nativeContentDerivationVerified: false,
      billingComplete: false,
    });
    expect(batch.candidate.contentDigest).not.toBe(
      batch.nativeCandidateContents.rrsi,
    );
    expect(JSON.stringify(batch)).not.toContain("publicInput");
    expect(JSON.stringify(batch)).not.toContain("expectedResult");
    expect(
      normalizeRrsiNativeEvaluationBatch(
        clone(batch),
        selection.planContext.context.campaign,
      ),
    ).toEqual(batch);
    expect(
      batch.children.every(
        (child) =>
          child.request.evaluationContext.planDigest === child.nativePlanDigest,
      ),
    ).toBe(true);
  });
  it.each(["actorInvocations", "gradeInvocations", "safetyInvocations"])(
    "refuses omission from the %s denominator",
    (category) => {
      const input = clone(selection);
      Object.values(input.allocations[0].byArm)[0].executionUnits[category]--;
      expect(() => buildRrsiNativeEvaluationBatch(input)).toThrow(
        /every actor, grade and safety/,
      );
    },
  );
  it("requires explicit provider/reset categories and their charged unit ceiling", () => {
    const input = clone(selection);
    delete Object.values(input.allocations[0].byArm)[0].executionUnits
      .providerRequests;
    expect(() => buildRrsiNativeEvaluationBatch(input)).toThrow(
      /execution units/,
    );
    const ceiling = clone(selection);
    Object.values(ceiling.allocations[0].byArm)[0].budget.maxExecutions = 120;
    expect(() => buildRrsiNativeEvaluationBatch(ceiling)).toThrow(
      /all charged execution units/,
    );
  });
  it("refuses missing, duplicate or foreign child allocations", () => {
    for (const change of [
      (entries) => entries.pop(),
      (entries) => entries.push(entries[0]),
      (entries) => {
        entries[0].cohortId = "foreign";
      },
    ]) {
      const input = clone(selection);
      change(input.allocations);
      expect(() => buildRrsiNativeEvaluationBatch(input)).toThrow(
        /omits|duplicate/,
      );
    }
  });
  it("readback rejects rehashed request substitution and denominator removal", () => {
    const batch = buildRrsiNativeEvaluationBatch(selection);
    const changed = clone(batch);
    changed.children[0].request.candidateId = digest("other candidate");
    expect(() =>
      normalizeRrsiNativeEvaluationBatch(
        rehash(changed),
        selection.planContext.context.campaign,
      ),
    ).toThrow(/arm or target/);
    const trimmed = clone(batch);
    trimmed.children.pop();
    expect(() =>
      normalizeRrsiNativeEvaluationBatch(
        rehash(trimmed),
        selection.planContext.context.campaign,
      ),
    ).toThrow(/full triangle denominator/);
  });
  it("rejects getters before calling them", () => {
    let calls = 0;
    const input = { ...selection };
    Object.defineProperty(input, "candidate", {
      enumerable: true,
      get() {
        calls++;
        return selection.candidate;
      },
    });
    expect(() => buildRrsiNativeEvaluationBatch(input)).toThrow(/accessors/);
    expect(calls).toBe(0);
  });
});

describe("native batch durable controls", () => {
  it("atomically holds the whole batch, charges each arm, and consumes one query", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    expect(response.children).toHaveLength(12);
    expect(value.adapter.inspect()).toMatchObject({
      selectionQueries: 1,
      candidateCount: 1,
      nativeBatches: [{ childCount: 12 }],
      chargedResourcesByArm: {
        baseline: { maxCostMicrounits: "8000", maxExecutions: "3928" },
        rsi: { maxCostMicrounits: "8000" },
        rrsi: { maxCostMicrounits: "8000" },
      },
    });
    expect(value.adapter.inspect().executions).toHaveLength(24);
    expect(response.children[0].reservations).toHaveLength(2);
    expect(() => value.adapter.recordDispatch(response.children[0])).toThrow(
      /fresh reservation/,
    );
    expect(() =>
      value.adapter.markUnknown({
        executionId: response.children[0].reservations[0].bindings.executionId,
        reservationDigest:
          response.children[0].reservations[0].reservationDigest,
      }),
    ).toThrow(/atomic child/);
  });
  it("gives each fresh child exactly one atomic dispatch and no recovered/copy capability", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    const recovered = openRrsiHistoryStore(
      value.root,
    ).adapter.reserveNativeBatch(clone(selection));
    expect(recovered.newlyCommitted).toBe(false);
    expect(() =>
      value.adapter.recordNativeDispatch(clone(response.children[0])),
    ).toThrow(/fresh child/);
    expect(() =>
      value.adapter.recordNativeDispatch(recovered.children[0]),
    ).toThrow(/fresh child/);
    expect(
      value.adapter.recordNativeDispatch(response.children[0]).newlyCommitted,
    ).toBe(true);
    expect(() =>
      value.adapter.recordNativeDispatch(response.children[0]),
    ).toThrow(/fresh child/);
    const executions = value.adapter
      .inspect()
      .executions.filter(
        (entry) =>
          entry.reservation.bindings.childId === response.children[0].childId,
      );
    expect(
      executions.every(
        (entry) => entry.status === "dispatch-intent" && entry.dispatched,
      ),
    ).toBe(true);
  });
  it("retains both ceilings on uncertainty and prevents candidate freeze", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    const child = response.children[0];
    value.adapter.recordNativeDispatch(child);
    value.adapter.markNativeUnknown({
      childId: child.childId,
      batchDigest: child.bindings.batchDigest,
    });
    expect(
      value.adapter.inspect().chargedResourcesByArm.rrsi.maxCostMicrounits,
    ).toBe("8000");
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: selection.planContext.context.campaign.campaignDigest,
        contentDigest: selection.candidate.contentDigest,
      }),
    ).toThrow(/complete history accounting/);
    expect(() => value.adapter.recordNativeDispatch(child)).toThrow(
      /fresh child/,
    );
  });
  it("settles both arms under one independent signature but retains false execution/billing claims", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    const child = response.children[0];
    value.adapter.recordNativeDispatch(child);
    const usage = value.sign(child).core.usageByArm;
    const arms = child.reservations.map(
      (reservation) => reservation.bindings.arm,
    );
    usage[arms[0]].costMicrounits = 75;
    usage[arms[1]].costMicrounits = 175;
    const receipt = value.sign(child, { usageByArm: usage });
    expect(value.adapter.settle(receipt)).toBe(true);
    expect(value.adapter.settle(receipt)).toBe(false);
    expect(() =>
      value.adapter.settle(
        value.sign(child, { receiptId: "duplicate-terminal-child" }),
      ),
    ).toThrow(/already settled/);
    const executions = value.adapter
      .inspect()
      .executions.filter(
        (entry) => entry.reservation.bindings.childId === child.childId,
      );
    expect(
      executions.every(
        (entry) =>
          entry.status === "settled" &&
          entry.budgetSettlementVerified &&
          !entry.executionEvidenceVerified &&
          !entry.costEvidenceVerified &&
          !entry.nativeExecutionDenominatorVerified,
      ),
    ).toBe(true);
    expect(
      openRrsiHistoryStore(value.root).adapter.inspect().chargedResourcesByArm,
    ).toEqual(value.adapter.inspect().chargedResourcesByArm);
    expect(
      value.adapter.inspect().chargedResourcesByArm[arms[0]].maxCostMicrounits,
    ).toBe("7075");
    expect(
      value.adapter.inspect().chargedResourcesByArm[arms[1]].maxCostMicrounits,
    ).toBe("7175");
  });
  it("cannot replace missing actors with extra provider calls", () => {
    const value = fixture();
    const child = value.adapter.reserveNativeBatch(selection).children[0];
    value.adapter.recordNativeDispatch(child);
    const receipt = value.sign(child);
    const arm = child.reservations[0].bindings.arm;
    receipt.core.executionUnitsByArm[arm].actorInvocations--;
    receipt.core.executionUnitsByArm[arm].providerRequests++;
    const signed = value.sign(child, {
      executionUnitsByArm: receipt.core.executionUnitsByArm,
    });
    expect(() => value.adapter.settle(signed)).toThrow(
      /omits a frozen execution category/,
    );
    expect(
      value.adapter
        .inspect()
        .executions.every((entry) => entry.status !== "settled"),
    ).toBe(true);
  });
  it("blocks forged signatures, attribution changes, and receipt reuse across children", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    const [first, second] = response.children;
    value.adapter.recordNativeDispatch(first);
    value.adapter.recordNativeDispatch(second);
    const forged = value.sign(first);
    Object.values(forged.core.usageByArm)[0].costMicrounits = 0;
    expect(() => value.adapter.settle(forged)).toThrow(/signature/);
    expect(() =>
      value.adapter.settle(
        value.sign(first, {
          bindings: {
            ...first.bindings,
            attributionDigest: digest("different ownership"),
          },
        }),
      ),
    ).toThrow(/bind the reserved/);
    const accepted = value.sign(first);
    value.adapter.settle(accepted);
    expect(() =>
      value.adapter.settle(
        value.sign(second, {
          sourceReceiptDigests: accepted.core.sourceReceiptDigests,
        }),
      ),
    ).toThrow(/another child/);
  });
  it("holds incomplete signed unit vectors without replacing unknown values with zero", () => {
    const value = fixture();
    const child = value.adapter.reserveNativeBatch(selection).children[0];
    value.adapter.recordNativeDispatch(child);
    const partial = value.sign(child).core;
    for (const arm of Object.keys(partial.usageByArm)) {
      partial.usageByArm[arm].executions = null;
      partial.executionUnitsByArm[arm].providerRequests = null;
    }
    value.adapter.settle(
      value.sign(child, {
        usageByArm: partial.usageByArm,
        executionUnitsByArm: partial.executionUnitsByArm,
      }),
    );
    for (const receiptId of ["partial-follow-up-1", "partial-follow-up-2"])
      value.adapter.settle(
        value.sign(child, {
          receiptId,
          usageByArm: partial.usageByArm,
          executionUnitsByArm: partial.executionUnitsByArm,
        }),
      );
    expect(value.adapter.inspect().nativeRecoveryEventHolds).toBe(45);
    expect(
      value.adapter
        .inspect()
        .executions.filter(
          (entry) => entry.reservation.bindings.childId === child.childId,
        )
        .every(
          (entry) =>
            entry.status === "unknown" &&
            entry.knownExecutionUnits.providerRequests === null,
        ),
    ).toBe(true);
    value.adapter.settle(
      value.sign(child, { receiptId: "complete-follow-up" }),
    );
    expect(value.adapter.inspect().nativeRecoveryEventHolds).toBe(44);
    expect(
      value.adapter
        .inspect()
        .executions.filter(
          (entry) => entry.reservation.bindings.childId === child.childId,
        )
        .every((entry) => entry.status === "settled"),
    ).toBe(true);
  });
  it("keeps signed overruns and consumes remaining fresh capabilities when dispatch is denied", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    const child = response.children[0];
    value.adapter.recordNativeDispatch(child);
    const usage = value.sign(child).core.usageByArm;
    Object.values(usage)[0].costMicrounits = 2000;
    value.adapter.settle(value.sign(child, { usageByArm: usage }));
    expect(value.adapter.inspect().budgetOverrun).toBe(true);
    expect(() =>
      value.adapter.recordNativeDispatch(response.children[1]),
    ).toThrow(/overrun/);
    expect(() =>
      value.adapter.recordNativeDispatch(response.children[1]),
    ).toThrow(/fresh child/);
  });
  it("retains a signed partial unit lower bound and blocks new work after a category overrun", () => {
    const value = fixture();
    const child = value.adapter.reserveNativeBatch(selection).children[0];
    value.adapter.recordNativeDispatch(child);
    const receipt = value.sign(child).core;
    const arm = child.reservations[0].bindings.arm;
    receipt.statusByArm[arm] = "unknown";
    receipt.executionUnitsByArm[arm].actorInvocations = 900;
    receipt.executionUnitsByArm[arm].providerRequests = null;
    receipt.usageByArm[arm].executions = null;
    value.adapter.settle(
      value.sign(child, {
        statusByArm: receipt.statusByArm,
        executionUnitsByArm: receipt.executionUnitsByArm,
        usageByArm: receipt.usageByArm,
      }),
    );
    const status = value.adapter.inspect();
    expect(status.budgetOverrun).toBe(true);
    const execution = status.executions.find(
      (entry) =>
        entry.reservation.bindings.childId === child.childId &&
        entry.reservation.bindings.arm === arm,
    );
    expect(execution).toMatchObject({
      status: "unknown",
      knownUsage: { executions: 1141 },
      knownExecutionUnits: { providerRequests: null },
    });
  });
  it("refuses not-started claims for a durably dispatched paired attempt", () => {
    const value = fixture();
    const child = value.adapter.reserveNativeBatch(selection).children[0];
    value.adapter.recordNativeDispatch(child);
    const receipt = value.sign(child).core;
    for (const arm of Object.keys(receipt.statusByArm)) {
      receipt.statusByArm[arm] = "not-started";
      for (const field of Object.keys(receipt.usageByArm[arm]))
        receipt.usageByArm[arm][field] = 0;
      for (const field of Object.keys(receipt.executionUnitsByArm[arm]))
        receipt.executionUnitsByArm[arm][field] = 0;
    }
    expect(() =>
      value.adapter.settle(
        value.sign(child, {
          statusByArm: receipt.statusByArm,
          usageByArm: receipt.usageByArm,
          executionUnitsByArm: receipt.executionUnitsByArm,
        }),
      ),
    ).toThrow(/not-started settlement contradicts dispatch/);
  });
  it("does not return exposure or quotas after every child is independently cancelled before start", () => {
    const value = fixture();
    const response = value.adapter.reserveNativeBatch(selection);
    for (const child of response.children) {
      const arms = child.reservations.map(
        (reservation) => reservation.bindings.arm,
      );
      value.adapter.settle(
        value.sign(child, {
          statusByArm: Object.fromEntries(
            arms.map((arm) => [arm, "not-started"]),
          ),
          usageByArm: Object.fromEntries(
            arms.map((arm) => [
              arm,
              {
                tokens: 0,
                toolCalls: 0,
                wallClockMs: 0,
                costMicrounits: 0,
                executions: 0,
              },
            ]),
          ),
          executionUnitsByArm: Object.fromEntries(
            arms.map((arm) => [
              arm,
              {
                actorInvocations: 0,
                gradeInvocations: 0,
                safetyInvocations: 0,
                resetOperations: 0,
                providerRequests: 0,
              },
            ]),
          ),
        }),
      );
    }
    expect(value.adapter.inspect()).toMatchObject({
      selectionQueries: 1,
      candidateCount: 1,
      chargedResources: { maxCostMicrounits: "0" },
    });
    expect(() =>
      value.adapter.reserveNativeBatch({
        ...selection,
        queryId: "renamed-query",
      }),
    ).toThrow(/already been consumed/);
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: selection.planContext.context.campaign.campaignDigest,
        contentDigest: selection.candidate.contentDigest,
      }),
    ).toThrow(/every planned paired arm/);
  });
  it("requires all triangle replicas before freeze and prevents a legacy final fallback", () => {
    const value = fixture();
    const selected = value.adapter.reserveNativeBatch(selection);
    dispatchAndSettle(value, selected);
    const otherCampaign = buildRrsiCampaign({
      ...rrsiCampaignInput(),
      campaignId: "second-finalist-campaign",
      dataset: selection.planContext.context.campaign.dataset,
      budget: selection.planContext.context.campaign.budget,
    });
    value.adapter.registerCampaign(otherCampaign);
    const otherCandidate = buildRrsiCandidate(
      otherCampaign,
      rrsiCandidateInput(otherCampaign, "second-finalist"),
    );
    const other = value.adapter.reserve({
      ...value.request(),
      campaignDigest: otherCampaign.campaignDigest,
      candidate: otherCandidate,
      executionId: "second-finalist-execution",
      slotId: "second-finalist-slot",
    });
    value.adapter.recordDispatch(other);
    value.adapter.settle(
      value.signSettlement(other.reservation, {
        receiptId: "second-finalist-selection",
      }),
    );
    expect(
      value.adapter.freezeCandidate({
        campaignDigest: selection.planContext.context.campaign.campaignDigest,
        contentDigest: selection.candidate.contentDigest,
      }),
    ).toBe(true);
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: otherCampaign.campaignDigest,
        contentDigest: otherCandidate.contentDigest,
      }),
    ).toThrow(/unique global finalist/);
    expect(() =>
      value.adapter.reserve({
        ...value.request(),
        campaignDigest: selection.planContext.context.campaign.campaignDigest,
        candidate: selection.candidate,
        partition: "audit",
      }),
    ).toThrow(/legacy final/);
    const final = value.adapter.reserveNativeBatch(generalization);
    expect(final.children).toHaveLength(24);
    expect(value.adapter.inspect()).toMatchObject({
      selectionQueries: 2,
      nativeBatches: [{ stage: "selection" }, { stage: "generalization" }],
    });
    expect(
      new Set(
        final.children.flatMap((child) =>
          child.reservations.flatMap(
            (reservation) => reservation.coveredPartitions,
          ),
        ),
      ),
    ).toEqual(new Set(["gate-validation", "gate-test", "audit"]));
    const sourceCampaign = selection.planContext.context.campaign;
    const dataset = buildRrsiDatasetManifest({
      manifestId: "retagged-final-sources",
      datasetVersion: sourceCampaign.dataset.datasetVersion,
      tasks: sourceCampaign.dataset.tasks.map((task) => ({
        ...task,
        partition:
          task.id === "train-task-0"
            ? "audit"
            : task.id === "audit-task-0"
              ? "train"
              : task.partition,
      })),
    });
    const reused = buildRrsiCampaign({
      ...rrsiCampaignInput(),
      campaignId: "retagged-final-campaign",
      budget: sourceCampaign.budget,
      dataset,
    });
    expect(() => value.adapter.registerCampaign(reused)).toThrow(
      /exposed selection or holdout sources/,
    );
  }, 90000);
  it("charges settled unlabelled legacy costs conservatively to every native arm", () => {
    const value = fixture();
    const campaign = selection.planContext.context.campaign;
    const older = buildRrsiCandidate(
      campaign,
      rrsiCandidateInput(campaign, "older-candidate"),
    );
    const legacy = value.adapter.reserve({
      ...value.request(),
      campaignDigest: campaign.campaignDigest,
      candidate: older,
    });
    value.adapter.recordDispatch(legacy);
    value.adapter.settle(value.signSettlement(legacy.reservation));
    value.adapter.reserveNativeBatch(selection);
    const status = value.adapter.inspect();
    for (const arm of ["baseline", "rsi", "rrsi"])
      expect(status.chargedResourcesByArm[arm].maxCostMicrounits).toBe("18000");
    expect(status.selectionQueries).toBe(2);
  });
  it("does not issue capabilities for uncertain commits or idempotent readback", () => {
    const value = fixture();
    const failing = openRrsiHistoryStore(value.root, {
      crashHook(phase) {
        if (phase === "after-head") throw new Error("TEST lost response");
      },
    });
    expect(() => failing.adapter.reserveNativeBatch(selection)).toThrow(
      /requires readback/,
    );
    const response = value.adapter.reserveNativeBatch(selection);
    expect(response.newlyCommitted).toBe(false);
    expect(value.adapter.inspect().selectionQueries).toBe(1);
    expect(() =>
      value.adapter.recordNativeDispatch(response.children[0]),
    ).toThrow(/fresh child/);
  });
  it("rejects unsafe unit totals and different data under a frozen query identity", () => {
    expect(() =>
      rrsiNativeUnitCount({
        actorInvocations: Number.MAX_SAFE_INTEGER,
        gradeInvocations: 1,
        safetyInvocations: 1,
        resetOperations: 1,
        providerRequests: 1,
      }),
    ).toThrow(/allowed range/);
    const value = fixture();
    value.adapter.reserveNativeBatch(selection);
    const changed = clone(selection);
    Object.values(changed.allocations[0].byArm)[0].budget.maxTokens++;
    expect(() => value.adapter.reserveNativeBatch(changed)).toThrow(
      /different data/,
    );
  });
  it("keeps campaign renames from resetting native control arms or exposed selection sources", () => {
    const value = fixture();
    dispatchAndSettle(value, value.adapter.reserveNativeBatch(selection));
    expect(() =>
      value.adapter.reserveNativeBatch(rotateNativeBatchCandidate(selection)),
    ).toThrow(
      /invocation or original request context has already been consumed/,
    );
    const rebound = {
      ...selection,
      candidate: buildRrsiCandidate(
        selection.planContext.context.campaign,
        rrsiCandidateInput(
          selection.planContext.context.campaign,
          "rebound-native-candidate",
        ),
      ),
      queryId: "rebound-query",
    };
    expect(() => value.adapter.reserveNativeBatch(rebound)).toThrow(
      /native candidate identity is already bound/,
    );
    const campaign = buildRrsiCampaign({
      ...rrsiCampaignInput(),
      campaignId: "renamed-campaign",
      dataset: selection.planContext.context.campaign.dataset,
      budget: selection.planContext.context.campaign.budget,
    });
    value.adapter.registerCampaign(campaign);
    // A genuine contextual graph for a renamed campaign still shares global history quotas.
    const oldRequest = {
      ...value.request(),
      campaignDigest: campaign.campaignDigest,
      candidate: buildRrsiCandidate(campaign, rrsiCandidateInput(campaign)),
      executionId: "renamed-execution",
      slotId: "renamed-slot",
    };
    expect(() => value.adapter.reserve(oldRequest)).toThrow(
      /already bound to another candidate/,
    );
    expect(value.adapter.inspect().selectionQueries).toBe(1);
    const exhausted = value.request({
      campaignDigest: selection.planContext.context.campaign.campaignDigest,
      candidate: buildRrsiCandidate(
        selection.planContext.context.campaign,
        rrsiCandidateInput(
          selection.planContext.context.campaign,
          "legacy-budget-fallback",
        ),
      ),
      executionId: "legacy-budget-fallback",
      slotId: "legacy-budget-fallback",
    });
    exhausted.budget.maxCostMicrounits =
      selection.planContext.context.campaign.budget.selectionPerExploringArm.maxCostMicrounits;
    expect(() => value.adapter.reserve(exhausted)).toThrow(
      /durable resource budget is exhausted/,
    );
  });
});
