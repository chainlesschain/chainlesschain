import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  openRrsiHistoryStore,
  appendPreUpgradeRrsiDispatch,
} from "../fixtures/rrsi-history-store.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiDatasetInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";
import {
  buildRrsiCampaign,
  buildRrsiCandidate,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import {
  RRSI_PREPARATION_PHASES,
  RRSI_PREPARATION_RESERVATION_SCHEMA,
} from "../../src/lib/evolution/rrsi-preparation-contracts.js";
import {
  buildRrsiSettlementMessage,
  RRSI_SETTLEMENT_SCHEMA,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { rrsiCanonical } from "../../src/lib/evolution/rrsi-data.js";

const roots = [];
function fixture({ maxAttempts = 4, ...options } = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "rrsi-preparation-"));
  roots.push(root);
  const value = {
    ...openRrsiHistoryStore(root, { initialize: true, ...options }),
    root,
  };
  value.adapter.registerCampaign(value.campaign);
  value.adapter.registerPreparationPlan(value.preparationPlan({ maxAttempts }));
  return value;
}
function settlePreparation(value, response, overrides = {}) {
  value.adapter.recordDispatch(response);
  const evidence = value.signSettlement(response.reservation, {
    receiptId: `receipt-${response.reservation.bindings.executionId}`,
    ...overrides,
  });
  value.adapter.settle(evidence);
  return evidence;
}
function changedRequest(value, index = 2) {
  return value.preparationRequest({
    slotId: `slot-${index}`,
    executionId: `prep-${index}`,
    inputs: {
      instructionDigest: rrsiFixtureDigest(`TEST instruction ${index}`),
      memoryDigest: rrsiFixtureDigest("TEST unchanged memory"),
      artifactDigests: [],
    },
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        path.resolve(tmpdir()) + path.sep + "rrsi-preparation-",
      )
    )
      throw new Error("unsafe test cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI durable preparation accounting", () => {
  it("prevents pending query capabilities from overlapping preparation admission", () => {
    const value = fixture();
    const query = value.adapter.reserve(value.request());
    expect(() =>
      value.adapter.reservePreparation(value.preparationRequest()),
    ).toThrow(/unresolved query/);
    expect(value.adapter.inspect().preparationAttempts).toBe(0);
    value.adapter.recordDispatch(query);
    value.adapter.markUnknown({
      executionId: query.reservation.bindings.executionId,
      reservationDigest: query.reservation.reservationDigest,
    });
    expect(() =>
      value.adapter.reservePreparation(value.preparationRequest()),
    ).toThrow(/unresolved query/);
    value.adapter.settle(value.signSettlement(query.reservation));
    expect(
      value.adapter.reservePreparation(value.preparationRequest())
        .newlyCommitted,
    ).toBe(true);
  });
  it.each(RRSI_PREPARATION_PHASES)(
    "reserves %s in the training/proposal budget before dispatch",
    (phase) => {
      const value = fixture();
      const response = value.adapter.reservePreparation(
        value.preparationRequest({ phase }),
      );
      expect(response.reservation).toMatchObject({
        schema: RRSI_PREPARATION_RESERVATION_SCHEMA,
        bindings: {
          partition: "train",
          phase,
          trainingPartitionDigest:
            value.campaign.dataset.pools.train.partitionDigest,
          ledgerId: value.store.backend.ledger.verify().ledgerId,
        },
        plannedExecutions: 1,
      });
      expect(response.reservation.bindings).not.toHaveProperty(
        "candidateDigest",
      );
      expect(value.adapter.inspect()).toMatchObject({
        controlBudgetCoverage: "preparation-selection-and-final",
        preparationAttempts: 1,
        selectionQueries: 0,
        candidateCount: 0,
        preparationPlan: {
          mappingAuthenticated: false,
          readyForExecution: false,
        },
        chargedResources: {
          maxTokens: "10000",
          maxCostMicrounits: "100000",
          maxExecutions: "1",
        },
        chargedResourcesByStage: {
          proposal: { maxCostMicrounits: "100000" },
          selection: { maxCostMicrounits: "0" },
        },
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
  );

  it("freezes attempt and PM mapping declarations across reopen and campaign rename", () => {
    const value = fixture();
    const reopened = openRrsiHistoryStore(value.root);
    expect(
      reopened.adapter.registerPreparationPlan(reopened.preparationPlan())
        .newlyCommitted,
    ).toBe(false);
    for (const change of [
      { maxAttempts: 5 },
      { planDigest: rrsiFixtureDigest("other plan") },
      { trainingMappingDigest: rrsiFixtureDigest("other mapping") },
      { pmTrainingPartitionDigest: rrsiFixtureDigest("other PM training") },
    ]) {
      expect(() =>
        reopened.adapter.registerPreparationPlan(
          reopened.preparationPlan(change),
        ),
      ).toThrow(/different data/);
    }
    const input = rrsiCampaignInput();
    input.campaignId = "alias-campaign";
    const alias = buildRrsiCampaign(input);
    reopened.adapter.registerCampaign(alias);
    expect(() =>
      reopened.adapter.registerPreparationPlan(
        reopened.preparationPlan({ campaignDigest: alias.campaignDigest }),
      ),
    ).toThrow(/different data/);
    expect(reopened.adapter.inspect().preparationPlan.maxAttempts).toBe(4);
  });

  it("keeps irreversible attempts and semantic dedup after a signed not-started refund", () => {
    const value = fixture({ maxAttempts: 1 });
    const response = value.adapter.reservePreparation(
      value.preparationRequest(),
    );
    value.adapter.settle(
      value.signSettlement(response.reservation, {
        status: "not-started",
        usage: {
          tokens: 0,
          toolCalls: 0,
          wallClockMs: 0,
          costMicrounits: 0,
          executions: 0,
        },
      }),
    );
    expect(value.adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "0" },
    });
    expect(() =>
      value.adapter.reservePreparation(
        value.preparationRequest({
          executionId: "renamed-execution",
          slotId: "renamed-slot",
          roundId: "renamed-round",
          branchId: "renamed-branch",
        }),
      ),
    ).toThrow(/semantic preparation/);
    expect(() =>
      value.adapter.reservePreparation(changedRequest(value)),
    ).toThrow(/attempt limit is exhausted/);
    expect(() => value.adapter.recordDispatch(response)).toThrow(
      /cannot be dispatched/,
    );
    expect(
      openRrsiHistoryStore(value.root).adapter.inspect().preparationAttempts,
    ).toBe(1);
  });

  it("deduplicates canonical sources and inputs across reordered lists and renamed task/campaign IDs", () => {
    const value = fixture();
    const inputs = {
      ...value.preparationRequest().inputs,
      artifactDigests: [rrsiFixtureDigest("A"), rrsiFixtureDigest("B")],
    };
    const response = value.adapter.reservePreparation(
      value.preparationRequest({
        sourceTaskIds: ["train-task-0", "train-task-1"],
        inputs,
      }),
    );
    settlePreparation(value, response);
    const dataset = rrsiDatasetInput();
    dataset.tasks.forEach((task) => {
      task.id = `alias-${task.id}`;
    });
    const campaign = buildRrsiCampaign({
      ...rrsiCampaignInput(),
      campaignId: "source-alias-campaign",
      dataset: buildRrsiDatasetManifest(dataset),
    });
    value.adapter.registerCampaign(campaign);
    expect(() =>
      value.adapter.reservePreparation(
        value.preparationRequest({
          campaignDigest: campaign.campaignDigest,
          executionId: "alias-execution",
          slotId: "alias-slot",
          roundId: "alias-round",
          branchId: "alias-branch",
          sourceTaskIds: ["alias-train-task-1", "alias-train-task-0"],
          inputs: {
            ...inputs,
            artifactDigests: [...inputs.artifactDigests].reverse(),
          },
        }),
      ),
    ).toThrow(/semantic preparation/);
    expect(value.adapter.inspect().preparationAttempts).toBe(1);
  });

  it.each([
    { status: "unknown" },
    { cleanupConfirmed: false },
    {
      usage: {
        tokens: 1000,
        toolCalls: 10,
        wallClockMs: 1000,
        costMicrounits: null,
        executions: 1,
      },
    },
  ])(
    "holds all preparation/query/freeze admission for incomplete evidence %#",
    (overrides) => {
      const value = fixture();
      const response = value.adapter.reservePreparation(
        value.preparationRequest(),
      );
      settlePreparation(value, response, overrides);
      const reopened = openRrsiHistoryStore(value.root);
      expect(reopened.adapter.inspect()).toMatchObject({
        preparationAttempts: 1,
        chargedResources: { maxCostMicrounits: "100000" },
        executions: [{ status: "unknown" }],
      });
      expect(() =>
        reopened.adapter.reservePreparation(changedRequest(value)),
      ).toThrow(/unresolved preparation/);
      expect(() => reopened.adapter.reserve(value.request())).toThrow(
        /unresolved preparation/,
      );
      expect(() =>
        reopened.adapter.freezeCandidate({
          campaignDigest: value.campaign.campaignDigest,
          contentDigest: value.candidate.contentDigest,
        }),
      ).toThrow(/complete history accounting/);
      reopened.adapter.settle(
        value.signSettlement(response.reservation, {
          receiptId: "late-complete",
        }),
      );
      expect(
        reopened.adapter.inspect().chargedResources.maxCostMicrounits,
      ).toBe("10000");
      const next = reopened.adapter.reservePreparation(changedRequest(value));
      expect(next.newlyCommitted).toBe(true);
      expect(reopened.adapter.inspect().preparationAttempts).toBe(2);
    },
  );

  it("forbids copied/recovered dispatch and retains pending ceilings", () => {
    const value = fixture();
    const response = value.adapter.reservePreparation(
      value.preparationRequest(),
    );
    const reopened = openRrsiHistoryStore(value.root);
    const recovered = reopened.adapter.reservePreparation(
      reopened.preparationRequest(),
    );
    expect(recovered.newlyCommitted).toBe(false);
    expect(() => reopened.adapter.recordDispatch(recovered)).toThrow(
      /fresh reservation/,
    );
    expect(() =>
      value.adapter.recordDispatch(JSON.parse(JSON.stringify(response))),
    ).toThrow(/fresh reservation/);
    expect(() =>
      value.adapter.reservePreparation(changedRequest(value)),
    ).toThrow(/unresolved preparation/);
    value.adapter.recordDispatch(response);
    value.adapter.markUnknown({
      executionId: response.reservation.bindings.executionId,
      reservationDigest: response.reservation.reservationDigest,
    });
    expect(() => value.adapter.recordDispatch(response)).toThrow(
      /fresh reservation/,
    );
    expect(value.adapter.inspect().chargedResources.maxCostMicrounits).toBe(
      "100000",
    );
  });

  it("shares execution, receipt IDs and source receipt ownership with query reservations", () => {
    const value = fixture();
    const prep = value.adapter.reservePreparation(value.preparationRequest());
    const evidence = settlePreparation(value, prep);
    expect(() =>
      value.adapter.reserve(
        value.request({ executionId: prep.reservation.bindings.executionId }),
      ),
    ).toThrow(/different data/);
    const query = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(query);
    expect(() =>
      value.adapter.settle(
        value.signSettlement(query.reservation, {
          receiptId: evidence.core.receiptId,
        }),
      ),
    ).toThrow(/different data/);
    expect(() =>
      value.adapter.settle(
        value.signSettlement(query.reservation, {
          receiptId: "new-query-receipt",
          sourceReceiptDigests: evidence.core.sourceReceiptDigests,
        }),
      ),
    ).toThrow(/another reservation/);
    value.adapter.settle(
      value.signSettlement(query.reservation, { receiptId: "query-complete" }),
    );
    expect(value.adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      selectionQueries: 1,
      chargedResources: { maxCostMicrounits: "20000", maxExecutions: "961" },
    });
  });

  it("uses separate signature domains while preserving legacy v1 bytes", () => {
    const value = fixture();
    const query = value.adapter.reserve(value.request());
    const queryEvidence = value.signSettlement(query.reservation);
    value.adapter.recordDispatch(query);
    value.adapter.settle(queryEvidence);
    expect(
      buildRrsiSettlementMessage(
        queryEvidence.core,
        value.settlementVerifier.descriptor,
      ).toString("utf8"),
    ).toBe(
      `${RRSI_SETTLEMENT_SCHEMA}\0${rrsiCanonical(value.settlementVerifier.descriptor)}\0${rrsiCanonical(queryEvidence.core)}`,
    );
    const prep = value.adapter.reservePreparation(value.preparationRequest());
    const evidence = value.signSettlement(prep.reservation, {
      receiptId: "preparation-domain-test",
    });
    expect(
      buildRrsiSettlementMessage(
        evidence.core,
        value.settlementVerifier.descriptor,
      ).toString("utf8"),
    ).toMatch(/^chainlesschain\.rrsi-preparation-settlement\/v1\0/);
    const queryUnderPreparation = value.signSettlement(query.reservation, {
      receiptId: "query-under-preparation",
      bindings: {
        ...query.reservation.bindings,
        executionId: prep.reservation.bindings.executionId,
        reservationDigest: prep.reservation.reservationDigest,
      },
    });
    expect(() => value.adapter.settle(queryUnderPreparation)).toThrow(
      /domain differs/,
    );
    const preparationUnderQuery = value.signSettlement(prep.reservation, {
      receiptId: "preparation-under-query",
      bindings: {
        ...prep.reservation.bindings,
        executionId: query.reservation.bindings.executionId,
        reservationDigest: query.reservation.reservationDigest,
      },
    });
    expect(() => value.adapter.settle(preparationUnderQuery)).toThrow(
      /domain differs/,
    );
    evidence.core.schema = RRSI_SETTLEMENT_SCHEMA;
    expect(() => value.adapter.settle(evidence)).toThrow(
      /missing or unexpected fields/,
    );
    expect(value.adapter.inspect().chargedResources.maxCostMicrounits).toBe(
      "110000",
    );
  });

  it("retains preparation overruns and blocks every later stage", () => {
    const value = fixture();
    const prep = value.adapter.reservePreparation(value.preparationRequest());
    settlePreparation(value, prep, {
      usage: {
        tokens: 1000,
        toolCalls: 10,
        wallClockMs: 1000,
        costMicrounits: 150_000,
        executions: 1,
      },
    });
    expect(value.adapter.inspect()).toMatchObject({
      budgetOverrun: true,
      chargedResources: { maxCostMicrounits: "150000" },
    });
    expect(() =>
      value.adapter.reservePreparation(changedRequest(value)),
    ).toThrow(/overrun/);
    expect(() => value.adapter.reserve(value.request())).toThrow(/overrun/);
  });

  it.each([1000, 150_000])(
    "rejects lower late costs after signed partial usage %i",
    (cost) => {
      const value = fixture();
      const prep = value.adapter.reservePreparation(value.preparationRequest());
      settlePreparation(value, prep, {
        status: "unknown",
        usage: {
          tokens: 1000,
          toolCalls: 10,
          wallClockMs: 1000,
          costMicrounits: cost,
          executions: 1,
        },
      });
      expect(() =>
        value.adapter.settle(
          value.signSettlement(prep.reservation, {
            receiptId: "contradictory-late-cost",
            usage: {
              tokens: 1000,
              toolCalls: 10,
              wallClockMs: 1000,
              costMicrounits: cost - 1,
              executions: 1,
            },
          }),
        ),
      ).toThrow(/cannot decrease/);
      expect(openRrsiHistoryStore(value.root).adapter.inspect()).toMatchObject({
        preparationAttempts: 1,
        budgetOverrun: cost > 100_000,
        chargedResources: {
          maxCostMicrounits: String(Math.max(100_000, cost)),
        },
        executions: [
          { status: "unknown", knownUsage: { costMicrounits: cost } },
        ],
      });
    },
  );

  it("rechecks global overrun before dispatching an earlier query capability", () => {
    const value = fixture();
    const first = value.adapter.reserve(value.request());
    // A second genuine candidate uses the established fixture's alternate bytes.
    const secondInput = rrsiCandidateInput(value.campaign, "candidate-2");
    const second = value.adapter.reserve(
      value.request({
        candidate: buildRrsiCandidate(value.campaign, secondInput),
        executionId: "query-2",
        slotId: "query-slot-2",
      }),
    );
    value.adapter.recordDispatch(first);
    value.adapter.settle(
      value.signSettlement(first.reservation, {
        usage: {
          tokens: 1000,
          toolCalls: 10,
          wallClockMs: 1000,
          costMicrounits: 150_000,
          executions: first.reservation.plannedExecutions,
        },
      }),
    );
    expect(() => value.adapter.recordDispatch(second)).toThrow(/overrun/);
    expect(
      value.adapter
        .inspect()
        .executions.find(
          (entry) => entry.reservation.bindings.executionId === "query-2",
        ),
    ).toMatchObject({ status: "reserved", dispatched: false });
  });

  it("rechecks global overrun before dispatching an earlier preparation capability", () => {
    const value = fixture();
    const prep = value.adapter.reservePreparation(value.preparationRequest());
    value.adapter.settle(
      value.signSettlement(prep.reservation, {
        status: "unknown",
        usage: {
          tokens: null,
          toolCalls: null,
          wallClockMs: null,
          costMicrounits: 150_000,
          executions: null,
        },
      }),
    );
    expect(() => value.adapter.recordDispatch(prep)).toThrow(/overrun/);
    expect(value.adapter.inspect().executions[0]).toMatchObject({
      status: "unknown",
      dispatched: false,
    });
  });

  it("preserves authenticated pre-upgrade dispatch costs while blocking all new overrun admission", () => {
    const value = fixture();
    const first = value.adapter.reserve(value.request());
    const second = value.adapter.reserve(
      value.request({
        candidate: buildRrsiCandidate(
          value.campaign,
          rrsiCandidateInput(value.campaign, "candidate-2"),
        ),
        executionId: "old-query-2",
        slotId: "old-slot-2",
      }),
    );
    value.adapter.recordDispatch(first);
    value.adapter.settle(
      value.signSettlement(first.reservation, {
        usage: {
          tokens: 1000,
          toolCalls: 10,
          wallClockMs: 1000,
          costMicrounits: 150_000,
          executions: first.reservation.plannedExecutions,
        },
      }),
    );
    expect(
      appendPreUpgradeRrsiDispatch(value, second.reservation).authenticated,
    ).toBe(true);
    const reopened = openRrsiHistoryStore(value.root);
    reopened.adapter.settle(
      value.signSettlement(second.reservation, {
        receiptId: "old-query-accounting",
      }),
    );
    expect(reopened.adapter.inspect()).toMatchObject({
      budgetOverrun: true,
      chargedResources: { maxCostMicrounits: "160000" },
    });
    expect(() =>
      reopened.adapter.reservePreparation(reopened.preparationRequest()),
    ).toThrow(/overrun/);
  });

  it("enforces proposal stage ceilings after prior actual costs are settled", () => {
    const value = fixture();
    const prep = value.adapter.reservePreparation(value.preparationRequest());
    settlePreparation(value, prep);
    const next = changedRequest(value);
    next.budget.maxCostMicrounits =
      value.campaign.budget.proposalPerExploringArm.maxCostMicrounits;
    expect(() => value.adapter.reservePreparation(next)).toThrow(
      /budget is exhausted/,
    );
    expect(value.adapter.inspect().preparationAttempts).toBe(1);
  });

  it("prohibits preparation after freezing a finalist", () => {
    const value = fixture();
    const query = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(query);
    value.adapter.settle(value.signSettlement(query.reservation));
    value.adapter.freezeCandidate({
      campaignDigest: value.campaign.campaignDigest,
      contentDigest: value.candidate.contentDigest,
    });
    expect(() =>
      value.adapter.reservePreparation(value.preparationRequest()),
    ).toThrow(/frozen finalist/);
  });

  it("requires a preparation plan and prohibits late plan registration after final freeze", () => {
    const value = fixture();
    const root = fs.mkdtempSync(path.join(tmpdir(), "rrsi-preparation-"));
    roots.push(root);
    const legacy = openRrsiHistoryStore(root, { initialize: true });
    legacy.adapter.registerCampaign(legacy.campaign);
    expect(() =>
      legacy.adapter.reservePreparation(legacy.preparationRequest()),
    ).toThrow(/plan has not been/);
    const query = legacy.adapter.reserve(legacy.request());
    legacy.adapter.recordDispatch(query);
    legacy.adapter.settle(legacy.signSettlement(query.reservation));
    legacy.adapter.freezeCandidate({
      campaignDigest: legacy.campaign.campaignDigest,
      contentDigest: legacy.candidate.contentDigest,
    });
    expect(() =>
      legacy.adapter.registerPreparationPlan(legacy.preparationPlan()),
    ).toThrow(/frozen finalist/);
    expect(() =>
      value.adapter.registerPreparationPlan(
        value.preparationPlan({ maxAttempts: 0 }),
      ),
    ).toThrow();
  });

  it.each([
    { sourceTaskIds: ["select-task-0"] },
    { sourceTaskIds: ["train-task-0", "train-task-0"] },
    { phase: "unregistered-phase" },
    { sourceTaskIds: [] },
    {
      inputs: {
        instructionDigest: rrsiFixtureDigest("I"),
        memoryDigest: rrsiFixtureDigest("M"),
        artifactDigests: [rrsiFixtureDigest("A"), rrsiFixtureDigest("A")],
      },
    },
  ])(
    "rejects invalid sources/phase/inputs without consuming attempts %#",
    (overrides) => {
      const value = fixture();
      expect(() =>
        value.adapter.reservePreparation(value.preparationRequest(overrides)),
      ).toThrow();
      expect(value.adapter.inspect().preparationAttempts).toBe(0);
    },
  );
});
