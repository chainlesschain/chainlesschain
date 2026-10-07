import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openRrsiPmBridgeFixture } from "../fixtures/rrsi-pm-bridge.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import { rrsiFixtureDigest } from "../fixtures/rrsi-shadow-fixture.js";
import { captureRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { RRSI_PREPARATION_RESERVATION_SCHEMA_V2 } from "../../src/lib/evolution/rrsi-preparation-contracts.js";
import {
  createRrsiPmExplorationBridge,
  reserveRrsiPmBroadRound,
  executeRrsiPmBroadRound,
} from "../../src/lib/evolution/rrsi-pm-execution-bridge.js";
import {
  createPmExplorationJournal,
  createPmExplorationPlan,
  inspectPmExplorationJournal,
  startPmExplorationRound,
  completePmExplorationRound,
} from "../../src/lib/evolution/pm-exploration-rounds.js";

const roots = [];
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "rrsi-pm-bridge-unit-"));
  roots.push(root);
  return { ...openRrsiPmBridgeFixture(root, options), root };
}
const reserve = (value, overrides = {}) =>
  reserveRrsiPmBroadRound(
    value.bridge,
    value.journal,
    value.roundInput(overrides),
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
function moveOtherBranch(value) {
  const round = startPmExplorationRound(value.journal, {
    roundId: "external-round",
    stage: "broad",
    branchId: "other",
    taskId: "pm-task-1",
    inputMemoryDigest: value.plan.initialMemoryDigest,
  });
  completePmExplorationRound(value.journal, round, {
    executionReceiptDigest: rrsiFixtureDigest("TEST ONLY external receipt"),
    graderReceiptDigest: rrsiFixtureDigest("TEST ONLY external grade"),
    outputMemoryDigest: rrsiFixtureDigest("TEST ONLY other branch memory"),
    decision: "accept",
    metrics: { tokens: 1, toolCalls: 0, wallClockMs: 0 },
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        path.resolve(tmpdir()) + path.sep + "rrsi-pm-bridge-unit-",
      )
    )
      throw new Error("unsafe fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI existing governed PM host bridge", () => {
  it("captures genuine history and host composition without accepting callbacks or getters", () => {
    const value = fixture();
    expect(captureRrsiHistoryLedgerAdapter(value.adapter)).toBe(
      captureRrsiHistoryLedgerAdapter(value.adapter),
    );
    expect(() => captureRrsiHistoryLedgerAdapter({ ...value.adapter })).toThrow(
      /branded/,
    );
    expect(() =>
      createRrsiPmExplorationBridge({
        ...value.composition,
        history: { ...value.adapter },
      }),
    ).toThrow(/branded/);
    expect(() =>
      createRrsiPmExplorationBridge({ ...value.composition, host: {} }),
    ).toThrow(/branded/);
    expect(() =>
      createRrsiPmExplorationBridge({ ...value.composition, run: () => {} }),
    ).toThrow(/own fields/);
    const input = { ...value.composition };
    const getter = vi.fn(() => value.host);
    Object.defineProperty(input, "host", { get: getter, enumerable: true });
    expect(() => createRrsiPmExplorationBridge(input)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
    expect(createRrsiPmExplorationBridge(value.composition)).toBe(value.bridge);
    expect(value.calls.run).toBe(0);
  });

  it("runs runner and grader, durably retains PM receipts and keeps all costs reserved", async () => {
    const value = fixture();
    const response = reserve(value);
    expect(response.reservation).toMatchObject({
      schema: RRSI_PREPARATION_RESERVATION_SCHEMA_V2,
      plannedExecutions: 2,
      budget: { maxExecutions: 2 },
    });
    expect(response.reservation.bindings.trainingSourceDigest).toBe(
      value.mapping.trainingSourceDigest,
    );
    const result = await executeRrsiPmBroadRound(value.bridge, response);
    expect(value.calls).toEqual({ run: 1, grade: 1, tool: 1 });
    expect(result).toMatchObject({
      dispatchCommitted: true,
      hostInvoked: true,
      pmReceiptsVerified: true,
      observationPersistence: "persisted",
      journalDriftDetected: false,
      independentSettlementRequired: true,
      cleanupConfirmed: null,
      executionEvidenceVerified: false,
      costEvidenceVerified: false,
      qualityVerdictVerified: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    const status = openRrsiHistoryStore(value.root).adapter.inspect();
    expect(status).toMatchObject({
      preparationAttempts: 1,
      selectionQueries: 0,
      chargedResources: {
        maxTokens: "100",
        maxCostMicrounits: "100000",
        maxExecutions: "2",
      },
      executions: [
        {
          status: "unknown",
          knownUsage: { tokens: null, costMicrounits: null },
          executionEvidenceVerified: false,
          costEvidenceVerified: false,
          executionObservation: {
            independentlyReverified: false,
            costEvidenceVerified: false,
            result: { receiptsAuthenticated: true },
          },
        },
      ],
    });
    expect(status.executions[0].executionObservation.result).toEqual(
      result.pmResult,
    );
    const usage = {
      ...result.pmResult.checkpoint.metrics,
      costMicrounits: 10000,
      executions: 1,
    };
    expect(() =>
      value.adapter.settle(
        value.signSettlement(response.reservation, {
          receiptId: "insufficient-unit-receipt",
          usage,
        }),
      ),
    ).toThrow(/denominator/);
    value.adapter.settle(
      value.signSettlement(response.reservation, {
        receiptId: "independent-pm-cost",
        usage: { ...usage, executions: 2 },
      }),
    );
    expect(value.adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: {
        maxTokens: "9",
        maxCostMicrounits: "10000",
        maxExecutions: "2",
      },
      executions: [
        {
          status: "settled",
          costEvidenceVerified: true,
          executionObservation: { independentlyReverified: false },
        },
      ],
    });
    await expect(
      executeRrsiPmBroadRound(value.bridge, response),
    ).rejects.toThrow(/fresh round reservation/);
    expect(value.calls.run).toBe(1);
  });

  it("does not grant bridge dispatch to copied, recovered or generic v1 reservations", async () => {
    const value = fixture();
    const response = reserve(value);
    const recovered = reserve(value);
    expect(recovered.newlyCommitted).toBe(false);
    await expect(
      executeRrsiPmBroadRound(
        value.bridge,
        JSON.parse(JSON.stringify(response)),
      ),
    ).rejects.toThrow(/fresh round/);
    await expect(
      executeRrsiPmBroadRound(value.bridge, recovered),
    ).rejects.toThrow(/fresh round/);
    expect(value.calls.run).toBe(0);
    await executeRrsiPmBroadRound(value.bridge, response);
    expect(value.calls.run).toBe(1);
    const other = fixture();
    const v1 = other.adapter.reservePreparation(
      other.preparationRequest({
        campaignDigest: other.campaign.campaignDigest,
      }),
    );
    await expect(executeRrsiPmBroadRound(other.bridge, v1)).rejects.toThrow(
      /fresh round/,
    );
    expect(other.calls.run).toBe(0);
  });

  it.each(["maxTokens", "maxToolCalls", "maxWallClockMs", "maxExecutions"])(
    "rejects an insufficient %s reservation before consuming an attempt",
    (field) => {
      const value = fixture();
      const input = value.roundInput();
      input.budget[field]--;
      expect(() =>
        reserveRrsiPmBroadRound(value.bridge, value.journal, input),
      ).toThrow(/cover the complete|runner and grader/);
      expect(value.adapter.inspect().preparationAttempts).toBe(0);
      expect(value.calls.run).toBe(0);
    },
  );

  it("rejects holdout tasks, incorrect memory, deep stage and foreign journal before dispatch", () => {
    const value = fixture();
    for (const overrides of [
      { taskId: "pm-task-2" },
      { inputMemoryDigest: rrsiFixtureDigest("foreign memory") },
      { stage: "deep" },
    ])
      expect(() => reserve(value, overrides)).toThrow();
    const foreignInput = { ...value.plan, planId: "foreign-plan" };
    delete foreignInput.schema;
    delete foreignInput.planDigest;
    const foreignJournal = createPmExplorationJournal(
      createPmExplorationPlan(foreignInput),
    );
    expect(() =>
      reserveRrsiPmBroadRound(value.bridge, foreignJournal, value.roundInput()),
    ).toThrow(/journal plan differs/);
    expect(value.adapter.inspect().preparationAttempts).toBe(0);
  });

  it("binds an already reserved journal to one bridge across independent host compositions", () => {
    const value = fixture();
    reserve(value);
    const other = openRrsiPmBridgeFixture(value.root, { initialize: false });
    expect(() =>
      reserveRrsiPmBroadRound(other.bridge, value.journal, other.roundInput()),
    ).toThrow(/belongs to another bridge/);
    expect(other.calls.run).toBe(0);
    expect(value.adapter.inspect().preparationAttempts).toBe(1);
  });

  it("records unverified observations after settlement without changing known usage or verification", () => {
    const value = fixture();
    const response = reserve(value);
    value.adapter.recordDispatch(response);
    value.adapter.settle(
      value.signSettlement(response.reservation, {
        status: "failed",
        usage: {
          tokens: 0,
          toolCalls: 0,
          wallClockMs: 0,
          costMicrounits: 0,
          executions: 0,
        },
      }),
    );
    value.adapter.recordPreparationObservation({
      executionId: response.reservation.bindings.executionId,
      reservationDigest: response.reservation.reservationDigest,
      observation: {
        result: {
          receiptsAuthenticated: true,
          budgetEnforced: true,
          usage: { costMicrounits: 999999 },
        },
        failureCode: null,
        driftDetected: false,
      },
    });
    expect(value.adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "0" },
      executions: [
        {
          status: "settled",
          knownUsage: { costMicrounits: 0 },
          executionEvidenceVerified: false,
          executionObservation: {
            independentlyReverified: false,
            costEvidenceVerified: false,
          },
        },
      ],
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
    });
  });

  it("consumes dispatch before awaiting and denies concurrent bridge use of the same budget", async () => {
    const ready = deferred(),
      finish = deferred();
    const value = fixture({
      run: async (request, runtime) => {
        runtime.recordTokens(1);
        ready.resolve();
        await finish.promise;
        return {
          outputMemoryDigest: rrsiFixtureDigest(
            `TEST pending ${request.roundId}`,
          ),
          traceDigest: rrsiFixtureDigest("TEST pending trace"),
        };
      },
    });
    const response = reserve(value);
    const running = executeRrsiPmBroadRound(value.bridge, response);
    try {
      await ready.promise;
      expect(value.adapter.inspect().executions[0]).toMatchObject({
        status: "dispatch-intent",
        dispatched: true,
      });
      await expect(
        executeRrsiPmBroadRound(value.bridge, response),
      ).rejects.toThrow(/fresh round/);
      expect(() =>
        reserve(value, {
          roundId: "pm-round-2",
          slotId: "pm-slot-2",
          executionId: "pm-execution-2",
        }),
      ).toThrow(/already running/);
      expect(value.adapter.inspect().preparationAttempts).toBe(1);
    } finally {
      finish.resolve();
    }
    expect((await running).observationPersistence).toBe("persisted");
    expect(value.calls.run).toBe(1);
  });

  it("keeps unknown accounting when the journal changes after reservation", async () => {
    const value = fixture();
    const response = reserve(value);
    moveOtherBranch(value);
    const result = await executeRrsiPmBroadRound(value.bridge, response);
    expect(result).toMatchObject({
      hostInvoked: false,
      dispatchCommitted: false,
      journalDriftDetected: true,
      independentSettlementRequired: true,
    });
    expect(value.calls.run).toBe(0);
    expect(value.adapter.inspect()).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [{ status: "unknown", dispatched: false }],
    });
    await expect(
      executeRrsiPmBroadRound(value.bridge, response),
    ).rejects.toThrow(/fresh round/);
  });

  it("detects direct journal interference during the await and retains genuine PM receipts", async () => {
    const ready = deferred(),
      finish = deferred();
    const value = fixture({
      run: async (request, runtime) => {
        runtime.recordTokens(1);
        ready.resolve();
        await finish.promise;
        return {
          outputMemoryDigest: rrsiFixtureDigest(
            `TEST drift ${request.roundId}`,
          ),
          traceDigest: rrsiFixtureDigest("TEST drift trace"),
        };
      },
    });
    const running = executeRrsiPmBroadRound(value.bridge, reserve(value));
    try {
      await ready.promise;
      moveOtherBranch(value);
    } finally {
      finish.resolve();
    }
    const result = await running;
    expect(result).toMatchObject({
      pmReceiptsVerified: true,
      journalDriftDetected: true,
      failureCode: "rrsi-pm-journal-drift",
      qualifiesForPromotion: false,
    });
    expect(
      inspectPmExplorationJournal(value.journal).checkpointDigests,
    ).toHaveLength(2);
    expect(value.adapter.inspect().executions[0]).toMatchObject({
      status: "unknown",
      costEvidenceVerified: false,
      executionObservation: {
        driftDetected: true,
        result: { receiptsAuthenticated: true },
      },
    });
  });

  it("retains actual signed results when observation acknowledgement is lost", async () => {
    let armed = false;
    const value = fixture({
      crashHook: (phase) => {
        if (armed && phase === "after-head")
          throw new Error("TEST lost observation response");
      },
      run: async (request, runtime) => {
        runtime.recordTokens(1);
        armed = true;
        return {
          outputMemoryDigest: rrsiFixtureDigest(`TEST loss ${request.roundId}`),
          traceDigest: rrsiFixtureDigest("TEST loss trace"),
        };
      },
    });
    const response = reserve(value);
    const result = await executeRrsiPmBroadRound(value.bridge, response);
    expect(result).toMatchObject({
      observationPersistence: "unknown",
      readbackRequired: true,
      pmReceiptsVerified: true,
    });
    armed = false;
    const recovered = openRrsiHistoryStore(value.root).adapter.inspect();
    expect(recovered.executions[0].executionObservation.result).toEqual(
      result.pmResult,
    );
    expect(recovered).toMatchObject({
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [{ status: "unknown" }],
    });
    await expect(
      executeRrsiPmBroadRound(value.bridge, response),
    ).rejects.toThrow(/fresh round/);
    expect(value.calls.run).toBe(1);
  });

  it("reports uncertain dispatch acknowledgement without invoking or retrying the host", async () => {
    let armed = false;
    const value = fixture({
      crashHook: (phase) => {
        if (armed && phase === "after-head")
          throw new Error("TEST dispatch response lost");
      },
    });
    const response = reserve(value);
    armed = true;
    const result = await executeRrsiPmBroadRound(value.bridge, response);
    expect(result).toMatchObject({
      dispatchPersistence: "unknown",
      dispatchCommitted: null,
      hostInvoked: false,
      observationPersistence: "not-recorded",
      readbackRequired: true,
      failureCode: "cc_rrsi_commit_unknown",
    });
    armed = false;
    expect(openRrsiHistoryStore(value.root).adapter.inspect()).toMatchObject({
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [
        {
          status: "dispatch-intent",
          dispatched: true,
          executionObservation: null,
        },
      ],
    });
    await expect(
      executeRrsiPmBroadRound(value.bridge, response),
    ).rejects.toThrow(/fresh round/);
    expect(value.calls.run).toBe(0);
  });

  it("does not treat a timed-out callback still running as cleanup or zero cost", async () => {
    const finish = deferred();
    let stillRunning = false;
    const value = fixture({
      planOverrides: { maxWallClockMs: 50 },
      run: async (_request, runtime) => {
        runtime.recordTokens(1);
        stillRunning = true;
        await finish.promise;
        stillRunning = false;
        return {
          outputMemoryDigest: rrsiFixtureDigest("TEST late output"),
          traceDigest: rrsiFixtureDigest("TEST late trace"),
        };
      },
    });
    let result;
    try {
      result = await executeRrsiPmBroadRound(value.bridge, reserve(value));
      expect(stillRunning).toBe(true);
      expect(result).toMatchObject({
        cleanupConfirmed: null,
        independentSettlementRequired: true,
        costEvidenceVerified: false,
      });
      expect(value.adapter.inspect()).toMatchObject({
        chargedResources: { maxCostMicrounits: "100000" },
        executions: [{ status: "unknown", costEvidenceVerified: false }],
      });
    } finally {
      finish.resolve();
      await finish.promise;
    }
    expect(result.qualifiesForPromotion).toBe(false);
  });
});
