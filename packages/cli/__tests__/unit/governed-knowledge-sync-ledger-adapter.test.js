import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import { GovernedKnowledgeSyncLedgerAdapter } from "../../src/lib/evolution/governed-knowledge-sync-ledger-adapter.js";
import {
  GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
  GovernedKnowledgeSync,
} from "../../src/lib/evolution/governed-knowledge-sync.js";

const roots = [];
const D = (value) =>
  `sha256:${createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const LEDGER_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/knowledge-ledger",
  trustPolicyDigest: D("knowledge-ledger-trust"),
};
const WITNESS_TRUST = {
  algorithm: "hmac-sha256",
  keyId: "key://tests/knowledge-witness",
  trustPolicyDigest: D("knowledge-witness-trust"),
};
const EMPTY_DISCARD_DIGEST = D(
  `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
);

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ?? EMPTY_DISCARD_DIGEST,
    epoch: snapshot?.epoch ?? null,
    generation: previous ? previous.generation + 1 : 0,
    headDigest: snapshot?.headDigest ?? null,
    identityDigest: snapshot?.identityDigest ?? null,
    ledgerId: snapshot?.ledgerId ?? null,
    payloadDigest: snapshot?.payloadDigest ?? null,
    previousWitnessDigest: previous?.witnessDigest ?? null,
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: snapshot?.segmentDigest ?? null,
    sequence: snapshot?.sequence ?? null,
    status: snapshot ? "committed" : "absent",
    storeMarkerDigest: snapshot?.storeMarkerDigest ?? null,
    storeMarkerEntryDigest: snapshot?.storeMarkerEntryDigest ?? null,
    storeMarkerId: snapshot?.storeMarkerId ?? null,
    witnessId,
  };
  return {
    ...core,
    witnessDigest: D(
      `chainlesschain.evolution-ledger-witness/v1\0${canonical(core)}`,
    ),
    signature: { ...WITNESS_TRUST, value: "A".repeat(43) },
  };
}

function durableWitness(witnessId) {
  let current = witnessRecord(witnessId);
  return {
    id: witnessId,
    read: () => current,
    initialize: ({ expected, snapshot }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, snapshot, current);
      return current;
    },
    compareAndSwap: ({ expected, next }) => {
      if (expected.witnessDigest !== current.witnessDigest) return current;
      current = witnessRecord(witnessId, next, current);
      return current;
    },
    proveAncestry: () => {
      throw new Error("unexpected ancestry request in linear sync test");
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -20_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function openRealLedger(storage, witness) {
  const secret = "test-only-real-knowledge-ledger-key";
  return new EvolutionLedger({
    rootDir: path.join(storage.root, "ledger-events"),
    authorityRootDir: path.join(storage.root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: storage.resolver,
    sign: ({ message }) => ({
      ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
}

function knowledge(overrides = {}) {
  return {
    schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
    tenantId: "tenant:a",
    knowledgeId: "knowledge:1",
    scope: "team",
    scopeId: "team:1",
    action: "upsert",
    contentDigest: D("content:a"),
    vectorClock: { "device:a": 1 },
    approvalReceiptDigest: D("approval"),
    revocationReceiptDigest: null,
    dependencies: [],
    ...overrides,
  };
}

function cryptoPorts() {
  const verify = vi.fn(
    async ({ envelopeDigest, signature }) =>
      signature === `signature:${envelopeDigest}`,
  );
  return {
    verifier: { verify },
    authorize: {
      authorize: async ({ knowledge: value }) => ({
        authenticated: true,
        allowed: true,
        tenantId: value.tenantId,
        knowledgeId: value.knowledgeId,
        scope: value.scope,
        scopeId: value.scopeId,
        receiptDigest: D("authorization"),
      }),
    },
    encrypt: {
      encrypt: async ({ plaintext }) => {
        const ciphertext = Buffer.from(plaintext).reverse();
        return {
          ciphertext,
          ciphertextDigest: D(ciphertext),
          keyRef: "key:team:1",
        };
      },
    },
    decrypt: {
      decrypt: async ({ envelope }) => ({
        plaintext: Buffer.from(envelope.ciphertext, "base64").reverse(),
      }),
    },
    sign: {
      sign: async ({ envelopeDigest }) => `signature:${envelopeDigest}`,
    },
    send: {
      send: async ({ envelope }) => ({
        durable: true,
        envelopeDigest: envelope.envelopeDigest,
      }),
    },
  };
}

function backends(deviceId = "device:a") {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-sync-"),
  );
  roots.push(root);
  const now = Date.parse("2026-09-04T00:00:00.000Z");
  const secret = "test-only-knowledge-artifact-key";
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const rawArtifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: "artifact-tenant:a",
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm: "hmac-sha256",
        keyId: "test:key/knowledge",
        value: sign(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) => signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm: "hmac-sha256",
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || "test:key/knowledge",
          policyDigest: D("artifact-policy"),
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: D(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = { events: [], loseResponse: false };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch:a",
      ledgerId: "ledger:a",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent: (input, expected) => {
      if (
        expected.expectedSequence !== state.events.length ||
        expected.expectedHeadDigest !==
          (state.events.at(-1)?.eventDigest ?? null)
      ) {
        throw new Error("ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: D(canonical(input)),
      };
      state.events.push(event);
      if (state.loseResponse) {
        state.loseResponse = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        durable: true,
        receiptDigest: D(canonical(event)),
      };
    },
  };
  return {
    descriptor: {
      tenantId: "tenant:a",
      artifactTenantId: "artifact-tenant:a",
      deviceId,
      streamId: `knowledge-sync:${deviceId}`,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: {
      putCanonical: (...args) => rawArtifactPorts.putCanonical(...args),
    },
    resolver: rawArtifactPorts.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
    root,
    ledger,
    state,
  };
}

function adapter(storage, crypto) {
  return new GovernedKnowledgeSyncLedgerAdapter({
    descriptor: storage.descriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    envelopeVerifier: crypto.verifier,
    now: () => Date.parse("2026-09-04T00:00:00.000Z"),
  });
}

function controller(storage, crypto) {
  const persisted = adapter(storage, crypto);
  return {
    persisted,
    controller: new GovernedKnowledgeSync({
      tenantId: storage.descriptor.tenantId,
      deviceId: storage.descriptor.deviceId,
      ports: persisted.syncPorts(crypto),
    }),
  };
}

describe("GovernedKnowledgeSyncLedgerAdapter", () => {
  it("reopens the same record from actual EvolutionLedger files and witness", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    const witness = durableWitness("witness-knowledge-sync");
    storage.ledger = openRealLedger(storage, witness);
    await controller(storage, crypto).controller.publish(knowledge());

    const reopenedLedger = openRealLedger(storage, witness);
    const reopened = adapter({ ...storage, ledger: reopenedLedger }, crypto);
    await expect(
      reopened.load({ knowledgeId: "knowledge:1" }),
    ).resolves.toMatchObject({ contentDigest: D("content:a") });
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 1,
      sequence: 1,
    });
  });

  it("recovers a locally published record through a new adapter instance", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    await controller(storage, crypto).controller.publish(knowledge());

    await expect(
      adapter(storage, crypto).load({ knowledgeId: "knowledge:1" }),
    ).resolves.toMatchObject({ contentDigest: D("content:a") });
    expect(storage.state.events).toHaveLength(1);
  });

  it("durably preserves concurrent remote edits for human merge", async () => {
    const senderStorage = backends("device:a");
    const crypto = cryptoPorts();
    const envelope = await controller(senderStorage, crypto).controller.publish(
      knowledge({ vectorClock: { "device:a": 2 } }),
    );
    const receiverStorage = backends("device:b");
    const receiver = controller(receiverStorage, crypto);
    await receiver.controller.publish(
      knowledge({
        contentDigest: D("content:b"),
        vectorClock: { "device:b": 2 },
      }),
    );
    await expect(receiver.controller.receive(envelope)).resolves.toMatchObject({
      reason: "conflict",
      requiresHumanMerge: true,
    });
    await expect(
      adapter(receiverStorage, crypto).listConflicts(),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ disposition: "conflict" }],
    });
  });

  it("recovers an idempotent commit after an append response is lost", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    const persisted = adapter(storage, crypto);
    const envelope = await controller(backends(), crypto).controller.publish(
      knowledge(),
    );
    const request = {
      knowledge: knowledge(),
      envelope,
      envelopeDigest: envelope.envelopeDigest,
      disposition: "local",
      authorizationReceiptDigest: D("authorization"),
    };
    storage.state.loseResponse = true;
    await expect(persisted.commit(request)).resolves.toMatchObject({
      durable: true,
      recovered: true,
    });
    await expect(persisted.commit(request)).resolves.toMatchObject({
      durable: true,
      recovered: true,
    });
    expect(storage.state.events).toHaveLength(1);
  });

  it("fails closed when the current envelope authority revokes a signature", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    await controller(storage, crypto).controller.publish(knowledge());
    crypto.verifier.verify.mockResolvedValue(false);
    await expect(
      adapter(storage, crypto).load({ knowledgeId: "knowledge:1" }),
    ).rejects.toMatchObject({
      code: "CC_GOVERNED_KNOWLEDGE_SYNC_LEDGER_CORRUPT",
    });
  });
});
