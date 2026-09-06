import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPruningMaintenanceStore } from "../fixtures/governed-wiki-pruning-maintenance.js";
import {
  buildWikiPruningJournal,
  pruningOperationCalls,
  pruningDigest,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import {
  GovernedWikiPruningMaintenance,
  WIKI_PRUNING_MAINTENANCE_RECEIPT_SCHEMA,
} from "../../src/lib/evolution/governed-wiki-pruning-maintenance.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function setup(hooks) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-maintenance-"),
  );
  roots.push(root);
  return openPruningMaintenanceStore(root, hooks);
}
function verifyReceipt(h, plan, receipt, resolution) {
  return h.wikiReceiptVerifier.verify({
    ...pruningOperationCalls(plan)[1],
    plan,
    receipt,
    tenantId: h.descriptor.tenantId,
    streamId: h.descriptor.streamId,
    context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
  });
}

describe("real governed Wiki pruning maintenance", () => {
  it("executes the real controller/Wiki/journal path and regenerates its receipt after reopening", async () => {
    const h = setup();
    await h.seed();
    const done = await h.execute();
    expect(done.phase).toBe("finalized");
    const receipt = done.operationReceipts[1];
    expect(receipt).toMatchObject({
      schema: WIKI_PRUNING_MAINTENANCE_RECEIPT_SCHEMA,
      mode: "revisions",
      revisions: [expect.any(Object)],
    });
    const reopened = openPruningMaintenanceStore(h.root);
    const resolution = await reopened.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    expect(await verifyReceipt(reopened, done.plan, receipt, resolution)).toBe(
      true,
    );
    expect(await reopened.execute()).toEqual(done);
    expect(
      await reopened.provider.applyWikiRevision(
        pruningOperationCalls(done.plan)[1],
      ),
    ).toEqual(receipt);
    expect(await reopened.inspect()).toMatchObject({
      phase: "finalized",
      wikiRevision: 2,
      operationCount: 3,
      maintenanceRequestCount: 1,
      patternStatuses: ["tombstoned"],
      ledgerSequence: 7,
    });
  }, 120_000);

  it("acknowledges an empty Wiki operation without creating evidence or a spurious revision", async () => {
    const h = setup();
    const done = await h.execute();
    const receipt = done.operationReceipts[1];
    expect(receipt).toMatchObject({
      mode: "noop",
      revisions: [],
      sourceStateDigest: receipt.resultStateDigest,
    });
    const reopened = openPruningMaintenanceStore(h.root);
    expect(await reopened.inspect()).toMatchObject({
      wikiRevision: 0,
      maintenanceRequestCount: 0,
      ledgerSequence: 5,
    });
    expect(await reopened.execute()).toEqual(done);
    expect(
      await verifyReceipt(
        reopened,
        done.plan,
        receipt,
        await reopened.journal.load({ tenantId: h.descriptor.tenantId }),
      ),
    ).toBe(true);
  }, 120_000);

  it("requires preparation and the dependency frontier and rejects substituted calls", async () => {
    const h = setup();
    await h.seed();
    const plan = await h.plan();
    const call = pruningOperationCalls(plan)[1];
    await expect(h.provider.applyWikiRevision(call)).rejects.toThrow(
      /prepared/u,
    );
    await h.journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    await expect(h.provider.applyWikiRevision(call)).rejects.toThrow(
      /dependency/u,
    );
    await expect(
      h.provider.applyWikiRevision({
        ...call,
        requestDigest: D("substituted"),
      }),
    ).rejects.toThrow(/differs/u);
    expect(h.wiki.loadWiki().state.revision).toBe(1);
    expect(() => h.maintenance.createProvider({ ...h.journal })).toThrow(
      /branded/u,
    );
    expect(
      () =>
        new GovernedWikiPruningMaintenance({
          descriptor: h.descriptor,
          wikiLedgerAdapter: { ...h.wiki },
        }),
    ).toThrow(/branded/u);
  });

  it.each(["wiki-response", "journal-before-checkpoint"])(
    "reconciles %s loss with new backend/provider instances and no duplicate Wiki effect",
    async (fault) => {
      let armed = false;
      const h = setup({
        afterWikiAppend() {
          if (armed && fault === "wiki-response") {
            armed = false;
            throw new Error("lost Wiki response");
          }
        },
        beforeJournalAppend(input) {
          if (
            armed &&
            fault === "journal-before-checkpoint" &&
            input.reason.endsWith("checkpoint 3")
          ) {
            armed = false;
            throw new Error("checkpoint write failed");
          }
        },
      });
      await h.seed();
      armed = true;
      await expect(h.execute()).rejects.toThrow(
        fault === "wiki-response" ? /lost Wiki/u : /checkpoint write/u,
      );
      expect(armed).toBe(false);
      expect(h.wiki.loadWiki().state.revision).toBe(2);
      const reopened = openPruningMaintenanceStore(h.root);
      expect((await reopened.execute()).phase).toBe("finalized");
      expect(await reopened.inspect()).toMatchObject({
        wikiRevision: 2,
        maintenanceRequestCount: 1,
        ledgerSequence: 7,
      });
    },
    120_000,
  );

  it("resumes a multi-batch plan above the Maintainer's 128-operation limit", async () => {
    let armed = false;
    const h = setup({
      afterWikiAppend() {
        if (armed) {
          armed = false;
          throw new Error("first batch committed");
        }
      },
    });
    await h.seed(130);
    armed = true;
    await expect(h.execute()).rejects.toThrow(/first batch/u);
    expect(h.wiki.loadWiki().state.revision).toBe(3);
    const partial = await h.journal.load({ tenantId: h.descriptor.tenantId });
    const requests = h.maintenance
      .authorityPorts()
      .requestDigests({ plan: partial.state.plan });
    expect(requests).toHaveLength(2);
    const reopened = openPruningMaintenanceStore(h.root);
    const done = await reopened.execute();
    expect(
      done.operationReceipts[1].revisions.map((entry) => entry.requestDigest),
    ).toEqual(requests);
    const snapshot = await reopened.inspect();
    expect(snapshot).toMatchObject({
      wikiRevision: 4,
      maintenanceRequestCount: 2,
      ledgerSequence: 9,
    });
    expect(snapshot.patternStatuses).toHaveLength(130);
    expect(new Set(snapshot.patternStatuses)).toEqual(new Set(["tombstoned"]));
  }, 180_000);

  it("preserves unrelated facts governed by a stricter corroboration policy", async () => {
    const h = setup();
    await h.seed();
    const at = "2026-09-05T00:00:00.000Z";
    const evidence = Object.fromEntries(
      ["a", "b"].map((domain) => {
        const ref = `ev-current-${domain}`;
        const core = {
          schema: WIKI_EVIDENCE_SCHEMA,
          tenantId: h.descriptor.tenantId,
          ref,
          sourceDigest: D(ref),
          projectionDigest: D(["projection", ref]),
          artifactRef: `artifact://${ref}`,
          trustedProjection: true,
          trustDomain: domain,
          kind: "tool-observation",
          status: "active",
          observedAt: at,
          expiresAt: null,
          data: { outcome: "verified" },
        };
        return [ref, { ...core, envelopeDigest: D(core) }];
      }),
    );
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: {
        tenantId: h.descriptor.tenantId,
        evolutionRunId: "pruning-wiki",
        maintainerModel: "test:strict-wiki",
        rulesDigest: D("three-source-policy"),
        minCorroboratingSources: 3,
      },
      policy: {
        trustedProjectionRead: true,
        rawEvidenceRead: false,
        activeSkillWrite: false,
        shell: false,
        network: false,
        secretRead: false,
      },
      ports: h.wiki.maintainerPorts({
        resolveEvidence: (ref) => evidence[ref],
        derive: () => ({
          operations: [
            {
              type: "upsert",
              pattern: {
                patternId: "pat-fresh-strict",
                kind: "success",
                summary: "Requires three independent sources",
                rootCause: "Strict policy",
                procedure: "Do not promote during pruning",
                appliesWhen: [],
                doesNotApplyWhen: [],
                positiveEvidence: Object.keys(evidence),
                negativeEvidence: [],
                contradicts: [],
                supersedes: [],
                confidence: 0.9,
                trustDomains: [],
                lastVerifiedAt: at,
                expiresAt: null,
                skillNames: [],
              },
            },
          ],
        }),
      }),
    });
    await maintainer.maintain({
      evidenceRefs: Object.keys(evidence),
      effectiveAt: at,
    });
    const before = h.wiki.loadWiki().state;
    expect(before.patterns["pat-fresh-strict"]).toMatchObject({
      status: "hypothesis",
      actionable: false,
    });
    const plan = await h.plan();
    expect(plan.patternActions.map((action) => action.patternId)).toEqual([
      "pat-maintenance-0000",
    ]);
    await h.controller.execute({ plan });
    const after = h.wiki.loadWiki().state;
    expect(after.patterns["pat-fresh-strict"]).toEqual(
      before.patterns["pat-fresh-strict"],
    );
    expect(after.index).toEqual(before.index);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.evidenceDependents).toEqual(before.evidenceDependents);
    expect(after.skillImpact).toEqual(before.skillImpact);
    expect(after.evolutionLog).toHaveLength(before.evolutionLog.length + 1);
    expect(after.patterns["pat-maintenance-0000"].status).toBe("tombstoned");
  }, 120_000);

  it("rejects redigested result, reference and tenant substitutions using durable state rather than receipt flags", async () => {
    const h = setup();
    await h.seed();
    const done = await h.execute();
    const reopened = openPruningMaintenanceStore(h.root);
    const resolution = await reopened.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    for (const kind of ["state", "reference", "tenant", "missing-revision"]) {
      const receipt = structuredClone(done.operationReceipts[1]);
      if (kind === "state") receipt.resultStateDigest = D("forged");
      if (kind === "reference")
        receipt.revisions[0].eventDigest = D("forged event");
      if (kind === "tenant") receipt.tenantId = "other";
      if (kind === "missing-revision") receipt.revisions = [];
      const { receiptDigest: ignored, ...core } = receipt;
      void ignored;
      receipt.receiptDigest = pruningDigest(
        WIKI_PRUNING_MAINTENANCE_RECEIPT_SCHEMA,
        core,
      );
      expect(
        await verifyReceipt(reopened, done.plan, receipt, resolution),
      ).toBe(false);
    }
  }, 120_000);
});
