import { types } from "node:util";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { captureSkillRollbackProvider } from "./skill-promotion-controller.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import {
  verifySkillMutationRequest,
  digestSkillMutationTransitionSubject,
} from "./skill-mutation-authority.js";
import {
  createGovernedKnowledgeDependencyAuthority,
  GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
  digestGovernedKnowledgeDependencyResult,
} from "./governed-knowledge-dependency-authority.js";
// Reuse the bounded plain-data snapshot/hash, not pruning plans or permissions.
import {
  capturePruningData as captureData,
  pruningDigest as digest,
  pruningCanonical as canonical,
} from "./governed-wiki-pruning-journal.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const VERIFICATION_SCHEMA =
  "chainlesschain.knowledge-skill-rollback-verification/v1";

function fail(message) {
  throw new Error(`knowledge Skill rollback: ${message}`);
}

export function governedKnowledgeSourceRef({ tenantId, knowledgeId }) {
  if (
    typeof tenantId !== "string" ||
    !ID.test(tenantId) ||
    typeof knowledgeId !== "string" ||
    !ID.test(knowledgeId)
  )
    throw new TypeError("knowledge source identity is invalid");
  return `knowledge://${encodeURIComponent(tenantId)}/${encodeURIComponent(knowledgeId)}`;
}

function bindReader(registry, transactionLedger, tenantId, wikiAdapter) {
  const reader = captureSkillReleaseRegistryReader(registry);
  if (
    reader.tenantId !== tenantId ||
    !reader.matchesTransactionLedger(transactionLedger)
  )
    throw new TypeError(
      "knowledge rollback registry/ledger tenant binding differs",
    );
  const wiki =
    wikiAdapter == null ? null : captureWikiRevisionReader(wikiAdapter);
  if (
    wiki &&
    (wiki.descriptor.tenantId !== tenantId ||
      !captureSkillReleaseOperationReader(transactionLedger).matchesWikiAdapter(
        wikiAdapter,
      ))
  )
    throw new TypeError("Knowledge Wiki lineage tenant differs");
  return Object.freeze({
    registry: reader,
    operations: captureSkillReleaseOperationReader(transactionLedger),
    wiki,
  });
}

function wikiLineage(reader, request, release) {
  if (release.candidate.derivationMode !== "wiki") return null;
  if (!reader.wiki)
    fail("Wiki-derived release requires an authenticated Wiki reader");
  const revision = reader.wiki.readKnowledgeProvenance({
    tenantId: request.tenantId,
    revisionId: release.candidate.wikiRevision,
    knowledgeId: request.knowledgeId,
    contentDigest: request.contentDigest,
  });
  const context = reader.operations.currentContext();
  if (
    ["epoch", "ledgerId", "identityDigest"].some(
      (key) => revision.checkpoint[key] !== context.checkpoint[key],
    )
  )
    fail("Wiki provenance belongs to another release ledger");
  const origin = reader.operations.resolveReleaseOrigin({
    tenantId: request.tenantId,
    skillName: release.skillName,
    releaseDigest: release.releaseDigest,
    context,
  }).result;
  if (
    !origin ||
    origin.projection.status !== "committed" ||
    origin.intent.mutationRequest.requestDigest !==
      release.mutationRequestDigest ||
    revision.checkpoint.sequence >= origin.preparationCheckpoint.sequence
  )
    fail("Wiki provenance must precede the original release preparation");
  return captureData({
    wikiRevision: revision.revisionId,
    stateDigest: revision.stateDigest,
    checkpoint: revision.checkpoint,
    releaseOriginTransactionId: origin.intent.transactionId,
    releaseOriginReceiptDigest: origin.projection.receiptDigest,
    affectedPatternIds: revision.affectedPatternIds,
    unsafePatternIds: revision.unsafePatternIds,
  });
}

function sameLedger(provider, verifier) {
  const left = provider.operations.currentContext().checkpoint;
  const right = verifier.operations.currentContext().checkpoint;
  if (
    ["epoch", "ledgerId", "identityDigest"].some(
      (key) => left[key] !== right[key],
    )
  )
    fail("independent readers do not authenticate the same ledger");
}

function releasesFor(reader, request) {
  if (
    request.dependency.kind !== "active-skill" ||
    request.dependency.disposition !== "rollback-active"
  )
    fail("this provider requires an active-skill / rollback-active dependency");
  // This effect accepts an immutable release identity, never an ambiguous content
  // digest or a caller-supplied Skill name. Other dependency kinds need their own effect.
  const from = reader.registry.readRelease(request.dependency.digest);
  if (
    !from ||
    from.tenantId !== request.tenantId ||
    from.releaseDigest !== request.dependency.digest
  )
    fail("dependent release is missing or substituted");
  const sourceRef = governedKnowledgeSourceRef(request);
  const wiki = wikiLineage(reader, request, from);
  if (
    !from.candidate.sourceEvidenceRefs.some(
      (entry) =>
        entry.ref === sourceRef && entry.digest === request.contentDigest,
    ) &&
    !wiki?.affectedPatternIds.length
  )
    fail("dependent candidate has no exact Knowledge source lineage");
  return { from, sourceRef, wiki };
}

function validateTarget(reader, request, from, target, sourceRef) {
  if (
    !target ||
    target.tenantId !== request.tenantId ||
    target.skillName !== from.skillName ||
    target.releaseDigest === from.releaseDigest
  )
    fail("no distinct same-tenant last-known-good release");
  if (
    target.candidate.sourceEvidenceRefs.some(
      (entry) =>
        entry.ref === sourceRef || entry.digest === request.contentDigest,
    )
  )
    fail("last-known-good still depends on revoked Knowledge");
  const wiki = wikiLineage(reader, request, target);
  if (wiki?.unsafePatternIds.length)
    fail("last-known-good Wiki revision still depends on revoked Knowledge");
  return wiki;
}

function resolve(reader, request, from) {
  return reader.operations.resolveOperation({
    tenantId: request.tenantId,
    skillName: from.skillName,
    operationId: request.operationId,
    context: reader.operations.currentContext(),
  }).result;
}

function committedProof(reader, request) {
  const { from, sourceRef, wiki } = releasesFor(reader, request);
  const result = resolve(reader, request, from);
  if (!result) return null;
  const { intent, previous, projection, finalizationEvidence } = result;
  if (projection.status !== "committed")
    fail("release transaction is pending; reopen the registry to recover");
  const target = reader.registry.readRelease(intent.targetReleaseDigest);
  const targetWiki = validateTarget(reader, request, from, target, sourceRef);
  if (
    intent.operation !== "rollback" ||
    intent.operationId !== request.operationId ||
    intent.skillName !== from.skillName ||
    previous.activeReleaseDigest !== from.releaseDigest ||
    intent.targetReleaseDigest !== previous.lastKnownGoodReleaseDigest ||
    intent.expectedParentDigest !== from.contentDigest ||
    intent.dependencyLockDigest !== target.dependencyLockDigest
  )
    fail("transaction differs from the exact dependent release rollback");
  const active = reader.registry.readActive(from.skillName);
  if (
    projection.current !== true ||
    !active ||
    active.release.releaseDigest !== target.releaseDigest ||
    active.state.transactionId !== intent.transactionId ||
    active.state.stateDigest !== projection.stateDigest
  )
    fail("rollback is no longer the current active release");
  if (
    !finalizationEvidence ||
    finalizationEvidence.eventDigest !== projection.headDigest
  )
    fail("authenticated finalization evidence is missing");
  return captureData({
    fromReleaseDigest: from.releaseDigest,
    targetReleaseDigest: target.releaseDigest,
    transactionId: intent.transactionId,
    stateDigest: projection.stateDigest,
    releaseReceiptDigest: projection.receiptDigest,
    authorityReceiptDigest: intent.authorityReceiptDigest,
    intentDigest: intent.intentDigest,
    epoch: projection.epoch,
    ledgerId: projection.ledgerId,
    sequence: projection.sequence,
    finalizationEvidence,
    ...(wiki || targetWiki
      ? { wikiLineage: { from: wiki, target: targetWiki } }
      : {}),
  });
}

function authorizationData(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    fail("rollback authorization must be own data");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 2 ||
    !fields.request ||
    !fields.capability ||
    [fields.request, fields.capability].some(
      (field) => !Object.hasOwn(field, "value") || !field.enumerable,
    )
  )
    fail("rollback authorization requires exact own request/capability fields");
  return {
    request: verifySkillMutationRequest(fields.request.value),
    capability: fields.capability.value,
  };
}

// Real active-release effect with direct or historically authenticated Wiki
// provenance. Candidate rejection and quarantine require separate effects.
export function createGovernedKnowledgeSkillRollbackAuthority({
  tenantId,
  deviceId,
  releaseRegistry,
  transactionLedger,
  rollbackProvider,
  authorizationProvider,
  verifierReleaseRegistry,
  verifierTransactionLedger,
  wikiLedgerAdapter = null,
  verifierWikiLedgerAdapter = null,
  providerDescriptor,
  verifierDescriptor,
} = {}) {
  if (
    releaseRegistry === verifierReleaseRegistry ||
    transactionLedger === verifierTransactionLedger
  )
    throw new TypeError(
      "knowledge rollback verifier must use independent readers",
    );
  if (
    (wikiLedgerAdapter === null) !== (verifierWikiLedgerAdapter === null) ||
    (wikiLedgerAdapter !== null &&
      wikiLedgerAdapter === verifierWikiLedgerAdapter)
  )
    throw new TypeError("Wiki provenance requires independent paired readers");
  const providerReader = bindReader(
    releaseRegistry,
    transactionLedger,
    tenantId,
    wikiLedgerAdapter,
  );
  const verifierReader = bindReader(
    verifierReleaseRegistry,
    verifierTransactionLedger,
    tenantId,
    verifierWikiLedgerAdapter,
  );
  if (
    providerReader.wiki &&
    canonical(providerReader.wiki.descriptor) !==
      canonical(verifierReader.wiki.descriptor)
  )
    throw new TypeError("Wiki provenance reader scopes differ");
  sameLedger(providerReader, verifierReader);
  const rollback = captureSkillRollbackProvider(
    rollbackProvider,
    releaseRegistry,
  );
  if (rollback.tenantId !== tenantId)
    throw new TypeError("rollback tenant differs");
  if (
    !authorizationProvider ||
    typeof authorizationProvider !== "object" ||
    types.isProxy(authorizationProvider)
  )
    throw new TypeError("a fixed rollback authorization provider is required");
  const authorize = Object.getOwnPropertyDescriptor(
    authorizationProvider,
    "authorizeRollback",
  )?.value;
  if (typeof authorize !== "function" || types.isProxy(authorize))
    throw new TypeError("a fixed rollback authorization provider is required");
  const providerIdentity = captureData(providerDescriptor);
  const verifierIdentity = captureData(verifierDescriptor);

  async function apply(request) {
    sameLedger(providerReader, verifierReader);
    let proof = committedProof(providerReader, request);
    if (!proof) {
      const { from, sourceRef, wiki } = releasesFor(providerReader, request);
      const active = providerReader.registry.readActive(from.skillName);
      if (!active || active.release.releaseDigest !== from.releaseDigest)
        fail("dependent release is not currently active");
      const target = providerReader.registry.readRelease(
        active.state.lastKnownGoodReleaseDigest,
      );
      const targetWiki = validateTarget(
        providerReader,
        request,
        from,
        target,
        sourceRef,
      );
      // Independently preflight before asking for a destructive capability.
      const independent = verifierReader.registry.readActive(from.skillName);
      if (canonical(independent) !== canonical(active))
        fail("independent active state differs");
      const independentSource = releasesFor(verifierReader, request);
      const independentTargetWiki = validateTarget(
        verifierReader,
        request,
        independentSource.from,
        verifierReader.registry.readRelease(
          active.state.lastKnownGoodReleaseDigest,
        ),
        sourceRef,
      );
      if (
        canonical(wiki) !== canonical(independentSource.wiki) ||
        canonical(targetWiki) !== canonical(independentTargetWiki)
      )
        fail("independent Wiki provenance differs");
      const expected = captureData({
        tenantId,
        skillName: from.skillName,
        operationId: request.operationId,
        operation: "rollback",
        targetScope: "active",
        expectedTargetDigest: from.contentDigest,
        expectedTargetRevision: active.state.revision,
        targetReleaseDigest: target.releaseDigest,
        transitionSubjectDigest: digestSkillMutationTransitionSubject({
          tenantId,
          skillName: from.skillName,
          operation: "rollback",
          candidateId: null,
          rollbackTargetReleaseDigest: target.releaseDigest,
          dependencyLockDigest: target.dependencyLockDigest,
          expectedActiveContentDigest: from.contentDigest,
          expectedActiveRevision: active.state.revision,
        }),
      });
      const authorization = authorizationData(
        await Reflect.apply(authorize, authorizationProvider, [expected]),
      );
      for (const key of [
        "tenantId",
        "skillName",
        "operationId",
        "operation",
        "targetScope",
        "expectedTargetDigest",
        "expectedTargetRevision",
        "transitionSubjectDigest",
      ])
        if (authorization.request[key] !== expected[key])
          fail("authority authorized a different transition");
      sameLedger(providerReader, verifierReader);
      if (
        committedProof(providerReader, request) !== null ||
        canonical(providerReader.registry.readActive(from.skillName)) !==
          canonical(active)
      )
        fail("release changed while authorization was pending");
      await rollback.rollback({
        authorization,
        targetReleaseDigest: target.releaseDigest,
      });
      proof = committedProof(providerReader, request);
      if (!proof) fail("rollback was not durably read back");
    }
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
      appliedAt: proof.finalizationEvidence.timestamp,
    };
    const { algorithm, keyId, value } = proof.finalizationEvidence.signature;
    return captureData({
      ...core,
      resultDigest: digestGovernedKnowledgeDependencyResult(core),
      attestation: { algorithm, keyId, value },
    });
  }

  return createGovernedKnowledgeDependencyAuthority({
    tenantId,
    deviceId,
    providerDescriptor: providerIdentity,
    verifierDescriptor: verifierIdentity,
    provider: Object.freeze({ apply }),
    verifier: Object.freeze({
      async verify({ request, result }) {
        sameLedger(providerReader, verifierReader);
        const proof = committedProof(verifierReader, request);
        const providerProof = committedProof(providerReader, request);
        if (!proof || canonical(proof) !== canonical(providerProof))
          fail("independent durable rollback proof differs");
        const { algorithm, keyId, value } =
          proof.finalizationEvidence.signature;
        if (
          result.appliedAt !== proof.finalizationEvidence.timestamp ||
          canonical(result.attestation) !==
            canonical({ algorithm, keyId, value })
        )
          fail("result differs from authenticated finalization");
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
          verificationReceiptDigest: digest(VERIFICATION_SCHEMA, {
            tenantId,
            deviceId,
            requestDigest: request.requestDigest,
            resultDigest: result.resultDigest,
            proof,
            verifierIdentity,
          }),
        });
      },
    }),
  });
}
