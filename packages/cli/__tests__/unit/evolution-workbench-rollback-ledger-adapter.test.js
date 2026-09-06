import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openWorkbenchRollbackStore,
  authorizationFor,
  verifyAuthorization,
  NOW,
} from "../fixtures/evolution-workbench-rollback.js";
import {
  EvolutionWorkbenchRollbackLedgerAdapter,
  createEvolutionWorkbenchRollbackRuntime,
} from "../../src/lib/evolution/evolution-workbench-rollback-ledger-adapter.js";
import { buildEvolutionWorkbenchRollbackRequest } from "../../src/lib/evolution/evolution-workbench-version-control.js";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function temp() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-workbench-rollback-"),
  );
  roots.push(root);
  return root;
}
describe("Workbench actual Registry rollback bridge", () => {
  it("rolls back actual content and dependency lock, then reopens without repeating authority or mutation", async () => {
    const root = temp();
    const h = await openWorkbenchRollbackStore(root, { seed: true });
    const runtime = createEvolutionWorkbenchRollbackRuntime(h.adapterOptions);
    const receipt = await runtime.rollbackExecutor.execute(h.plan);
    expect(h.asks).toHaveLength(1);
    expect(h.mutationRequests).toHaveLength(1);
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.release.readActive().state.revision).toBe(3);
    expect(receipt.activeContentDigest).toBe(h.release.baseline.contentDigest);
    const sequence = h.backend.ledger.verify().sequence;
    const noHuman = vi.fn(() => {
      throw new Error("unexpected human request");
    });
    const reopened = await openWorkbenchRollbackStore(root, {
      now: () => NOW + 700_000,
      authorizeHuman: noHuman,
    });
    expect(await reopened.adapter.createExecutor().execute(h.plan)).toEqual(
      receipt,
    );
    expect(await reopened.adapter.resume()).toEqual([]);
    expect(noHuman).not.toHaveBeenCalled();
    expect(reopened.mutationRequests).toHaveLength(0);
    expect(reopened.backend.ledger.verify().sequence).toBe(sequence);
    await h.release.promoteCandidate("later-authorized-promotion");
    const later = h.release.readActive();
    expect(later.state.revision).toBe(4);
    expect(await h.adapter.resume()).toEqual([]);
    await expect(h.adapter.createExecutor().execute(h.plan)).rejects.toThrow(
      "no longer the current",
    );
    expect(h.release.readActive()).toEqual(later);
    expect(h.asks).toHaveLength(1);
    expect(h.mutationRequests).toHaveLength(1);
  });
  it("rejects automated but correctly signed human authorization before rollback", async () => {
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      authorizeHuman: (plan) => authorizationFor(plan, { automated: true }),
    });
    await expect(h.adapter.createExecutor().execute(h.plan)).rejects.toThrow(
      "automated",
    );
    expect(h.mutationRequests).toHaveLength(0);
    expect(h.release.readActive().state.revision).toBe(2);
  });
  it("rejects a capability whose policy is not bound to the saved Workbench authorization", async () => {
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      authorizeMutation: (expected, authorize) =>
        authorize({ ...expected, policyReceipt: null }),
    });
    await expect(h.adapter.createExecutor().execute(h.plan)).rejects.toThrow(
      "policy is not bound",
    );
    expect(h.release.readActive().state.revision).toBe(2);
  });
  it("rejects mutation permission that expires later than the exact human approval", async () => {
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      authorizeHuman: (plan) =>
        authorizationFor(plan, {
          expiresAt: new Date(NOW + 60_000).toISOString(),
        }),
      authorizeMutation: (expected, authorize) =>
        authorize({ ...expected, expiresAt: null }),
    });
    await expect(h.adapter.createExecutor().execute(h.plan)).rejects.toThrow(
      "outlives human approval",
    );
    expect(h.release.readActive().state.revision).toBe(2);
  });
  it.each([false, true])(
    "resumes only a real effect when prepared approval is expired (applied=%s)",
    async (applied) => {
      const root = temp();
      const h = await openWorkbenchRollbackStore(root, { seed: true });
      const authorization = await h.adapter.authorizeHumanRollback({
        plan: h.plan,
      });
      const request = buildEvolutionWorkbenchRollbackRequest(
        h.plan,
        authorization.receiptDigest,
      );
      if (applied) await h.adapter.applyRollback(request);
      const reopened = await openWorkbenchRollbackStore(root, {
        now: () => NOW + 700_000,
      });
      if (applied) {
        expect(await reopened.adapter.resume()).toHaveLength(1);
        expect(reopened.release.readActive().state.revision).toBe(3);
      } else {
        await expect(reopened.adapter.resume()).rejects.toThrow("stale");
        expect(reopened.release.readActive().state.revision).toBe(2);
      }
      expect(reopened.asks).toHaveLength(0);
      expect(reopened.mutationRequests).toHaveLength(0);
    },
  );
  it("rejects a stale active-state plan before asking for human permission", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const candidate = h.release.createDerivedCandidate();
    await h.release.promoteCandidate(
      "another-promotion",
      candidate.candidateId,
    );
    await expect(h.adapter.createExecutor().execute(h.plan)).rejects.toThrow();
    expect(h.asks).toHaveLength(0);
    expect(h.mutationRequests).toHaveLength(0);
  });
  it("settles a historical rollback after a later promotion without changing the new active release", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const authorization = await h.adapter.authorizeHumanRollback({
      plan: h.plan,
    });
    await h.adapter.applyRollback(
      buildEvolutionWorkbenchRollbackRequest(
        h.plan,
        authorization.receiptDigest,
      ),
    );
    await h.release.promoteCandidate("promotion-before-workbench-settlement");
    const later = h.release.readActive();
    const reopenedAdapter = new EvolutionWorkbenchRollbackLedgerAdapter(
      h.adapterOptions,
    );
    const receipts = await reopenedAdapter.resume();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].activeContentDigest).toBe(
      h.release.baseline.contentDigest,
    );
    expect(h.release.readActive()).toEqual(later);
    expect(later.state.revision).toBe(4);
    expect(await reopenedAdapter.resume()).toEqual([]);
    expect(h.asks).toHaveLength(1);
    expect(h.mutationRequests).toHaveLength(1);
  });
  it("requires genuine same-Ledger projection and independent release readers", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    expect(
      () =>
        new EvolutionWorkbenchRollbackLedgerAdapter({
          ...h.adapterOptions,
          projectionReader: { ...h.adapterOptions.projectionReader },
        }),
    ).toThrow("genuine");
    expect(
      () =>
        new EvolutionWorkbenchRollbackLedgerAdapter({
          ...h.adapterOptions,
          verifierReleaseRegistry: h.adapterOptions.releaseRegistry,
        }),
    ).toThrow("independent");
    expect(
      () =>
        new EvolutionWorkbenchRollbackLedgerAdapter({
          ...h.adapterOptions,
          transactionLedger: { ...h.adapterOptions.transactionLedger },
        }),
    ).toThrow("binding differs");
  });
  it("fails replay after the human verifier is revoked without repeating the actual rollback", async () => {
    const root = temp();
    const h = await openWorkbenchRollbackStore(root, { seed: true });
    await h.adapter.createExecutor().execute(h.plan);
    const reopened = await openWorkbenchRollbackStore(root, {
      verifyHuman: () => false,
    });
    await expect(
      reopened.adapter.createExecutor().execute(h.plan),
    ).rejects.toThrow("signature verification failed");
    expect(reopened.release.readActive().state.revision).toBe(3);
    expect(reopened.mutationRequests).toHaveLength(0);
  });
  it("rechecks expiry after an asynchronous human verification before requesting mutation authority", async () => {
    let current = NOW;
    let expire = false;
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      now: () => current,
      verifyHuman: async (input) => {
        const verified = verifyAuthorization(input);
        if (expire) current = NOW + 700_000;
        return verified;
      },
    });
    const authorization = await h.adapter.authorizeHumanRollback({
      plan: h.plan,
    });
    expire = true;
    await expect(
      h.adapter.applyRollback(
        buildEvolutionWorkbenchRollbackRequest(
          h.plan,
          authorization.receiptDigest,
        ),
      ),
    ).rejects.toThrow("stale");
    expect(h.mutationRequests).toHaveLength(0);
    expect(h.release.readActive().state.revision).toBe(2);
  });
});
