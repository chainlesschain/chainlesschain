import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openWorkbenchReviewStore,
  responseFor,
  NOW,
} from "../fixtures/evolution-workbench-review.js";
import { openWorkbenchRollbackStore } from "../fixtures/evolution-workbench-rollback.js";
import { workbenchRuntimeOptions } from "../fixtures/evolution-workbench-runtime.js";
import { buildWorkbenchBatchItemRequest } from "../../src/lib/evolution/evolution-workbench-review-protocol.js";
import { buildEvolutionWorkbenchRollbackRequest } from "../../src/lib/evolution/evolution-workbench-version-control.js";
import { createEvolutionWorkbenchRuntime } from "../../src/lib/evolution/evolution-workbench-runtime.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function temp() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-workbench-startup-"),
  );
  roots.push(root);
  return root;
}

describe("Workbench startup reconciles existing effects only", () => {
  it.each([false, true])(
    "audits expired Review preparation without starting other decisions (applied=%s)",
    async (applied) => {
      let now = NOW;
      const root = temp();
      const h = openWorkbenchReviewStore(root, { now: () => now });
      const { plan, packets } = await h.seed(2);
      const packet = packets[0];
      const request = buildWorkbenchBatchItemRequest(plan, packet);
      const response = responseFor(packet, request);
      await h.adapter.prepareDecision({ plan, request, response });
      if (applied)
        await h.adapter.retainDecision({
          plan,
          request,
          response,
          decision: response.decision,
          packetDigest: packet.packetDigest,
        });
      now += 700_000;
      const result = await h.adapter.reconcileCommitted();
      expect(result.settledItems).toHaveLength(applied ? 1 : 0);
      expect(result.deferredRequestDigests).toEqual(
        applied ? [] : [request.requestDigest],
      );
      expect(
        (await h.reviewAdapter.readReview(packets[1].packetDigest)).decision,
      ).toBeNull();
      expect(h.asks).toHaveLength(0);
      if (!applied) await expect(h.adapter.resume()).rejects.toThrow("stale");
      expect((await h.adapter.reconcileCommitted()).settledItems).toHaveLength(
        0,
      );
      const revoked = openWorkbenchReviewStore(root, {
        now: () => now,
        verifyHuman: () => false,
      });
      await expect(revoked.adapter.reconcileCommitted()).rejects.toThrow(
        "signature verification failed",
      );
    },
  );

  it("defers an expired rollback even after later promotion without switching the active version", async () => {
    let now = NOW;
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      now: () => now,
    });
    await h.adapter.authorizeHumanRollback({ plan: h.plan });
    const next = h.release.createDerivedCandidate();
    await h.release.promoteCandidate(
      "startup-later-promotion",
      next.candidateId,
    );
    const active = h.release.readActive();
    now += 700_000;
    const result = await h.adapter.reconcileCommitted();
    expect(result).toEqual({
      settledReceipts: [],
      deferredPlanDigests: [h.plan.planDigest],
    });
    expect(h.release.readActive()).toEqual(active);
    expect(h.asks).toHaveLength(1);
    expect(h.mutationRequests).toHaveLength(0);
    await expect(h.adapter.resume()).rejects.toThrow("stale");
    const runtime = await createEvolutionWorkbenchRuntime(
      workbenchRuntimeOptions(h),
    );
    expect(runtime.recovery.rollbackPlansDeferred).toBe(1);
    expect(
      (await runtime.workbenchHost.list()).governance.activeReleaseId,
    ).toBe(active.release.releaseDigest);
  });

  it("settles an already applied rollback before exposing a fully assembled host", async () => {
    let now = NOW;
    const h = await openWorkbenchRollbackStore(temp(), {
      seed: true,
      now: () => now,
    });
    const authorization = await h.adapter.authorizeHumanRollback({
      plan: h.plan,
    });
    await h.adapter.applyRollback(
      buildEvolutionWorkbenchRollbackRequest(
        h.plan,
        authorization.receiptDigest,
      ),
    );
    now += 700_000;
    const runtime = await createEvolutionWorkbenchRuntime(
      workbenchRuntimeOptions(h),
    );
    expect(runtime.recovery).toEqual({
      reviewsSettled: 0,
      reviewPreparationsDeferred: 0,
      rollbacksSettled: 1,
      rollbackPlansDeferred: 0,
    });
    expect(
      (await runtime.workbenchHost.list()).governance.activeReleaseId,
    ).toBe(h.release.baseline.releaseDigest);
    expect(h.mutationRequests).toHaveLength(1);
    expect(h.asks).toHaveLength(1);
    expect(
      (await createEvolutionWorkbenchRuntime(workbenchRuntimeOptions(h)))
        .recovery.rollbacksSettled,
    ).toBe(0);
    await expect(
      createEvolutionWorkbenchRuntime(
        workbenchRuntimeOptions(h, {
          humanRollbackVerifier: { verify: () => false },
        }),
      ),
    ).rejects.toThrow("signature verification failed");
  });

  it("rejects replacements and resource accessors before publishing a host or asking for identity", async () => {
    const h = await openWorkbenchRollbackStore(temp(), { seed: true });
    const options = workbenchRuntimeOptions(h);
    for (const change of [
      { transitionAdapter: { list: () => [] } },
      { projectionReader: {} },
      { identityProvider: {} },
      { verifierLedger: options.ledger },
    ])
      await expect(
        createEvolutionWorkbenchRuntime({ ...options, ...change }),
      ).rejects.toThrow();
    let invoked = false;
    Object.defineProperty(options, "ledger", {
      get() {
        invoked = true;
        throw new Error("must not run");
      },
    });
    await expect(createEvolutionWorkbenchRuntime(options)).rejects.toThrow(
      "accessors",
    );
    expect(invoked).toBe(false);
    expect(h.asks).toHaveLength(0);
    expect(h.mutationRequests).toHaveLength(0);
  });
});
