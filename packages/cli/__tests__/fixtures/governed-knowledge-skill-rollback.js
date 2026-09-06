import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import protocol from "@chainlesschain/session-core/evolvable-artifact";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "./skill-revocation-release-registry.js";
import { openKnowledgeWikiProvenance } from "./knowledge-wiki-provenance.js";
import {
  createGovernedKnowledgeSkillQuarantineAuthority,
  createGovernedKnowledgeSkillRollbackAuthority,
  governedKnowledgeSourceRef,
} from "../../src/lib/evolution/governed-knowledge-skill-rollback.js";
import { GovernedKnowledgeDependencyLedgerExecutor } from "../../src/lib/evolution/governed-knowledge-dependency-ledger-executor.js";
import { GovernedKnowledgeSync } from "../../src/lib/evolution/governed-knowledge-sync.js";
import { GovernedKnowledgeSyncLedgerAdapter } from "../../src/lib/evolution/governed-knowledge-sync-ledger-adapter.js";
import { EvolvableArtifactLedgerAdapter } from "../../src/lib/evolution/evolvable-artifact-ledger-adapter.js";
import { createGovernedKnowledgeArtifactLifecycle } from "../../src/lib/evolution/governed-knowledge-artifact-lifecycle.js";
import {
  createGovernedKnowledgeCandidateRejectionAuthority,
  createGovernedKnowledgeCandidateQuarantineAuthority,
} from "../../src/lib/evolution/governed-knowledge-candidate-rejection.js";
import { createGovernedKnowledgeDependencyRouter } from "../../src/lib/evolution/governed-knowledge-dependency-authority.js";
import {
  createGovernedKnowledgeWikiQuarantineAuthority,
  createGovernedKnowledgeWikiTombstoneAuthority,
} from "../../src/lib/evolution/governed-knowledge-wiki-tombstone.js";

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
    localDeviceId = deviceId,
    cryptoAuthority = null,
    candidateEvidenceRefs = [source],
    baselineEvidenceRefs = null,
    crashPoint = "none",
    activeQuarantine = false,
    wikiProvenance = false,
    unsafeWikiBaseline = false,
    lateWikiProvenance = false,
    onReleaseRetain = null,
    onTransition = null,
    beforeDependencyAppend = null,
    candidateRejection = false,
    candidateQuarantine = false,
    wikiTombstone = false,
    wikiQuarantine = false,
    wikiTombstoneAllRuns = false,
    wikiPatternCount = 1,
    wikiHops = 0,
    wikiHopReference = "uri",
    wikiNegativeSource = false,
    transformWikiHopSource = null,
  } = {},
) {
  if (candidateRejection && candidateQuarantine)
    throw new Error("test candidate dispositions must not be conflated");
  if (wikiTombstone && wikiQuarantine)
    throw new Error("test Wiki dispositions must not be conflated");
  const wikiDisposition = wikiQuarantine ? "quarantine" : "tombstone";
  const wikiDispositionMode = wikiQuarantine || wikiTombstone;
  const resources = openEvolutionDurableStore(root, {
    tenantId,
    streamId: "knowledge-revocations",
    crashHook:
      crashPoint === "after-first-wiki-tombstone"
        ? (phase, context) => {
            if (phase !== "after-head") return;
            // Inspect the already-written test event, without reentering the
            // Ledger lock. Kill after one real Wiki commit, before readback or
            // the next configured run; no fabricated effect/receipt is used.
            const directory = path.join(root, "events", "segments-v1");
            const latest = fs
              .readdirSync(directory)
              .filter((name) => /^\d{12}-[a-f0-9]{64}\.json$/.test(name))
              .sort()
              .at(-1);
            if (!latest)
              throw new Error(
                "test crash hook cannot find its committed event",
              );
            const event = JSON.parse(
              fs.readFileSync(path.join(directory, latest), "utf8"),
            );
            if (event.eventDigest !== context.eventDigest)
              throw new Error("test crash hook event identity differs");
            if (event.type === "wiki.revision.committed") process.exit(94);
          }
        : null,
  });
  let wiki = wikiProvenance
    ? openKnowledgeWikiProvenance(resources, source, {
        negativeSource: wikiNegativeSource,
      })
    : null;
  let wikiSeed =
    wiki && seed
      ? await wiki.seed({
          late: lateWikiProvenance && wikiHops === 0,
          patternCount: wikiPatternCount,
        })
      : null;
  const upstreamWikis = [];
  let wikiSource = source;
  let wikiRunId = "knowledge-source-wiki";
  if (
    !Number.isSafeInteger(wikiHops) ||
    wikiHops < 0 ||
    wikiHops > 8 ||
    !["uri", "state-digest", "artifact-digest"].includes(wikiHopReference)
  )
    throw new Error("invalid test Wiki hop configuration");
  for (let hop = 1; wiki && hop <= wikiHops; hop += 1) {
    upstreamWikis.push(wiki);
    const parent = wiki.adapter.loadWiki();
    const original = wiki.reader.readRevision({
      tenantId,
      revisionId: parent.state.revisionId,
    });
    wikiSource =
      wikiHopReference === "uri"
        ? {
            ref: `wiki-source://${tenantId}/${parent.state.revisionId}`,
            digest: parent.stateDigest,
          }
        : {
            ref: `recording://alias/wiki-hop-${hop}`,
            digest:
              wikiHopReference === "artifact-digest"
                ? original.artifactRef.digest
                : parent.stateDigest,
          };
    wikiRunId = `knowledge-source-wiki-hop-${hop}`;
    wikiSource = transformWikiHopSource?.(wikiSource, hop) ?? wikiSource;
    wiki = openKnowledgeWikiProvenance(resources, wikiSource, {
      evolutionRunId: wikiRunId,
    });
    wikiSeed = seed
      ? await wiki.seed({
          late: lateWikiProvenance && hop === wikiHops,
          patternCount: wikiPatternCount,
        })
      : null;
  }
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
    ? openKnowledgeWikiProvenance(independentResources, wikiSource, {
        evolutionRunId: wikiRunId,
      })
    : null;
  const options = {
    ...release.pruningRollbackOptions,
    deviceId: localDeviceId,
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
  const rollbackAuthority = activeQuarantine
    ? createGovernedKnowledgeSkillQuarantineAuthority({
        ...options,
        providerDescriptor: {
          authorityId: "knowledge-active-quarantine:provider",
          revision: 1,
          handlerArtifactDigest: D("active-quarantine-provider"),
        },
        verifierDescriptor: {
          authorityId: "knowledge-active-quarantine:verifier",
          revision: 1,
          handlerArtifactDigest: D("active-quarantine-verifier"),
        },
      })
    : createGovernedKnowledgeSkillRollbackAuthority(options);
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
    candidateRejection || wikiDispositionMode === "combined"
      ? createGovernedKnowledgeCandidateRejectionAuthority(rejectionOptions)
      : null;
  const quarantineOptions = {
    ...rejectionOptions,
    providerDescriptor: {
      authorityId: "knowledge-candidate-quarantine:provider",
      revision: 1,
      handlerArtifactDigest: D("candidate-quarantine-provider"),
    },
    verifierDescriptor: {
      authorityId: "knowledge-candidate-quarantine:verifier",
      revision: 1,
      handlerArtifactDigest: D("candidate-quarantine-verifier"),
    },
  };
  const quarantineAuthority = candidateQuarantine
    ? createGovernedKnowledgeCandidateQuarantineAuthority(quarantineOptions)
    : null;
  const wikiTombstoneOptions = {
    tenantId,
    deviceId: localDeviceId,
    wikiLedgerAdapter: wiki?.adapter,
    verifierWikiLedgerAdapter: independentWiki?.adapter,
    transactionLedger: release.pruningRollbackOptions.transactionLedger,
    verifierTransactionLedger:
      independent.pruningRollbackOptions.transactionLedger,
    additionalWikiTargets: wikiTombstoneAllRuns
      ? upstreamWikis.map((upstream) => ({
          wikiLedgerAdapter: upstream.adapter,
          verifierWikiLedgerAdapter: openKnowledgeWikiProvenance(
            independentResources,
            source,
            { evolutionRunId: upstream.adapter.descriptor.evolutionRunId },
          ).adapter,
        }))
      : [],
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
  const wikiAuthority = wikiDispositionMode
    ? (wikiQuarantine
        ? createGovernedKnowledgeWikiQuarantineAuthority
        : createGovernedKnowledgeWikiTombstoneAuthority)(wikiTombstoneOptions)
    : null;
  const authority =
    candidateRejection === "combined" ||
    candidateQuarantine === "combined" ||
    wikiDispositionMode === "combined"
      ? createGovernedKnowledgeDependencyRouter({
          tenantId,
          deviceId: localDeviceId,
          routes: {
            [`active-skill/${activeQuarantine ? "quarantine" : "rollback-active"}`]:
              rollbackAuthority,
            ...(rejectionAuthority
              ? { "candidate/reject-candidate": rejectionAuthority }
              : {}),
            ...(quarantineAuthority
              ? { "candidate/quarantine": quarantineAuthority }
              : {}),
            ...(wikiAuthority
              ? { [`wiki/${wikiDisposition}`]: wikiAuthority }
              : {}),
          },
        })
      : (wikiAuthority ??
        quarantineAuthority ??
        rejectionAuthority ??
        rollbackAuthority);
  const descriptor = { ...resources.descriptor, deviceId: localDeviceId };
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
  const defaultCrypto = {
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
  const crypto = cryptoAuthority
    ? {
        ...defaultCrypto,
        verifier: cryptoAuthority,
        encrypt: cryptoAuthority,
        decrypt: cryptoAuthority,
        sign: cryptoAuthority,
      }
    : defaultCrypto;
  const persisted = new GovernedKnowledgeSyncLedgerAdapter({
    descriptor,
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
    envelopeVerifier: crypto.verifier,
    now: resources.clock,
  });
  const makeSync = (
    dependencyExecutor = executor,
    dependencyPlanner = null,
    portOverrides = {},
  ) =>
    new GovernedKnowledgeSync({
      tenantId,
      deviceId: localDeviceId,
      ports: { ...persisted.syncPorts(crypto), ...portOverrides },
      dependencyExecutor,
      dependencyPlanner,
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
    vectorClock: { [localDeviceId]: 1 },
    approvalReceiptDigest: null,
    revocationReceiptDigest: D("revocation-receipt"),
    dependencies: [
      {
        kind: "active-skill",
        digest: release.candidateRelease.releaseDigest,
        disposition: activeQuarantine ? "quarantine" : "rollback-active",
      },
    ],
  };
  if (candidateRejection || candidateQuarantine) {
    const candidate = {
      kind: "candidate",
      digest: release.candidateRelease.candidate.candidateId,
      disposition: candidateQuarantine ? "quarantine" : "reject-candidate",
    };
    knowledge.dependencies =
      candidateRejection === "combined" || candidateQuarantine === "combined"
        ? [...knowledge.dependencies, candidate]
        : [candidate];
  }
  if (wikiDispositionMode) {
    const original = wiki.reader.readRevision({
      tenantId,
      revisionId: release.candidateRelease.candidate.wikiRevision,
    });
    const dependency = {
      kind: "wiki",
      disposition: wikiDisposition,
      digest: original.stateDigest,
    };
    const wikiDependencies = [dependency];
    if (wikiTombstoneAllRuns) {
      // Pin the source revisions that existed at the original derived Wiki,
      // never whichever maintenance revision happens to be current on reopen.
      const history = resources.backend.ledger.read();
      for (const upstream of [...upstreamWikis].reverse()) {
        const event = history.findLast(
          (entry) =>
            entry.type === "wiki.revision.committed" &&
            entry.correlationId ===
              upstream.adapter.descriptor.evolutionRunId &&
            entry.sequence <= original.checkpoint.sequence,
        );
        if (!event) throw new Error("test upstream Wiki source is missing");
        wikiDependencies.push({
          kind: "wiki",
          disposition: wikiDisposition,
          digest: upstream.reader.readRevision({
            tenantId,
            revisionId: event.eventId.replace("wiki.revision.", "wiki:"),
          }).stateDigest,
        });
      }
    }
    knowledge.dependencies =
      wikiDispositionMode === "combined"
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
            ...wikiDependencies,
          ]
        : wikiDependencies;
  }
  return {
    root,
    wiki,
    wikiSeed,
    upstreamWikis,
    sent,
    resources,
    release,
    independent,
    options,
    descriptor,
    authority,
    rejectionOptions,
    quarantineOptions,
    wikiTombstoneOptions,
    executor,
    makeSync,
    crypto,
    knowledge,
    persisted,
  };
}
