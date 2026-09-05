import { captureSkillCandidateRegistryReader } from "./skill-candidate-registry.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { governedKnowledgeSourceRef } from "./governed-knowledge-skill-rollback.js";
import {
  createGovernedKnowledgeDependencyAuthority,
  GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
  digestGovernedKnowledgeDependencyResult,
} from "./governed-knowledge-dependency-authority.js";
import {
  capturePruningData as captureData,
  pruningDigest as digest,
  pruningCanonical as canonical,
} from "./governed-wiki-pruning-journal.js";

const VERIFICATION_SCHEMA =
  "chainlesschain.knowledge-candidate-rejection-verification/v1";
const QUARANTINE_VERIFICATION_SCHEMA =
  "chainlesschain.knowledge-candidate-quarantine-verification/v1";
function fail(message) {
  throw new Error(`knowledge candidate disposition: ${message}`);
}

function bindReader(
  candidateRegistry,
  releaseRegistry,
  transactionLedger,
  tenantId,
  wikiAdapter,
) {
  const candidates = captureSkillCandidateRegistryReader(candidateRegistry);
  const releases = captureSkillReleaseRegistryReader(releaseRegistry);
  if (
    candidates.tenantId !== tenantId ||
    releases.tenantId !== tenantId ||
    !releases.matchesTransactionLedger(transactionLedger)
  ) {
    throw new TypeError(
      "candidate rejection registry/ledger tenant binding differs",
    );
  }
  const operations = captureSkillReleaseOperationReader(transactionLedger);
  const wiki =
    wikiAdapter == null ? null : captureWikiRevisionReader(wikiAdapter);
  if (
    wiki &&
    (wiki.descriptor.tenantId !== tenantId ||
      !operations.matchesWikiAdapter(wikiAdapter))
  )
    throw new TypeError("candidate Wiki tenant differs");
  return Object.freeze({ candidates, releases, operations, wiki });
}

function sourceProof(reader, candidate, request, admission) {
  const ref = governedKnowledgeSourceRef(request);
  const direct = candidate.sourceEvidenceRefs.some(
    (entry) => entry.ref === ref && entry.digest === request.contentDigest,
  );
  let wiki = null;
  if (candidate.derivationMode === "wiki") {
    if (!reader.wiki)
      fail("Wiki-derived candidate requires an authenticated Wiki reader");
    const revision = reader.wiki.readKnowledgeProvenance({
      tenantId: request.tenantId,
      revisionId: candidate.wikiRevision,
      knowledgeId: request.knowledgeId,
      contentDigest: request.contentDigest,
    });
    if (
      ["epoch", "ledgerId", "identityDigest"].some(
        (key) => revision.checkpoint[key] !== admission.checkpoint[key],
      ) ||
      revision.checkpoint.sequence >= admission.fence.sequence ||
      admission.history.some(
        (entry) => revision.checkpoint.sequence >= entry.preparationSequence,
      )
    ) {
      fail(
        "Wiki provenance must precede revocation and every original promotion",
      );
    }
    wiki = {
      revisionId: revision.revisionId,
      stateDigest: revision.stateDigest,
      checkpoint: revision.checkpoint,
      affectedPatternIds: revision.affectedPatternIds,
    };
  }
  if (!direct && !wiki?.affectedPatternIds.length)
    fail("candidate source lineage does not identify the revoked Knowledge");
  return captureData({ direct, wiki });
}

function prove(reader, request, context, disposition) {
  if (
    request.dependency.kind !== "candidate" ||
    request.dependency.disposition !== disposition
  ) {
    fail(`this provider requires a candidate / ${disposition} dependency`);
  }
  const candidate = reader.candidates.read(request.dependency.digest);
  if (
    candidate.tenantId !== request.tenantId ||
    candidate.candidateId !== request.dependency.digest
  )
    fail("candidate identity differs");
  const resolve =
    disposition === "quarantine"
      ? reader.operations.resolveCandidateQuarantine
      : reader.operations.resolveCandidateRevocation;
  const admission = resolve({
    tenantId: request.tenantId,
    skillName: candidate.skillName,
    candidateId: candidate.candidateId,
    operationDigest: request.operationDigest,
    context,
  });
  if (!admission.fence || admission.fence.record.deviceId !== request.deviceId)
    fail("no exact durable candidate admission fence");
  const knowledge = admission.fence.record.knowledge;
  for (const key of [
    "tenantId",
    "knowledgeId",
    "action",
    "contentDigest",
    "revocationReceiptDigest",
  ]) {
    if (knowledge[key] !== request[key])
      fail("prepared revocation differs from request");
  }
  if (admission.pendingTransactions.length)
    fail(
      "in-flight release transition requires recovery before candidate disposition can settle",
    );
  const active = reader.releases.readActive(candidate.skillName);
  if (
    Boolean(active) !== Boolean(admission.current) ||
    (active &&
      (active.release.releaseDigest !== admission.current.releaseDigest ||
        active.state.stateDigest !== admission.current.stateDigest ||
        active.state.revision !== admission.current.revision ||
        admission.current.projection.current !== true))
  )
    fail("actual active state differs from authenticated release history");
  let lastKnownGood = null;
  if (active) {
    lastKnownGood = reader.releases.readRelease(
      active.state.lastKnownGoodReleaseDigest,
    );
    if (
      active.release.candidate.candidateId === candidate.candidateId ||
      lastKnownGood.candidate.candidateId === candidate.candidateId
    ) {
      fail(
        "active or rollback-eligible candidate requires real release rollback first",
      );
    }
  }
  const source = sourceProof(reader, candidate, request, admission);
  if (canonical(reader.operations.currentContext()) !== canonical(context))
    fail("ledger changed during candidate verification");
  return captureData({
    candidateId: candidate.candidateId,
    skillName: candidate.skillName,
    source,
    admission,
    active: active
      ? {
          releaseDigest: active.release.releaseDigest,
          stateDigest: active.state.stateDigest,
          lastKnownGoodReleaseDigest: lastKnownGood.releaseDigest,
        }
      : null,
  });
}

export function createGovernedKnowledgeCandidateRejectionAuthority(
  options = {},
) {
  return createCandidateDispositionAuthority(options, "reject-candidate");
}

// Quarantine is a distinct, persistent admission disposition, not rejection or
// a draft-label rewrite. Neither factory may certify an active/LKG candidate.
export function createGovernedKnowledgeCandidateQuarantineAuthority(
  options = {},
) {
  return createCandidateDispositionAuthority(options, "quarantine");
}

function createCandidateDispositionAuthority(
  {
    tenantId,
    deviceId,
    candidateRegistry,
    releaseRegistry,
    transactionLedger,
    verifierCandidateRegistry,
    verifierReleaseRegistry,
    verifierTransactionLedger,
    wikiLedgerAdapter = null,
    verifierWikiLedgerAdapter = null,
    providerDescriptor,
    verifierDescriptor,
  },
  disposition,
) {
  if (
    candidateRegistry === verifierCandidateRegistry ||
    releaseRegistry === verifierReleaseRegistry ||
    transactionLedger === verifierTransactionLedger ||
    (wikiLedgerAdapter !== null &&
      wikiLedgerAdapter === verifierWikiLedgerAdapter) ||
    Boolean(wikiLedgerAdapter) !== Boolean(verifierWikiLedgerAdapter)
  ) {
    throw new TypeError(
      "candidate rejection requires independent fixed readers",
    );
  }
  const provider = bindReader(
    candidateRegistry,
    releaseRegistry,
    transactionLedger,
    tenantId,
    wikiLedgerAdapter,
  );
  const verifier = bindReader(
    verifierCandidateRegistry,
    verifierReleaseRegistry,
    verifierTransactionLedger,
    tenantId,
    verifierWikiLedgerAdapter,
  );
  const providerHead = provider.operations.currentContext().checkpoint;
  const verifierHead = verifier.operations.currentContext().checkpoint;
  if (
    ["epoch", "ledgerId", "identityDigest"].some(
      (key) => providerHead[key] !== verifierHead[key],
    )
  ) {
    throw new TypeError(
      "candidate rejection readers belong to different ledgers",
    );
  }
  if (
    provider.wiki &&
    canonical(provider.wiki.descriptor) !== canonical(verifier.wiki.descriptor)
  )
    throw new TypeError("candidate Wiki reader scopes differ");
  const providerIdentity = captureData(providerDescriptor);
  const verifierIdentity = captureData(verifierDescriptor);
  function proofPair(request) {
    const context = provider.operations.currentContext();
    const other = verifier.operations.currentContext();
    if (canonical(context) !== canonical(other))
      fail("independent readers do not authenticate the same current ledger");
    const left = prove(provider, request, context, disposition);
    const right = prove(verifier, request, context, disposition);
    if (canonical(left) !== canonical(right))
      fail("independent candidate rejection proof differs");
    return left;
  }
  return createGovernedKnowledgeDependencyAuthority({
    tenantId,
    deviceId,
    providerDescriptor: providerIdentity,
    verifierDescriptor: verifierIdentity,
    provider: Object.freeze({
      async apply(request) {
        // Preparation already activated the mandatory admission fence. This
        // authority certifies its real effect; it never changes a draft label
        // or reports success while an active/in-flight version can survive.
        const proof = proofPair(request);
        const evidence = proof.admission.fence.evidence;
        const core = {
          schema: GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
          tenantId,
          deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          knowledgeId: request.knowledgeId,
          revocationReceiptDigest: request.revocationReceiptDigest,
          dependencyKind: request.dependency.kind,
          dependencyDigest: request.dependency.digest,
          dependencyDisposition: request.dependency.disposition,
          authorityId: providerIdentity.authorityId,
          authorityRevision: providerIdentity.revision,
          handlerArtifactDigest: providerIdentity.handlerArtifactDigest,
          applied: true,
          durable: true,
          idempotent: true,
          appliedAt: evidence.timestamp,
        };
        const { algorithm, keyId, value } = evidence.signature;
        return captureData({
          ...core,
          resultDigest: digestGovernedKnowledgeDependencyResult(core),
          attestation: { algorithm, keyId, value },
        });
      },
    }),
    verifier: Object.freeze({
      async verify({ request, result }) {
        const proof = proofPair(request);
        const evidence = proof.admission.fence.evidence;
        const { algorithm, keyId, value } = evidence.signature;
        if (
          result.appliedAt !== evidence.timestamp ||
          canonical(result.attestation) !==
            canonical({ algorithm, keyId, value })
        )
          fail("result differs from authenticated admission fence");
        return captureData({
          authenticated: true,
          durable: true,
          tenantId,
          deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          resultDigest: result.resultDigest,
          providerAuthorityId: providerIdentity.authorityId,
          providerRevision: providerIdentity.revision,
          verifierAuthorityId: verifierIdentity.authorityId,
          verifierRevision: verifierIdentity.revision,
          verificationReceiptDigest: digest(
            disposition === "quarantine"
              ? QUARANTINE_VERIFICATION_SCHEMA
              : VERIFICATION_SCHEMA,
            {
              tenantId,
              deviceId,
              requestDigest: request.requestDigest,
              resultDigest: result.resultDigest,
              proof,
              verifierIdentity,
            },
          ),
        });
      },
    }),
  });
}
