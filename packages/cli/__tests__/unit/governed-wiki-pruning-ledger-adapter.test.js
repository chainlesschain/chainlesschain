import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GovernedWikiPruning,
  GOVERNED_WIKI_PRUNING_PLAN_SCHEMA,
} from "../../src/lib/evolution/governed-wiki-pruning.js";
import {
  WIKI_STATE_SCHEMA,
  digestWikiState,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  buildWikiPruningJournal,
  pruningCanonical,
  pruningDigest,
  pruningOperationCalls,
  verifyWikiPruningJournal,
  WIKI_PRUNING_JOURNAL_SCHEMA,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import {
  GovernedWikiPruningLedgerAdapter,
  captureWikiPruningJournalStore,
} from "../../src/lib/evolution/governed-wiki-pruning-ledger-adapter.js";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const D = (value) => pruningDigest("pruning-test", value);
const signature = (value) =>
  createHmac("sha256", "test-only-pruning-operation")
    .update(pruningCanonical(value))
    .digest("base64url");
function receipt(call) {
  const core = {
    authenticated: true,
    durable: true,
    requestDigest: call.requestDigest,
    receiptDigest: D(call),
  };
  return { ...core, attestation: signature(core) };
}

async function harness() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-journal-"),
  );
  roots.push(root);
  const resources = openEvolutionDurableStore(root);
  const wiki = {
    schema: WIKI_STATE_SCHEMA,
    tenantId: resources.descriptor.tenantId,
    revision: 0,
    revisionId: null,
    patterns: {},
    evidence: {},
    evidenceDependents: {},
    maintenanceRequests: {},
    skillImpact: {},
    evolutionLog: [],
    index: [],
  };
  const ack = async ({ requestDigest }) => ({
    authenticated: true,
    durable: true,
    requestDigest,
    receiptDigest: D(requestDigest),
  });
  const controllerPorts = {
    loadWikiState: async () => ({
      trusted: true,
      state: wiki,
      stateDigest: digestWikiState(wiki),
    }),
    resolveDeletionReceipt: async () => {
      throw new Error("unexpected deletion");
    },
    commitControl: ack,
    applyDependencyDispositions: ack,
    applyWikiRevision: ack,
    cryptoShred: ack,
    publishRetrievalProjection: ack,
    verifyOfflineClosure: ack,
  };
  const pruning = new GovernedWikiPruning({
    descriptor: { tenantId: wiki.tenantId },
    ports: controllerPorts,
  });
  const plan = await pruning.plan({
    expectedStateDigest: digestWikiState(wiki),
    effectiveAt: "2026-09-05T00:00:00.000Z",
  });
  const planVerifier = {
    verify: vi.fn(
      ({ plan: input }) => pruningCanonical(input) === pruningCanonical(plan),
    ),
  };
  const operationReceiptVerifier = {
    verify: vi.fn(({ requestDigest, receipt: input }) => {
      const { attestation, ...core } = input;
      return (
        core.requestDigest === requestDigest && signature(core) === attestation
      );
    }),
  };
  const open = (storage = resources, overrides = {}) =>
    new GovernedWikiPruningLedgerAdapter({
      descriptor: storage.descriptor,
      artifactPorts: storage.artifactPorts,
      ledger: storage.backend.ledger,
      ledgerArtifactResolver: storage.resolver,
      planVerifier,
      operationReceiptVerifier,
      clock: storage.clock,
      ...overrides,
    });
  return {
    root,
    resources,
    wiki,
    controllerPorts,
    plan,
    planVerifier,
    operationReceiptVerifier,
    open,
    store: open(),
  };
}

describe("Wiki pruning durable journal", () => {
  it.each([2, 3, 5])(
    "resumes the controller after checkpoint %i fails without requiring the old Wiki to remain current",
    async (failureRevision) => {
      const h = await harness();
      const effects = new Map();
      const invocations = [];
      const apply = async (call) => {
        invocations.push(call.request.operation);
        if (effects.has(call.requestDigest))
          return effects.get(call.requestDigest);
        if (call.request.operation === "wiki-revision") h.wiki.revision++;
        const result = receipt(call);
        effects.set(call.requestDigest, result);
        return result;
      };
      const ports = {
        ...h.controllerPorts,
        applyDependencyDispositions: apply,
        applyWikiRevision: apply,
        cryptoShred: apply,
        publishRetrievalProjection: apply,
      };
      delete ports.commitControl;
      const ledger = h.resources.backend.ledger;
      let failOnce = true;
      const journal = h.open(h.resources, {
        ledger: {
          read: () => ledger.read(),
          verify: () => ledger.verify(),
          appendDomainEvent(input, options) {
            if (
              failOnce &&
              input.reason.endsWith(`checkpoint ${failureRevision}`)
            ) {
              failOnce = false;
              throw new Error("checkpoint write failed");
            }
            return ledger.appendDomainEvent(input, options);
          },
        },
      });
      const first = new GovernedWikiPruning({
        descriptor: { tenantId: h.plan.tenantId },
        ports,
        journalStore: journal,
      });
      await expect(first.execute({ plan: h.plan })).rejects.toThrow(
        "checkpoint write failed",
      );
      expect(failOnce).toBe(false);
      if (failureRevision >= 3)
        expect(digestWikiState(h.wiki)).not.toBe(h.plan.wikiStateDigest);
      const reopened = h.open(openEvolutionDurableStore(h.root));
      const resumed = new GovernedWikiPruning({
        descriptor: { tenantId: h.plan.tenantId },
        ports,
        journalStore: reopened,
      });
      const completed = await resumed.resume();
      expect(completed.phase).toBe("finalized");
      expect(completed.operationReceipts).toHaveLength(3);
      expect(effects.size).toBe(3);
      expect(h.wiki.revision).toBe(1);
      const callsBeforeRetry = invocations.length;
      expect(await resumed.execute({ plan: h.plan })).toEqual(completed);
      expect(invocations).toHaveLength(callsBeforeRetry);
      expect(ledger.verify().sequence).toBe(5);
    },
  );

  it("binds the resumed controller to its exact captured policy", async () => {
    const h = await harness();
    await h.store.commit({
      state: buildWikiPruningJournal({ plan: h.plan }),
      expectedJournalDigest: null,
    });
    const invoke = vi.fn();
    const controller = new GovernedWikiPruning({
      descriptor: { tenantId: h.plan.tenantId, staleGraceDays: 31 },
      ports: { ...h.controllerPorts, applyDependencyDispositions: invoke },
      journalStore: h.store,
    });
    await expect(controller.execute({ plan: h.plan })).rejects.toThrow(
      /current trusted policy/u,
    );
    await expect(controller.resume()).rejects.toThrow(
      /current trusted policy/u,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(
      () =>
        new GovernedWikiPruning({
          descriptor: { tenantId: h.plan.tenantId },
          ports: h.controllerPorts,
          journalStore: { ...h.store },
        }),
    ).toThrow(/branded/u);
  });

  it("restores a full plan and ordered receipts from real ArtifactStore/Ledger/witness files", async () => {
    const h = await harness();
    expect((await h.store.load({ tenantId: h.plan.tenantId })).found).toBe(
      false,
    );
    let state = buildWikiPruningJournal({ plan: h.plan });
    await h.store.commit({ state, expectedJournalDigest: null });
    for (const call of pruningOperationCalls(h.plan)) {
      const next = buildWikiPruningJournal({
        plan: h.plan,
        previous: state,
        receipt: receipt(call),
      });
      await h.store.commit({
        state: next,
        expectedJournalDigest: state.journalDigest,
      });
      state = next;
    }
    const done = buildWikiPruningJournal({
      plan: h.plan,
      previous: state,
      finalize: true,
    });
    await h.store.commit({
      state: done,
      expectedJournalDigest: state.journalDigest,
    });
    const reopened = h.open(openEvolutionDurableStore(h.root));
    expect((await reopened.load({ tenantId: h.plan.tenantId })).state).toEqual(
      done,
    );
    expect(h.resources.backend.ledger.verify().sequence).toBe(5);
    await reopened.commit({
      state: done,
      expectedJournalDigest: state.journalDigest,
    });
    expect(h.resources.backend.ledger.verify().sequence).toBe(5);
    expect(captureWikiPruningJournalStore(reopened).descriptor).toEqual(
      h.resources.descriptor,
    );
  });

  it("reauthenticates every retained effect on each load through a captured batch verifier", async () => {
    const h = await harness();
    let revoked = false;
    const batch = vi.fn(
      (inputs) =>
        !revoked &&
        inputs.every((input) => h.operationReceiptVerifier.verify(input)),
    );
    const verifier = {
      verify: h.operationReceiptVerifier.verify,
      verifyAll: batch,
    };
    const store = h.open(h.resources, { operationReceiptVerifier: verifier });
    verifier.verifyAll = () => true;
    const prepared = buildWikiPruningJournal({ plan: h.plan });
    await store.commit({ state: prepared, expectedJournalDigest: null });
    const call = pruningOperationCalls(h.plan)[0];
    const state = buildWikiPruningJournal({
      plan: h.plan,
      previous: prepared,
      receipt: receipt(call),
    });
    await store.commit({
      state,
      expectedJournalDigest: prepared.journalDigest,
    });
    expect(batch).toHaveBeenCalled();
    expect(batch.mock.calls.at(-1)[0]).toMatchObject([
      { ...call, receipt: receipt(call), context: { mode: "current" } },
    ]);
    revoked = true;
    await expect(store.load({ tenantId: h.plan.tenantId })).rejects.toThrow(
      /batch authentication/u,
    );
    expect(h.resources.backend.ledger.verify().sequence).toBe(2);
  });

  it("reconciles append response loss only by authenticated readback", async () => {
    const h = await harness();
    const ledger = h.resources.backend.ledger;
    let calls = 0;
    const store = h.open(h.resources, {
      ledger: {
        read: () => ledger.read(),
        verify: () => ledger.verify(),
        appendDomainEvent: (...args) => {
          calls++;
          ledger.appendDomainEvent(...args);
          throw new Error("response lost");
        },
      },
    });
    const state = buildWikiPruningJournal({ plan: h.plan });
    expect(
      (await store.commit({ state, expectedJournalDigest: null })).state,
    ).toEqual(state);
    await store.commit({ state, expectedJournalDigest: null });
    expect(calls).toBe(1);
    expect(ledger.verify().sequence).toBe(1);
  });

  it("does not acknowledge a failed append or mutate the current checkpoint", async () => {
    const h = await harness();
    const ledger = h.resources.backend.ledger;
    const store = h.open(h.resources, {
      ledger: {
        read: () => ledger.read(),
        verify: () => ledger.verify(),
        appendDomainEvent: () => {
          throw new Error("disk failure");
        },
      },
    });
    await expect(
      store.commit({
        state: buildWikiPruningJournal({ plan: h.plan }),
        expectedJournalDigest: null,
      }),
    ).rejects.toThrow("disk failure");
    expect((await h.store.load({ tenantId: h.plan.tenantId })).found).toBe(
      false,
    );
  });

  it.each(["truncated", "identity", "race"])(
    "rejects %s snapshots without trusting a derived head",
    async (fault) => {
      const h = await harness();
      const prepared = buildWikiPruningJournal({ plan: h.plan });
      await h.store.commit({ state: prepared, expectedJournalDigest: null });
      await h.store.commit({
        state: buildWikiPruningJournal({
          plan: h.plan,
          previous: prepared,
          receipt: receipt(pruningOperationCalls(h.plan)[0]),
        }),
        expectedJournalDigest: prepared.journalDigest,
      });
      const ledger = h.resources.backend.ledger;
      const original = ledger.read();
      let armed = fault === "race";
      const store = h.open(h.resources, {
        ledger: {
          read: (options) => {
            const events = ledger.read(options);
            if (fault === "truncated") return events.slice(0, -1);
            if (fault === "identity")
              return events.map((event) => ({
                ...event,
                epoch: "forged-epoch",
              }));
            return events;
          },
          verify: () => ledger.verify(),
          appendDomainEvent: () => {
            throw new Error("unexpected journal write");
          },
        },
        planVerifier: {
          verify: () => {
            if (armed) {
              armed = false;
              const head = ledger.verify();
              ledger.appendDomainEvent(
                {
                  artifactTenantId: h.resources.descriptor.artifactTenantId,
                  correlationId: "external",
                  decision: "committed",
                  eventId: "test.journal-read-race",
                  reason: "Concurrent domain append",
                  skillName: null,
                  sourceRefs: [],
                  subjectRef: original[0].subjectRef,
                  tenantId: h.plan.tenantId,
                  timestamp: "2026-09-05T00:00:00.000Z",
                  type: "test.other-domain",
                },
                {
                  expectedHeadDigest: head.headDigest,
                  expectedSequence: head.sequence,
                },
              );
            }
            return true;
          },
        },
      });
      await expect(store.load({ tenantId: h.plan.tenantId })).rejects.toThrow();
      expect(ledger.verify().sequence).toBe(fault === "race" ? 3 : 2);
    },
  );

  it("rejects forged receipts, current authorization revocation, and stale CAS", async () => {
    const h = await harness();
    const state = buildWikiPruningJournal({ plan: h.plan });
    await h.store.commit({ state, expectedJournalDigest: null });
    const valid = receipt(pruningOperationCalls(h.plan)[0]);
    const forged = buildWikiPruningJournal({
      plan: h.plan,
      previous: state,
      receipt: { ...valid, attestation: "forged" },
    });
    await expect(
      h.store.commit({
        state: forged,
        expectedJournalDigest: state.journalDigest,
      }),
    ).rejects.toThrow(/authentication/u);
    const next = buildWikiPruningJournal({
      plan: h.plan,
      previous: state,
      receipt: valid,
    });
    await expect(
      h.store.commit({ state: next, expectedJournalDigest: D("stale") }),
    ).rejects.toThrow(/changed before commit/u);
    await h.store.commit({
      state: next,
      expectedJournalDigest: state.journalDigest,
    });
    h.operationReceiptVerifier.verify.mockReturnValue(false);
    await expect(h.store.load({ tenantId: h.plan.tenantId })).rejects.toThrow(
      /authentication/u,
    );
    h.planVerifier.verify.mockReturnValue(false);
    await expect(h.store.load({ tenantId: h.plan.tenantId })).rejects.toThrow(
      /authorization/u,
    );
  });

  it("allows only one independently valid successor to win the same checkpoint", async () => {
    const h = await harness();
    const prepared = buildWikiPruningJournal({ plan: h.plan });
    await h.store.commit({ state: prepared, expectedJournalDigest: null });
    const original = receipt(pruningOperationCalls(h.plan)[0]);
    const alteredCore = {
      ...original,
      receiptDigest: D("alternate valid receipt"),
    };
    delete alteredCore.attestation;
    const different = { ...alteredCore, attestation: signature(alteredCore) };
    const states = [original, different].map((ack) =>
      buildWikiPruningJournal({
        plan: h.plan,
        previous: prepared,
        receipt: ack,
      }),
    );
    const outcomes = await Promise.allSettled(
      states.map((state) =>
        h
          .open()
          .commit({ state, expectedJournalDigest: prepared.journalDigest }),
      ),
    );
    expect(
      outcomes.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(h.resources.backend.ledger.verify().sequence).toBe(2);
  });

  it("rejects unbranded storage handles and resolver substitutes", async () => {
    const h = await harness();
    expect(() => captureWikiPruningJournalStore({ ...h.store })).toThrow(
      /branded/u,
    );
    expect(() =>
      h.open(h.resources, {
        ledgerArtifactResolver: () => ({ authenticated: true }),
      }),
    ).toThrow(/branded/u);
    await expect(h.store.load({ tenantId: "other" })).rejects.toThrow(/scope/u);
  });

  it("rejects jump-ahead finalization and replacement of an unfinished plan", async () => {
    const h = await harness();
    const prepared = buildWikiPruningJournal({ plan: h.plan });
    expect(() =>
      buildWikiPruningJournal({
        plan: h.plan,
        previous: prepared,
        finalize: true,
      }),
    ).toThrow(/progress/u);
    const { planDigest: ignored, ...core } = h.plan;
    const otherCore = { ...core, effectiveAt: "2026-09-06T00:00:00.000Z" };
    const other = {
      ...otherCore,
      planDigest: pruningDigest(GOVERNED_WIKI_PRUNING_PLAN_SCHEMA, otherCore),
    };
    expect(() =>
      buildWikiPruningJournal({ plan: other, previous: prepared }),
    ).toThrow(/unfinished plan/u);
    expect(ignored).toMatch(/^sha256:/u);
  });

  it("rejects accessors and proxy inputs without invoking traps", async () => {
    const h = await harness();
    const state = buildWikiPruningJournal({ plan: h.plan });
    const getter = vi.fn(() => state.plan);
    const accessor = { ...state };
    Object.defineProperty(accessor, "plan", { get: getter, enumerable: true });
    expect(() => verifyWikiPruningJournal(accessor, h.plan.tenantId)).toThrow(
      /unsafe/u,
    );
    const trap = vi.fn();
    const proxy = new Proxy(state, {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    });
    expect(() => verifyWikiPruningJournal(proxy, h.plan.tenantId)).toThrow(
      /plain data/u,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
    expect(state.schema).toBe(WIKI_PRUNING_JOURNAL_SCHEMA);
  });

  it("rejects redigested step skips and replacement of a persisted receipt", async () => {
    const h = await harness();
    const prepared = buildWikiPruningJournal({ plan: h.plan });
    await h.store.commit({ state: prepared, expectedJournalDigest: null });
    const calls = pruningOperationCalls(h.plan);
    const first = buildWikiPruningJournal({
      plan: h.plan,
      previous: prepared,
      receipt: receipt(calls[0]),
    });
    const { journalDigest: ignored, ...firstCore } = first;
    const skippedCore = {
      ...firstCore,
      operationReceipts: [receipt(calls[0]), receipt(calls[1])],
    };
    const skipped = {
      ...skippedCore,
      journalDigest: pruningDigest(WIKI_PRUNING_JOURNAL_SCHEMA, skippedCore),
    };
    await expect(
      h.store.commit({
        state: skipped,
        expectedJournalDigest: prepared.journalDigest,
      }),
    ).rejects.toThrow(/one step/u);
    await h.store.commit({
      state: first,
      expectedJournalDigest: prepared.journalDigest,
    });
    const second = buildWikiPruningJournal({
      plan: h.plan,
      previous: first,
      receipt: receipt(calls[1]),
    });
    const altered = structuredClone(second);
    altered.operationReceipts[0].receiptDigest = D("rewritten history");
    const { attestation: oldSignature, ...receiptCore } =
      altered.operationReceipts[0];
    altered.operationReceipts[0].attestation = signature(receiptCore);
    delete altered.journalDigest;
    const forged = {
      ...altered,
      journalDigest: pruningDigest(WIKI_PRUNING_JOURNAL_SCHEMA, altered),
    };
    await expect(
      h.store.commit({
        state: forged,
        expectedJournalDigest: first.journalDigest,
      }),
    ).rejects.toThrow(/retain receipts/u);
    expect(h.resources.backend.ledger.verify().sequence).toBe(2);
    expect(ignored).toMatch(/^sha256:/u);
    expect(oldSignature).toBeTypeOf("string");
  });

  it("keeps branded persistence ports separate from subclass overrides", async () => {
    const h = await harness();
    class Substitute extends GovernedWikiPruningLedgerAdapter {
      load() {
        throw new Error("substituted read");
      }
      commit() {
        throw new Error("substituted write");
      }
    }
    const store = new Substitute({
      descriptor: h.resources.descriptor,
      artifactPorts: h.resources.artifactPorts,
      ledger: h.resources.backend.ledger,
      ledgerArtifactResolver: h.resources.resolver,
      planVerifier: h.planVerifier,
      operationReceiptVerifier: h.operationReceiptVerifier,
      clock: h.resources.clock,
    });
    const ports = captureWikiPruningJournalStore(store);
    const state = buildWikiPruningJournal({ plan: h.plan });
    await ports.commit({ state, expectedJournalDigest: null });
    expect((await ports.load({ tenantId: h.plan.tenantId })).state).toEqual(
      state,
    );
    expect(() => store.load()).toThrow("substituted read");
  });

  it("allows journal retention only for the evolution-ledger purpose", async () => {
    const h = await harness();
    expect(() =>
      h.resources.artifactPorts.putCanonical(
        "wiki-pruning-journal",
        { checkpoint: "test" },
        {
          audience: h.resources.descriptor.audience,
          purpose: "skill-mutation",
          retention: "ledger",
        },
      ),
    ).toThrow();
  });

  it("bounds journal input bytes and rejects sparse arrays", async () => {
    const h = await harness();
    const prepared = buildWikiPruningJournal({ plan: h.plan });
    expect(() =>
      verifyWikiPruningJournal(
        { ...prepared, extra: "x".repeat(1024 * 1024) },
        h.plan.tenantId,
      ),
    ).toThrow(/budget/u);
    const sparse = { ...prepared, operationReceipts: new Array(3) };
    expect(() => verifyWikiPruningJournal(sparse, h.plan.tenantId)).toThrow(
      /array/u,
    );
  });
});
