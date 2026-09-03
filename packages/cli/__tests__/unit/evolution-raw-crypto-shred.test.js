import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { EvolutionRawCryptoShred } from "../../src/lib/evolution/evolution-raw-crypto-shred.js";

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const D = (domain, value = domain) =>
  `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;

function harness() {
  const payload = {
    evidenceRef: "evidence:private",
    sourceDigest: D("source"),
    artifactRef: "artifact://trusted/private",
    rawArtifactRef: "artifact://tenant:a/raw/private",
    rawCipherDigest: D("cipher"),
    keyRef: "kms://tenant:a/private",
    receiptDigest: D("deletion"),
  };
  const request = {
    tenantId: "tenant:a",
    planDigest: D("plan"),
    wikiStateDigest: D("state"),
    operation: "crypto-shred",
    payload,
  };
  const call = {
    request,
    requestDigest: D(
      "chainlesschain.governed-wiki-pruning-operation/v1",
      request,
    ),
  };
  const ports = {
    verifyDeletionReceipt: vi.fn(async () => ({
      authenticated: true,
      tenantId: "tenant:a",
      decision: "delete",
      ...payload,
    })),
    destroyKey: vi.fn(async (destruction) => ({
      authenticated: true,
      durable: true,
      destroyed: true,
      keyRef: payload.keyRef,
      requestDigest: destruction.requestDigest,
      receiptDigest: D("destroyed"),
    })),
    confirmKeyDestroyed: vi.fn(async ({ destructionReceiptDigest }) => ({
      authenticated: true,
      destroyed: true,
      keyRef: payload.keyRef,
      destructionReceiptDigest,
      receiptDigest: D("confirmed"),
    })),
    retainTombstone: vi.fn(async ({ tombstone }) => ({
      authenticated: true,
      durable: true,
      tombstoneDigest: tombstone.tombstoneDigest,
      receiptDigest: D("tombstone-retained"),
    })),
  };
  return {
    shredder: new EvolutionRawCryptoShred({ tenantId: "tenant:a", ports }),
    call,
    payload,
    ports,
  };
}

describe("Evolution Raw crypto-shred", () => {
  it("destroys the exact tenant key and retains an auditable tombstone", async () => {
    const h = harness();
    const result = await h.shredder.shred(h.call);
    expect(result).toMatchObject({
      authenticated: true,
      durable: true,
      requestDigest: h.call.requestDigest,
    });
    expect(h.ports.destroyKey).toHaveBeenCalledOnce();
    expect(h.ports.confirmKeyDestroyed).toHaveBeenCalledOnce();
    expect(h.ports.retainTombstone).toHaveBeenCalledOnce();
  });

  it("rejects a pruning request with substituted bytes", async () => {
    const h = harness();
    await expect(
      h.shredder.shred({
        ...h.call,
        request: {
          ...h.call.request,
          payload: { ...h.payload, rawCipherDigest: D("other") },
        },
      }),
    ).rejects.toThrow("not pruning-plan-bound");
  });

  it("rejects a cross-tenant KMS key", async () => {
    const h = harness();
    const request = {
      ...h.call.request,
      payload: { ...h.payload, keyRef: "kms://tenant:b/private" },
    };
    await expect(
      h.shredder.shred({
        request,
        requestDigest: D(
          "chainlesschain.governed-wiki-pruning-operation/v1",
          request,
        ),
      }),
    ).rejects.toThrow("cross-tenant");
  });

  it("rejects deletion receipt substitution before touching KMS", async () => {
    const h = harness();
    h.ports.verifyDeletionReceipt.mockResolvedValueOnce({
      authenticated: true,
      tenantId: "tenant:a",
      decision: "delete",
      ...h.payload,
      rawCipherDigest: D("wrong"),
    });
    await expect(h.shredder.shred(h.call)).rejects.toThrow("substituted");
    expect(h.ports.destroyKey).not.toHaveBeenCalled();
  });

  it("fails closed when destruction, confirmation, or tombstone is not durable", async () => {
    const destruction = harness();
    destruction.ports.destroyKey.mockResolvedValueOnce({ durable: false });
    await expect(destruction.shredder.shred(destruction.call)).rejects.toThrow(
      "destruction was not durable",
    );

    const confirmation = harness();
    confirmation.ports.confirmKeyDestroyed.mockResolvedValueOnce({
      authenticated: false,
    });
    await expect(
      confirmation.shredder.shred(confirmation.call),
    ).rejects.toThrow("could not be confirmed");

    const tombstone = harness();
    tombstone.ports.retainTombstone.mockResolvedValueOnce({ durable: false });
    await expect(tombstone.shredder.shred(tombstone.call)).rejects.toThrow(
      "tombstone was not durably retained",
    );
  });
});
