import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRrsiHistoryLedgerAdapter,
  createRrsiSettlementVerifier,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  buildRrsiCampaign,
  buildRrsiCandidate,
  buildRrsiDatasetManifest,
} from "../../src/lib/evolution/rrsi-contracts.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiDatasetInput,
  rrsiFixtureDigest,
} from "../fixtures/rrsi-shadow-fixture.js";

const roots = [];
function fixture(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(tmpdir()), "rrsi-history-unit-"),
  );
  roots.push(root);
  return {
    ...openRrsiHistoryStore(root, { initialize: true, ...options }),
    root,
  };
}
function anotherCandidate(campaign, id) {
  return buildRrsiCandidate(campaign, rrsiCandidateInput(campaign, id));
}
function reserveAndSettle(value, request = value.request()) {
  const response = value.adapter.reserve(request);
  value.adapter.recordDispatch(response);
  value.adapter.settle(
    value.signSettlement(response.reservation, {
      receiptId: `receipt-${request.executionId}`,
    }),
  );
  return response;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      !resolved.startsWith(
        fs.realpathSync.native(tmpdir()) + path.sep + "rrsi-history-unit-",
      )
    )
      throw new Error("unsafe test cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("RRSI authenticated durable controls", () => {
  it("registers idempotently and reopens the same root without resetting scope", () => {
    const value = fixture();
    expect(value.adapter.registerCampaign(value.campaign).newlyCommitted).toBe(
      true,
    );
    expect(value.adapter.registerCampaign(value.campaign).newlyCommitted).toBe(
      false,
    );
    const reopened = openRrsiHistoryStore(value.root);
    expect(reopened.adapter.inspect()).toMatchObject({
      historyAuthenticated: true,
      campaignCount: 1,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    expect(reopened.adapter.descriptor.scopeId).toBe(
      value.adapter.descriptor.scopeId,
    );
  });

  it("durably charges five ceilings before returning a fresh reservation", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const reserved = value.adapter.reserve(value.request());
    expect(reserved.newlyCommitted).toBe(true);
    expect(value.adapter.inspect()).toMatchObject({
      candidateCount: 1,
      selectionQueries: 1,
      chargedResources: {
        maxTokens: "10000",
        maxToolCalls: "100",
        maxWallClockMs: "10000",
        maxCostMicrounits: "100000",
        maxExecutions: "1000",
      },
    });
    const recovered = openRrsiHistoryStore(value.root).adapter.reserve(
      value.request(),
    );
    expect(recovered.newlyCommitted).toBe(false);
    expect(() =>
      value.adapter.recordDispatch(JSON.parse(JSON.stringify(reserved))),
    ).toThrow(/fresh reservation/);
    expect(() => value.adapter.recordDispatch(recovered)).toThrow(
      /fresh reservation/,
    );
    expect(value.adapter.recordDispatch(reserved).newlyCommitted).toBe(true);
    expect(() => value.adapter.recordDispatch(reserved)).toThrow(
      /fresh reservation/,
    );
  });

  it("rejects changed payload under the same execution identity", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    value.adapter.reserve(value.request());
    const changed = value.request();
    changed.budget.maxTokens++;
    expect(() => value.adapter.reserve(changed)).toThrow(/different data/);
    expect(value.adapter.inspect().selectionQueries).toBe(1);
  });

  it("refuses forged, foreign, and changed receipt bindings before releasing budget", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(response);
    const signed = value.signSettlement(response.reservation);
    signed.core.usage.costMicrounits = 0;
    expect(() => value.adapter.settle(signed)).toThrow(/signature/);
    const changedBinding = value.signSettlement(response.reservation, {
      bindings: {
        ...response.reservation.bindings,
        executionDigest: rrsiFixtureDigest("other environment"),
      },
    });
    expect(() => value.adapter.settle(changedBinding)).toThrow(
      /bind the reserved/,
    );
    const foreign = value.signSettlement(response.reservation);
    foreign.attestation.authorityId = "other-authority";
    expect(() => value.adapter.settle(foreign)).toThrow(/authority differs/);
    expect(value.adapter.inspect().chargedResources.maxCostMicrounits).toBe(
      "100000",
    );
  });

  it("only independent complete settlement replaces ceilings with actual usage", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = reserveAndSettle(value);
    const status = value.adapter.inspect();
    expect(status.selectionQueries).toBe(1);
    expect(status.chargedResources).toMatchObject({
      maxTokens: "1000",
      maxCostMicrounits: "10000",
      maxExecutions: "960",
    });
    expect(status.executions[0]).toMatchObject({
      status: "settled",
      settlementSignatureVerified: true,
      executionEvidenceVerified: true,
      costEvidenceVerified: true,
    });
    expect(
      value.adapter.settle(
        value.signSettlement(response.reservation, {
          receiptId: "receipt-rrsi-execution-1",
        }),
      ),
    ).toBe(false);
    expect(
      openRrsiHistoryStore(value.root).adapter.inspect().chargedResources,
    ).toEqual(status.chargedResources);
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
        executions: 960,
      },
    },
  ])(
    "keeps ceilings and unknown state for incomplete signed settlement %#",
    (overrides) => {
      const value = fixture();
      value.adapter.registerCampaign(value.campaign);
      const response = value.adapter.reserve(value.request());
      value.adapter.recordDispatch(response);
      value.adapter.settle(
        value.signSettlement(response.reservation, overrides),
      );
      expect(value.adapter.inspect()).toMatchObject({
        selectionQueries: 1,
        chargedResources: { maxCostMicrounits: "100000" },
        executions: [{ status: "unknown", costEvidenceVerified: false }],
      });
      expect(() =>
        value.adapter.freezeCandidate({
          campaignDigest: value.campaign.campaignDigest,
          contentDigest: value.candidate.contentDigest,
        }),
      ).toThrow(/complete history accounting/);
      value.adapter.settle(
        value.signSettlement(response.reservation, {
          receiptId: "later-complete-settlement",
        }),
      );
      expect(value.adapter.inspect().executions[0].status).toBe("settled");
    },
  );

  it("retains independently signed overruns and blocks further admission", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(response);
    value.adapter.settle(
      value.signSettlement(response.reservation, {
        usage: {
          tokens: 1000,
          toolCalls: 10,
          wallClockMs: 1000,
          costMicrounits: 200_000,
          executions: 960,
        },
      }),
    );
    expect(value.adapter.inspect()).toMatchObject({
      budgetOverrun: true,
      chargedResources: { maxCostMicrounits: "200000" },
    });
    const request = value.request({
      executionId: "execution-2",
      slotId: "slot-2",
      candidate: anotherCandidate(value.campaign, "candidate-2"),
    });
    expect(() => value.adapter.reserve(request)).toThrow(/overrun/);
  });

  it("revalidates historic accepted settlement at its original acceptance time", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    reserveAndSettle(value);
    const reopened = openRrsiHistoryStore(value.root, {
      now: () => value.store.clock() + 24 * 60 * 60 * 1000,
    });
    expect(reopened.adapter.inspect().executions[0].status).toBe("settled");
  });

  it("rejects expired new evidence and insufficient successful denominators", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(response);
    expect(() =>
      value.adapter.settle(
        value.signSettlement(response.reservation, {
          issuedAt: new Date(value.store.clock() - 1000).toISOString(),
          validUntil: new Date(value.store.clock() - 1).toISOString(),
        }),
      ),
    ).toThrow(/acceptance window/);
    expect(() =>
      value.adapter.settle(
        value.signSettlement(response.reservation, {
          usage: {
            tokens: 0,
            toolCalls: 0,
            wallClockMs: 0,
            costMicrounits: 0,
            executions: 0,
          },
        }),
      ),
    ).toThrow(/frozen execution denominator/);
  });

  it("does not turn signed not-started status into completed evaluation", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
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
      selectionQueries: 1,
      chargedResources: { maxCostMicrounits: "0" },
      executions: [{ executionEvidenceVerified: false }],
    });
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: value.campaign.campaignDigest,
        contentDigest: value.candidate.contentDigest,
      }),
    ).toThrow(/successful selection/);
    expect(() =>
      value.adapter.reserve(
        value.request({ executionId: "execution-2", slotId: "slot-2" }),
      ),
    ).toThrow(/already been consumed/);
  });

  it("cannot reset policy or budgets by registering a new campaign ID", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const input = rrsiCampaignInput();
    input.campaignId = "new-campaign";
    input.budget.totalPerArm.maxTokens++;
    expect(() =>
      value.adapter.registerCampaign(buildRrsiCampaign(input)),
    ).toThrow(/cannot be reset/);
  });

  it("persists unknown executions and never grants dispatch on reopen", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
    value.adapter.markUnknown({
      executionId: response.reservation.bindings.executionId,
      reservationDigest: response.reservation.reservationDigest,
    });
    const reopened = openRrsiHistoryStore(value.root);
    expect(reopened.adapter.inspect().executions[0].status).toBe("unknown");
    expect(() =>
      reopened.adapter.recordDispatch(
        reopened.adapter.reserve(reopened.request()),
      ),
    ).toThrow(/fresh reservation/);
    expect(() => value.adapter.recordDispatch(response)).toThrow(
      /cannot be dispatched/,
    );
  });

  it("prevents renamed candidate identities from obtaining another query", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    value.adapter.reserve(value.request());
    const candidateInput = rrsiCandidateInput(value.campaign);
    candidateInput.candidateId = "alias-candidate";
    const alias = buildRrsiCandidate(value.campaign, candidateInput);
    expect(() =>
      value.adapter.reserve(
        value.request({
          candidate: alias,
          executionId: "alias-execution",
          slotId: "alias-slot",
        }),
      ),
    ).toThrow(/another candidate identity/);
  });

  it("enforces pending resource totals across unrelated slots", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const first = value.request();
    first.budget.maxTokens = 300_000;
    value.adapter.reserve(first);
    const next = value.request({
      executionId: "execution-2",
      slotId: "slot-2",
      candidate: anotherCandidate(value.campaign, "candidate-2"),
    });
    next.budget.maxTokens = 300_000;
    expect(() => value.adapter.reserve(next)).toThrow(/budget is exhausted/);
    expect(value.adapter.inspect().selectionQueries).toBe(1);
  });

  it("permits one finalist and never restores final-pool queries after settlement", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    reserveAndSettle(value);
    expect(
      value.adapter.freezeCandidate({
        campaignDigest: value.campaign.campaignDigest,
        contentDigest: value.candidate.contentDigest,
      }),
    ).toBe(true);
    const request = value.request({
      partition: "gate-test",
      executionId: "test-execution",
      slotId: "test-slot",
    });
    request.budget.maxExecutions = 150;
    const response = reserveAndSettle(value, request);
    expect(response.reservation.plannedExecutions).toBe(120);
    const repeated = {
      ...request,
      executionId: "test-execution-again",
      slotId: "test-slot-again",
    };
    expect(() => value.adapter.reserve(repeated)).toThrow(
      /already been consumed/,
    );
    expect(() =>
      value.adapter.reserve(
        value.request({
          candidate: anotherCandidate(value.campaign, "late-candidate"),
          executionId: "late",
          slotId: "late",
        }),
      ),
    ).toThrow(/further selection/);
  });

  it("checks exposed holdout content/source identities across renamed manifests", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    reserveAndSettle(value);
    value.adapter.freezeCandidate({
      campaignDigest: value.campaign.campaignDigest,
      contentDigest: value.candidate.contentDigest,
    });
    const firstTest = value.request({
      partition: "gate-test",
      executionId: "test-1",
      slotId: "test-1",
    });
    firstTest.budget.maxExecutions = 150;
    reserveAndSettle(value, firstTest);
    const campaignInput = rrsiCampaignInput();
    campaignInput.campaignId = "alias-campaign";
    const dataset = rrsiDatasetInput();
    dataset.manifestId = "alias-manifest";
    dataset.tasks.forEach((task) => {
      task.id = `alias-${task.id}`;
    });
    campaignInput.dataset = buildRrsiDatasetManifest(dataset);
    const campaign = buildRrsiCampaign(campaignInput);
    value.adapter.registerCampaign(campaign);
    const candidateInput = rrsiCandidateInput(campaign, "candidate-2");
    candidateInput.sourceTaskIds = ["alias-train-task-0"];
    const candidate = buildRrsiCandidate(campaign, candidateInput);
    const select = value.request({
      campaignDigest: campaign.campaignDigest,
      candidate,
      executionId: "select-2",
      slotId: "select-2",
    });
    reserveAndSettle(value, select);
    value.adapter.freezeCandidate({
      campaignDigest: campaign.campaignDigest,
      contentDigest: candidate.contentDigest,
    });
    const secondTest = {
      ...select,
      partition: "gate-test",
      executionId: "test-2",
      slotId: "test-2",
      budget: { ...select.budget, maxExecutions: 150 },
    };
    expect(() => value.adapter.reserve(secondTest)).toThrow(
      /previously exposed/,
    );
  });

  it("allows no refunds without an independent configured verifier", () => {
    const value = fixture({ settlementEnabled: false });
    value.adapter.registerCampaign(value.campaign);
    const response = value.adapter.reserve(value.request());
    value.adapter.recordDispatch(response);
    expect(() =>
      value.adapter.settle(value.signSettlement(response.reservation)),
    ).toThrow(/verification is unavailable/);
    expect(value.adapter.inspect().chargedResources.maxCostMicrounits).toBe(
      "100000",
    );
  });

  it("records training exposure across campaigns before any query starts", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const dataset = rrsiDatasetInput();
    const training = dataset.tasks.find((task) => task.id === "train-task-0");
    const audit = dataset.tasks.find((task) => task.id === "audit-task-0");
    const old = {
      contentDigest: training.contentDigest,
      groups: training.groups,
    };
    training.contentDigest = audit.contentDigest;
    training.groups = audit.groups;
    audit.contentDigest = old.contentDigest;
    audit.groups = old.groups;
    const input = rrsiCampaignInput();
    input.campaignId = "moved-training-to-audit";
    input.dataset = buildRrsiDatasetManifest(dataset);
    const campaign = buildRrsiCampaign(input);
    value.adapter.registerCampaign(campaign);
    const candidate = anotherCandidate(campaign, "candidate-2");
    reserveAndSettle(
      value,
      value.request({
        campaignDigest: campaign.campaignDigest,
        candidate,
        executionId: "select-2",
        slotId: "select-2",
      }),
    );
    value.adapter.freezeCandidate({
      campaignDigest: campaign.campaignDigest,
      contentDigest: candidate.contentDigest,
    });
    const query = value.request({
      campaignDigest: campaign.campaignDigest,
      candidate,
      partition: "audit",
      executionId: "audit-2",
      slotId: "audit-2",
    });
    query.budget.maxExecutions = 150;
    expect(() => value.adapter.reserve(query)).toThrow(/previously exposed/);
  });

  it("does not retire previously queried holdouts to training implicitly", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    reserveAndSettle(value);
    value.adapter.freezeCandidate({
      campaignDigest: value.campaign.campaignDigest,
      contentDigest: value.candidate.contentDigest,
    });
    const query = value.request({
      partition: "audit",
      executionId: "audit-1",
      slotId: "audit-1",
    });
    query.budget.maxExecutions = 150;
    value.adapter.reserve(query);
    const dataset = rrsiDatasetInput();
    const training = dataset.tasks.find((task) => task.id === "train-task-0");
    const audit = dataset.tasks.find((task) => task.id === "audit-task-0");
    const old = {
      contentDigest: training.contentDigest,
      groups: training.groups,
    };
    training.contentDigest = audit.contentDigest;
    training.groups = audit.groups;
    audit.contentDigest = old.contentDigest;
    audit.groups = old.groups;
    const input = rrsiCampaignInput();
    input.campaignId = "retire-holdout-implicitly";
    input.dataset = buildRrsiDatasetManifest(dataset);
    expect(() =>
      value.adapter.registerCampaign(buildRrsiCampaign(input)),
    ).toThrow(/explicit retirement/);
  });

  it("cannot freeze with an unresolved competitor even after selected execution settles", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    reserveAndSettle(value);
    value.adapter.reserve(
      value.request({
        candidate: anotherCandidate(value.campaign, "candidate-2"),
        executionId: "pending-2",
        slotId: "pending-2",
      }),
    );
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: value.campaign.campaignDigest,
        contentDigest: value.candidate.contentDigest,
      }),
    ).toThrow(/complete history accounting/);
  });

  it("binds reservation and settlement identity to the actual Ledger root", () => {
    const first = fixture();
    first.adapter.registerCampaign(first.campaign);
    const one = first.adapter.reserve(first.request());
    first.adapter.recordDispatch(one);
    const evidence = first.signSettlement(one.reservation);
    const second = fixture();
    const adapter = createRrsiHistoryLedgerAdapter({
      backend: second.store.backend,
      artifactPorts: second.store.artifactPorts,
      ledgerArtifactResolver: second.store.resolver,
      descriptor: {
        tenantId: "synthetic-tenant",
        artifactTenantId: "rrsi-artifacts",
        goalId: "pm-task-change-export",
        audience: "rrsi-runtime",
        purpose: "evolution-ledger",
      },
      settlementVerifier: first.settlementVerifier,
      now: second.store.clock,
    });
    adapter.registerCampaign(second.campaign);
    const two = adapter.reserve(second.request());
    adapter.recordDispatch(two);
    expect(two.reservation.reservationDigest).not.toBe(
      one.reservation.reservationDigest,
    );
    expect(() => adapter.settle(evidence)).toThrow(/binding differs/);
    expect(adapter.inspect().chargedResources.maxCostMicrounits).toBe("100000");
  });

  it("cannot assign one source receipt to different executions", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const first = reserveAndSettle(value);
    const second = value.adapter.reserve(
      value.request({
        candidate: anotherCandidate(value.campaign, "candidate-2"),
        executionId: "execution-2",
        slotId: "slot-2",
      }),
    );
    value.adapter.recordDispatch(second);
    const sourceReceiptDigests = value.signSettlement(first.reservation).core
      .sourceReceiptDigests;
    expect(() =>
      value.adapter.settle(
        value.signSettlement(second.reservation, {
          receiptId: "receipt-2",
          sourceReceiptDigests,
        }),
      ),
    ).toThrow(/another reservation/);
  });

  it("rejects forged storage/verification composition and changed pinned authority", () => {
    const value = fixture();
    value.adapter.registerCampaign(value.campaign);
    const compose = (backend, verifier) =>
      createRrsiHistoryLedgerAdapter({
        backend,
        artifactPorts: value.store.artifactPorts,
        ledgerArtifactResolver: value.store.resolver,
        descriptor: {
          tenantId: "synthetic-tenant",
          artifactTenantId: "rrsi-artifacts",
          goalId: "pm-task-change-export",
          audience: "rrsi-runtime",
          purpose: "evolution-ledger",
        },
        settlementVerifier: verifier,
        now: value.store.clock,
      });
    expect(() =>
      compose({ ...value.store.backend }, value.settlementVerifier),
    ).toThrow(/branded/);
    expect(() => compose(value.store.backend, { verify: () => true })).toThrow(
      /branded/,
    );
    const keys = generateKeyPairSync("ed25519");
    const replacement = createRrsiSettlementVerifier({
      publicKey: keys.publicKey,
      authorityId: "rrsi-test-settlement",
      trustPolicyDigest: value.settlementVerifier.descriptor.trustPolicyDigest,
    });
    expect(() => compose(value.store.backend, replacement)).toThrow(
      /identity differs/,
    );
  });
});
