import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPruningFullChain } from "../fixtures/wiki-pruning-full-chain.js";
import { GovernedWikiPruningRawShred } from "../../src/lib/evolution/governed-wiki-pruning-raw-shred.js";
import { createGovernedWikiPruningRuntime } from "../../src/lib/evolution/governed-wiki-pruning-runtime.js";
import {
  pruningOperationCalls,
  buildWikiPruningJournal,
} from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-pruning-full-"),
  );
  roots.push(root);
  return openPruningFullChain(root, { seed: true, ...options });
}
const headOf = (head) =>
  Object.fromEntries(
    ["epoch", "ledgerId", "identityDigest", "sequence", "headDigest"].map(
      (key) => [key, head[key]],
    ),
  );

describe("whole governed Wiki pruning transaction", () => {
  it("finalizes real rollback, Wiki effects, key destruction, retained tombstone and retrieval and restores without repeating effects", async () => {
    const h = await setup();
    const before = headOf(h.resources.backend.ledger.verify());
    expect(h.keyAuthority.decrypt()).toBe("private test recording");
    const done = await h.execute();
    expect(done.phase).toBe("finalized");
    expect(done.operationReceipts).toHaveLength(4);
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.keyAuthority.inspect().keyAvailable).toBe(false);
    expect(() => h.keyAuthority.decrypt()).toThrow(/ENOENT/u);
    const reopened = await openPruningFullChain(h.root);
    expect(await reopened.runtime.resume()).toEqual(done);
    expect(reopened.release.inspect().transitions).toHaveLength(3);
    expect(reopened.keyAuthority.inspect()).toEqual(h.keyAuthority.inspect());
    const query = {
      tenantId: h.descriptor.tenantId,
      wikiRevision: reopened.wiki.loadWiki().state.revisionId,
    };
    expect(
      (await reopened.retrievalReader.readIndex(query)).data.entries,
    ).toEqual([]);
    await expect(
      reopened.retrievalReader.readPattern({
        ...query,
        patternId: "pat-maintenance-0000",
      }),
    ).rejects.toThrow(/excluded/u);
    const resolution = await reopened.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    expect(
      await reopened.rawReceiptVerifier.verify({
        ...pruningOperationCalls(done.plan)[2],
        ...h.descriptor,
        plan: done.plan,
        receipt: done.operationReceipts[2],
        context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
      }),
    ).toBe(true);
    await expect(
      reopened.rawReceiptVerifier.verify({
        ...pruningOperationCalls(done.plan)[2],
        ...h.descriptor,
        plan: done.plan,
        receipt: done.operationReceipts[2],
        context: { mode: "checkpoint", checkpoint: before },
      }),
    ).rejects.toThrow(/not retained/u);
    const proofInput = {
      ...pruningOperationCalls(done.plan)[2],
      ...h.descriptor,
      plan: done.plan,
      receipt: done.operationReceipts[2],
      context: { mode: "checkpoint", checkpoint: resolution.checkpoint },
    };
    const verifierWith = (resolveDestruction) =>
      new GovernedWikiPruningRawShred({
        descriptor: h.descriptor,
        deletionLedgerAdapter: h.deletionSource.adapter,
        keyAuthority: { ...h.keyAuthority, resolveDestruction },
      }).operationReceiptVerifier();
    await expect(verifierWith(() => null).verify(proofInput)).resolves.toBe(
      false,
    );
    await expect(
      verifierWith(async (request) => {
        const proof = h.keyAuthority.resolveDestruction(request);
        await h.writeWiki([]);
        return proof;
      }).verify(proofInput),
    ).rejects.toThrow(/changed during KMS proof/u);
    expect(
      () =>
        new GovernedWikiPruningRawShred({
          descriptor: h.descriptor,
          deletionLedgerAdapter: { ...h.deletionSource.adapter },
          keyAuthority: h.keyAuthority,
        }),
    ).toThrow(/branded Raw deletion/u);
  }, 300_000);

  it("rejects a substituted independent KMS proof and resumes the same actual deletion after reopening", async () => {
    const h = await setup({
      transformProof: (proof) => ({ ...proof, keyRef: "kms://wrong/key" }),
    });
    await expect(h.execute()).rejects.toThrow(/independently verified/u);
    expect(h.keyAuthority.inspect().keyAvailable).toBe(false);
    const unfinished = await h.journal.load({
      tenantId: h.descriptor.tenantId,
    });
    expect(unfinished.state.operationReceipts).toHaveLength(2);
    const reopened = await openPruningFullChain(h.root);
    expect((await reopened.execute()).phase).toBe("finalized");
    expect(reopened.release.inspect().transitions).toHaveLength(3);
    expect(reopened.keyAuthority.inspect()).toEqual(h.keyAuthority.inspect());
  }, 240_000);

  it("never destroys a key before dependency and Wiki acknowledgements", async () => {
    const h = await setup();
    const options = {
      descriptor: h.resources.descriptor,
      artifactPorts: h.resources.artifactPorts,
      ledgerArtifactResolver: h.resources.resolver,
      ledger: h.resources.backend.ledger,
      wikiLedgerAdapter: h.wiki,
      deletionLedgerAdapter: h.deletionSource.adapter,
      skillRollbackProvider: h.rollback,
      keyAuthority: h.keyAuthority,
      clock: h.resources.clock,
    };
    const initialHead = h.resources.backend.ledger.verify();
    expect(() =>
      createGovernedWikiPruningRuntime({ ...options, keyAuthority: null }),
    ).toThrow(/KMS/u);
    expect(() =>
      createGovernedWikiPruningRuntime({
        ...options,
        descriptor: { ...options.descriptor, artifactTenantId: "other-tenant" },
      }),
    ).toThrow(/scope/u);
    expect(() =>
      createGovernedWikiPruningRuntime({
        ...options,
        deletionLedgerAdapter: { ...h.deletionSource.adapter },
      }),
    ).toThrow(/branded/u);
    expect(h.resources.backend.ledger.verify()).toEqual(initialHead);
    const plan = await h.plan();
    const call = pruningOperationCalls(plan)[2];
    await expect(h.rawProvider.cryptoShred(call)).rejects.toThrow(/prepared/u);
    await h.journal.commit({
      state: buildWikiPruningJournal({ plan }),
      expectedJournalDigest: null,
    });
    await expect(h.rawProvider.cryptoShred(call)).rejects.toThrow(/frontier/u);
    expect(h.keyAuthority.decrypt()).toBe("private test recording");
    expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
  }, 120_000);
});
