import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvolutionWorkbenchReviewLedgerAdapter,
  createEvolutionWorkbenchReviewRuntime,
  WORKBENCH_REVIEW_SETTLEMENT_SCHEMA,
} from "../../src/lib/evolution/evolution-workbench-review-ledger-adapter.js";
import {
  buildWorkbenchExecutionItem,
  buildWorkbenchBatchItemRequest,
} from "../../src/lib/evolution/evolution-workbench-review-protocol.js";
import { pruningDigest } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import { EVOLUTION_WORKBENCH_PROJECTION_SCHEMA } from "../../src/lib/evolution/evolution-workbench-projection.js";
import {
  openWorkbenchReviewStore,
  responseFor,
  verifyHuman,
  verifyDecision,
  NOW,
  TENANT,
  D,
} from "../fixtures/evolution-workbench-review.js";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function rootDir() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-workbench-review-"),
  );
  roots.push(root);
  return root;
}

describe("actual Workbench Review Ledger bridge", () => {
  it("allows only one exact signed response to win a preparation race", async () => {
    const root = rootDir();
    const h = openWorkbenchReviewStore(root);
    const { plan, request } = await h.seed();
    const other = openWorkbenchReviewStore(root);
    const results = await Promise.allSettled([
      h.adapter.prepareDecision({
        plan,
        request,
        response: responseFor(h.packet, request),
      }),
      other.adapter.prepareDecision({
        plan,
        request,
        response: responseFor(h.packet, request, {}, NOW - 1000),
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(
      h.backend.ledger
        .read()
        .filter(({ type }) => type === "evolution.workbench.review.prepared"),
    ).toHaveLength(1);
    expect(
      (await h.reviewAdapter.readReview(h.packet.packetDigest)).decision,
    ).toBeNull();
  });
  it("rejects approval expiration during asynchronous signature verification", async () => {
    let clock = NOW;
    const h = openWorkbenchReviewStore(rootDir(), {
      now: () => clock,
      verifyDecision: async (input) => {
        const valid = verifyDecision(input);
        if (input.source === "retain") clock = NOW + 700_000;
        return valid;
      },
    });
    const { plan } = await h.seed();
    await expect(h.adapter.createExecutor().execute(plan)).rejects.toThrow(
      "stale",
    );
    expect(
      (await h.reviewAdapter.readReview(h.packet.packetDigest)).decision,
    ).toBeNull();
  });
  it("assembles the deployment review leg from actual Run and Review adapters", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { plan, projection } = await h.seed();
    const runtime = createEvolutionWorkbenchReviewRuntime({
      ...h.shared,
      decisionVerifier: { verify: verifyDecision },
      transitionAdapter: { list: () => [] },
      humanDecisionProvider: {
        request: (request) => responseFor(h.packet, request),
      },
      humanDecisionVerifier: { verify: verifyHuman },
    });
    expect(await runtime.projectionLoader.load()).toEqual(projection);
    expect(
      await runtime.projectionAuthority.retain({
        tenantId: TENANT,
        projection,
      }),
    ).toMatchObject({ durable: true });
    expect((await runtime.batchExecutor.execute(plan)).items).toHaveLength(1);
    expect(
      (await h.reviewAdapter.readReview(h.packet.packetDigest)).decision
        .decision,
    ).toBe("approved");
  });
  it("finishes unprepared items after the first item of a multi-packet plan committed", async () => {
    const root = rootDir();
    const h = openWorkbenchReviewStore(root);
    const { plan, packets } = await h.seed(2);
    const packet = packets.find(
      (value) => value.packetDigest === plan.packetDigests[0],
    );
    const request = buildWorkbenchBatchItemRequest(plan, packet);
    const response = responseFor(packet, request);
    await h.adapter.prepareDecision({ plan, request, response });
    await h.adapter.retainDecision({
      plan,
      request,
      response,
      packetDigest: packet.packetDigest,
      decision: response.decision,
    });
    await h.adapter.commitExecutionItem({
      plan,
      request,
      response,
      item: buildWorkbenchExecutionItem(request, response),
    });
    const reopened = openWorkbenchReviewStore(root);
    const results = await reopened.adapter.resume();
    expect(results).toHaveLength(1);
    expect(results[0].items).toHaveLength(2);
    expect(reopened.asks).toHaveLength(1);
    expect(reopened.asks[0].packetDigest).toBe(plan.packetDigests[1]);
    expect(await reopened.adapter.resume()).toEqual([]);
  });
  it("rejects a signed settlement forged without a real Review decision", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { plan, request } = await h.seed();
    const response = responseFor(h.packet, request);
    await h.adapter.prepareDecision({ plan, request, response });
    const events = h.backend.ledger.read();
    const prepared = events.find(
      ({ type }) => type === "evolution.workbench.review.prepared",
    );
    const packetEvent = events.find(
      ({ type }) => type === "skill.promotion-review.requested",
    );
    const artifactType = "evolution-workbench-review-settlement";
    const value = {
      schema: WORKBENCH_REVIEW_SETTLEMENT_SCHEMA,
      tenantId: TENANT,
      runId: plan.runId,
      skillName: plan.skillName,
      planDigest: plan.planDigest,
      requestDigest: request.requestDigest,
      responseDigest: response.responseDigest,
      item: buildWorkbenchExecutionItem(request, response),
    };
    const published = h.artifactPorts.putCanonical(artifactType, value, {
      audience: h.descriptor.audience,
      purpose: h.descriptor.purpose,
      retention: "ledger",
    });
    const head = h.backend.ledger.verify();
    h.backend.ledger.appendDomainEvent(
      {
        artifactTenantId: h.descriptor.artifactTenantId,
        tenantId: TENANT,
        correlationId: h.descriptor.streamId,
        skillName: plan.skillName,
        type: "evolution.workbench.review.committed",
        eventId: `evolution.workbench.review.committed.${request.requestDigest.slice(7)}`,
        decision: "committed",
        reason: artifactType,
        timestamp: new Date(NOW).toISOString(),
        subjectRef: published.ref,
        sourceRefs: [prepared.subjectRef, packetEvent.subjectRef],
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    await expect(
      h.adapter.loadExecutionItem({ plan, request }),
    ).rejects.toThrow("no exact authenticated review effect");
    await expect(h.adapter.resume()).rejects.toThrow(
      "no exact authenticated review effect",
    );
  });
  it("persists canonical Review decisions and reopens the exact settled batch without asking again", async () => {
    const root = rootDir();
    const h = openWorkbenchReviewStore(root);
    const { plan, request } = await h.seed();
    const result = await h.adapter.createExecutor().execute(plan);
    expect(h.asks).toHaveLength(1);
    const actual = await h.reviewAdapter.readReview(h.packet.packetDigest);
    expect(verifyDecision({ decision: actual.decision })).toBe(true);
    expect(actual.decision).not.toHaveProperty("requestDigest");
    expect((await h.adapter.loadExecutionItem({ plan, request })).status).toBe(
      "committed",
    );
    const sequence = h.backend.ledger.verify().sequence;
    const noHuman = vi.fn(() => {
      throw new Error("human must not be asked on recovery");
    });
    const reopened = openWorkbenchReviewStore(root, {
      request: noHuman,
      now: () => NOW + 700_000,
    });
    expect(await reopened.adapter.createExecutor().execute(plan)).toEqual(
      result,
    );
    expect(await reopened.adapter.resume()).toEqual([]);
    expect(noHuman).not.toHaveBeenCalled();
    expect(reopened.backend.ledger.verify().sequence).toBe(sequence);
  });
  it.each(["prepared", "applied"])(
    "resumes a durable %s record using real Ledger state",
    async (phase) => {
      const root = rootDir();
      const h = openWorkbenchReviewStore(root);
      const { plan, request } = await h.seed();
      const response = responseFor(h.packet, request);
      await h.adapter.prepareDecision({ plan, request, response });
      if (phase === "applied")
        await h.reviewAdapter.retainDecision({
          packetDigest: h.packet.packetDigest,
          decision: response.decision,
        });
      const noHuman = vi.fn(() => {
        throw new Error("unexpected human request");
      });
      const reopened = openWorkbenchReviewStore(root, {
        request: noHuman,
        now: () => (phase === "applied" ? NOW + 700_000 : NOW),
      });
      expect(await reopened.adapter.resume()).toHaveLength(1);
      expect(
        (await reopened.adapter.loadExecutionItem({ plan, request })).status,
      ).toBe("committed");
      expect(noHuman).not.toHaveBeenCalled();
      const events = reopened.backend.ledger.read();
      expect(
        events.filter(({ type }) => type === "skill.promotion-review.decided"),
      ).toHaveLength(1);
      expect(
        events.filter(
          ({ type }) => type === "evolution.workbench.review.committed",
        ),
      ).toHaveLength(1);
    },
  );
  it("rejects an expired prepared approval with no actual decision effect", async () => {
    const root = rootDir();
    const h = openWorkbenchReviewStore(root);
    const { plan, request } = await h.seed();
    await h.adapter.prepareDecision({
      plan,
      request,
      response: responseFor(h.packet, request),
    });
    const sequence = h.backend.ledger.verify().sequence;
    const reopened = openWorkbenchReviewStore(root, {
      now: () => NOW + 700_000,
    });
    await expect(reopened.adapter.resume()).rejects.toThrow("stale");
    expect(
      (await reopened.reviewAdapter.readReview(h.packet.packetDigest)).decision,
    ).toBeNull();
    expect(reopened.backend.ledger.verify().sequence).toBe(sequence);
  });
  it.each(["verifyHuman", "verifyDecision"])(
    "rechecks current %s after effects are committed",
    async (verifier) => {
      const root = rootDir();
      const h = openWorkbenchReviewStore(root);
      const { plan } = await h.seed();
      await h.adapter.createExecutor().execute(plan);
      const sequence = h.backend.ledger.verify().sequence;
      const reopened = openWorkbenchReviewStore(root, {
        [verifier]: () => false,
      });
      await expect(
        reopened.adapter.createExecutor().execute(plan),
      ).rejects.toThrow("signature verification failed");
      expect(reopened.backend.ledger.verify().sequence).toBe(sequence);
    },
  );
  it("will not settle an unexecuted preparation, even with a self-consistent item digest", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { plan, request } = await h.seed();
    const response = responseFor(h.packet, request);
    await h.adapter.prepareDecision({ plan, request, response });
    const sequence = h.backend.ledger.verify().sequence;
    await expect(
      h.adapter.commitExecutionItem({
        plan,
        request,
        response,
        item: buildWorkbenchExecutionItem(request, response),
      }),
    ).rejects.toThrow("no exact authenticated review effect");
    expect(h.backend.ledger.verify().sequence).toBe(sequence);
  });
  it("rejects a rehashed projection not rebuilt from the fixed source", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { projection } = await h.seed();
    const core = { ...projection };
    delete core.projectionDigest;
    const changed = {
      ...core,
      candidates: [
        { ...core.candidates[0], candidateContentDigest: D("substituted") },
      ],
    };
    await expect(
      h.adapter.retainProjection({
        tenantId: TENANT,
        projection: {
          ...changed,
          projectionDigest: pruningDigest(
            EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
            changed,
          ),
        },
      }),
    ).rejects.toThrow("authenticated source");
  });
  it("rejects a different signed response for a prepared request", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { plan, request } = await h.seed();
    await h.adapter.prepareDecision({
      plan,
      request,
      response: responseFor(h.packet, request),
    });
    const response = responseFor(h.packet, request, {}, NOW - 1000);
    await expect(
      h.adapter.prepareDecision({ plan, request, response }),
    ).rejects.toThrow("conflicts");
  });
  it("does not adopt a decision made outside this Workbench request", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const { plan, request } = await h.seed();
    const response = responseFor(h.packet, request);
    await h.reviewAdapter.retainDecision({
      packetDigest: h.packet.packetDigest,
      decision: response.decision,
    });
    await expect(
      h.adapter.prepareDecision({ plan, request, response }),
    ).rejects.toThrow("outside this request");
  });
  it("rejects wrong scope and caller-shaped persistence before creating an executor", async () => {
    const h = openWorkbenchReviewStore(rootDir());
    const options = {
      ...h.shared,
      projectionSource: h.projectionSource,
      decisionVerifier: { verify: verifyDecision },
      humanDecisionProvider: { request: async () => null },
      humanDecisionVerifier: { verify: verifyHuman },
    };
    expect(
      () =>
        new EvolutionWorkbenchReviewLedgerAdapter({
          ...options,
          ledger: { ...h.backend.ledger },
        }),
    ).toThrow("actual Ledger");
    expect(
      () =>
        new EvolutionWorkbenchReviewLedgerAdapter({
          ...options,
          descriptor: { ...h.descriptor, runId: "another-run" },
        }),
    ).toThrow("same-scope");
  });
});
