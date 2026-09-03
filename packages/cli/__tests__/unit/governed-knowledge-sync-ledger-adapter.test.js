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
import {
  GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
  createGovernedKnowledgeDependencyAuthority,
  digestGovernedKnowledgeDependencyResult,
} from "../../src/lib/evolution/governed-knowledge-dependency-authority.js";
import {
  GovernedKnowledgeDependencyLedgerExecutor,
  digestGovernedKnowledgeDependencyOperation,
} from "../../src/lib/evolution/governed-knowledge-dependency-ledger-executor.js";
import {
  GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA,
  GovernedKnowledgeConflictMergePlanner,
  digestGovernedKnowledgeHumanMergeReceipt,
} from "../../src/lib/evolution/governed-knowledge-conflict-merge.js";
import { GovernedKnowledgeMergeLedgerExecutor } from "../../src/lib/evolution/governed-knowledge-merge-ledger-executor.js";
import {
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
  createGovernedKnowledgeMergePublisherAuthority,
  digestGovernedKnowledgeMergePublishResult,
} from "../../src/lib/evolution/governed-knowledge-merge-publisher-authority.js";
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

function controller(storage, crypto, dependencyExecutor = null) {
  const persisted = adapter(storage, crypto);
  return {
    persisted,
    controller: new GovernedKnowledgeSync({
      tenantId: storage.descriptor.tenantId,
      deviceId: storage.descriptor.deviceId,
      ports: persisted.syncPorts(crypto),
      dependencyExecutor,
    }),
  };
}

async function mergePlanFixture({ realLedger = false } = {}) {
  const crypto = cryptoPorts();
  const senderStorage = backends("device:a");
  const remoteEnvelope = await controller(
    senderStorage,
    crypto,
  ).controller.publish(knowledge({ vectorClock: { "device:a": 2 } }));
  const receiverStorage = backends("device:b");
  const witness = realLedger ? durableWitness("witness-knowledge-merge") : null;
  if (witness)
    receiverStorage.ledger = openRealLedger(receiverStorage, witness);
  const receiver = controller(receiverStorage, crypto);
  await receiver.controller.publish(
    knowledge({
      contentDigest: D("content:b"),
      vectorClock: { "device:b": 2 },
    }),
  );
  await receiver.controller.receive(remoteEnvelope);
  const merged = knowledge({
    contentDigest: D("content:merged"),
    vectorClock: { "device:a": 2, "device:b": 3 },
  });
  const receiptCore = {
    schema: GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA,
    tenantId: "tenant:a",
    reviewerId: "human:alice",
    automated: false,
    knowledgeId: "knowledge:1",
    conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
    localContentDigest: D("content:b"),
    remoteContentDigest: D("content:a"),
    mergedContentDigest: D("content:merged"),
    mergedVectorClock: merged.vectorClock,
    reason: "Reviewed both offline edits and preserved their intent.",
    decidedAt: "2026-09-04T00:00:00.000Z",
  };
  const receipt = {
    ...receiptCore,
    receiptDigest: digestGovernedKnowledgeHumanMergeReceipt(receiptCore),
    attestation: {
      algorithm: "test-signature",
      keyId: "human-key:alice",
      value: "signed-human-merge-decision",
    },
  };
  const reader = adapter(receiverStorage, crypto).conflictReader();
  const verifier = {
    verify: vi.fn(async ({ receipt: value }) => ({
      authenticated: true,
      durable: true,
      automated: false,
      tenantId: value.tenantId,
      reviewerId: value.reviewerId,
      knowledgeId: value.knowledgeId,
      conflictEnvelopeDigest: value.conflictEnvelopeDigest,
      receiptDigest: value.receiptDigest,
    })),
  };
  const planner = new GovernedKnowledgeConflictMergePlanner({
    conflictReader: reader,
    receiptVerifier: verifier,
    now: () => Date.parse("2026-09-04T00:00:00.000Z"),
  });
  const plan = await planner.plan({
    conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
    mergedKnowledge: merged,
    humanReceipt: receipt,
  });
  return {
    crypto,
    merged,
    plan,
    receipt,
    reader,
    receiverStorage,
    remoteEnvelope,
    verifier,
    witness,
  };
}

function mergePublisher({ loseFirstResponse = false } = {}) {
  let durableResult = null;
  let shouldLose = loseFirstResponse;
  const requests = [];
  const provider = {
    publish: vi.fn(async (request) => {
      requests.push(structuredClone(request));
      if (!durableResult) {
        const core = {
          schema: GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
          tenantId: request.tenantId,
          deviceId: request.deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          planDigest: request.planDigest,
          knowledgeId: request.knowledgeId,
          mergedContentDigest: request.mergedContentDigest,
          envelopeDigest: D(`merged-envelope:${request.planDigest}`),
          providerAuthorityId: "merge-publisher:test",
          providerRevision: 1,
          providerHandlerArtifactDigest: D("merge-publisher-handler"),
          publishedAt: "2026-09-04T00:00:00.000Z",
          durable: true,
          idempotent: true,
        };
        durableResult = {
          ...core,
          resultDigest: digestGovernedKnowledgeMergePublishResult(core),
          attestation: {
            algorithm: "test-signature",
            keyId: "merge-publisher-key",
            value: "signed-merge-publish-result",
          },
        };
      }
      if (shouldLose) {
        shouldLose = false;
        throw new Error("simulated publisher response loss");
      }
      return durableResult;
    }),
  };
  const verifier = {
    verify: vi.fn(async ({ request, result }) => ({
      authenticated: true,
      durable: true,
      tenantId: request.tenantId,
      deviceId: request.deviceId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      planDigest: request.planDigest,
      resultDigest: result.resultDigest,
      envelopeDigest: result.envelopeDigest,
      providerAuthorityId: "merge-publisher:test",
      providerRevision: 1,
      verifierAuthorityId: "merge-verifier:test",
      verifierRevision: 1,
      verificationReceiptDigest: D(`verified:${result.resultDigest}`),
    })),
  };
  const authority = createGovernedKnowledgeMergePublisherAuthority({
    tenantId: "tenant:a",
    deviceId: "device:b",
    providerDescriptor: {
      authorityId: "merge-publisher:test",
      revision: 1,
      handlerArtifactDigest: D("merge-publisher-handler"),
    },
    verifierDescriptor: {
      authorityId: "merge-verifier:test",
      revision: 1,
      handlerArtifactDigest: D("merge-verifier-handler"),
    },
    provider,
    verifier,
    now: () => Date.parse("2026-09-04T00:00:00.000Z"),
  });
  return { authority, provider, requests, verifier };
}

function mergeExecutor(storage, publisherAuthority) {
  return new GovernedKnowledgeMergeLedgerExecutor({
    descriptor: storage.descriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    publisherAuthority,
    now: () => Date.parse("2026-09-04T00:00:00.000Z"),
  });
}

function revocationKnowledge(overrides = {}) {
  return knowledge({
    action: "revoke",
    contentDigest: D("content:revoked"),
    revocationReceiptDigest: D("revocation"),
    dependencies: [
      {
        kind: "candidate",
        digest: D("candidate:1"),
        disposition: "reject-candidate",
      },
      {
        kind: "active-skill",
        digest: D("active-skill:1"),
        disposition: "rollback-active",
      },
    ],
    ...overrides,
  });
}

function dependencyAuthority({
  loseFirstResponse = false,
  deviceId = "device:a",
} = {}) {
  const durableResults = new Map();
  let shouldLose = loseFirstResponse;
  const requests = [];
  const provider = {
    apply: vi.fn(async (request) => {
      requests.push(structuredClone(request));
      if (!durableResults.has(request.operationId)) {
        const core = {
          schema: GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
          tenantId: request.tenantId,
          deviceId: request.deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          knowledgeId: request.knowledgeId,
          revocationReceiptDigest: request.revocationReceiptDigest,
          dependencyKind: request.dependency.kind,
          dependencyDigest: request.dependency.digest,
          dependencyDisposition: request.dependency.disposition,
          authorityId: "dependency-provider:test",
          authorityRevision: 1,
          handlerArtifactDigest: D("dependency-provider-handler"),
          applied: true,
          durable: true,
          idempotent: true,
          appliedAt: "2026-09-04T00:00:00.000Z",
        };
        durableResults.set(request.operationId, {
          ...core,
          resultDigest: digestGovernedKnowledgeDependencyResult(core),
          attestation: {
            algorithm: "test-signature",
            keyId: "dependency-key:test",
            value: "signed-dependency-result",
          },
        });
      }
      if (shouldLose) {
        shouldLose = false;
        throw new Error("simulated dependency response loss");
      }
      return durableResults.get(request.operationId);
    }),
  };
  const verifier = {
    verify: vi.fn(async ({ request, result }) => ({
      authenticated: true,
      durable: true,
      tenantId: request.tenantId,
      deviceId: request.deviceId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      resultDigest: result.resultDigest,
      providerAuthorityId: "dependency-provider:test",
      providerRevision: 1,
      verifierAuthorityId: "dependency-verifier:test",
      verifierRevision: 1,
      verificationReceiptDigest: D(`verified:${result.resultDigest}`),
    })),
  };
  const authority = createGovernedKnowledgeDependencyAuthority({
    tenantId: "tenant:a",
    deviceId,
    providerDescriptor: {
      authorityId: "dependency-provider:test",
      revision: 1,
      handlerArtifactDigest: D("dependency-provider-handler"),
    },
    verifierDescriptor: {
      authorityId: "dependency-verifier:test",
      revision: 1,
      handlerArtifactDigest: D("dependency-verifier-handler"),
    },
    provider,
    verifier,
  });
  return { authority, provider, requests, verifier };
}

function dependencyExecutor(storage, authority) {
  return new GovernedKnowledgeDependencyLedgerExecutor({
    descriptor: storage.descriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    dependencyAuthority: authority,
    now: () => Date.parse("2026-09-04T00:00:00.000Z"),
  });
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

  it("builds only an independently authenticated exact human merge plan", async () => {
    const crypto = cryptoPorts();
    const senderStorage = backends("device:a");
    const remoteEnvelope = await controller(
      senderStorage,
      crypto,
    ).controller.publish(knowledge({ vectorClock: { "device:a": 2 } }));
    const receiverStorage = backends("device:b");
    const receiver = controller(receiverStorage, crypto);
    await receiver.controller.publish(
      knowledge({
        contentDigest: D("content:b"),
        vectorClock: { "device:b": 2 },
      }),
    );
    await receiver.controller.receive(remoteEnvelope);
    const merged = knowledge({
      contentDigest: D("content:merged"),
      vectorClock: { "device:a": 2, "device:b": 3 },
    });
    const receiptCore = {
      schema: GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA,
      tenantId: "tenant:a",
      reviewerId: "human:alice",
      automated: false,
      knowledgeId: "knowledge:1",
      conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
      localContentDigest: D("content:b"),
      remoteContentDigest: D("content:a"),
      mergedContentDigest: D("content:merged"),
      mergedVectorClock: merged.vectorClock,
      reason: "Reviewed both offline edits and preserved their intent.",
      decidedAt: "2026-09-04T00:00:00.000Z",
    };
    const receipt = {
      ...receiptCore,
      receiptDigest: digestGovernedKnowledgeHumanMergeReceipt(receiptCore),
      attestation: {
        algorithm: "test-signature",
        keyId: "human-key:alice",
        value: "signed-human-merge-decision",
      },
    };
    const verifier = {
      verify: vi.fn(async ({ receipt: value }) => ({
        authenticated: true,
        durable: true,
        automated: false,
        tenantId: value.tenantId,
        reviewerId: value.reviewerId,
        knowledgeId: value.knowledgeId,
        conflictEnvelopeDigest: value.conflictEnvelopeDigest,
        receiptDigest: value.receiptDigest,
      })),
    };
    const reader = adapter(receiverStorage, crypto).conflictReader();
    const planner = new GovernedKnowledgeConflictMergePlanner({
      conflictReader: reader,
      receiptVerifier: verifier,
      now: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });
    await expect(
      planner.plan({
        conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
        mergedKnowledge: merged,
        humanReceipt: receipt,
      }),
    ).resolves.toMatchObject({
      knowledgeId: "knowledge:1",
      mergedKnowledge: { vectorClock: { "device:a": 2, "device:b": 3 } },
      humanReceiptDigest: receipt.receiptDigest,
    });
    await expect(
      planner.plan({
        conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
        mergedKnowledge: {
          ...merged,
          vectorClock: { "device:a": 2, "device:b": 2 },
        },
        humanReceipt: receipt,
      }),
    ).rejects.toThrow("exactly join both histories");
    await expect(
      planner.plan({
        conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
        mergedKnowledge: {
          ...merged,
          vectorClock: {
            "device:a": 2,
            "device:b": 3,
            "device:smuggled": 0,
          },
        },
        humanReceipt: receipt,
      }),
    ).rejects.toThrow("exactly join both histories");

    const denied = new GovernedKnowledgeConflictMergePlanner({
      conflictReader: reader,
      receiptVerifier: { verify: async () => ({ authenticated: false }) },
      now: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });
    await expect(
      denied.plan({
        conflictEnvelopeDigest: remoteEnvelope.envelopeDigest,
        mergedKnowledge: merged,
        humanReceipt: receipt,
      }),
    ).rejects.toThrow("did not authenticate");
  });

  it("resumes prepared merge publication with one stable idempotency key", async () => {
    const fixture = await mergePlanFixture();
    const publisher = mergePublisher({ loseFirstResponse: true });
    const first = mergeExecutor(fixture.receiverStorage, publisher.authority);
    await expect(first.execute(structuredClone(fixture.plan))).rejects.toThrow(
      "branded plan",
    );
    await expect(first.execute(fixture.plan)).rejects.toThrow(
      "publisher response loss",
    );
    expect(publisher.provider.publish).toHaveBeenCalledOnce();

    fixture.receiverStorage.state.loseResponse = true;
    const reopened = mergeExecutor(
      fixture.receiverStorage,
      publisher.authority,
    );
    await expect(
      reopened.resume({ planDigest: fixture.plan.planDigest }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      recovered: true,
      planDigest: fixture.plan.planDigest,
      envelopeDigest: D(`merged-envelope:${fixture.plan.planDigest}`),
    });
    expect(publisher.provider.publish).toHaveBeenCalledTimes(2);
    expect(publisher.requests[0]).toEqual(publisher.requests[1]);

    await expect(reopened.execute(fixture.plan)).resolves.toMatchObject({
      durable: true,
      recovered: true,
    });
    expect(publisher.provider.publish).toHaveBeenCalledTimes(2);
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.merge.prepared",
      ),
    ).toHaveLength(1);
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.merge.settled",
      ),
    ).toHaveLength(1);
  });

  it("reopens a settled merge through actual Ledger files and witness", async () => {
    const fixture = await mergePlanFixture({ realLedger: true });
    const publisher = mergePublisher();
    await expect(
      mergeExecutor(fixture.receiverStorage, publisher.authority).execute(
        fixture.plan,
      ),
    ).resolves.toMatchObject({ durable: true, recovered: false });
    expect(publisher.provider.publish).toHaveBeenCalledOnce();

    const reopenedLedger = openRealLedger(
      fixture.receiverStorage,
      fixture.witness,
    );
    const reopenedStorage = {
      ...fixture.receiverStorage,
      ledger: reopenedLedger,
    };
    await expect(
      mergeExecutor(reopenedStorage, publisher.authority).execute(fixture.plan),
    ).resolves.toMatchObject({ durable: true, recovered: true });
    expect(publisher.provider.publish).toHaveBeenCalledOnce();
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 4,
      sequence: 4,
    });
  });

  it("refuses a merge publish result rejected by its independent verifier", async () => {
    const fixture = await mergePlanFixture();
    const publisher = mergePublisher();
    publisher.verifier.verify.mockResolvedValueOnce({ authenticated: false });
    const executor = mergeExecutor(
      fixture.receiverStorage,
      publisher.authority,
    );
    await expect(executor.execute(fixture.plan)).rejects.toThrow(
      "not independently verified",
    );
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.merge.prepared",
      ),
    ).toHaveLength(1);
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.merge.settled",
      ),
    ).toHaveLength(0);
  });

  it("applies every revocation dependency durably before sync commit", async () => {
    const storage = backends("device:a");
    const crypto = cryptoPorts();
    const dependency = dependencyAuthority();
    const executor = dependencyExecutor(storage, dependency.authority);
    await expect(
      controller(storage, crypto, executor).controller.publish(
        revocationKnowledge(),
      ),
    ).resolves.toMatchObject({ action: "revoke" });
    expect(dependency.provider.apply).toHaveBeenCalledTimes(2);
    expect(storage.state.events.map(({ type }) => type)).toEqual([
      "knowledge.revocation-dependencies.prepared",
      "knowledge.revocation-dependencies.settled",
      "knowledge.sync.committed",
    ]);
  });

  it("does not execute destructive dependencies for a concurrent conflict", async () => {
    const crypto = cryptoPorts();
    const senderStorage = backends("device:a");
    const senderDependency = dependencyAuthority({ deviceId: "device:a" });
    const remoteEnvelope = await controller(
      senderStorage,
      crypto,
      dependencyExecutor(senderStorage, senderDependency.authority),
    ).controller.publish(
      revocationKnowledge({ vectorClock: { "device:a": 2 } }),
    );
    const receiverStorage = backends("device:b");
    const receiverDependency = dependencyAuthority({ deviceId: "device:b" });
    const receiver = controller(
      receiverStorage,
      crypto,
      dependencyExecutor(receiverStorage, receiverDependency.authority),
    );
    await receiver.controller.publish(
      knowledge({
        contentDigest: D("content:b"),
        vectorClock: { "device:b": 2 },
      }),
    );
    await expect(
      receiver.controller.receive(remoteEnvelope),
    ).resolves.toMatchObject({ reason: "conflict", requiresHumanMerge: true });
    expect(receiverDependency.provider.apply).not.toHaveBeenCalled();
  });

  it("resumes dependency response loss without reapplying a durable operation", async () => {
    const storage = backends("device:a");
    const crypto = cryptoPorts();
    const dependency = dependencyAuthority({ loseFirstResponse: true });
    const first = dependencyExecutor(storage, dependency.authority);
    await expect(
      controller(storage, crypto, first).controller.publish(
        revocationKnowledge(),
      ),
    ).rejects.toThrow("dependency response loss");
    expect(storage.state.events.map(({ type }) => type)).toEqual([
      "knowledge.revocation-dependencies.prepared",
    ]);

    storage.state.loseResponse = true;
    const reopened = dependencyExecutor(storage, dependency.authority);
    await expect(
      controller(storage, crypto, reopened).controller.publish(
        revocationKnowledge(),
      ),
    ).resolves.toMatchObject({ action: "revoke" });
    expect(dependency.provider.apply).toHaveBeenCalledTimes(3);
    expect(dependency.requests[0]).toEqual(dependency.requests[1]);
    expect(
      storage.state.events.filter(
        ({ type }) => type === "knowledge.revocation-dependencies.settled",
      ),
    ).toHaveLength(1);
  });

  it("reopens settled dependencies from actual Ledger files without reapplying", async () => {
    const storage = backends("device:a");
    const witness = durableWitness("witness-knowledge-dependencies");
    storage.ledger = openRealLedger(storage, witness);
    const crypto = cryptoPorts();
    const dependency = dependencyAuthority();
    const first = dependencyExecutor(storage, dependency.authority);
    const input = revocationKnowledge();
    await controller(storage, crypto, first).controller.publish(input);
    expect(dependency.provider.apply).toHaveBeenCalledTimes(2);

    const operationDigest = digestGovernedKnowledgeDependencyOperation({
      tenantId: "tenant:a",
      deviceId: "device:a",
      knowledge: input,
    });
    const reopenedLedger = openRealLedger(storage, witness);
    const reopened = dependencyExecutor(
      { ...storage, ledger: reopenedLedger },
      dependency.authority,
    );
    await expect(reopened.resume({ operationDigest })).resolves.toMatchObject({
      durable: true,
      recovered: true,
      resultDigests: [
        expect.stringMatching(/^sha256:/),
        expect.stringMatching(/^sha256:/),
      ],
    });
    expect(dependency.provider.apply).toHaveBeenCalledTimes(2);
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 3,
      sequence: 3,
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
