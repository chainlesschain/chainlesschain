import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_WITNESS_SCHEMA,
  EvolutionLedger,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  createGovernedKnowledgeArtifactLifecycle,
  isGovernedKnowledgeArtifactLifecycle,
} from "../../src/lib/evolution/governed-knowledge-artifact-lifecycle.js";
import { GOVERNED_KNOWLEDGE_SYNC_SCHEMA } from "../../src/lib/evolution/governed-knowledge-sync.js";
import {
  EvolvableArtifactLedgerAdapter,
  isEvolvableArtifactActiveReleaseReader,
  isEvolvableArtifactReleaseResolver,
  isEvolvableArtifactTransitionReader,
} from "../../src/lib/evolution/evolvable-artifact-ledger-adapter.js";

const {
  ARTIFACT_TYPE,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactReceipt,
  createEvolvableArtifactReleaseGate,
  digestEvolvableArtifactValue: digest,
} = evolvableArtifactProtocol;

const roots = [];
const now = Date.parse("2026-09-04T00:00:00.000Z");
const H = (value) =>
  `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
const descriptor = Object.freeze({
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a",
  streamId: "evolvable-artifacts-a",
  audience: "evolution-runtime",
  purpose: "evolution-ledger",
});
const LEDGER_TRUST = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolvable-ledger",
  trustPolicyDigest: H("evolvable-ledger-trust"),
});
const WITNESS_TRUST = Object.freeze({
  algorithm: "hmac-sha256",
  keyId: "key://tests/evolvable-witness",
  trustPolicyDigest: H("evolvable-witness-trust"),
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function witnessRecord(witnessId, snapshot = null, previous = null) {
  const emptyDiscardDigest = H(
    `chainlesschain.evolution-witness-discard-accumulator/v1\0${canonical([])}`,
  );
  const core = {
    ...WITNESS_TRUST,
    anchorDigest: snapshot?.anchorDigest ?? null,
    authenticated: true,
    durable: true,
    discardAccumulatorDigest:
      previous?.discardAccumulatorDigest ?? emptyDiscardDigest,
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
    witnessDigest: H(
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
      throw new Error("unexpected ancestry request");
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -30_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(fileDescriptor) {
      if (directories.delete(fileDescriptor)) return;
      return fs.closeSync(fileDescriptor);
    },
    fsyncSync(fileDescriptor) {
      if (directories.has(fileDescriptor)) return;
      try {
        return fs.fsyncSync(fileDescriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(fileDescriptor).isDirectory()
        )
          return;
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
          const fileDescriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(fileDescriptor);
          return fileDescriptor;
        }
        throw error;
      }
    },
  };
}

function artifactPorts(root) {
  const secret = "evolvable-artifact-test-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/evolvable-artifacts";
  const policyDigest = H("evolvable-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: descriptor.audience,
    tenantId: descriptor.artifactTenantId,
    now: () => now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve: (request) => {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(now).toISOString(),
          decisionExpiresAt: new Date(now + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
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
          receiptDigest: H(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
}

function open(root, witness) {
  const ports = artifactPorts(root);
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: descriptor.purpose,
  });
  const secret = "evolvable-ledger-test-secret";
  const ledger = new EvolutionLedger({
    rootDir: path.join(root, "ledger-events"),
    authorityRootDir: path.join(root, "ledger-authority"),
    secure: false,
    fsImpl: durableFilesystem(),
    clock: () => now,
    random: () => randomBytes(16).toString("hex"),
    trust: LEDGER_TRUST,
    witnessTrust: WITNESS_TRUST,
    witness,
    artifactResolver: resolver,
    sign: ({ message }) => ({
      ...LEDGER_TRUST,
      value: createHmac("sha256", secret).update(message).digest("base64url"),
    }),
    verifySignature: () => true,
    verifyWitnessSignature: () => true,
  });
  return {
    ledger,
    adapter: new EvolvableArtifactLedgerAdapter({
      descriptor,
      artifactPorts: ports,
      ledger,
      ledgerArtifactResolver: resolver,
      clock: () => new Date(now).toISOString(),
    }),
  };
}

function authority() {
  const revision = "knowledge-policy/v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  return createEvolvableArtifactAuthority({
    tenantId: descriptor.tenantId,
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.KNOWLEDGE,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
}

function receipt(artifact, kind) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `issuer:${kind}`,
    issuerRevision: "1",
    issuedAt: new Date(now).toISOString(),
    decision: "allow",
  });
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("EvolvableArtifactLedgerAdapter", () => {
  it("reopens a typed candidate and release transition from real ArtifactStore and Ledger files", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-evolvable-ledger-"),
    );
    roots.push(root);
    const witness = durableWitness("witness-evolvable-artifact");
    const first = open(root, witness);
    const scopedAuthority = authority();
    const candidateGate = createEvolvableArtifactCandidateGate({
      authority: scopedAuthority,
      candidateWriter: first.adapter,
    });
    const emptyDependencies = { dependencies: [] };
    const staged = await candidateGate.stageCandidate({
      tenantId: descriptor.tenantId,
      artifactId: "knowledge-1",
      type: ARTIFACT_TYPE.KNOWLEDGE,
      contentDigest: digest("knowledge-v2"),
      parent: {
        artifactId: "knowledge-1",
        releaseId: "knowledge-release-1",
        contentDigest: digest("knowledge-v1"),
      },
      lineage: [digest("knowledge-v1"), digest("knowledge-v2")],
      dependencyLock: {
        ...emptyDependencies,
        digest: digest(emptyDependencies),
      },
      runtimeManifest: {
        executable: false,
        digest: digest({ executable: false }),
      },
      permissionManifest: {
        capabilities: ["knowledge:team:merge"],
        digest: digest({ capabilities: ["knowledge:team:merge"] }),
      },
      candidateId: "knowledge-candidate-2",
      activeReleaseId: "knowledge-release-1",
      lastKnownGoodReleaseId: "knowledge-release-0",
    });
    const promoted = await createEvolvableArtifactReleaseGate({
      authority: scopedAuthority,
      transitionWriter: first.adapter,
      transitionReader: first.adapter,
    }).promote({
      artifact: staged.artifact,
      candidatePersistenceReceipt: staged.receipt,
      evaluationReceipt: receipt(staged.artifact, "eval"),
      reviewReceipt: receipt(staged.artifact, "review"),
      promotionReceipt: receipt(staged.artifact, "promotion"),
      releaseId: "knowledge-release-2",
    });
    expect(promoted).toMatchObject({
      recovered: false,
      artifact: { activeReleaseId: "knowledge-release-2" },
      receipt: { durable: true, persisted: true, revision: 2 },
    });
    expect(first.ledger.verify()).toMatchObject({ sequence: 2 });

    const reopened = open(root, witness);
    const independentReader = reopened.adapter.transitionReader();
    expect(isEvolvableArtifactTransitionReader(independentReader)).toBe(true);
    expect(isEvolvableArtifactTransitionReader({})).toBe(false);
    const releaseResolver = reopened.adapter.releaseResolver();
    expect(isEvolvableArtifactReleaseResolver(releaseResolver)).toBe(true);
    await expect(
      releaseResolver.resolveDependency({
        tenantId: descriptor.tenantId,
        kind: "active-knowledge",
        digest: promoted.artifact.contentDigest,
        disposition: "refresh-index",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      artifactId: promoted.artifact.artifactId,
      type: ARTIFACT_TYPE.KNOWLEDGE,
      releaseId: "knowledge-release-2",
      contentDigest: promoted.artifact.contentDigest,
    });
    const recovered = await independentReader.readTransition({
      operationId: promoted.receipt.operationId,
    });
    expect(recovered).toEqual({
      request: expect.objectContaining({
        previousArtifactDigest: staged.artifact.artifactDigest,
        nextArtifactDigest: promoted.artifact.artifactDigest,
      }),
      artifact: promoted.artifact,
      receipt: promoted.receipt,
    });
    await expect(
      reopened.adapter.persistCandidate(staged.artifact),
    ).resolves.toEqual(staged.receipt);
    await expect(
      createEvolvableArtifactReleaseGate({
        authority: scopedAuthority,
        transitionWriter: reopened.adapter,
        transitionReader: reopened.adapter,
      }).promote({
        artifact: staged.artifact,
        candidatePersistenceReceipt: staged.receipt,
        evaluationReceipt: receipt(staged.artifact, "eval"),
        reviewReceipt: receipt(staged.artifact, "review"),
        promotionReceipt: receipt(staged.artifact, "promotion"),
        releaseId: "knowledge-release-2",
      }),
    ).resolves.toMatchObject({ artifact: promoted.artifact });
    await expect(
      reopened.adapter.commitTransition({
        request: { ...recovered.request, releaseId: "substituted-release" },
        artifact: promoted.artifact,
      }),
    ).rejects.toThrow("transition request is invalid");
    const rolledBack = await createEvolvableArtifactReleaseGate({
      authority: scopedAuthority,
      transitionWriter: reopened.adapter,
      transitionReader: reopened.adapter,
    }).rollBack({
      artifact: promoted.artifact,
      rollbackReceipt: receipt(promoted.artifact, "rollback"),
      targetReleaseId: "knowledge-release-1",
    });
    expect(rolledBack.artifact).toMatchObject({
      activeReleaseId: "knowledge-release-1",
      lastKnownGoodReleaseId: "knowledge-release-2",
      release: { status: "rolled-back" },
    });
    await expect(
      releaseResolver.resolveDependency({
        tenantId: descriptor.tenantId,
        kind: "active-knowledge",
        digest: promoted.artifact.contentDigest,
        disposition: "refresh-index",
      }),
    ).rejects.toThrow("active release is ambiguous");
    expect(reopened.ledger.verify()).toMatchObject({ sequence: 3 });
  });

  it("prepares and commits one governed Knowledge lifecycle without a parallel release path", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-lifecycle-"),
    );
    roots.push(root);
    const witness = durableWitness("witness-knowledge-lifecycle");
    const provider = open(root, witness);
    const verifierPorts = artifactPorts(root);
    const verifier = new EvolvableArtifactLedgerAdapter({
      descriptor,
      artifactPorts: verifierPorts,
      ledger: provider.ledger,
      ledgerArtifactResolver:
        verifierPorts.createEvolutionLedgerArtifactResolver({
          purpose: descriptor.purpose,
        }),
      clock: () => new Date(now).toISOString(),
    });
    const scopedAuthority = authority();
    const lifecycle = createGovernedKnowledgeArtifactLifecycle({
      tenantId: descriptor.tenantId,
      artifactCandidateGate: createEvolvableArtifactCandidateGate({
        authority: scopedAuthority,
        candidateWriter: provider.adapter,
      }),
      artifactReleaseGate: createEvolvableArtifactReleaseGate({
        authority: scopedAuthority,
        transitionWriter: provider.adapter,
        transitionReader: provider.adapter.transitionReader(),
      }),
      artifactReleaseResolver: verifier.releaseResolver(),
      verifierArtifactTransitionReader: verifier.transitionReader(),
    });
    expect(isGovernedKnowledgeArtifactLifecycle(lifecycle)).toBe(true);
    const prepared = await lifecycle.prepare({
      knowledge: {
        schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
        tenantId: descriptor.tenantId,
        knowledgeId: "knowledge-lifecycle-1",
        scope: "project",
        scopeId: "project-1",
        action: "upsert",
        contentDigest: digest("lifecycle-content"),
        vectorClock: { "device-a": 1 },
        approvalReceiptDigest: null,
        revocationReceiptDigest: null,
        dependencies: [],
      },
      operation: "publish",
      operationId: "knowledge-publish-1",
      authorizationReceiptDigest: digest("authorization"),
      evidenceDigest: digest("user-review"),
      issuedAt: new Date(now).toISOString(),
      humanReviewed: true,
    });
    expect(provider.ledger.verify()).toMatchObject({ sequence: 1 });
    await expect(lifecycle.commit({ ...prepared })).rejects.toThrow(
      "prepared Knowledge lifecycle handle",
    );
    const committed = await lifecycle.commit(prepared);
    expect(committed).toMatchObject({
      candidateOnly: false,
      artifactReleaseId: expect.stringMatching(/^knowledge-release:/u),
      artifactTransitionReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(provider.ledger.verify()).toMatchObject({ sequence: 2 });

    const next = await lifecycle.prepare({
      knowledge: {
        schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
        tenantId: descriptor.tenantId,
        knowledgeId: "knowledge-lifecycle-1",
        scope: "project",
        scopeId: "project-1",
        action: "upsert",
        contentDigest: digest("lifecycle-content-v2"),
        vectorClock: { "device-a": 2 },
        approvalReceiptDigest: null,
        revocationReceiptDigest: null,
        dependencies: [],
      },
      currentKnowledge: {
        schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
        tenantId: descriptor.tenantId,
        knowledgeId: "knowledge-lifecycle-1",
        scope: "project",
        scopeId: "project-1",
        action: "upsert",
        contentDigest: digest("lifecycle-content"),
        vectorClock: { "device-a": 1 },
        approvalReceiptDigest: null,
        revocationReceiptDigest: null,
        dependencies: [],
      },
      operation: "publish",
      operationId: "knowledge-publish-2",
      authorizationReceiptDigest: digest("authorization-v2"),
      issuedAt: new Date(now).toISOString(),
      humanReviewed: true,
    });
    expect(next.candidate.artifact.parent).toMatchObject({
      artifactId: "knowledge-lifecycle-1",
      releaseId: committed.artifactReleaseId,
      contentDigest: digest("lifecycle-content"),
    });
    expect(provider.ledger.verify()).toMatchObject({ sequence: 3 });
  });

  it("recovers exact active content through a branded release reader", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-active-content-reader-"),
    );
    roots.push(root);
    const provider = open(root, durableWitness("witness-active-content"));
    const verifierPorts = artifactPorts(root);
    const verifier = new EvolvableArtifactLedgerAdapter({
      descriptor,
      artifactPorts: verifierPorts,
      ledger: provider.ledger,
      ledgerArtifactResolver:
        verifierPorts.createEvolutionLedgerArtifactResolver({
          purpose: descriptor.purpose,
        }),
      clock: () => new Date(now).toISOString(),
    });
    const content = "governed active knowledge content";
    const scopedAuthority = authority();
    const candidateGate = createEvolvableArtifactCandidateGate({
      authority: scopedAuthority,
      candidateWriter: provider.adapter,
    });
    const dependencyLock = { dependencies: [] };
    const runtimeManifest = { executable: false };
    const permissionManifest = { capabilities: ["knowledge:project:read"] };
    const staged = await candidateGate.stageCandidate(
      {
        tenantId: descriptor.tenantId,
        artifactId: "knowledge-active-content",
        candidateId: "knowledge-active-content-candidate",
        type: ARTIFACT_TYPE.KNOWLEDGE,
        contentDigest: digest(content),
        parent: null,
        lineage: [digest(content)],
        dependencyLock: {
          ...dependencyLock,
          digest: digest(dependencyLock),
        },
        runtimeManifest: {
          ...runtimeManifest,
          digest: digest(runtimeManifest),
        },
        permissionManifest: {
          ...permissionManifest,
          digest: digest(permissionManifest),
        },
        activeReleaseId: null,
        lastKnownGoodReleaseId: null,
      },
      content,
    );
    const releaseGate = createEvolvableArtifactReleaseGate({
      authority: scopedAuthority,
      transitionWriter: provider.adapter,
      transitionReader: provider.adapter.transitionReader(),
    });
    const promoted = await releaseGate.promote({
      artifact: staged.artifact,
      candidatePersistenceReceipt: staged.receipt,
      evaluationReceipt: receipt(staged.artifact, "eval"),
      reviewReceipt: receipt(staged.artifact, "review"),
      promotionReceipt: receipt(staged.artifact, "promotion"),
      releaseId: "knowledge-active-content-release",
    });
    const reader = verifier.activeReleaseReader();
    expect(isEvolvableArtifactActiveReleaseReader(reader)).toBe(true);
    expect(isEvolvableArtifactActiveReleaseReader({ ...reader })).toBe(false);
    await expect(
      reader.readActive({
        type: ARTIFACT_TYPE.KNOWLEDGE,
        artifactId: "knowledge-active-content",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      releaseId: promoted.artifact.activeReleaseId,
      contentDigest: digest(content),
      contentAvailable: true,
      content,
    });
    await expect(
      provider.adapter.persistCandidate(staged.artifact, "substituted"),
    ).rejects.toThrow("content does not match contentDigest");
    await expect(
      reader.listActive({ type: ARTIFACT_TYPE.KNOWLEDGE }),
    ).resolves.toHaveLength(1);

    const nextContent = "governed active knowledge content v2";
    const next = await candidateGate.stageCandidate(
      {
        tenantId: descriptor.tenantId,
        artifactId: "knowledge-active-content",
        candidateId: "knowledge-active-content-candidate-v2",
        type: ARTIFACT_TYPE.KNOWLEDGE,
        contentDigest: digest(nextContent),
        parent: {
          artifactId: "knowledge-active-content",
          releaseId: promoted.artifact.activeReleaseId,
          contentDigest: digest(content),
        },
        lineage: [digest(content), digest(nextContent)],
        dependencyLock: {
          ...dependencyLock,
          digest: digest(dependencyLock),
        },
        runtimeManifest: {
          ...runtimeManifest,
          digest: digest(runtimeManifest),
        },
        permissionManifest: {
          ...permissionManifest,
          digest: digest(permissionManifest),
        },
        activeReleaseId: promoted.artifact.activeReleaseId,
        lastKnownGoodReleaseId: null,
      },
      nextContent,
    );
    const promotedNext = await releaseGate.promote({
      artifact: next.artifact,
      candidatePersistenceReceipt: next.receipt,
      evaluationReceipt: receipt(next.artifact, "eval"),
      reviewReceipt: receipt(next.artifact, "review"),
      promotionReceipt: receipt(next.artifact, "promotion"),
      releaseId: "knowledge-active-content-release-v2",
    });
    await expect(
      reader.readActive({
        type: ARTIFACT_TYPE.KNOWLEDGE,
        artifactId: "knowledge-active-content",
      }),
    ).resolves.toMatchObject({
      releaseId: promotedNext.artifact.activeReleaseId,
      content: nextContent,
    });
    await releaseGate.rollBack({
      artifact: promotedNext.artifact,
      rollbackReceipt: receipt(promotedNext.artifact, "rollback"),
      targetReleaseId: promoted.artifact.activeReleaseId,
    });
    await expect(
      reader.readActive({
        type: ARTIFACT_TYPE.KNOWLEDGE,
        artifactId: "knowledge-active-content",
      }),
    ).resolves.toMatchObject({
      releaseId: promoted.artifact.activeReleaseId,
      contentDigest: digest(content),
      content,
    });
  });
});
