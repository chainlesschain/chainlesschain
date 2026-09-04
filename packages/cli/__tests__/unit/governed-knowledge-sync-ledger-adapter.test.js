import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import { registerGovernedKnowledgeCommands } from "../../src/commands/evolution-knowledge.js";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../../src/lib/app-server/protocol.js";
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
import { createGovernedKnowledgeReviewHost } from "../../src/lib/evolution/governed-knowledge-review-host.js";
import { createGovernedKnowledgeSyncMergePublisherAuthority } from "../../src/lib/evolution/governed-knowledge-sync-merge-publisher.js";
import { createGovernedKnowledgeArtifactLifecycle } from "../../src/lib/evolution/governed-knowledge-artifact-lifecycle.js";
import {
  EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
  EvolvableArtifactLedgerAdapter,
} from "../../src/lib/evolution/evolvable-artifact-ledger-adapter.js";
import {
  GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE,
  GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_LEGACY_SCHEMA,
  GovernedKnowledgeSyncLedgerAdapter,
  digestGovernedKnowledgeSyncLedgerRecord,
} from "../../src/lib/evolution/governed-knowledge-sync-ledger-adapter.js";
import {
  GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA,
  GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
  GovernedKnowledgeSync,
} from "../../src/lib/evolution/governed-knowledge-sync.js";

const {
  ARTIFACT_TYPE,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactReceipt,
  createEvolvableArtifactReleaseGate,
  digestEvolvableArtifactValue: artifactDigest,
} = evolvableArtifactProtocol;

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

function cryptoPorts({ loseFirstSendResponse = false } = {}) {
  let loseSendResponse = loseFirstSendResponse;
  const verify = vi.fn(
    async ({ envelopeDigest, signature }) =>
      signature?.algorithm === "test-signature" &&
      signature.keyId === "device-key:test" &&
      signature.value === `signature:${envelopeDigest}`,
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
      sign: async ({ envelopeDigest }) => ({
        algorithm: "test-signature",
        keyId: "device-key:test",
        value: `signature:${envelopeDigest}`,
      }),
    },
    send: {
      send: vi.fn(async ({ envelope }) => {
        if (loseSendResponse) {
          loseSendResponse = false;
          throw new Error("simulated sync transport response loss");
        }
        return {
          durable: true,
          envelopeDigest: envelope.envelopeDigest,
        };
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

function controller(
  storage,
  crypto,
  dependencyExecutor = null,
  artifactLifecycle = null,
) {
  const persisted = adapter(storage, crypto);
  storage.artifactLifecycle ??= storageKnowledgeArtifactLifecycle(storage);
  return {
    persisted,
    controller: new GovernedKnowledgeSync({
      tenantId: storage.descriptor.tenantId,
      deviceId: storage.descriptor.deviceId,
      ports: persisted.syncPorts(crypto),
      dependencyExecutor,
      artifactLifecycle: artifactLifecycle ?? storage.artifactLifecycle,
      clock: () => Date.parse("2026-09-04T00:00:00.000Z"),
    }),
  };
}

function storageKnowledgeArtifactLifecycle(storage) {
  const descriptor = {
    tenantId: storage.descriptor.tenantId,
    artifactTenantId: storage.descriptor.artifactTenantId,
    streamId: `knowledge-artifacts:${storage.descriptor.deviceId}`,
    audience: storage.descriptor.audience,
    purpose: storage.descriptor.purpose,
  };
  const provider = new EvolvableArtifactLedgerAdapter({
    descriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
  const verifier = new EvolvableArtifactLedgerAdapter({
    descriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
  const authority = createEvolvableArtifactAuthority({
    tenantId: storage.descriptor.tenantId,
    policy: knowledgeArtifactPolicy(),
  });
  return createGovernedKnowledgeArtifactLifecycle({
    tenantId: storage.descriptor.tenantId,
    artifactCandidateGate: createEvolvableArtifactCandidateGate({
      authority,
      candidateWriter: provider,
    }),
    artifactReleaseGate: createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: provider,
      transitionReader: provider.transitionReader(),
    }),
    artifactReleaseResolver: verifier.releaseResolver(),
    verifierArtifactTransitionReader: verifier.transitionReader(),
  });
}

async function mergePlanFixture({
  realLedger = false,
  mergedDependencies = [],
} = {}) {
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
    dependencies: mergedDependencies,
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
          artifactCandidateDigest: D(`candidate:${request.planDigest}`),
          artifactDigest: D(`artifact:${request.planDigest}`),
          artifactReleaseId: `knowledge-release:${request.planDigest.slice(7)}`,
          artifactTransitionOperationId: `artifact-transition:${D(`transition:${request.planDigest}`).slice(7)}`,
          artifactTransitionReceiptDigest: D(
            `transition-receipt:${request.planDigest}`,
          ),
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
      artifactCandidateDigest: result.artifactCandidateDigest,
      artifactDigest: result.artifactDigest,
      artifactReleaseId: result.artifactReleaseId,
      artifactTransitionOperationId: result.artifactTransitionOperationId,
      artifactTransitionReceiptDigest: result.artifactTransitionReceiptDigest,
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

function knowledgeArtifactPolicy(activationDecision = "allow") {
  const revision = "knowledge-merge-test/v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  return createEvolvableArtifactPolicy({
    type: ARTIFACT_TYPE.KNOWLEDGE,
    revision,
    admission: allow,
    evaluator: allow,
    activation: () => ({
      decision: activationDecision,
      policyRevision: revision,
    }),
    rollback: allow,
  });
}

function artifactReceipt(artifact, kind) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `test:${kind}`,
    issuerRevision: "1",
    issuedAt: "2026-09-04T00:00:00.000Z",
    decision: "allow",
  });
}

async function seedKnowledgeArtifactRelease(storage, contentDigest) {
  const artifactAdapter = new EvolvableArtifactLedgerAdapter({
    descriptor: {
      tenantId: storage.descriptor.tenantId,
      artifactTenantId: storage.descriptor.artifactTenantId,
      streamId: `knowledge-artifacts:${storage.descriptor.deviceId}`,
      audience: storage.descriptor.audience,
      purpose: storage.descriptor.purpose,
    },
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
  const authority = createEvolvableArtifactAuthority({
    tenantId: storage.descriptor.tenantId,
    policy: knowledgeArtifactPolicy(),
  });
  const emptyDependencies = { dependencies: [] };
  const staged = await createEvolvableArtifactCandidateGate({
    authority,
    candidateWriter: artifactAdapter,
  }).stageCandidate({
    tenantId: storage.descriptor.tenantId,
    artifactId: "knowledge-dependency-1",
    type: ARTIFACT_TYPE.KNOWLEDGE,
    contentDigest,
    parent: null,
    lineage: [contentDigest],
    dependencyLock: {
      ...emptyDependencies,
      digest: artifactDigest(emptyDependencies),
    },
    runtimeManifest: {
      executable: false,
      digest: artifactDigest({ executable: false }),
    },
    permissionManifest: {
      capabilities: ["knowledge:team:read"],
      digest: artifactDigest({ capabilities: ["knowledge:team:read"] }),
    },
    candidateId: "knowledge-dependency-candidate-1",
    activeReleaseId: null,
    lastKnownGoodReleaseId: null,
  });
  return createEvolvableArtifactReleaseGate({
    authority,
    transitionWriter: artifactAdapter,
    transitionReader: artifactAdapter.transitionReader(),
  }).promote({
    artifact: staged.artifact,
    candidatePersistenceReceipt: staged.receipt,
    evaluationReceipt: artifactReceipt(staged.artifact, "eval"),
    reviewReceipt: artifactReceipt(staged.artifact, "review"),
    promotionReceipt: artifactReceipt(staged.artifact, "promotion"),
    releaseId: "knowledge-dependency-release-1",
  });
}

function syncMergePublisher(
  storage,
  crypto,
  {
    activationDecision = "allow",
    candidateFailure = null,
    omitCandidateGate = false,
    omitDependencyResolver = false,
    reuseArtifactReader = false,
  } = {},
) {
  const artifactDescriptor = {
    tenantId: storage.descriptor.tenantId,
    artifactTenantId: storage.descriptor.artifactTenantId,
    streamId: `knowledge-artifacts:${storage.descriptor.deviceId}`,
    audience: storage.descriptor.audience,
    purpose: storage.descriptor.purpose,
  };
  const providerArtifactAdapter = new EvolvableArtifactLedgerAdapter({
    descriptor: artifactDescriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
  const verifierArtifactAdapter = new EvolvableArtifactLedgerAdapter({
    descriptor: artifactDescriptor,
    artifactPorts: storage.artifactPorts,
    ledger: storage.ledger,
    ledgerArtifactResolver: storage.resolver,
    clock: () => "2026-09-04T00:00:00.000Z",
  });
  const persistCandidate = vi.fn(async (artifact) => {
    if (candidateFailure) throw candidateFailure;
    return providerArtifactAdapter.persistCandidate(artifact);
  });
  const policy = knowledgeArtifactPolicy(activationDecision);
  const artifactAuthority = createEvolvableArtifactAuthority({
    tenantId: storage.descriptor.tenantId,
    policy,
  });
  const artifactCandidateGate = createEvolvableArtifactCandidateGate({
    authority: artifactAuthority,
    candidateWriter: { persistCandidate },
  });
  const artifactReleaseGate = createEvolvableArtifactReleaseGate({
    authority: artifactAuthority,
    transitionWriter: providerArtifactAdapter,
    transitionReader: providerArtifactAdapter.transitionReader(),
  });
  const verifierArtifactTransitionReader = (
    reuseArtifactReader ? providerArtifactAdapter : verifierArtifactAdapter
  ).transitionReader();
  const artifactLifecycle = createGovernedKnowledgeArtifactLifecycle({
    tenantId: storage.descriptor.tenantId,
    ...(omitCandidateGate ? {} : { artifactCandidateGate }),
    artifactReleaseGate,
    ...(omitDependencyResolver
      ? {}
      : { artifactReleaseResolver: verifierArtifactAdapter.releaseResolver() }),
    verifierArtifactTransitionReader,
  });
  const publishing = controller(storage, crypto, null, artifactLifecycle);
  const providerPublicationReader = publishing.persisted.publicationReader();
  const verifierPublicationReader = adapter(
    storage,
    crypto,
  ).publicationReader();
  return {
    publishing,
    persistCandidate,
    authority: createGovernedKnowledgeSyncMergePublisherAuthority({
      sync: publishing.controller,
      verifierArtifactTransitionReader,
      providerPublicationReader,
      verifierPublicationReader,
      providerDescriptor: {
        authorityId: "merge-sync-publisher:test",
        revision: 1,
        handlerArtifactDigest: D("merge-sync-publisher-handler"),
      },
      verifierDescriptor: {
        authorityId: "merge-sync-verifier:test",
        revision: 1,
        handlerArtifactDigest: D("merge-sync-verifier-handler"),
      },
      now: () => Date.parse("2026-09-04T00:00:00.000Z"),
    }),
  };
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

function reviewHost(fixture, mergeExecution) {
  const receiptIssuer = {
    issue: vi.fn(async (request) => {
      const core = {
        schema: GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA,
        tenantId: request.tenantId,
        reviewerId: "human:alice",
        automated: false,
        knowledgeId: request.knowledgeId,
        conflictEnvelopeDigest: request.conflictEnvelopeDigest,
        localContentDigest: request.localContentDigest,
        remoteContentDigest: request.remoteContentDigest,
        mergedContentDigest: request.mergedContentDigest,
        mergedVectorClock: request.mergedVectorClock,
        reason: request.reason,
        decidedAt: request.requestedAt,
      };
      return {
        ...core,
        receiptDigest: digestGovernedKnowledgeHumanMergeReceipt(core),
        attestation: {
          algorithm: "test-signature",
          keyId: "human-key:alice",
          value: "signed-human-merge-decision",
        },
      };
    }),
  };
  return {
    host: createGovernedKnowledgeReviewHost({
      conflictReader: fixture.reader,
      receiptIssuer,
      receiptVerifier: fixture.verifier,
      mergeExecutor: mergeExecution,
      now: () => Date.parse("2026-09-04T00:00:00.000Z"),
    }),
    receiptIssuer,
  };
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
  it("continues to authenticate and load legacy v1 sync records", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    const envelope = await controller(
      backends("device:a"),
      crypto,
    ).controller.publish(knowledge());
    const core = {
      schema: GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_LEGACY_SCHEMA,
      tenantId: "tenant:a",
      deviceId: "device:a",
      disposition: "local",
      knowledge: knowledge(),
      envelope,
      envelopeDigest: envelope.envelopeDigest,
      conflictWithDigest: null,
      authorizationReceiptDigest: D("authorization"),
      committedAt: "2026-09-04T00:00:00.000Z",
    };
    const record = {
      ...core,
      recordDigest: digestGovernedKnowledgeSyncLedgerRecord(core),
    };
    const published = storage.artifactPorts.putCanonical(
      "governed-knowledge-sync-record",
      record,
      {
        audience: storage.descriptor.audience,
        purpose: storage.descriptor.purpose,
        retention: "ledger",
      },
    );
    storage.ledger.appendDomainEvent(
      {
        artifactTenantId: storage.descriptor.artifactTenantId,
        correlationId: storage.descriptor.streamId,
        decision: "committed",
        eventId: `${GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE}.local.${envelope.envelopeDigest.slice(7)}`,
        reason: "legacy governed knowledge local commit",
        skillName: null,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: storage.descriptor.tenantId,
        timestamp: core.committedAt,
        type: GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE,
      },
      { expectedHeadDigest: null, expectedSequence: 0 },
    );

    await expect(
      adapter(storage, crypto).load({ knowledgeId: "knowledge:1" }),
    ).resolves.toMatchObject({ contentDigest: D("content:a") });
  });

  it("reopens the same record from actual EvolutionLedger files and witness", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    const witness = durableWitness("witness-knowledge-sync");
    storage.ledger = openRealLedger(storage, witness);
    await controller(storage, crypto).controller.publish(knowledge(), {
      operationId: "knowledge-publish:real-ledger",
    });

    const reopenedLedger = openRealLedger(storage, witness);
    const reopened = adapter({ ...storage, ledger: reopenedLedger }, crypto);
    await expect(
      reopened.load({ knowledgeId: "knowledge:1" }),
    ).resolves.toMatchObject({ contentDigest: D("content:a") });
    await expect(
      reopened.getPublication({
        operationId: "knowledge-publish:real-ledger",
      }),
    ).resolves.toMatchObject({
      disposition: "local",
      operationId: "knowledge-publish:real-ledger",
    });
    expect(reopenedLedger.verify()).toMatchObject({
      eventCount: 3,
      sequence: 3,
    });
  });

  it("recovers a locally published record through a new adapter instance", async () => {
    const storage = backends();
    const crypto = cryptoPorts();
    await controller(storage, crypto).controller.publish(knowledge());

    await expect(
      adapter(storage, crypto).load({ knowledgeId: "knowledge:1" }),
    ).resolves.toMatchObject({ contentDigest: D("content:a") });
    expect(storage.state.events.map(({ type }) => type)).toEqual([
      "evolvable-artifact.candidate.persisted",
      "knowledge.sync.committed",
      "evolvable-artifact.transition.committed",
    ]);
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

  it("publishes a merge through the durable sync ledger and recovers transport response loss", async () => {
    const fixture = await mergePlanFixture();
    const publishingCrypto = cryptoPorts({ loseFirstSendResponse: true });
    const publisher = syncMergePublisher(
      fixture.receiverStorage,
      publishingCrypto,
    );
    const first = mergeExecutor(fixture.receiverStorage, publisher.authority);
    const transitionCountBeforeMerge =
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      ).length;

    await expect(first.execute(fixture.plan)).rejects.toThrow(
      "sync transport response loss",
    );
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      ),
    ).toHaveLength(transitionCountBeforeMerge);
    const operationId = `knowledge-merge:${fixture.plan.planDigest.slice(7)}`;
    const committed = await publisher.publishing.persisted.getPublication({
      operationId,
    });
    expect(committed).toMatchObject({
      operationId,
      disposition: "local",
      knowledge: { contentDigest: fixture.merged.contentDigest },
      artifactBinding: {
        operation: "merge",
        operationId,
        evidenceDigest: fixture.plan.humanReceiptDigest,
        humanReviewed: true,
      },
    });

    const reopenedCrypto = cryptoPorts();
    const reopenedPublisher = syncMergePublisher(
      fixture.receiverStorage,
      reopenedCrypto,
    );
    const resumed = await mergeExecutor(
      fixture.receiverStorage,
      reopenedPublisher.authority,
    ).resume({ planDigest: fixture.plan.planDigest });
    expect(resumed).toMatchObject({
      authenticated: true,
      durable: true,
      recovered: true,
      planDigest: fixture.plan.planDigest,
      envelopeDigest: committed.envelopeDigest,
    });
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      ),
    ).toHaveLength(transitionCountBeforeMerge + 1);
    expect(publishingCrypto.send.send).toHaveBeenCalledOnce();
    expect(publisher.persistCandidate).toHaveBeenCalledOnce();
    expect(publisher.persistCandidate.mock.calls[0][0]).toMatchObject({
      tenantId: fixture.plan.tenantId,
      artifactId: fixture.plan.knowledgeId,
      type: ARTIFACT_TYPE.KNOWLEDGE,
      contentDigest: fixture.merged.contentDigest,
      candidate: {
        candidateId: expect.stringMatching(/^knowledge-candidate:/u),
        status: "candidate",
      },
      runtimeManifest: {
        executable: false,
        operation: "merge",
        operationId,
      },
      permissionManifest: {
        capabilities: ["knowledge:team:merge"],
      },
    });
    expect(reopenedCrypto.send.send).toHaveBeenCalledOnce();
    expect(reopenedPublisher.persistCandidate).toHaveBeenCalledOnce();
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.sync.committed",
      ),
    ).toHaveLength(3);

    await expect(
      reopenedPublisher.publishing.controller.publish(
        {
          ...fixture.merged,
          contentDigest: D("substituted-merge"),
        },
        { operationId },
      ),
    ).rejects.toThrow("resolved different knowledge");
  });

  it("requires the shared Knowledge candidate gate at composition time", async () => {
    const fixture = await mergePlanFixture();
    expect(() =>
      syncMergePublisher(fixture.receiverStorage, cryptoPorts(), {
        omitCandidateGate: true,
      }),
    ).toThrow("Knowledge candidate gate");
  });

  it("requires an independent artifact transition verifier reader", async () => {
    const fixture = await mergePlanFixture();
    expect(() =>
      syncMergePublisher(fixture.receiverStorage, cryptoPorts(), {
        reuseArtifactReader: true,
      }),
    ).toThrow("independent artifact transition reader");
  });

  it("requires a branded artifact dependency release resolver", async () => {
    const fixture = await mergePlanFixture();
    expect(() =>
      syncMergePublisher(fixture.receiverStorage, cryptoPorts(), {
        omitDependencyResolver: true,
      }),
    ).toThrow("artifact release resolver");
  });

  it("does not stage or publish an unresolved Knowledge dependency", async () => {
    const fixture = await mergePlanFixture({
      mergedDependencies: [
        {
          kind: "active-knowledge",
          digest: D("missing-active-knowledge"),
          disposition: "refresh-index",
        },
      ],
    });
    const publishingCrypto = cryptoPorts();
    const publisher = syncMergePublisher(
      fixture.receiverStorage,
      publishingCrypto,
    );
    await expect(
      mergeExecutor(fixture.receiverStorage, publisher.authority).execute(
        fixture.plan,
      ),
    ).rejects.toThrow("active release is ambiguous");
    expect(publisher.persistCandidate).not.toHaveBeenCalled();
    expect(publishingCrypto.send.send).not.toHaveBeenCalled();
  });

  it("locks a Knowledge dependency to the current typed Ledger release", async () => {
    const dependencyContentDigest = D("active-knowledge-dependency");
    const fixture = await mergePlanFixture({
      mergedDependencies: [
        {
          kind: "active-knowledge",
          digest: dependencyContentDigest,
          disposition: "refresh-index",
        },
      ],
    });
    const dependencyRelease = await seedKnowledgeArtifactRelease(
      fixture.receiverStorage,
      dependencyContentDigest,
    );
    const publisher = syncMergePublisher(
      fixture.receiverStorage,
      cryptoPorts(),
    );

    await expect(
      mergeExecutor(fixture.receiverStorage, publisher.authority).execute(
        fixture.plan,
      ),
    ).resolves.toMatchObject({ authenticated: true, durable: true });
    expect(
      publisher.persistCandidate.mock.calls[0][0].dependencyLock.dependencies,
    ).toEqual([
      {
        artifactId: dependencyRelease.artifact.artifactId,
        type: ARTIFACT_TYPE.KNOWLEDGE,
        releaseId: dependencyRelease.artifact.activeReleaseId,
        contentDigest: dependencyContentDigest,
      },
    ]);
  });

  it("does not publish a merge when Knowledge candidate persistence fails", async () => {
    const fixture = await mergePlanFixture();
    const publishingCrypto = cryptoPorts();
    const publisher = syncMergePublisher(
      fixture.receiverStorage,
      publishingCrypto,
      { candidateFailure: new Error("candidate store unavailable") },
    );

    await expect(
      mergeExecutor(fixture.receiverStorage, publisher.authority).execute(
        fixture.plan,
      ),
    ).rejects.toThrow("candidate store unavailable");
    expect(publisher.persistCandidate).toHaveBeenCalledOnce();
    expect(publishingCrypto.send.send).not.toHaveBeenCalled();
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === "knowledge.merge.settled",
      ),
    ).toHaveLength(0);
  });

  it("does not publish a merge rejected by the typed activation policy", async () => {
    const fixture = await mergePlanFixture();
    const publishingCrypto = cryptoPorts();
    const publisher = syncMergePublisher(
      fixture.receiverStorage,
      publishingCrypto,
      { activationDecision: "deny" },
    );
    const transitionCountBeforeMerge =
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      ).length;

    await expect(
      mergeExecutor(fixture.receiverStorage, publisher.authority).execute(
        fixture.plan,
      ),
    ).rejects.toThrow("activation policy rejected");
    expect(publisher.persistCandidate).toHaveBeenCalledOnce();
    expect(publishingCrypto.send.send).not.toHaveBeenCalled();
    expect(
      fixture.receiverStorage.state.events.filter(
        ({ type }) => type === EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      ),
    ).toHaveLength(transitionCountBeforeMerge);
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
      eventCount: 6,
      sequence: 6,
    });
  });

  it("exposes a redacted CLI reviewer surface backed by the durable merge", async () => {
    const fixture = await mergePlanFixture();
    const publisher = mergePublisher();
    const reviewed = reviewHost(
      fixture,
      mergeExecutor(fixture.receiverStorage, publisher.authority),
    );
    const before = await reviewed.host.list();
    expect(before).toMatchObject({
      total: 1,
      items: [{ knowledgeId: "knowledge:1" }],
    });
    expect(JSON.stringify(before)).not.toContain("ciphertext");
    expect(JSON.stringify(before)).not.toContain("signature");

    const root = new Command().exitOverride();
    const evolution = root.command("evolution");
    registerGovernedKnowledgeCommands(evolution, {
      governedKnowledgeReviewHost: reviewed.host,
    });
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    await root.parseAsync([
      "node",
      "cc",
      "evolution",
      "knowledge",
      "merge",
      fixture.remoteEnvelope.envelopeDigest,
      "--record",
      JSON.stringify(fixture.merged),
      "--reason",
      "Reviewed both offline edits and preserved their intent.",
    ]);
    const result = JSON.parse(printed.mock.calls[0][0]);
    printed.mockRestore();
    expect(result).toMatchObject({
      durable: true,
      knowledgeId: "knowledge:1",
      mergedContentDigest: D("content:merged"),
    });
    expect(reviewed.receiptIssuer.issue).toHaveBeenCalledOnce();
    expect(await reviewed.host.list()).toMatchObject({ total: 0, items: [] });
    await expect(
      reviewed.host.merge({
        conflictEnvelopeDigest: fixture.remoteEnvelope.envelopeDigest,
        mergedRecord: fixture.merged,
        reason: "A second decision must not be accepted.",
      }),
    ).rejects.toThrow("already settled");
  });

  it("rejects an unbranded CLI reviewer host before reading user data", async () => {
    const root = new Command().exitOverride();
    const evolution = root.command("evolution");
    registerGovernedKnowledgeCommands(evolution, {
      governedKnowledgeReviewHost: {},
    });
    await expect(
      root.parseAsync(["node", "cc", "evolution", "knowledge", "conflicts"]),
    ).rejects.toThrow("trusted deployment host");
  });

  it("routes Cloud Session review through fixed App Server methods", async () => {
    const fixture = await mergePlanFixture();
    const publisher = mergePublisher();
    const reviewed = reviewHost(
      fixture,
      mergeExecutor(fixture.receiverStorage, publisher.authority),
    );
    const server = new CcAppServer({
      send: async () => {},
      store: new MemoryRolloutStore(),
      governedKnowledgeReviewHost: reviewed.host,
    });
    try {
      const initialized = await server.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: APP_SERVER_PROTOCOL_VERSION,
          minimumProtocolVersion: 1,
          client: { name: "knowledge-review-test", version: "1" },
          features: [],
        },
      });
      expect(initialized.result.governedKnowledgeReview).toEqual({
        available: true,
        methods: ["conflicts", "merge"],
      });
      const listed = await server.receive({
        jsonrpc: "2.0",
        id: 2,
        method: "evolution/knowledge/conflicts",
        params: { cursor: 0, limit: 50 },
      });
      expect(listed.result).toMatchObject({
        total: 1,
        items: [{ knowledgeId: "knowledge:1" }],
      });
      const merged = await server.receive({
        jsonrpc: "2.0",
        id: 3,
        method: "evolution/knowledge/merge",
        params: {
          conflictEnvelopeDigest: fixture.remoteEnvelope.envelopeDigest,
          mergedRecord: fixture.merged,
          reason: "Reviewed through the fixed Cloud Session surface.",
        },
      });
      expect(merged.result).toMatchObject({
        durable: true,
        knowledgeId: "knowledge:1",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects an unbranded App Server knowledge review host", () => {
    expect(
      () =>
        new CcAppServer({
          send: async () => {},
          store: new MemoryRolloutStore(),
          governedKnowledgeReviewHost: {},
        }),
    ).toThrow("branded review host");
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
      "evolvable-artifact.candidate.persisted",
      "knowledge.revocation-dependencies.prepared",
      "knowledge.revocation-dependencies.settled",
      "knowledge.sync.committed",
      "evolvable-artifact.transition.committed",
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
      "evolvable-artifact.candidate.persisted",
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
      eventCount: 5,
      sequence: 5,
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
      artifactBinding: {
        schema: GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA,
        operationId: "raw-adapter-recovery",
        operation: "publish",
        issuedAt: "2026-09-04T00:00:00.000Z",
        authorizationReceiptDigest: D("authorization"),
        evidenceDigest: D("authorization"),
        humanReviewed: false,
        baseline: null,
      },
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
