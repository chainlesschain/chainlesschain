import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { GovernedKnowledgeSync } from "../../src/lib/evolution/governed-knowledge-sync.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function knowledge(overrides = {}) {
  return {
    tenantId: "tenant:a",
    knowledgeId: "knowledge:1",
    scope: "team",
    scopeId: "team:1",
    action: "upsert",
    contentDigest: D("content:1"),
    vectorClock: { "device:a": 1 },
    approvalReceiptDigest: D("approval"),
    revocationReceiptDigest: null,
    dependencies: [],
    ...overrides,
  };
}

function harness({ deviceId = "device:a", initial = null } = {}) {
  const records = new Map(initial ? [[initial.knowledgeId, initial]] : []);
  const sent = [];
  const ports = {
    authorize: vi.fn(async ({ knowledge: value }) => ({
      authenticated: true,
      allowed: true,
      tenantId: value.tenantId,
      knowledgeId: value.knowledgeId,
      scope: value.scope,
      scopeId: value.scopeId,
      receiptDigest: D("authorization"),
    })),
    encrypt: vi.fn(async ({ plaintext }) => {
      const ciphertext = Buffer.from(plaintext).reverse();
      return {
        ciphertext,
        ciphertextDigest: `sha256:${createHash("sha256")
          .update(ciphertext)
          .digest("hex")}`,
        keyRef: "key:team:1",
      };
    }),
    decrypt: vi.fn(async ({ envelope }) => ({
      plaintext: Buffer.from(envelope.ciphertext, "base64").reverse(),
    })),
    sign: vi.fn(async ({ envelopeDigest }) => `signature:${envelopeDigest}`),
    verify: vi.fn(
      async ({ envelopeDigest, signature }) =>
        signature === `signature:${envelopeDigest}`,
    ),
    load: vi.fn(async ({ knowledgeId }) => records.get(knowledgeId) || null),
    commit: vi.fn(async ({ knowledge: value, envelopeDigest, disposition }) => {
      if (disposition !== "conflict") records.set(value.knowledgeId, value);
      return {
        authenticated: true,
        durable: true,
        envelopeDigest,
        knowledgeId: value.knowledgeId,
      };
    }),
    send: vi.fn(async ({ envelope }) => {
      sent.push(envelope);
      return { durable: true, envelopeDigest: envelope.envelopeDigest };
    }),
  };
  return {
    controller: new GovernedKnowledgeSync({
      tenantId: "tenant:a",
      deviceId,
      ports,
    }),
    ports,
    records,
    sent,
  };
}

describe("Governed evolution knowledge synchronization", () => {
  it("publishes only ciphertext after exact approval, authorization and durable commit", async () => {
    const h = harness();
    const envelope = await h.controller.publish(knowledge());
    expect(envelope).toMatchObject({
      tenantId: "tenant:a",
      scope: "team",
      knowledgeId: "knowledge:1",
      keyRef: "key:team:1",
    });
    expect(envelope).not.toHaveProperty("approvalReceiptDigest");
    expect(envelope.ciphertext).not.toContain("knowledge:1");
    expect(h.ports.commit).toHaveBeenCalledBefore(h.ports.send);
  });

  it("never upgrades personal memory into a shared channel", async () => {
    const h = harness();
    await expect(
      h.controller.publish(
        knowledge({ scope: "personal", scopeId: "person:alice" }),
      ),
    ).rejects.toThrow("personal knowledge");
    expect(h.ports.encrypt).not.toHaveBeenCalled();
    expect(h.ports.send).not.toHaveBeenCalled();
  });

  it("requires approval for team/org knowledge and a dependency disposition for revocation", async () => {
    const h = harness();
    await expect(
      h.controller.publish(knowledge({ approvalReceiptDigest: null })),
    ).rejects.toThrow("requires approval");
    await expect(
      h.controller.publish(
        knowledge({
          action: "revoke",
          revocationReceiptDigest: D("revoke"),
          dependencies: [],
        }),
      ),
    ).rejects.toThrow("dependency graph");
    await expect(
      h.controller.publish(
        knowledge({
          action: "revoke",
          revocationReceiptDigest: D("revoke"),
          dependencies: [
            { kind: "active-skill", digest: D("skill"), disposition: "ignore" },
          ],
        }),
      ),
    ).rejects.toThrow("unsafe");
  });

  it("receives an authenticated newer record and rejects tenant/signature substitution", async () => {
    const sender = harness();
    const envelope = await sender.controller.publish(knowledge());
    const receiver = harness({ deviceId: "device:b" });
    await expect(receiver.controller.receive(envelope)).resolves.toEqual({
      applied: true,
      action: "upsert",
    });
    await expect(
      receiver.controller.receive({ ...envelope, tenantId: "tenant:b" }),
    ).rejects.toThrow("unauthenticated or cross-tenant");
    await expect(
      receiver.controller.receive({ ...envelope, signature: "forged" }),
    ).rejects.toThrow("unauthenticated or cross-tenant");
    await expect(
      receiver.controller.receive({
        ...envelope,
        ciphertext: Buffer.from("substituted").toString("base64"),
      }),
    ).rejects.toThrow("unauthenticated or cross-tenant");
  });

  it("preserves concurrent offline edits as an explicit human merge conflict", async () => {
    const sender = harness();
    const envelope = await sender.controller.publish(
      knowledge({ vectorClock: { "device:a": 2 } }),
    );
    const receiver = harness({
      deviceId: "device:b",
      initial: knowledge({
        contentDigest: D("content:b"),
        vectorClock: { "device:b": 2 },
      }),
    });
    await expect(receiver.controller.receive(envelope)).resolves.toEqual({
      applied: false,
      reason: "conflict",
      requiresHumanMerge: true,
    });
    expect(receiver.ports.commit).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "conflict" }),
    );
    expect(receiver.records.get("knowledge:1").contentDigest).toBe(
      D("content:b"),
    );
  });

  it("does not report sync success without durable storage or transport acknowledgement", async () => {
    const storage = harness();
    storage.ports.commit.mockResolvedValueOnce({ durable: false });
    await expect(storage.controller.publish(knowledge())).rejects.toThrow(
      "durably committed",
    );
    expect(storage.ports.send).not.toHaveBeenCalled();

    const transport = harness();
    transport.ports.send.mockResolvedValueOnce({ durable: false });
    await expect(transport.controller.publish(knowledge())).rejects.toThrow(
      "transport did not durably accept",
    );
  });
});
