import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPruningRollbackStore } from "../fixtures/wiki-pruning-skill-rollback.js";
import { openPruningMaintenanceStore } from "../fixtures/governed-wiki-pruning-maintenance.js";
import { GovernedWikiPruningSkillRollback } from "../../src/lib/evolution/governed-wiki-pruning-skill-rollback.js";
import { captureWikiRevisionReader } from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import { captureSkillReleaseOperationReader } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { captureSkillReleaseRegistryReader } from "../../src/lib/evolution/skill-release-registry.js";
import { captureSkillRollbackProvider } from "../../src/lib/evolution/skill-promotion-controller.js";
import {
  pruningOperationCalls,
  pruningDigest,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pruning-rollback-"),
  );
  roots.push(root);
  return openPruningRollbackStore(root, { seed: true, ...options });
}
describe("actual Skill rollback inside pruning", () => {
  it("rolls back the actual release before tombstones and restores exact receipts from the same Ledger", async () => {
    const h = await setup();
    const beforeHead = h.resources.backend.ledger.verify();
    const before = Object.fromEntries(
      ["epoch", "ledgerId", "identityDigest", "sequence", "headDigest"].map(
        (key) => [key, beforeHead[key]],
      ),
    );
    await expect(h.execute()).rejects.toThrow(/separately verified KMS/u);
    const state = (await h.journal.load({ tenantId: h.descriptor.tenantId }))
      .state;
    expect(state.operationReceipts).toHaveLength(2);
    const receipt = state.operationReceipts[0];
    expect(receipt.schema).toBe(
      "chainlesschain.wiki-pruning-dependency-receipt/v2",
    );
    expect(receipt.rollbacks).toHaveLength(1);
    const reader = captureSkillReleaseOperationReader(
      h.release.pruningRollbackOptions.transactionLedger,
    );
    expect(
      reader.resolveOperation({
        tenantId: h.descriptor.tenantId,
        skillName: "safe-refactor",
        operationId: receipt.rollbacks[0].operationId,
        context: { mode: "checkpoint", checkpoint: before },
      }).result,
    ).toBeNull();
    const history = captureWikiRevisionReader(h.wiki).resolveHistory({
      tenantId: h.descriptor.tenantId,
      stateDigest: state.plan.wikiStateDigest,
      allowedMaintenanceRequestDigests: h.maintenance
        .authorityPorts()
        .requestDigests({ plan: state.plan }),
    });
    expect(receipt.rollbacks[0].sequence).toBeLessThanOrEqual(
      history.successors[0].predecessorHead.sequence,
    );
    expect(
      await h.maintenance.authorityPorts().verifySuccessors({
        plan: state.plan,
        history: {
          ...history,
          successors: [
            { ...history.successors[0], predecessorHead: before },
            ...history.successors.slice(1),
          ],
        },
      }),
    ).toBe(false);
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.release.readActive().state.revision).toBe(3);
    expect(receipt.rollbacks[0].transactionId).toBe(
      h.release.readActive().state.transactionId,
    );
    const reopened = await openPruningRollbackStore(h.root);
    await expect(reopened.execute()).rejects.toThrow(
      /separately verified KMS/u,
    );
    const resolution = await reopened.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    expect(resolution.state).toEqual(state);
    expect(reopened.release.inspect().transitions).toHaveLength(3);
    expect(
      await reopened.provider.applyDependencyDispositions(
        pruningOperationCalls(state.plan)[0],
      ),
    ).toEqual(receipt);
    expect(
      await reopened.wikiReceiptVerifier.verify({
        ...pruningOperationCalls(state.plan)[0],
        plan: state.plan,
        receipt,
        ...h.descriptor,
        context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
      }),
    ).toBe(true);
  }, 180_000);

  it.each([
    [
      "unsafe last-known-good",
      { baselinePatternRefs: ["pat-maintenance-0000"] },
      /still depends/u,
    ],
    [
      "unrelated active candidate",
      { candidateId: pruningDigest("unrelated-candidate", {}) },
      /candidate-to-pattern/u,
    ],
  ])(
    "rejects %s without mutating a release or Wiki",
    async (_label, options, error) => {
      const h = await setup(options);
      const before = h.wiki.loadWiki();
      await expect(h.execute()).rejects.toThrow(error);
      expect(h.wiki.loadWiki()).toEqual(before);
      expect(h.release.readActive().release).toEqual(
        h.release.candidateRelease,
      );
      expect(h.release.inspect().transitions).toHaveLength(2);
    },
    120_000,
  );

  it("does not execute accessors in a returned rollback authorization", async () => {
    const h = await setup();
    let accessed = false;
    const rollback = new GovernedWikiPruningSkillRollback({
      ...h.release.pruningRollbackOptions,
      authorizationProvider: {
        authorizeRollback: () => ({
          capability: {},
          get request() {
            accessed = true;
            throw new Error("getter executed");
          },
        }),
      },
    });
    const current = openPruningMaintenanceStore(h.root, {
      realDependencies: true,
      dependencyDeletion: true,
      skillRollbackProvider: rollback,
    });
    await expect(current.execute()).rejects.toThrow(/exact own/u);
    expect(accessed).toBe(false);
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
  }, 120_000);

  it("rejects cloned recovery ports, forged registry readers and mismatched rollback providers", async () => {
    const h = await setup();
    const options = h.release.pruningRollbackOptions;
    expect(() =>
      captureSkillReleaseOperationReader({ ...options.transactionLedger }),
    ).toThrow(/branded/u);
    expect(() =>
      captureSkillReleaseRegistryReader({ ...options.releaseRegistry }),
    ).toThrow(/genuine/u);
    expect(() =>
      captureSkillRollbackProvider(
        { ...options.rollbackProvider },
        options.releaseRegistry,
      ),
    ).toThrow(/branded/u);
    expect(() =>
      captureSkillRollbackProvider(options.rollbackProvider, {}),
    ).toThrow(/same release registry/u);
  }, 120_000);
});
