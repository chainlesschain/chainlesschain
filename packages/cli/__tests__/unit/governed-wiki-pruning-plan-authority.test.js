import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  WIKI_REVISION_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import {
  WikiMaintainerLedgerAdapter,
  captureWikiRevisionReader,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import { createWikiPruningPlanner } from "../../src/lib/evolution/governed-wiki-pruning.js";
import { GovernedWikiPruningPlanAuthority } from "../../src/lib/evolution/governed-wiki-pruning-plan-authority.js";
import {
  GovernedWikiPruningLedgerAdapter,
  WIKI_PRUNING_JOURNAL_EVENT_TYPE,
} from "../../src/lib/evolution/governed-wiki-pruning-ledger-adapter.js";
import {
  GOVERNED_WIKI_PRUNING_PLAN_SCHEMA,
  buildWikiPruningJournal,
  pruningCanonical,
  pruningDigest,
  pruningOperationCalls,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const effectiveAt = "2026-09-05T00:00:00.000Z";
const CURRENT = Object.freeze({ mode: "current", checkpoint: null });
const checkpoint = (event) =>
  Object.fromEntries([
    ["epoch", event.epoch],
    ["ledgerId", event.ledgerId],
    ["identityDigest", event.identityDigest],
    ["sequence", event.sequence],
    ["headDigest", event.eventDigest],
  ]);
function ack(call) {
  const core = {
    authenticated: true,
    durable: true,
    requestDigest: call.requestDigest,
    receiptDigest: D(call),
  };
  return {
    ...core,
    attestation: createHmac("sha256", "test-pruning-effects")
      .update(pruningCanonical(core))
      .digest("hex"),
  };
}
function verifyAck({ requestDigest, receipt }) {
  const { attestation, ...core } = receipt;
  return (
    requestDigest === core.requestDigest &&
    attestation ===
      createHmac("sha256", "test-pruning-effects")
        .update(pruningCanonical(core))
        .digest("hex")
  );
}

async function harness() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-plan-authority-"),
  );
  roots.push(root);
  const resources = openEvolutionDurableStore(root);
  const tenantId = resources.descriptor.tenantId;
  const descriptor = {
    tenantId,
    streamId: "pruning",
    staleGraceDays: 30,
    maxActions: 512,
  };
  const wikiOptions = {
    descriptor: { ...resources.descriptor, evolutionRunId: "wiki-pruning" },
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
  };
  const wiki = new WikiMaintainerLedgerAdapter(wikiOptions);
  const evidenceCore = {
    schema: WIKI_EVIDENCE_SCHEMA,
    tenantId,
    ref: "ev-pruning",
    sourceDigest: D("source"),
    projectionDigest: D("projection"),
    artifactRef: `artifact://${tenantId}/trusted/ev-pruning`,
    trustedProjection: true,
    trustDomain: "test-pruning",
    kind: "tool-observation",
    status: "active",
    observedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: null,
    data: { outcome: "verified" },
  };
  const evidence = { ...evidenceCore, envelopeDigest: D(evidenceCore) };
  const maintainerDescriptor = {
    tenantId,
    evolutionRunId: "wiki-pruning",
    maintainerModel: "test:deterministic-pruning",
    rulesDigest: D("deterministic-pruning-rules"),
  };
  const maintenanceRequest = (requestDigest) => ({
    schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
    tenantId,
    requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
    requestDigest,
  });
  async function maintain(
    operations,
    requestDigest = null,
    at = effectiveAt,
    source = null,
  ) {
    const base = source
      ? {
          loadWiki: () => source,
          commitRevision: ({ revision }) => ({
            committed: true,
            revisionId: revision.revisionId,
            stateDigest: revision.stateDigest,
            evolutionRunId: revision.evolutionRunId,
          }),
        }
      : wiki;
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: maintainerDescriptor,
      policy: {
        trustedProjectionRead: true,
        rawEvidenceRead: false,
        activeSkillWrite: false,
        shell: false,
        network: false,
        secretRead: false,
      },
      ports: {
        loadWiki: base.loadWiki,
        commitRevision: base.commitRevision,
        resolveEvidence: async () => evidence,
        derive: async () => ({ operations }),
      },
    });
    return maintainer.maintain({
      evidenceRefs: [evidence.ref],
      effectiveAt: at,
      ...(requestDigest
        ? { maintenanceRequest: maintenanceRequest(requestDigest) }
        : {}),
    });
  }
  await maintain([
    {
      type: "upsert",
      pattern: {
        patternId: "pat-pruning",
        kind: "success",
        summary: "Old bounded procedure",
        rootCause: "Expiry is explicit",
        procedure: "Verify before use",
        appliesWhen: ["tests exist"],
        doesNotApplyWhen: [],
        positiveEvidence: [evidence.ref],
        negativeEvidence: [],
        contradicts: [],
        supersedes: [],
        confidence: 0.8,
        trustDomains: [],
        lastVerifiedAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2026-07-01T00:00:00.000Z",
        skillNames: [],
      },
    },
  ]);
  const deletionDigest = D("delete-pruning");
  let deletionAllowed = true;
  const deletionReceipts = {
    resolve: vi.fn(async ({ receiptDigest }) => {
      if (!deletionAllowed || receiptDigest !== deletionDigest)
        throw new Error("deletion authority revoked");
      return {
        authenticated: true,
        tenantId,
        decision: "delete",
        receiptDigest,
        evidenceRef: evidence.ref,
        sourceDigest: evidence.sourceDigest,
        artifactRef: evidence.artifactRef,
        rawArtifactRef: `artifact://${tenantId}/raw/ev-pruning`,
        rawCipherDigest: D("cipher"),
        keyRef: `kms://${tenantId}/pruning`,
      };
    }),
  };
  const wikiMaintenance = {
    requestDigests: vi.fn(({ plan }) => [
      pruningOperationCalls(plan)[1].requestDigest,
    ]),
    // Independent deterministic replay, not a request-id echo. No durable write
    // is made by this verifier. Non-Wiki effects below use signed test receipts;
    // this fixture is not the real rollback/shred/retrieval composition.
    verifySuccessors: vi.fn(async ({ plan, history }) => {
      if (history.successors.length === 0) return true;
      if (history.successors.length !== 1) return false;
      const revision = history.successors[0].revision;
      const expected = await maintain(
        plan.patternActions,
        pruningOperationCalls(plan)[1].requestDigest,
        plan.effectiveAt,
        history.source,
      );
      return (
        revision.rulesDigest === maintainerDescriptor.rulesDigest &&
        revision.maintainerModel === maintainerDescriptor.maintainerModel &&
        revision.operationDigest === D(plan.patternActions) &&
        revision.revisionId === expected.revisionId &&
        revision.stateDigest === expected.stateDigest &&
        pruningCanonical(revision.state) === pruningCanonical(expected.state)
      );
    }),
  };
  const makeAuthority = (overrides = {}) =>
    new GovernedWikiPruningPlanAuthority({
      descriptor,
      wikiLedgerAdapter: wiki,
      deletionReceipts,
      wikiMaintenance,
      ...overrides,
    });
  const authority = makeAuthority();
  const planner = createWikiPruningPlanner({
    descriptor,
    ports: {
      loadWikiState: wiki.loadWiki,
      resolveDeletionReceipt: deletionReceipts.resolve,
    },
  });
  const plan = (deletions = [], at = effectiveAt) =>
    planner.plan({
      expectedStateDigest: wiki.loadWiki().stateDigest,
      effectiveAt: at,
      deletionReceiptDigests: deletions,
    });
  const verify = (plan, context = CURRENT, facade = authority.verifier()) =>
    facade.verify({
      plan,
      tenantId,
      streamId: descriptor.streamId,
      context:
        context === CURRENT
          ? {
              mode: "current",
              checkpoint: {
                ...checkpoint(resources.backend.ledger.read().at(-1)),
              },
            }
          : context,
    });
  const openJournal = (storage = resources, overrides = {}) =>
    new GovernedWikiPruningLedgerAdapter({
      descriptor: storage.descriptor,
      artifactPorts: storage.artifactPorts,
      ledger: storage.backend.ledger,
      ledgerArtifactResolver: storage.resolver,
      planVerifier: authority.verifier(),
      operationReceiptVerifier: { verify: verifyAck },
      clock: storage.clock,
      ...overrides,
    });
  return {
    root,
    resources,
    tenantId,
    descriptor,
    wiki,
    wikiOptions,
    maintain,
    maintainerDescriptor,
    authority,
    makeAuthority,
    wikiMaintenance,
    deletionReceipts,
    deletionDigest,
    revokeDeletion: () => {
      deletionAllowed = false;
    },
    plan,
    verify,
    openJournal,
  };
}

describe("Wiki pruning plan authority", () => {
  it("rebuilds a plan from real Wiki history and independently verifies its actual successor", async () => {
    const h = await harness();
    const plan = await h.plan();
    expect(plan.patternActions).toEqual([
      {
        type: "tombstone",
        patternId: "pat-pruning",
        reason: "stale-grace-elapsed",
      },
    ]);
    expect(await h.verify(plan)).toBe(true);
    await h.maintain(
      plan.patternActions,
      pruningOperationCalls(plan)[1].requestDigest,
    );
    expect(await h.verify(plan)).toBe(true);
    expect(h.wiki.loadWiki().state.patterns["pat-pruning"].status).toBe(
      "tombstoned",
    );
    expect(h.wikiMaintenance.verifySuccessors).toHaveBeenCalledTimes(2);
  });

  it("rejects redigested actions, policy drift and currently revoked deletion authority", async () => {
    const h = await harness();
    const plan = await h.plan([h.deletionDigest]);
    const { planDigest: ignored, ...core } = plan;
    void ignored;
    const changed = { ...core, patternActions: [] };
    expect(
      await h.verify({
        ...changed,
        planDigest: pruningDigest(GOVERNED_WIKI_PRUNING_PLAN_SCHEMA, changed),
      }),
    ).toBe(false);
    const stricter = h.makeAuthority({
      descriptor: { ...h.descriptor, maxActions: 100 },
    });
    expect(await h.verify(plan, CURRENT, stricter.verifier())).toBe(false);
    h.revokeDeletion();
    await expect(h.verify(plan)).rejects.toThrow(/revoked/u);
    expect(h.wiki.loadWiki().state.revision).toBe(1);
  });

  it("does not equate an authenticated own request with the correct Wiki effect", async () => {
    const h = await harness();
    const plan = await h.plan();
    await h.maintain([], pruningOperationCalls(plan)[1].requestDigest);
    expect(await h.verify(plan)).toBe(false);
    expect(h.wiki.loadWiki().state.patterns["pat-pruning"].status).toBe(
      "stale",
    );
  });

  it("rejects a signed substituted state even when request, operation and revision identity are exact", async () => {
    const h = await harness();
    const plan = await h.plan();
    const requestDigest = pruningOperationCalls(plan)[1].requestDigest;
    const expected = await h.maintain(
      plan.patternActions,
      requestDigest,
      effectiveAt,
      h.wiki.loadWiki(),
    );
    const payload = {
      schema: WIKI_REVISION_SCHEMA,
      ...h.maintainerDescriptor,
      revision: expected.revision,
      priorStateDigest: plan.wikiStateDigest,
      effectiveAt,
      evidenceRefs: ["ev-pruning"],
      operationDigest: D(plan.patternActions),
      maintenanceRequestId: `wiki-maintenance:${requestDigest.slice(7)}`,
      maintenanceRequestDigest: requestDigest,
    };
    const revisionId = `wiki:${D(payload).slice(7)}`;
    expect(revisionId).toBe(expected.revisionId);
    const state = structuredClone(expected.state);
    state.patterns["pat-pruning"].actionable = true;
    const revision = { ...payload, revisionId, stateDigest: D(state), state };
    const ledger = h.resources.backend.ledger;
    const previous = ledger.read().at(-1);
    const artifact = h.resources.artifactPorts.putCanonical(
      "wiki-revision",
      revision,
      {
        audience: h.resources.descriptor.audience,
        purpose: "evolution-ledger",
        retention: "ledger",
      },
    );
    const head = ledger.verify();
    ledger.appendDomainEvent(
      {
        artifactTenantId: h.resources.descriptor.artifactTenantId,
        correlationId: "wiki-pruning",
        decision: "committed",
        eventId: `wiki.revision.${revisionId.slice(5)}`,
        reason: "test signed state substitution",
        skillName: null,
        sourceRefs: [previous.subjectRef],
        subjectRef: artifact.ref,
        tenantId: h.tenantId,
        timestamp: effectiveAt,
        type: "wiki.revision.committed",
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    // Persistence provenance is valid; business-state replay still rejects it.
    expect(h.wiki.loadWiki().stateDigest).toBe(revision.stateDigest);
    expect(await h.verify(plan)).toBe(false);
  });

  it("authenticates an archived checkpoint while still rejecting unrelated CURRENT successors", async () => {
    const h = await harness();
    const plan = await h.plan();
    await h.maintain(
      plan.patternActions,
      pruningOperationCalls(plan)[1].requestDigest,
    );
    const boundary = checkpoint(h.resources.backend.ledger.read().at(-1));
    await h.maintain([], D("another writer"));
    await expect(h.verify(plan)).rejects.toThrow(/successors/u);
    expect(
      await h.verify(plan, { mode: "checkpoint", checkpoint: boundary }),
    ).toBe(true);
    await expect(
      h.verify(plan, {
        mode: "checkpoint",
        checkpoint: { ...boundary, headDigest: D("forged head") },
      }),
    ).rejects.toThrow(/checkpoint/u);
    await expect(
      h.verify(plan, {
        mode: "checkpoint",
        checkpoint: { ...boundary, ledgerId: "another-ledger" },
      }),
    ).rejects.toThrow(/checkpoint/u);
    expect(() =>
      captureWikiRevisionReader(h.wiki).resolveHistory({
        tenantId: h.tenantId,
        stateDigest: plan.wikiStateDigest,
        allowedMaintenanceRequestDigests: [],
        checkpoint: boundary,
      }),
    ).toThrow(/downgraded/u);
  });

  it("reopens two consecutive completed plans without granting old checkpoints current execution authority", async () => {
    const h = await harness();
    const firstPlan = await h.plan();
    let previous = null;
    for (const plan of [firstPlan, null]) {
      const active = plan ?? (await h.plan([], "2026-09-06T00:00:00.000Z"));
      const journal = h.openJournal();
      let state = buildWikiPruningJournal({ plan: active, previous });
      await journal.commit({
        state,
        expectedJournalDigest: previous?.journalDigest ?? null,
      });
      for (const call of pruningOperationCalls(active)) {
        if (call.request.operation === "wiki-revision")
          await h.maintain(
            active.patternActions,
            call.requestDigest,
            active.effectiveAt,
          );
        const next = buildWikiPruningJournal({
          plan: active,
          previous: state,
          receipt: ack(call),
        });
        await journal.commit({
          state: next,
          expectedJournalDigest: state.journalDigest,
        });
        state = next;
      }
      const done = buildWikiPruningJournal({
        plan: active,
        previous: state,
        finalize: true,
      });
      await journal.commit({
        state: done,
        expectedJournalDigest: state.journalDigest,
      });
      previous = done;
    }
    await h.maintain([], D("legitimate later work"));
    const resources = openEvolutionDurableStore(h.root);
    const wiki = new WikiMaintainerLedgerAdapter({
      ...h.wikiOptions,
      artifactPorts: resources.artifactPorts,
      ledger: resources.backend.ledger,
      ledgerArtifactResolver: resources.resolver,
    });
    const authority = h.makeAuthority({ wikiLedgerAdapter: wiki });
    const reopened = h.openJournal(resources, {
      planVerifier: authority.verifier(),
    });
    expect((await reopened.load({ tenantId: h.tenantId })).state).toEqual(
      previous,
    );
    expect(
      (
        await reopened.load({
          tenantId: h.tenantId,
          planDigest: firstPlan.planDigest,
        })
      ).state.phase,
    ).toBe("finalized");
    await expect(h.verify(firstPlan)).rejects.toThrow(/successors/u);
    expect(wiki.loadWiki().state.revision).toBe(4);
  }, 240_000);

  it("requires current authority for unfinished execution even when its historical checkpoint is valid", async () => {
    const h = await harness();
    const plan = await h.plan();
    const journal = h.openJournal();
    await journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    await h.maintain([], D("unrelated active writer"));
    await expect(journal.load({ tenantId: h.tenantId })).rejects.toThrow(
      /successors/u,
    );
  });

  it("rejects a different journal ledger before publishing any preparation artifact", async () => {
    const h = await harness();
    const plan = await h.plan();
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-wrong-ledger-"),
    );
    roots.push(root);
    const other = openEvolutionDurableStore(root);
    const putCanonical = vi.fn();
    const journal = h.openJournal(other, { artifactPorts: { putCanonical } });
    await expect(
      journal.commit({
        state: buildWikiPruningJournal({ plan }),
        expectedJournalDigest: null,
      }),
    ).rejects.toThrow(/current ledger/u);
    expect(putCanonical).not.toHaveBeenCalled();
    expect(other.backend.ledger.verify().sequence).toBe(0);
  });

  it("does not let a later valid checkpoint hide a baseline that was absent at preparation", async () => {
    const h = await harness();
    const future = await h.maintain([], null, effectiveAt, h.wiki.loadWiki());
    const planner = createWikiPruningPlanner({
      descriptor: h.descriptor,
      ports: {
        loadWikiState: () => ({
          trusted: true,
          state: future.state,
          stateDigest: future.stateDigest,
        }),
        resolveDeletionReceipt: h.deletionReceipts.resolve,
      },
    });
    const plan = await planner.plan({
      expectedStateDigest: future.stateDigest,
      effectiveAt,
    });
    const ledger = h.resources.backend.ledger;
    const appendUnchecked = (state) => {
      const previous = ledger
        .read()
        .filter((event) => event.type === WIKI_PRUNING_JOURNAL_EVENT_TYPE)
        .at(-1);
      const artifact = h.resources.artifactPorts.putCanonical(
        "wiki-pruning-journal",
        state,
        {
          audience: h.resources.descriptor.audience,
          purpose: "evolution-ledger",
          retention: "ledger",
        },
      );
      const head = ledger.verify();
      ledger.appendDomainEvent(
        {
          artifactTenantId: h.resources.descriptor.artifactTenantId,
          correlationId: "pruning",
          decision: "committed",
          eventId: `${WIKI_PRUNING_JOURNAL_EVENT_TYPE}.${state.journalDigest.slice(7)}`,
          reason: "test signed out-of-order preparation",
          skillName: null,
          sourceRefs: previous ? [previous.subjectRef] : [],
          subjectRef: artifact.ref,
          tenantId: h.tenantId,
          timestamp: effectiveAt,
          type: WIKI_PRUNING_JOURNAL_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
    };
    let state = buildWikiPruningJournal({ plan });
    appendUnchecked(state);
    expect((await h.maintain([])).stateDigest).toBe(plan.wikiStateDigest);
    for (const call of pruningOperationCalls(plan)) {
      if (call.request.operation === "wiki-revision")
        await h.maintain(plan.patternActions, call.requestDigest);
      state = buildWikiPruningJournal({
        plan,
        previous: state,
        receipt: ack(call),
      });
      appendUnchecked(state);
    }
    state = buildWikiPruningJournal({ plan, previous: state, finalize: true });
    appendUnchecked(state);
    // Its latest checkpoint alone has a valid source and exact Wiki effect.
    expect(
      await h.verify(plan, {
        mode: "checkpoint",
        checkpoint: checkpoint(ledger.read().at(-1)),
      }),
    ).toBe(true);
    // The journal still authenticates the preparation checkpoint as well.
    await expect(
      h.openJournal().load({ tenantId: h.tenantId }),
    ).rejects.toThrow(/baseline/u);
  });

  it("captures policy and verifier implementations and rejects imitation readers", async () => {
    const h = await harness();
    const plan = await h.plan();
    h.descriptor.maxActions = 1;
    h.wikiMaintenance.requestDigests = () => {
      throw new Error("substituted");
    };
    h.wikiMaintenance.verifySuccessors = () => false;
    expect(await h.verify(plan)).toBe(true);
    expect(() => h.makeAuthority({ wikiLedgerAdapter: { ...h.wiki } })).toThrow(
      /branded/u,
    );
    await expect(
      h.authority.verifier().verify({
        plan,
        tenantId: "other",
        streamId: "pruning",
        context: CURRENT,
      }),
    ).rejects.toThrow(/scope/u);
    await expect(
      h.verify(plan, { mode: "checkpoint", checkpoint: null }),
    ).rejects.toThrow(/checkpoint/u);
  });
});
