import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { describe, expect, it, vi } from "vitest";
import { EvolutionWorkbenchBatchExecutor } from "../../src/lib/evolution/evolution-workbench-batch-executor.js";
import {
  buildEvolutionWorkbenchProjection,
  createEvolutionWorkbenchDataSource,
  buildEvolutionWorkbenchBatchPlan,
} from "../../src/lib/evolution/evolution-workbench-projection.js";
import {
  packetFixture,
  responseFor,
  decisionFor,
  verifyHuman,
  runEvents,
  NOW,
  TENANT,
  RUN,
  SKILL,
  D,
} from "../fixtures/evolution-workbench-review.js";

async function fixture() {
  const { packet, candidate } = packetFixture();
  const events = runEvents(candidate);
  const source = createEvolutionWorkbenchDataSource({
    tenantId: TENANT,
    runId: RUN,
    skillName: SKILL,
    runAdapter: {
      load: () => ({
        events,
        projection: evolutionRun.projectEvolutionRun(events, {
          tenantId: TENANT,
          runId: RUN,
        }),
      }),
    },
    reviewAdapter: {
      listReviews: () => [{ packet, decision: null, status: "pending" }],
    },
    transitionAdapter: { list: () => [] },
  });
  const projection = await buildEvolutionWorkbenchProjection(source, {
    observedAt: new Date(NOW).toISOString(),
  });
  const plan = buildEvolutionWorkbenchBatchPlan(projection, {
    packetDigests: [packet.packetDigest],
    decision: "approve",
    reason: "Reviewed exact packet.",
    requestedBy: "human:alice",
  });
  let stored = null;
  const ports = {
    loadProjection: vi.fn(async () => projection),
    resolvePacket: vi.fn(async () => packet),
    loadExecutionItem: vi.fn(async () => stored),
    requestHumanDecision: vi.fn(async (request) =>
      responseFor(packet, request),
    ),
    verifyHumanDecision: vi.fn(verifyHuman),
    prepareDecision: vi.fn(async ({ response }) => {
      stored = { status: "prepared", response };
      return {
        authenticated: true,
        durable: true,
        responseDigest: response.responseDigest,
      };
    }),
    retainDecision: vi.fn(async ({ decision }) => {
      stored = { ...stored, status: "applied" };
      return { persisted: true, receiptDigest: decision.receiptDigest };
    }),
    commitExecutionItem: vi.fn(async ({ item }) => {
      stored = { ...stored, status: "committed", item };
      return {
        authenticated: true,
        durable: true,
        itemDigest: item.itemDigest,
      };
    }),
  };
  return {
    packet,
    projection,
    plan,
    ports,
    executor: new EvolutionWorkbenchBatchExecutor({
      tenantId: TENANT,
      ports,
      now: () => NOW,
    }),
  };
}

describe("Evolution Workbench batch executor", () => {
  it("retains the unchanged canonical human decision and separately verifies its signed request binding", async () => {
    const h = await fixture();
    const result = await h.executor.execute(h.plan);
    expect(result.schema).toBe(
      "chainlesschain.evolution-workbench-batch-execution/v2",
    );
    expect(result.items).toHaveLength(1);
    expect(h.ports.requestHumanDecision).toHaveBeenCalledOnce();
    expect(h.ports.retainDecision).toHaveBeenCalledOnce();
    const retained = h.ports.retainDecision.mock.calls[0][0];
    expect(retained.decision).not.toHaveProperty("requestDigest");
    expect(retained.response.decision).toEqual(retained.decision);
    expect(h.ports.commitExecutionItem).toHaveBeenCalledOnce();
    expect(await h.executor.execute(h.plan)).toEqual(result);
    expect(h.ports.requestHumanDecision).toHaveBeenCalledOnce();
    expect(h.ports.retainDecision).toHaveBeenCalledOnce();
  });
  it("rejects a stale source projection", async () => {
    const h = await fixture();
    h.ports.loadProjection.mockResolvedValueOnce({
      ...h.projection,
      projectionDigest: D("wrong"),
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow();
    expect(h.ports.requestHumanDecision).not.toHaveBeenCalled();
  });
  it.each([
    [
      "legacy flat response",
      (h, request) => ({
        ...decisionFor(h.packet),
        requestDigest: request.requestDigest,
      }),
    ],
    [
      "wrong request",
      (h, request) =>
        responseFor(h.packet, request, { requestDigest: D("wrong") }),
    ],
    [
      "automated decision",
      (h, request) =>
        responseFor(h.packet, request, {
          decision: decisionFor(h.packet, { automated: true }),
        }),
    ],
    [
      "wrong initiating reviewer",
      (h, request) =>
        responseFor(h.packet, request, {
          decision: decisionFor(h.packet, {
            reviewerIds: ["human:carol", "human:bob"],
          }),
        }),
    ],
    [
      "expired approval",
      (h, request) => responseFor(h.packet, request, {}, NOW - 600_001),
    ],
    [
      "bad outer signature",
      (h, request) => ({
        ...responseFor(h.packet, request),
        signature: "a".repeat(86),
      }),
    ],
    [
      "mixed signed fields",
      (h, request) =>
        responseFor(h.packet, request, {
          decision: {
            ...decisionFor(h.packet),
            requestDigest: request.requestDigest,
          },
        }),
    ],
  ])("rejects %s before persistence", async (_name, response) => {
    const h = await fixture();
    h.ports.requestHumanDecision.mockImplementationOnce((request) =>
      response(h, request),
    );
    await expect(h.executor.execute(h.plan)).rejects.toThrow();
    expect(h.ports.prepareDecision).not.toHaveBeenCalled();
    expect(h.ports.retainDecision).not.toHaveBeenCalled();
  });
  it.each([
    [
      "prepareDecision",
      { authenticated: true, durable: false },
      "not durably prepared",
    ],
    ["retainDecision", { persisted: false }, "not durably retained"],
    ["commitExecutionItem", { durable: false }, "not committed"],
  ])("requires durable %s", async (port, result, message) => {
    const h = await fixture();
    h.ports[port].mockResolvedValueOnce(result);
    await expect(h.executor.execute(h.plan)).rejects.toThrow(message);
  });
  it("does not accept an acknowledgement without final committed readback", async () => {
    const h = await fixture();
    h.ports.commitExecutionItem.mockImplementationOnce(async ({ item }) => ({
      authenticated: true,
      durable: true,
      itemDigest: item.itemDigest,
    }));
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "not durably read back",
    );
  });
  it("fails replay after current signature verification is revoked", async () => {
    const h = await fixture();
    await h.executor.execute(h.plan);
    h.ports.verifyHumanDecision.mockReturnValueOnce(false);
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "signature verification failed",
    );
    expect(h.ports.retainDecision).toHaveBeenCalledOnce();
  });
  it("captures fixed own methods and rejects accessors without invoking them", async () => {
    const h = await fixture();
    const replacement = vi.fn(() => {
      throw new Error("substitution");
    });
    h.ports.retainDecision = replacement;
    await h.executor.execute(h.plan);
    expect(replacement).not.toHaveBeenCalled();
    const accessor = vi.fn();
    Object.defineProperty(h.ports, "retainDecision", { get: accessor });
    expect(
      () =>
        new EvolutionWorkbenchBatchExecutor({
          tenantId: TENANT,
          ports: h.ports,
        }),
    ).toThrow("port retainDecision");
    expect(accessor).not.toHaveBeenCalled();
  });
});
