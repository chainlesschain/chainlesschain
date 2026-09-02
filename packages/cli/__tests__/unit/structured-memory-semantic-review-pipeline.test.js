import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import {
  createStructuredMemorySemanticReviewPipeline,
  createStructuredMemorySemanticReviewer,
} from "../../src/lib/evolution/structured-memory-semantic-review-pipeline.js";

const {
  StructuredEvolutionMemory,
  createStructuredMemoryAuthority,
  createStructuredMemoryPostCompactVerifier,
  createStructuredMemoryReceiptProvider,
} = structuredMemory;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function harness(overrides = {}) {
  const receipts = new Map();
  const providerIdentity = {
    tenantId: "tenant-a",
    authorityId: "semantic-receipts",
    authorityRevision: 1,
    handlerDigest: digest("semantic-receipt-resolver:v1"),
  };
  const receiptProvider = createStructuredMemoryReceiptProvider({
    descriptor: providerIdentity,
    resolver: {
      async resolve(request) {
        const receipt = receipts.get(request.receiptDigest);
        return {
          schema: structuredMemory.STRUCTURED_MEMORY_RECEIPT_RESOLUTION_SCHEMA,
          authenticated: true,
          ...providerIdentity,
          kind: request.kind,
          receiptDigest: request.receiptDigest,
          receipt,
          resolutionReceiptDigest: digest(`resolve:${request.receiptDigest}`),
        };
      },
    },
    verifier: {
      async verify({ resolution }) {
        return (
          resolution.receipt.attestation ===
          digest(
            `signed:${resolution.receipt.kind}:${resolution.receipt.receiptDigest}`,
          )
        );
      },
    },
  });
  const postIdentity = {
    tenantId: "tenant-a",
    authorityId: "post-compact-test",
    authorityRevision: 1,
    handlerDigest: digest("post-compact-test:v1"),
  };
  const postCompactVerifier = createStructuredMemoryPostCompactVerifier({
    descriptor: postIdentity,
    hook: {
      async run(request) {
        return {
          schema:
            structuredMemory.STRUCTURED_MEMORY_POST_COMPACT_VERIFICATION_SCHEMA,
          authenticated: true,
          ...postIdentity,
          ...request,
          decision: "accepted",
          checkedAt: "2026-09-02T00:00:00.000Z",
          receiptDigest: digest("post-compact"),
        };
      },
    },
    verifier: { verify: async () => true },
  });
  const memory = new StructuredEvolutionMemory({
    tenantId: "tenant-a",
    receiptProvider,
    postCompactVerifier,
    persistEvent: async (event) => ({
      persisted: true,
      eventId: event.eventId,
      eventDigest: digest(canonical(event)),
    }),
    persistSnapshot: async (snapshot) => ({
      persisted: true,
      snapshotDigest: snapshot.snapshotDigest,
    }),
  });
  const reviewer = (kind) =>
    createStructuredMemorySemanticReviewer({
      descriptor: {
        tenantId: "tenant-a",
        kind,
        issuerId: `${kind}-producer`,
        issuerRevision: 1,
        issuerHandlerDigest: digest(`${kind}-producer:v1`),
        verifierId: `${kind}-verifier`,
        verifierRevision: 1,
        verifierHandlerDigest: digest(`${kind}-verifier:v1`),
      },
      producer: {
        review: vi.fn(async () => ({
          decision: overrides[`${kind}Decision`] || "accepted",
          reasonCodes: [`${kind}-checked`],
        })),
      },
      attestor: {
        attest: async ({ payloadDigest }) =>
          digest(`signed:${kind}:${payloadDigest}`),
      },
      verifier: {
        verify: async ({ receipt }) =>
          overrides[`${kind}Verified`] !== false &&
          receipt.attestation ===
            digest(`signed:${kind}:${receipt.receiptDigest}`),
      },
      clock: () => "2026-09-02T00:00:00.000Z",
    });
  const authorityStore = {
    async retainReceipt(receipt) {
      if (overrides.unconfirmedKind === receipt.kind)
        return { persisted: false };
      receipts.set(receipt.receiptDigest, receipt);
      return { persisted: true, receiptDigest: receipt.receiptDigest };
    },
  };
  const pipeline = createStructuredMemorySemanticReviewPipeline({
    tenantId: "tenant-a",
    memory,
    authorityStore,
    critic: reviewer("critic"),
    evaluator: reviewer("evaluator"),
    proposerAuthority: createStructuredMemoryAuthority({
      tenantId: "tenant-a",
      actorId: "child-1",
      actorType: "agent",
      role: "child-agent",
      authorityDigest: digest("child-authority"),
    }),
    governorAuthority: createStructuredMemoryAuthority({
      tenantId: "tenant-a",
      actorId: "governor-1",
      actorType: "service",
      role: "governor",
      authorityDigest: digest("governor-authority"),
    }),
  });
  return { memory, pipeline, receipts };
}

async function propose(pipeline) {
  return pipeline.propose({
    eventId: "semantic-proposal-1",
    memoryId: "semantic-memory-1",
    contentDigest: digest("semantic-content"),
    artifactRef: "artifact://semantic-memory-1",
    evidenceRefs: ["evidence://grader/1"],
    timestamp: "2026-09-02T00:00:00.000Z",
    metadata: { source: "child-agent" },
  });
}

describe("structured semantic memory review pipeline", () => {
  it("persists independent critic/evaluator receipts before governor acceptance", async () => {
    const value = harness();
    await propose(value.pipeline);
    const accepted = await value.pipeline.reviewAndAccept({
      memoryId: "semantic-memory-1",
      eventId: "semantic-accept-1",
      timestamp: "2026-09-02T00:00:01.000Z",
    });

    expect(value.receipts.size).toBe(2);
    expect(
      [...value.receipts.values()].map((receipt) => receipt.kind).sort(),
    ).toEqual(["critic", "evaluator"]);
    expect(accepted.projection.memories["semantic-memory-1"]).toMatchObject({
      status: "active",
      receipts: {
        critic: expect.stringMatching(/^sha256:/u),
        evaluator: expect.stringMatching(/^sha256:/u),
      },
    });
  });

  it("keeps the proposal queued when either independent reviewer rejects", async () => {
    const value = harness({ criticDecision: "rejected" });
    await propose(value.pipeline);
    await expect(
      value.pipeline.reviewAndAccept({
        memoryId: "semantic-memory-1",
        eventId: "semantic-accept-1",
        timestamp: "2026-09-02T00:00:01.000Z",
      }),
    ).rejects.toThrow(/rejected by independent review/u);
    expect(value.receipts.size).toBe(0);
    expect(value.memory.projection().memories["semantic-memory-1"].status).toBe(
      "proposed",
    );
  });

  it("does not activate on invalid authentication or unconfirmed durability", async () => {
    for (const options of [
      { evaluatorVerified: false },
      { unconfirmedKind: "evaluator" },
    ]) {
      const value = harness(options);
      await propose(value.pipeline);
      await expect(
        value.pipeline.reviewAndAccept({
          memoryId: "semantic-memory-1",
          eventId: "semantic-accept-1",
          timestamp: "2026-09-02T00:00:01.000Z",
        }),
      ).rejects.toThrow(/authentication failed|not durably acknowledged/u);
      expect(
        value.memory.projection().memories["semantic-memory-1"].status,
      ).toBe("proposed");
    }
  });

  it("rejects unbranded reviewers and shared reviewer authorities", () => {
    const value = harness();
    expect(() =>
      createStructuredMemorySemanticReviewPipeline({
        tenantId: "tenant-a",
        memory: value.memory,
        authorityStore: { retainReceipt: async () => ({}) },
        critic: { issue: async () => ({}) },
        evaluator: { issue: async () => ({}) },
      }),
    ).toThrow(/branded tenant-scoped critic reviewer/u);
  });
});
