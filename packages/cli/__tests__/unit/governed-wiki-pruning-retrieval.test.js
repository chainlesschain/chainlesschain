import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPruningMaintenanceStore } from "../fixtures/governed-wiki-pruning-maintenance.js";
import {
  buildWikiPruningJournal,
  pruningOperationCalls,
  pruningDigest,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import {
  WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA,
  WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE,
  WIKI_PRUNING_RETRIEVAL_SCHEMA,
  WIKI_PRUNING_RETRIEVAL_EVENT_TYPE,
} from "../../src/lib/evolution/governed-wiki-pruning-retrieval.js";
import { digestWikiState as D } from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import { WikiInformedSkillProposer } from "../../src/lib/evolution/wiki-informed-skill-proposer.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const reopen = (root, hooks = {}) =>
  openPruningMaintenanceStore(root, { ...hooks, realRetrieval: true });
function setup(hooks) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pruning-retrieval-"),
  );
  roots.push(root);
  return reopen(root, hooks);
}
function query(h) {
  return {
    tenantId: h.descriptor.tenantId,
    wikiRevision: h.wiki.loadWiki().state.revisionId,
  };
}
function verify(h, done, receipt, resolution) {
  return h.retrievalReceiptVerifier.verify({
    ...pruningOperationCalls(done.plan).at(-1),
    plan: done.plan,
    receipt,
    ...h.descriptor,
    context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
  });
}

describe("real pruning retrieval projection", () => {
  it("keeps non-pruned index entries and selective pattern reads without exposing a writer", async () => {
    const h = setup();
    await h.seed();
    const original = h.wiki.loadWiki().state.patterns["pat-maintenance-0000"];
    await h.writeWiki([
      {
        type: "upsert",
        pattern: {
          ...original,
          patternId: "pat-current",
          summary: "Current retained knowledge",
          procedure: "Keep this fresh procedure",
          lastVerifiedAt: "2026-09-05T00:00:00.000Z",
          expiresAt: null,
        },
      },
    ]);
    expect(
      h.wiki.loadWiki().state.index.map((entry) => entry.patternId),
    ).toEqual(["pat-current"]);
    await h.execute();
    const restored = reopen(h.root);
    const readQuery = query(restored);
    const index = await restored.retrievalReader.readIndex(readQuery);
    expect(index.data.entries.map((entry) => entry.patternId)).toEqual([
      "pat-current",
    ]);
    const selected = await restored.retrievalReader.readPattern({
      ...readQuery,
      patternId: "pat-current",
    });
    expect(selected.kind).toBe("pattern");
    expect(selected.data.patternId).toBe("pat-current");
    expect(selected.digest).toBe(D(selected.data));
    expect(Object.keys(restored.retrievalReader)).toEqual([
      "readIndex",
      "readPattern",
    ]);
    let accessed = false;
    await expect(
      restored.retrievalReader.readPattern({
        ...readQuery,
        get patternId() {
          accessed = true;
          return "pat-current";
        },
      }),
    ).rejects.toThrow();
    expect(accessed).toBe(false);
    await expect(
      restored.retrievalReader.readPattern({
        ...readQuery,
        patternId: "pat-maintenance-0000",
      }),
    ).rejects.toThrow(/excluded/u);
  }, 180_000);

  it("rejects an independently signed substituted index even with exact request and event lineage", async () => {
    let armed = true;
    const h = setup({
      beforeRetrievalAppend(input) {
        if (!armed) return;
        armed = false;
        const head = h.resources.backend.ledger.verify();
        const resolved = h.resources.resolver({
          epoch: head.epoch,
          ledgerId: head.ledgerId,
          tenantId: h.resources.descriptor.artifactTenantId,
          ref: input.subjectRef,
        });
        const record = JSON.parse(resolved.bytes.toString("utf8")).value;
        record.index.push({
          patternId: "forged-hidden-pattern",
          status: "corroborated",
          actionable: true,
        });
        const { projectionDigest, ...core } = record;
        void projectionDigest;
        record.projectionDigest = pruningDigest(
          WIKI_PRUNING_RETRIEVAL_SCHEMA,
          core,
        );
        const replacement = h.resources.artifactPorts.putCanonical(
          WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE,
          record,
          {
            audience: h.resources.descriptor.audience,
            purpose: h.resources.descriptor.purpose,
            retention: "ledger",
          },
        );
        input.subjectRef = replacement.ref;
        input.eventId = `${WIKI_PRUNING_RETRIEVAL_EVENT_TYPE}.${record.projectionDigest.slice(7)}`;
      },
    });
    await expect(h.execute()).rejects.toThrow(/readback/u);
    expect(armed).toBe(false);
    const restored = reopen(h.root);
    await expect(restored.execute()).rejects.toThrow(/substituted/u);
    await expect(
      restored.retrievalReader.readIndex(query(restored)),
    ).rejects.toThrow(/finalized/u);
  }, 120_000);

  it("publishes a durable empty index, removes access to pruned patterns and feeds the real proposer", async () => {
    const h = setup();
    await h.seed();
    await expect(h.retrievalReader.readIndex(query(h))).rejects.toThrow(
      /finalized/u,
    );
    const done = await h.execute();
    const receipt = done.operationReceipts.at(-1);
    expect(receipt.schema).toBe(WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA);
    const restored = reopen(h.root);
    const index = await restored.retrievalReader.readIndex(query(restored));
    expect(index).toMatchObject({
      kind: "wiki-index",
      trusted: true,
      data: { entries: [] },
    });
    await expect(
      restored.retrievalReader.readPattern({
        ...query(restored),
        patternId: "pat-maintenance-0000",
      }),
    ).rejects.toThrow(/excluded/u);
    const generate = vi.fn(({ evidence }) => {
      expect(
        evidence.find((entry) => entry.kind === "wiki-index").data,
      ).toEqual(index.data);
      return { status: "no-proposal", reason: "no actionable Wiki evidence" };
    });
    const proposer = new WikiInformedSkillProposer({
      descriptor: {
        tenantId: h.descriptor.tenantId,
        evolutionRunId: "test-proposer",
        targetSkillName: "safe-refactor",
        wikiRevision: query(restored).wikiRevision,
        proposerModel: {
          provider: "test",
          model: "deterministic",
          version: "1",
        },
      },
      policy: { proposerWikiRead: true, executionAgentWikiRead: false },
      ports: {
        readInitial: (kind) =>
          kind === "wiki-index"
            ? restored.retrievalReader.readIndex(query(restored))
            : {
                kind,
                trusted: true,
                ref: `fixture://${kind}`,
                data: { sampleCount: 3 },
                digest: D({ sampleCount: 3 }),
              },
        readSelective: () => {
          throw new Error("unexpected selective read");
        },
        generate,
        createCandidate: () => {
          throw new Error("unexpected candidate");
        },
      },
    });
    expect((await proposer.propose()).status).toBe("no-proposal");
    expect(generate).toHaveBeenCalledOnce();
    expect(await restored.execute()).toEqual(done);
    expect(
      await restored.retrievalProvider.publishRetrievalProjection(
        pruningOperationCalls(done.plan).at(-1),
      ),
    ).toEqual(receipt);
    expect(await restored.inspect()).toMatchObject({
      wikiRevision: 2,
      journalRevision: 5,
      ledgerSequence: 8,
    });
  }, 180_000);

  it("requires exact calls and the complete prior-effect frontier and denies unbranded readers", async () => {
    const h = setup();
    const plan = await h.plan();
    const call = pruningOperationCalls(plan).at(-1);
    await expect(
      h.retrievalProvider.publishRetrievalProjection(call),
    ).rejects.toThrow(/prepared/u);
    await h.journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    await expect(
      h.retrievalProvider.publishRetrievalProjection(call),
    ).rejects.toThrow(/frontier/u);
    await expect(
      h.retrievalProvider.publishRetrievalProjection({
        ...call,
        requestDigest: D("forged"),
      }),
    ).rejects.toThrow(/differs/u);
    expect(() => h.retrieval.createProvider({ ...h.journal })).toThrow(
      /branded/u,
    );
    expect(() =>
      h.retrieval.createProposerReader({
        journalStore: h.journal,
        policy: { proposerWikiRead: true, executionAgentWikiRead: true },
      }),
    ).toThrow(/isolated/u);
    expect(h.resources.backend.ledger.verify().sequence).toBe(1);
    expect(() =>
      h.resources.artifactPorts.putCanonical(
        WIKI_PRUNING_RETRIEVAL_ARTIFACT_TYPE,
        {},
        {
          audience: "evolution-runtime",
          purpose: "skill-mutation",
          retention: "ledger",
        },
      ),
    ).toThrow(/retention/u);
  });

  it.each(["projection-response", "journal-checkpoint"])(
    "recovers %s without duplicate index publication",
    async (fault) => {
      let armed = true;
      const h = setup({
        afterRetrievalAppend() {
          if (armed && fault === "projection-response") {
            armed = false;
            throw new Error("projection response lost");
          }
        },
        beforeJournalAppend(input) {
          if (
            armed &&
            fault === "journal-checkpoint" &&
            input.reason.endsWith("checkpoint 4")
          ) {
            armed = false;
            throw new Error("projection checkpoint lost");
          }
        },
      });
      await expect(h.execute()).rejects.toThrow(/lost/u);
      expect(armed).toBe(false);
      const restored = reopen(h.root);
      expect((await restored.execute()).phase).toBe("finalized");
      expect(await restored.inspect()).toMatchObject({
        wikiRevision: 0,
        journalRevision: 5,
        ledgerSequence: 6,
      });
      expect(
        (await restored.retrievalReader.readIndex(query(restored))).data
          .entries,
      ).toEqual([]);
    },
    180_000,
  );

  it("rejects stale current reads but preserves historical receipts across a second completed plan", async () => {
    const h = setup();
    const first = await h.execute();
    const firstResolution = await h.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    // A normal Wiki writer creates a newer revision. The old projection must
    // not be returned as current, even when its receipt is still authentic.
    await h.seed();
    await expect(
      h.retrievalReader.readIndex({
        tenantId: h.descriptor.tenantId,
        wikiRevision: null,
      }),
    ).rejects.toThrow();
    expect(
      await verify(h, first, first.operationReceipts.at(-1), firstResolution),
    ).toBe(true);
    const second = await h.controller.execute({ plan: await h.plan() });
    expect(second.plan.planDigest).not.toBe(first.plan.planDigest);
    const restored = reopen(h.root);
    expect(
      await verify(
        restored,
        first,
        first.operationReceipts.at(-1),
        firstResolution,
      ),
    ).toBe(true);
    expect(
      (await restored.retrievalReader.readIndex(query(restored))).data.entries,
    ).toEqual([]);
    expect(await restored.inspect()).toMatchObject({
      ledgerSequence: 14,
      wikiRevision: 2,
    });
  }, 240_000);

  it("rejects redigested receipt substitutions and a checkpoint preceding publication", async () => {
    const h = setup();
    const done = await h.execute();
    const resolution = await h.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    for (const key of ["projectionDigest", "wikiStateDigest", "eventDigest"]) {
      const receipt = structuredClone(done.operationReceipts.at(-1));
      receipt[key] = D(`forged ${key}`);
      const { receiptDigest, ...core } = receipt;
      void receiptDigest;
      receipt.receiptDigest = pruningDigest(
        WIKI_PRUNING_RETRIEVAL_RECEIPT_SCHEMA,
        core,
      );
      expect(await verify(h, done, receipt, resolution)).toBe(false);
    }
    const first = h.resources.backend.ledger.read()[0];
    const early = {
      checkpoint: {
        epoch: first.epoch,
        ledgerId: first.ledgerId,
        identityDigest: first.identityDigest,
        sequence: first.sequence,
        headDigest: first.eventDigest,
      },
    };
    expect(await verify(h, done, done.operationReceipts.at(-1), early)).toBe(
      false,
    );
    await expect(
      h.retrievalReader.readIndex({ ...query(h), tenantId: "other" }),
    ).rejects.toThrow(/scope/u);
  }, 180_000);
});
