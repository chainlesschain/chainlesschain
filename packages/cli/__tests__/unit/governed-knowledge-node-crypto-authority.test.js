import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createGovernedKnowledgeNodeCryptoAuthority,
  isGovernedKnowledgeNodeCryptoAuthority,
} from "../../src/lib/evolution/governed-knowledge-node-crypto-authority.js";
import { GovernedKnowledgeSync } from "../../src/lib/evolution/governed-knowledge-sync.js";
import { knowledgeArtifactLifecycle } from "../helpers/governed-knowledge-artifact-lifecycle.js";

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
    approvalReceiptDigest: D("approval:1"),
    revocationReceiptDigest: null,
    dependencies: [],
    ...overrides,
  };
}

function fixture() {
  const deviceA = generateKeyPairSync("ed25519");
  const deviceB = generateKeyPairSync("ed25519");
  const sharedKey = randomBytes(32);
  const peerIdentities = [
    {
      tenantId: "tenant:a",
      deviceId: "device:a",
      publicKey: deviceA.publicKey,
    },
    {
      tenantId: "tenant:a",
      deviceId: "device:b",
      publicKey: deviceB.publicKey,
    },
  ];
  const scopeKeys = [
    {
      tenantId: "tenant:a",
      scope: "team",
      scopeId: "team:1",
      keyRef: "kms:team:1:v1",
      key: sharedKey,
      active: true,
    },
  ];
  return {
    deviceA,
    deviceB,
    sharedKey,
    peerIdentities,
    scopeKeys,
    authorityA: createGovernedKnowledgeNodeCryptoAuthority({
      tenantId: "tenant:a",
      deviceId: "device:a",
      privateKey: deviceA.privateKey,
      scopeKeys,
      peerIdentities,
    }),
    authorityB: createGovernedKnowledgeNodeCryptoAuthority({
      tenantId: "tenant:a",
      deviceId: "device:b",
      privateKey: deviceB.privateKey,
      scopeKeys,
      peerIdentities,
    }),
  };
}

function controller(deviceId, cryptoAuthority, { initial = null } = {}) {
  const records = new Map(initial ? [[initial.knowledgeId, initial]] : []);
  const receptions = new Map();
  const sent = [];
  const authorize = vi.fn(async ({ knowledge: value }) => ({
    authenticated: true,
    allowed: true,
    tenantId: value.tenantId,
    knowledgeId: value.knowledgeId,
    scope: value.scope,
    scopeId: value.scopeId,
    receiptDigest: D(`authorization:${value.knowledgeId}`),
  }));
  return {
    records,
    sent,
    authorize,
    sync: new GovernedKnowledgeSync({
      tenantId: "tenant:a",
      deviceId,
      artifactLifecycle: knowledgeArtifactLifecycle(),
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
      ports: {
        authorize,
        encrypt: cryptoAuthority.encrypt,
        decrypt: cryptoAuthority.decrypt,
        sign: cryptoAuthority.sign,
        verify: cryptoAuthority.verify,
        load: async ({ knowledgeId }) => records.get(knowledgeId) ?? null,
        commit: async (request) => {
          const { knowledge: value, envelopeDigest, disposition } = request;
          if (disposition !== "conflict") records.set(value.knowledgeId, value);
          if (["remote", "conflict"].includes(disposition)) {
            receptions.set(envelopeDigest, {
              ...structuredClone(request),
              tenantId: "tenant:a",
              deviceId,
            });
          }
          return {
            authenticated: true,
            durable: true,
            envelopeDigest,
            knowledgeId: value.knowledgeId,
          };
        },
        loadReception: async ({ envelopeDigest }) =>
          receptions.get(envelopeDigest) ?? null,
        send: async ({ envelope }) => {
          sent.push(envelope);
          return { durable: true, envelopeDigest: envelope.envelopeDigest };
        },
      },
    }),
  };
}

describe("GovernedKnowledgeNodeCryptoAuthority", () => {
  it("synchronizes two devices with real AES-GCM and Ed25519", async () => {
    const f = fixture();
    const sender = controller("device:a", f.authorityA);
    const receiver = controller("device:b", f.authorityB);
    const envelope = await sender.sync.publish(knowledge());

    expect(isGovernedKnowledgeNodeCryptoAuthority(f.authorityA)).toBe(true);
    expect(envelope.signature).toMatchObject({ algorithm: "Ed25519" });
    expect(envelope.keyRef).toBe("kms:team:1:v1");
    expect(Buffer.from(envelope.ciphertext, "base64")[0]).toBe(1);
    expect(envelope.ciphertext).not.toContain("knowledge:1");
    await expect(receiver.sync.receive(envelope)).resolves.toMatchObject({
      applied: true,
      action: "upsert",
      artifact: { candidateOnly: false },
    });
    expect(receiver.records.get("knowledge:1")).toMatchObject(knowledge());
  });

  it("rejects forged signatures and authenticated-ciphertext changes", async () => {
    const f = fixture();
    const sender = controller("device:a", f.authorityA);
    const receiver = controller("device:b", f.authorityB);
    const envelope = await sender.sync.publish(knowledge());

    await expect(
      receiver.sync.receive({
        ...envelope,
        signature: { ...envelope.signature, value: "A".repeat(86) },
      }),
    ).rejects.toThrow("unauthenticated");
    const encrypted = Buffer.from(envelope.ciphertext, "base64");
    encrypted[encrypted.length - 1] ^= 1;
    await expect(
      receiver.sync.receive({
        ...envelope,
        ciphertext: encrypted.toString("base64"),
      }),
    ).rejects.toThrow("unauthenticated");
  });

  it("keeps retired keys for decrypt while publishing only with the active key", async () => {
    const f = fixture();
    const newKey = randomBytes(32);
    const rotatedKeys = [
      { ...f.scopeKeys[0], active: false },
      {
        tenantId: "tenant:a",
        scope: "team",
        scopeId: "team:1",
        keyRef: "kms:team:1:v2",
        key: newKey,
        active: true,
      },
    ];
    const beforeRotation = controller("device:a", f.authorityA);
    const oldEnvelope = await beforeRotation.sync.publish(knowledge());
    const rotatedA = createGovernedKnowledgeNodeCryptoAuthority({
      tenantId: "tenant:a",
      deviceId: "device:a",
      privateKey: f.deviceA.privateKey,
      scopeKeys: rotatedKeys,
      peerIdentities: f.peerIdentities,
    });
    const rotatedB = createGovernedKnowledgeNodeCryptoAuthority({
      tenantId: "tenant:a",
      deviceId: "device:b",
      privateKey: f.deviceB.privateKey,
      scopeKeys: rotatedKeys,
      peerIdentities: f.peerIdentities,
    });
    const afterRotation = controller("device:a", rotatedA);
    const receiver = controller("device:b", rotatedB);
    const newEnvelope = await afterRotation.sync.publish(
      knowledge({
        contentDigest: D("content:2"),
        vectorClock: { "device:a": 2 },
      }),
    );

    expect(newEnvelope.keyRef).toBe("kms:team:1:v2");
    await expect(receiver.sync.receive(oldEnvelope)).resolves.toMatchObject({
      applied: true,
    });
    await expect(receiver.sync.receive(newEnvelope)).resolves.toMatchObject({
      applied: true,
    });
  });

  it("fails closed on cross-tenant keys, wrong key pins, and unknown scope keys", async () => {
    const f = fixture();
    expect(() =>
      createGovernedKnowledgeNodeCryptoAuthority({
        tenantId: "tenant:a",
        deviceId: "device:a",
        privateKey: f.deviceA.privateKey,
        scopeKeys: [{ ...f.scopeKeys[0], tenantId: "tenant:b" }],
        peerIdentities: f.peerIdentities,
      }),
    ).toThrow("tenant or scope boundary");
    expect(() =>
      createGovernedKnowledgeNodeCryptoAuthority({
        tenantId: "tenant:a",
        deviceId: "device:a",
        privateKey: f.deviceB.privateKey,
        scopeKeys: f.scopeKeys,
        peerIdentities: f.peerIdentities,
      }),
    ).toThrow("not pinned");
    expect(() =>
      createGovernedKnowledgeNodeCryptoAuthority({
        tenantId: "tenant:a",
        deviceId: "device:a",
        privateKey: f.deviceA.privateKey,
        scopeKeys: f.scopeKeys,
        peerIdentities: [
          f.peerIdentities[0],
          {
            tenantId: "tenant:a",
            deviceId: "device:b",
            publicKey: f.deviceA.publicKey,
          },
        ],
      }),
    ).toThrow("multiple devices");

    const sender = controller("device:a", f.authorityA);
    const envelope = await sender.sync.publish(knowledge());
    const unrelatedKeyAuthority = createGovernedKnowledgeNodeCryptoAuthority({
      tenantId: "tenant:a",
      deviceId: "device:b",
      privateKey: f.deviceB.privateKey,
      scopeKeys: [
        {
          tenantId: "tenant:a",
          scope: "team",
          scopeId: "team:other",
          keyRef: "kms:team:other:v1",
          key: randomBytes(32),
          active: true,
        },
      ],
      peerIdentities: f.peerIdentities,
    });
    const receiver = controller("device:b", unrelatedKeyAuthority);
    await expect(receiver.sync.receive(envelope)).rejects.toThrow(
      "not authorized for its scope",
    );
  });
});
