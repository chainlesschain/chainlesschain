import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPruningMaintenanceStore } from "../fixtures/governed-wiki-pruning-maintenance.js";
import {
  buildWikiPruningJournal,
  pruningDigest,
  pruningOperationCalls,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import { WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA } from "../../src/lib/evolution/governed-wiki-pruning-maintenance.js";

const roots = [];
const OPTIONS = { realDependencies: true, dependencyDeletion: true };
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function setup(hooks = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-dependencies-"),
  );
  roots.push(root);
  return openPruningMaintenanceStore(root, { ...OPTIONS, ...hooks });
}
async function verify(h, receipt, index = 0) {
  const resolution = await h.journal.load({ tenantId: h.descriptor.tenantId });
  return h.wikiReceiptVerifier.verify({
    ...pruningOperationCalls(resolution.state.plan)[index],
    ...h.descriptor,
    plan: resolution.state.plan,
    receipt,
    context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
  });
}
const stopAtKms = (h) =>
  expect(h.execute()).rejects.toThrow(/separately verified KMS/u);

describe("Wiki-only pruning dependency effects", () => {
  it("authenticates an empty dependency receipt without creating Wiki evidence or revisions", async () => {
    const h = setup({ dependencyDeletion: false });
    const result = await h.execute();
    expect(result.operationReceipts[0]).toMatchObject({
      schema: WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA,
      mode: "noop",
      revisions: [],
      sourceStateDigest: result.plan.wikiStateDigest,
      resultStateDigest: result.plan.wikiStateDigest,
    });
    const reopened = openPruningMaintenanceStore(h.root, {
      realDependencies: true,
    });
    expect(await reopened.execute()).toEqual(result);
    expect(await verify(reopened, result.operationReceipts[0])).toBe(true);
    expect(reopened.wiki.loadWiki().state.revision).toBe(0);
  });

  it("keeps a no-op maintenance receipt bound to the post-dependency state", async () => {
    const h = setup();
    await h.seed();
    const pattern = h.wiki.loadWiki().state.patterns["pat-maintenance-0000"];
    await h.writeWiki([
      {
        type: "upsert",
        pattern: {
          ...pattern,
          lastVerifiedAt: "2026-09-05T00:00:00.000Z",
          expiresAt: null,
        },
      },
    ]);
    expect((await h.plan()).patternActions).toEqual([]);
    await stopAtKms(h);
    const { state } = await h.journal.load({ tenantId: h.descriptor.tenantId });
    const [dependency, maintenance] = state.operationReceipts;
    expect(maintenance).toMatchObject({
      mode: "noop",
      revisions: [],
      sourceStateDigest: dependency.resultStateDigest,
      resultStateDigest: dependency.resultStateDigest,
    });
    expect(await verify(h, maintenance, 1)).toBe(true);
    expect(h.wiki.loadWiki().state.revision).toBe(3);
  }, 120_000);

  it("rejects a signed Wiki successor that copies the dependency request but does not replay its exact reducer", async () => {
    const h = setup();
    await h.seed();
    const plan = await h.plan();
    await h.journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    const call = pruningOperationCalls(plan)[0];
    await h.writeWiki(
      [
        {
          type: "tombstone",
          patternId: "pat-maintenance-0000",
          reason: "substituted",
        },
      ],
      call.requestDigest,
    );
    await expect(
      h.provider.applyDependencyDispositions(call),
    ).rejects.toThrow();
    expect(h.wiki.loadWiki().state.revision).toBe(2);
  });

  it("persists dependency tombstones before maintenance and independently restores both receipt boundaries", async () => {
    const h = setup();
    await h.seed();
    await stopAtKms(h);
    const resolution = await h.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    expect(resolution.state.phase).toBe("running");
    expect(resolution.state.operationReceipts).toHaveLength(2);
    const [dependency, maintenance] = resolution.state.operationReceipts;
    expect(dependency).toMatchObject({
      schema: WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA,
      sourceStateDigest: resolution.state.plan.wikiStateDigest,
      mode: "revisions",
      revisions: [expect.any(Object)],
    });
    expect(maintenance.sourceStateDigest).toBe(dependency.resultStateDigest);
    expect(maintenance.revisions).toHaveLength(1);
    expect(maintenance.revisions[0].requestDigest).not.toBe(
      dependency.revisions[0].requestDigest,
    );
    const reopened = openPruningMaintenanceStore(h.root, OPTIONS);
    expect(await verify(reopened, dependency)).toBe(true);
    expect(await verify(reopened, maintenance, 1)).toBe(true);
    await stopAtKms(reopened);
    expect(await reopened.inspect()).toMatchObject({
      wikiRevision: 3,
      operationCount: 2,
      maintenanceRequestCount: 2,
    });
    expect(
      await reopened.provider.applyDependencyDispositions(
        pruningOperationCalls(resolution.state.plan)[0],
      ),
    ).toEqual(dependency);
    const core = { ...dependency };
    delete core.receiptDigest;
    core.resultStateDigest = maintenance.resultStateDigest;
    expect(
      await verify(reopened, {
        ...core,
        receiptDigest: pruningDigest(
          WIKI_PRUNING_DEPENDENCY_RECEIPT_SCHEMA,
          core,
        ),
      }),
    ).toBe(false);
    expect(await verify(reopened, maintenance)).toBe(false);
  }, 120_000);

  it("feeds the combined successor chain into the real retrieval projection (KMS is an explicit test effect)", async () => {
    const hooks = { ...OPTIONS, realRetrieval: true, testCryptoShred: true };
    const h = setup(hooks);
    await h.seed();
    const result = await h.execute();
    expect(result.phase).toBe("finalized");
    expect(result.operationReceipts).toHaveLength(4);
    const reopened = openPruningMaintenanceStore(h.root, hooks);
    expect(await reopened.execute()).toEqual(result);
    expect(await verify(reopened, result.operationReceipts[0])).toBe(true);
    const query = {
      tenantId: reopened.descriptor.tenantId,
      wikiRevision: reopened.wiki.loadWiki().state.revisionId,
    };
    expect(await reopened.retrievalReader.readIndex(query)).toMatchObject({
      data: { entries: [] },
    });
    await expect(
      reopened.retrievalReader.readPattern({
        ...query,
        patternId: "pat-maintenance-0000",
      }),
    ).rejects.toThrow();
  }, 120_000);

  it("requires the exact prepared call and rejects Wiki advancement before the dependency checkpoint", async () => {
    const h = setup();
    await h.seed();
    const plan = await h.plan();
    const [dependencyCall, wikiCall] = pruningOperationCalls(plan);
    await expect(
      h.provider.applyDependencyDispositions(dependencyCall),
    ).rejects.toThrow(/prepared/u);
    await h.journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    await expect(
      h.provider.applyDependencyDispositions(wikiCall),
    ).rejects.toThrow(/differs/u);
    const dependency =
      await h.provider.applyDependencyDispositions(dependencyCall);
    expect(h.wiki.loadWiki().state.revision).toBe(2);
    await expect(h.provider.applyWikiRevision(wikiCall)).rejects.toThrow(
      /dependency/u,
    );
    expect(
      await h.provider.applyDependencyDispositions(dependencyCall),
    ).toEqual(dependency);
    await stopAtKms(h);
    expect(h.wiki.loadWiki().state.revision).toBe(3);
  }, 120_000);

  it("refuses a Skill-backed dependency before any pruning journal or tombstone is committed", async () => {
    const h = setup();
    await h.seed(1, { skillNames: ["safe-refactor"] });
    const before = h.resources.backend.ledger.verify();
    const plan = await h.plan();
    expect(plan.dependencyDispositions[0].action).toBe("rollback");
    await expect(h.controller.execute({ plan })).rejects.toThrow(
      /Skill rollback/u,
    );
    expect(h.resources.backend.ledger.verify()).toEqual(before);
    expect(
      (await h.journal.load({ tenantId: h.descriptor.tenantId })).state,
    ).toBeNull();
    expect(h.wiki.loadWiki().state.revision).toBe(1);
  });

  it.each(["dependency-response", "dependency-checkpoint"])(
    "recovers %s without repeating the dependency revision",
    async (fault) => {
      let armed = false;
      const h = setup({
        afterWikiAppend() {
          if (armed && fault === "dependency-response") {
            armed = false;
            throw new Error("dependency response lost");
          }
        },
        beforeJournalAppend(input) {
          if (
            armed &&
            fault === "dependency-checkpoint" &&
            input.reason.endsWith("checkpoint 2")
          ) {
            armed = false;
            throw new Error("dependency checkpoint interrupted");
          }
        },
      });
      await h.seed();
      armed = true;
      await expect(h.execute()).rejects.toThrow(
        /dependency (response|checkpoint)/u,
      );
      expect(armed).toBe(false);
      expect(h.wiki.loadWiki().state.revision).toBe(2);
      const reopened = openPruningMaintenanceStore(h.root, OPTIONS);
      await stopAtKms(reopened);
      expect(await reopened.inspect()).toMatchObject({
        wikiRevision: 3,
        operationCount: 2,
        maintenanceRequestCount: 2,
      });
    },
    120_000,
  );

  it("recovers an interrupted 129-pattern dependency batch and retains the ordered maintenance suffix", async () => {
    let armed = false;
    const h = setup({
      afterWikiAppend() {
        if (armed) {
          armed = false;
          throw new Error("first dependency batch committed");
        }
      },
    });
    await h.seed(129);
    armed = true;
    await expect(h.execute()).rejects.toThrow(/first dependency batch/u);
    const reopened = openPruningMaintenanceStore(h.root, OPTIONS);
    await stopAtKms(reopened);
    const resolution = await reopened.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    const requests = reopened.maintenance
      .authorityPorts()
      .requestDigests({ plan: resolution.state.plan });
    expect(requests).toHaveLength(4);
    expect(
      resolution.state.operationReceipts.flatMap((receipt) =>
        receipt.revisions.map((entry) => entry.requestDigest),
      ),
    ).toEqual(requests);
    expect(await reopened.inspect()).toMatchObject({
      wikiRevision: 6,
      operationCount: 2,
      maintenanceRequestCount: 4,
    });
  }, 180_000);
});
