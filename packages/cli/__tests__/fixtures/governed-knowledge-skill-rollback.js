import { createHash } from "node:crypto";
import protocol from "@chainlesschain/session-core/evolvable-artifact";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "./skill-revocation-release-registry.js";
import { openKnowledgeWikiProvenance } from "./knowledge-wiki-provenance.js";
import {
  createGovernedKnowledgeSkillRollbackAuthority,
  governedKnowledgeSourceRef,
} from "../../src/lib/evolution/governed-knowledge-skill-rollback.js";
import { GovernedKnowledgeDependencyLedgerExecutor } from "../../src/lib/evolution/governed-knowledge-dependency-ledger-executor.js";
import { GovernedKnowledgeSync } from "../../src/lib/evolution/governed-knowledge-sync.js";
import { GovernedKnowledgeSyncLedgerAdapter } from "../../src/lib/evolution/governed-knowledge-sync-ledger-adapter.js";
import { EvolvableArtifactLedgerAdapter } from "../../src/lib/evolution/evolvable-artifact-ledger-adapter.js";
import { createGovernedKnowledgeArtifactLifecycle } from "../../src/lib/evolution/governed-knowledge-artifact-lifecycle.js";
import { createGovernedKnowledgeCandidateRejectionAuthority } from "../../src/lib/evolution/governed-knowledge-candidate-rejection.js";
import { createGovernedKnowledgeDependencyRouter } from "../../src/lib/evolution/governed-knowledge-dependency-authority.js";
import { createGovernedKnowledgeWikiTombstoneAuthority } from "../../src/lib/evolution/governed-knowledge-wiki-tombstone.js";

export const tenantId = "tenant-knowledge-rollback";
export const deviceId = "device:a";
export const knowledgeId = "knowledge:procedure";
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const source = {
  ref: governedKnowledgeSourceRef({ tenantId, knowledgeId }),
  digest: D("knowledge-source"),
};

function knowledgeLifecycle(resources, descriptor) {
  const options = {
    descriptor: { ...descriptor, streamId: "knowledge-artifacts:rollback" },
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
    clock: () => new Date(resources.clock()).toISOString(),
  };
  const provider = new EvolvableArtifactLedgerAdapter(options);
  const verifier = new EvolvableArtifactLedgerAdapter(options);
  const revision = "test-knowledge-rollback/v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  // Admission/identity is test-owned; persistence and release effects are not mocked.
  const authority = protocol.createEvolvableArtifactAuthority({
    tenantId,
    policy: protocol.createEvolvableArtifactPolicy({
      type: protocol.ARTIFACT_TYPE.KNOWLEDGE,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  return createGovernedKnowledgeArtifactLifecycle({
    tenantId,
    artifactCandidateGate: protocol.createEvolvableArtifactCandidateGate({
      authority,
      candidateWriter: provider,
    }),
    artifactReleaseGate: protocol.createEvolvableArtifactReleaseGate({
      authority,
      transitionWriter: provider,
      transitionReader: provider.transitionReader(),
    }),
    artifactReleaseResolver: verifier.releaseResolver(),
    verifierArtifactTransitionReader: verifier.transitionReader(),
  });
}

export async function openKnowledgeSkillRollbackStore(
  root,
  {
    seed = false,
    candidateEvidenceRefs = [source],
    baselineEvidenceRefs = null,
    crashPoint = "none",
    wikiProvenance = false,
    unsafeWikiBaseline = false,
    lateWikiProvenance = false,
    onReleaseRetain = null,
    onTransition = null,
    beforeDependencyAppend = null,
    candidateRejection = false,
    wikiTombstone = false,
    wikiPatternCount = 1,
  } = {},
) {
  const resources = openEvolutionDurableStore(root, {
    tenantId,
    streamId: "knowledge-revocations",
  });
  const wiki = wikiProvenance
    ? openKnowledgeWikiProvenance(resources, source)
    : null;
  const wikiSeed =
    wiki && seed
      ? await wiki.seed({
          late: lateWikiProvenance,
          patternCount: wikiPatternCount,
        })
      : null;
  const wikiReferences = (state) => [
    {
      ref: `wiki-source://${tenantId}/${state.state.revisionId}`,
      digest: state.stateDigest,
    },
  ];
  const baselineWiki =
    wikiSeed && (unsafeWikiBaseline ? wikiSeed.candidate : wikiSeed.baseline);
  const release = await openRevocationReleaseRegistry({
    root,
    storage: { ...resources, now: resources.clock() },
    fsImpl: resources.fsImpl,
    tenantId,
    artifactTenantId: resources.descriptor.artifactTenantId,
    seed,
    crashPoint,
    onReleaseRetain,
    onTransition,
    candidateEvidenceRefs: wikiSeed
      ? wikiReferences(wikiSeed.candidate)
      : candidateEvidenceRefs,
    baselineEvidenceRefs: wikiSeed
      ? wikiReferences(baselineWiki)
      : baselineEvidenceRefs,
    candidateWikiRevision: wikiSeed?.candidate.state.revisionId ?? null,
    baselineWikiRevision: baselineWiki?.state.revisionId ?? null,
  });
  if (wikiSeed && lateWikiProvenance) wikiSeed.commitDelayed();
  const independentResources = openEvolutionDurableStore(root, {
    tenantId,
    streamId: "knowledge-revocations",
  });
  const independent = await openRevocationReleaseRegistry({
    root,
    storage: { ...independentResources, now: independentResources.clock() },
    fsImpl: independentResources.fsImpl,
    tenantId,
    artifactTenantId: independentResources.descriptor.artifactTenantId,
  });
  const independentWiki = wikiProvenance
    ? openKnowledgeWikiProvenance(independentResources, source)
    : null;
  const options = {
    ...release.pruningRollbackOptions,
    deviceId,
    wikiLedgerAdapter: wiki?.adapter ?? null,
    verifierWikiLedgerAdapter: independentWiki?.adapter ?? null,
    verifierReleaseRegistry: independent.pruningRollbackOptions.releaseRegistry,
    verifierTransactionLedger:
      independent.pruningRollbackOptions.transactionLedger,
    providerDescriptor: {
      authorityId: "knowledge-rollback:provider",
      revision: 1,
      handlerArtifactDigest: D("rollback-provider"),
    },
    verifierDescriptor: {
      authorityId: "knowledge-rollback:verifier",
      revision: 1,
      handlerArtifactDigest: D("rollback-verifier"),
    },
  };
  const rollbackAuthority =
    createGovernedKnowledgeSkillRollbackAuthority(options);
  const rejectionOptions = {
    ...options,
    candidateRegistry: release.candidateRegistry,
    verifierCandidateRegistry: independent.candidateRegistry,
    providerDescriptor: {
      authorityId: "knowledge-candidate:provider",
      revision: 1,
      handlerArtifactDigest: D("candidate-rejection-provider"),
    },
    verifierDescriptor: {
      authorityId: "knowledge-candidate:verifier",
      revision: 1,
      handlerArtifactDigest: D("candidate-rejection-verifier"),
    },
  };
  const rejectionAuthority =
    candidateRejection || wikiTombstone === "combined"
      ? createGovernedKnowledgeCandidateRejectionAuthority(rejectionOptions)
      : null;
  const wikiTombstoneOptions = {
    tenantId,
    deviceId,
    wikiLedgerAdapter: wiki?.adapter,
    verifierWikiLedgerAdapter: independentWiki?.adapter,
    transactionLedger: release.pruningRollbackOptions.transactionLedger,
    verifierTransactionLedger:
      independent.pruningRollbackOptions.transactionLedger,
    providerDescriptor: {
      authorityId: "knowledge-wiki:provider",
      revision: 1,
      handlerArtifactDigest: D("wiki-tombstone-provider"),
    },
    verifierDescriptor: {
      authorityId: "knowledge-wiki:verifier",
      revision: 1,
      handlerArtifactDigest: D("wiki-tombstone-verifier"),
    },
  };
  const wikiAuthority = wikiTombstone
    ? createGovernedKnowledgeWikiTombstoneAuthority(wikiTombstoneOptions)
    : null;
  const authority =
    candidateRejection === "combined" || wikiTombstone === "combined"
      ? createGovernedKnowledgeDependencyRouter({
          tenantId,
          deviceId,
          routes: {
            "active-skill/rollback-active": rollbackAuthority,
            "candidate/reject-candidate": rejectionAuthority,
            ...(wikiAuthority ? { "wiki/tombstone": wikiAuthority } : {}),
          },
        })
      : (wikiAuthority ?? rejectionAuthority ?? rollbackAuthority);
  const descriptor = { ...resources.descriptor, deviceId };
  const executorLedger = {
    read: resources.backend.ledger.read.bind(resources.backend.ledger),
    verify: resources.backend.ledger.verify.bind(resources.backend.ledger),
    appendDomainEvent(event, expected) {
      beforeDependencyAppend?.(event, expected);
      if (
        event.type === "knowledge.revocation-dependencies.settled" &&
        crashPoint === "before-dependency-settlement"
      )
        process.exit(96);
      const result = resources.backend.ledger.appendDomainEvent(
        event,
        expected,
      );
      if (
        event.type === "knowledge.revocation-dependencies.prepared" &&
        crashPoint === "after-dependency-prepare"
      )
        process.exit(98);
      if (
        event.type === "knowledge.revocation-dependencies.settled" &&
        crashPoint === "after-dependency-settlement"
      )
        process.exit(97);
      return result;
    },
  };
  const executor = new GovernedKnowledgeDependencyLedgerExecutor({
    descriptor,
    artifactPorts: resources.artifactPorts,
    ledger: executorLedger,
    ledgerArtifactResolver: resources.resolver,
    dependencyAuthority: authority,
    now: resources.clock,
  });
  // Transport/identity here are test-owned. Actual release mutations, artifact
  // storage, signed Ledger/witness, independent readers and recovery are real.
  const sent = [];
  const crypto = {
    verifier: {
      verify: async ({ envelopeDigest, signature }) =>
        signature === `test:${envelopeDigest}`,
    },
    authorize: {
      authorize: async ({ knowledge }) => ({
        authenticated: true,
        allowed: true,
        tenantId,
        knowledgeId: knowledge.knowledgeId,
        scope: knowledge.scope,
        scopeId: knowledge.scopeId,
        receiptDigest: D("knowledge-authorization"),
      }),
    },
    encrypt: {
      encrypt: async ({ plaintext }) => {
        const ciphertext = Buffer.from(plaintext).reverse();
        return {
          ciphertext,
          ciphertextDigest: D(ciphertext),
          keyRef: "key:test",
        };
      },
    },
    decrypt: {
      decrypt: async ({ envelope }) => ({
        plaintext: Buffer.from(envelope.ciphertext, "base64").reverse(),
      }),
    },
    sign: { sign: async ({ envelopeDigest }) => `test:${envelopeDigest}` },
    send: {
      send: async ({ envelope }) => {
        sent.push(envelope);
        return { durable: true, envelopeDigest: envelope.envelopeDigest };
      },
    },
  };
  const persisted = new GovernedKnowledgeSyncLedgerAdapter({
    descriptor,
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
    envelopeVerifier: crypto.verifier,
    now: resources.clock,
  });
  const makeSync = (dependencyExecutor = executor) =>
    new GovernedKnowledgeSync({
      tenantId,
      deviceId,
      ports: persisted.syncPorts(crypto),
      dependencyExecutor,
      artifactLifecycle: knowledgeLifecycle(resources, descriptor),
      clock: resources.clock,
    });
  const knowledge = {
    tenantId,
    knowledgeId,
    scope: "project",
    scopeId: "project:1",
    action: "revoke",
    contentDigest: source.digest,
    vectorClock: { [deviceId]: 1 },
    approvalReceiptDigest: null,
    revocationReceiptDigest: D("revocation-receipt"),
    dependencies: [
      {
        kind: "active-skill",
        digest: release.candidateRelease.releaseDigest,
        disposition: "rollback-active",
      },
    ],
  };
  if (candidateRejection) {
    const candidate = {
      kind: "candidate",
      digest: release.candidateRelease.candidate.candidateId,
      disposition: "reject-candidate",
    };
    knowledge.dependencies =
      candidateRejection === "combined"
        ? [...knowledge.dependencies, candidate]
        : [candidate];
  }
  if (wikiTombstone) {
    const dependency = {
      kind: "wiki",
      disposition: "tombstone",
      digest: wiki.reader.readRevision({
        tenantId,
        revisionId: release.candidateRelease.candidate.wikiRevision,
      }).stateDigest,
    };
    knowledge.dependencies =
      wikiTombstone === "combined"
        ? [
            {
              kind: "active-skill",
              digest: release.candidateRelease.releaseDigest,
              disposition: "rollback-active",
            },
            {
              kind: "candidate",
              digest: release.candidateRelease.candidateId,
              disposition: "reject-candidate",
            },
            dependency,
          ]
        : [dependency];
  }
  return {
    root,
    wiki,
    wikiSeed,
    sent,
    resources,
    release,
    independent,
    options,
    descriptor,
    authority,
    rejectionOptions,
    wikiTombstoneOptions,
    executor,
    makeSync,
    crypto,
    knowledge,
    persisted,
  };
}
