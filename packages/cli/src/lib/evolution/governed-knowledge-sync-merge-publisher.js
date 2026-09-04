import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import {
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
  createGovernedKnowledgeMergePublisherAuthority,
  digestGovernedKnowledgeMergePublishResult,
} from "./governed-knowledge-merge-publisher-authority.js";
import { isGovernedKnowledgeSync } from "./governed-knowledge-sync.js";
import { isGovernedKnowledgePublicationReader } from "./governed-knowledge-sync-ledger-adapter.js";
import {
  isEvolvableArtifactReleaseResolver,
  isEvolvableArtifactTransitionReader,
} from "./evolvable-artifact-ledger-adapter.js";

const {
  ARTIFACT_TYPE,
  createEvolvableArtifactReceipt,
  digestEvolvableArtifactValue,
  isEvolvableArtifactCandidateGate,
  isEvolvableArtifactReleaseGate,
} = evolvableArtifactProtocol;

export const GOVERNED_KNOWLEDGE_SYNC_MERGE_VERIFICATION_SCHEMA =
  "chainlesschain.governed-knowledge-sync-merge-verification/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "revision",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function manifest(body) {
  return freeze({
    ...body,
    digest: digestEvolvableArtifactValue(body),
  });
}

function knowledgeCandidateInput(plan, dependencyLock) {
  const parentReleaseId = `knowledge-content:${plan.localContentDigest.slice(7)}`;
  return freeze({
    tenantId: plan.tenantId,
    artifactId: plan.knowledgeId,
    type: ARTIFACT_TYPE.KNOWLEDGE,
    contentDigest: plan.mergedKnowledge.contentDigest,
    parent: {
      artifactId: plan.knowledgeId,
      releaseId: parentReleaseId,
      contentDigest: plan.localContentDigest,
    },
    lineage: [
      plan.localContentDigest,
      plan.remoteContentDigest,
      plan.mergedKnowledge.contentDigest,
    ],
    dependencyLock,
    runtimeManifest: manifest({
      executable: false,
      mergePlanDigest: plan.planDigest,
      humanReceiptDigest: plan.humanReceiptDigest,
      scope: plan.scope,
      scopeId: plan.scopeId,
      action: plan.mergedKnowledge.action,
      vectorClock: plan.mergedKnowledge.vectorClock,
    }),
    permissionManifest: manifest({
      automated: false,
      requestedBy: plan.requestedBy,
      capabilities: [`knowledge:${plan.scope}:merge`],
      approvalReceiptDigest: plan.mergedKnowledge.approvalReceiptDigest ?? null,
    }),
    candidateId: `knowledge-merge:${plan.planDigest.slice(7)}`,
    activeReleaseId: parentReleaseId,
    lastKnownGoodReleaseId: null,
  });
}

async function resolveDependencyLock(plan, resolveDependency) {
  const dependencies = [];
  for (const dependency of plan.mergedKnowledge.dependencies) {
    const resolved = await resolveDependency({
      tenantId: plan.tenantId,
      ...dependency,
    });
    if (
      resolved?.authenticated !== true ||
      resolved.durable !== true ||
      resolved.tenantId !== plan.tenantId ||
      resolved.sourceKind !== dependency.kind ||
      resolved.sourceDigest !== dependency.digest ||
      resolved.sourceDisposition !== dependency.disposition ||
      !DIGEST.test(resolved.artifactDigest ?? "")
    ) {
      throw new Error("artifact dependency resolution is invalid");
    }
    dependencies.push({
      artifactId: resolved.artifactId,
      type: resolved.type,
      releaseId: resolved.releaseId,
      contentDigest: resolved.contentDigest,
    });
  }
  dependencies.sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
  return freeze({
    dependencies,
    digest: digestEvolvableArtifactValue({ dependencies }),
  });
}

function artifactReceipt(artifact, kind, plan, claims) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `governed-knowledge-merge:${kind}`,
    issuerRevision: "v1",
    issuedAt: plan.decidedAt,
    decision: "allow",
    claims,
  });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function descriptor(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== DESCRIPTOR_KEYS.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !DESCRIPTOR_KEYS.has(key),
    ) ||
    !ID.test(value.authorityId ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !DIGEST.test(value.handlerArtifactDigest ?? "")
  ) {
    throw new TypeError(`${label} descriptor is invalid`);
  }
  return freeze({
    authorityId: value.authorityId,
    revision: value.revision,
    handlerArtifactDigest: value.handlerArtifactDigest,
  });
}

function bindReader(reader, tenantId, deviceId, label) {
  if (!isGovernedKnowledgePublicationReader(reader)) {
    throw new TypeError(`${label} must be a branded publication reader`);
  }
  if (reader.tenantId !== tenantId || reader.deviceId !== deviceId) {
    throw new TypeError(`${label} crossed its synchronization boundary`);
  }
  return capture(reader, "getPublication", label);
}

function sameKnowledge(left, right) {
  const comparable = { ...left };
  delete comparable.conflictWithDigest;
  return canonical(comparable) === canonical(right);
}

function verifyStoredPublication(record, request, envelope = null) {
  if (
    !record ||
    record.operationId !== request.operationId ||
    record.disposition !== "local" ||
    record.tenantId !== request.tenantId ||
    record.deviceId !== request.deviceId ||
    record.envelope?.envelopeDigest !== record.envelopeDigest ||
    (envelope !== null && record.envelopeDigest !== envelope.envelopeDigest) ||
    !sameKnowledge(record.knowledge, request.mergedKnowledge) ||
    !DIGEST.test(record.recordDigest ?? "")
  ) {
    throw new Error("merge publication was not durably bound to its request");
  }
  return record;
}

export function createGovernedKnowledgeSyncMergePublisherAuthority({
  sync,
  artifactCandidateGate,
  artifactReleaseGate,
  artifactDependencyResolver,
  verifierArtifactTransitionReader,
  providerPublicationReader,
  verifierPublicationReader,
  providerDescriptor,
  verifierDescriptor,
  now = Date.now,
} = {}) {
  if (!isGovernedKnowledgeSync(sync)) {
    throw new TypeError(
      "a branded governed knowledge synchronizer is required",
    );
  }
  if (providerPublicationReader === verifierPublicationReader) {
    throw new TypeError(
      "merge provider and verifier readers must be independent",
    );
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const tenantId = sync.tenantId;
  const deviceId = sync.deviceId;
  if (
    !isEvolvableArtifactCandidateGate(
      artifactCandidateGate,
      ARTIFACT_TYPE.KNOWLEDGE,
    ) ||
    artifactCandidateGate.tenantId !== tenantId
  ) {
    throw new TypeError(
      "a tenant-bound Knowledge artifact candidate gate is required",
    );
  }
  const stageArtifactCandidate = capture(
    artifactCandidateGate,
    "stageCandidate",
    "artifactCandidateGate",
  );
  if (
    !isEvolvableArtifactReleaseResolver(artifactDependencyResolver) ||
    artifactDependencyResolver.tenantId !== tenantId
  ) {
    throw new TypeError(
      "a tenant-bound artifact dependency release resolver is required",
    );
  }
  const resolveArtifactDependency = capture(
    artifactDependencyResolver,
    "resolveDependency",
    "artifactDependencyResolver",
  );
  if (
    !isEvolvableArtifactReleaseGate(
      artifactReleaseGate,
      ARTIFACT_TYPE.KNOWLEDGE,
    ) ||
    artifactReleaseGate.tenantId !== tenantId ||
    artifactReleaseGate.authorityScope !== artifactCandidateGate.authorityScope
  ) {
    throw new TypeError(
      "a same-authority Knowledge artifact release gate is required",
    );
  }
  if (
    !isEvolvableArtifactTransitionReader(verifierArtifactTransitionReader) ||
    verifierArtifactTransitionReader.tenantId !== tenantId ||
    verifierArtifactTransitionReader.readerScope ===
      artifactReleaseGate.transitionReaderScope
  ) {
    throw new TypeError(
      "an independent tenant-bound artifact transition reader is required",
    );
  }
  const prepareArtifactPromotion = capture(
    artifactReleaseGate,
    "preparePromotion",
    "artifactReleaseGate",
  );
  const commitArtifactPromotion = capture(
    artifactReleaseGate,
    "commitPreparedPromotion",
    "artifactReleaseGate",
  );
  const readArtifactTransition = capture(
    verifierArtifactTransitionReader,
    "readTransition",
    "verifierArtifactTransitionReader",
  );
  const providerIdentity = descriptor(providerDescriptor, "provider");
  const verifierIdentity = descriptor(verifierDescriptor, "verifier");
  const publish = capture(sync, "publish", "sync");
  const readProviderPublication = bindReader(
    providerPublicationReader,
    tenantId,
    deviceId,
    "providerPublicationReader",
  );
  const readVerifierPublication = bindReader(
    verifierPublicationReader,
    tenantId,
    deviceId,
    "verifierPublicationReader",
  );
  const provider = Object.freeze({
    async publish(request, plan) {
      const dependencyLock = await resolveDependencyLock(
        plan,
        resolveArtifactDependency,
      );
      const staged = await stageArtifactCandidate(
        knowledgeCandidateInput(plan, dependencyLock),
      );
      if (
        staged?.artifact?.candidate?.candidateId !==
          `knowledge-merge:${plan.planDigest.slice(7)}` ||
        staged.artifact.contentDigest !== request.mergedContentDigest ||
        staged.receipt?.artifactDigest !== staged.artifact.artifactDigest ||
        staged.receipt?.persisted !== true
      ) {
        throw new Error(
          "governed knowledge candidate was not persistently staged",
        );
      }
      const releaseId = `knowledge-release:${plan.planDigest.slice(7)}`;
      const preparedPromotion = prepareArtifactPromotion({
        artifact: staged.artifact,
        candidatePersistenceReceipt: staged.receipt,
        evaluationReceipt: artifactReceipt(staged.artifact, "eval", plan, {
          planDigest: plan.planDigest,
          conflictEnvelopeDigest: plan.conflictEnvelopeDigest,
          localContentDigest: plan.localContentDigest,
          remoteContentDigest: plan.remoteContentDigest,
        }),
        reviewReceipt: artifactReceipt(staged.artifact, "review", plan, {
          planDigest: plan.planDigest,
          humanReceiptDigest: plan.humanReceiptDigest,
          reviewerId: plan.requestedBy,
          automated: false,
        }),
        promotionReceipt: artifactReceipt(staged.artifact, "promotion", plan, {
          planDigest: plan.planDigest,
          publishOperationId: request.operationId,
          scope: plan.scope,
          scopeId: plan.scopeId,
        }),
        releaseId,
      });
      const envelope = await publish(request.mergedKnowledge, {
        operationId: request.operationId,
      });
      const stored = verifyStoredPublication(
        await readProviderPublication({ operationId: request.operationId }),
        request,
        envelope,
      );
      const confirmedAt = Number(now());
      if (
        !Number.isFinite(confirmedAt) ||
        confirmedAt < Date.parse(stored.committedAt)
      ) {
        throw new Error("merge publication confirmation clock is invalid");
      }
      const promoted = await commitArtifactPromotion(preparedPromotion);
      const core = {
        schema: GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
        tenantId,
        deviceId,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        planDigest: request.planDigest,
        knowledgeId: request.knowledgeId,
        mergedContentDigest: request.mergedContentDigest,
        envelopeDigest: stored.envelopeDigest,
        artifactCandidateDigest: staged.artifact.artifactDigest,
        artifactDigest: promoted.artifact.artifactDigest,
        artifactReleaseId: promoted.artifact.activeReleaseId,
        artifactTransitionOperationId: promoted.receipt.operationId,
        artifactTransitionReceiptDigest: promoted.receipt.receiptDigest,
        providerAuthorityId: providerIdentity.authorityId,
        providerRevision: providerIdentity.revision,
        providerHandlerArtifactDigest: providerIdentity.handlerArtifactDigest,
        publishedAt: new Date(confirmedAt).toISOString(),
        durable: true,
        idempotent: true,
      };
      return freeze({
        ...core,
        resultDigest: digestGovernedKnowledgeMergePublishResult(core),
        attestation: clone(stored.envelope.signature),
      });
    },
  });
  const verifier = Object.freeze({
    async verify({ request, result }) {
      const stored = verifyStoredPublication(
        await readVerifierPublication({ operationId: request.operationId }),
        request,
      );
      const transition = await readArtifactTransition({
        operationId: result.artifactTransitionOperationId,
      });
      if (
        result.envelopeDigest !== stored.envelopeDigest ||
        Date.parse(result.publishedAt) < Date.parse(stored.committedAt) ||
        canonical(result.attestation) !==
          canonical(stored.envelope.signature) ||
        result.resultDigest !==
          digestGovernedKnowledgeMergePublishResult(result) ||
        transition?.request?.previousArtifactDigest !==
          result.artifactCandidateDigest ||
        transition.request.nextArtifactDigest !== result.artifactDigest ||
        transition.artifact.artifactDigest !== result.artifactDigest ||
        transition.artifact.activeReleaseId !== result.artifactReleaseId ||
        transition.artifact.contentDigest !== request.mergedContentDigest ||
        transition.artifact.runtimeManifest.mergePlanDigest !==
          request.planDigest ||
        transition.receipt.operationId !==
          result.artifactTransitionOperationId ||
        transition.receipt.receiptDigest !==
          result.artifactTransitionReceiptDigest ||
        transition.receipt.durable !== true
      ) {
        throw new Error("merge publication result differs from durable state");
      }
      const verificationReceiptDigest = hash(
        GOVERNED_KNOWLEDGE_SYNC_MERGE_VERIFICATION_SCHEMA,
        {
          tenantId,
          deviceId,
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          resultDigest: result.resultDigest,
          envelopeDigest: stored.envelopeDigest,
          publicationRecordDigest: stored.recordDigest,
          artifactCandidateDigest: result.artifactCandidateDigest,
          artifactDigest: result.artifactDigest,
          artifactReleaseId: result.artifactReleaseId,
          artifactTransitionOperationId: result.artifactTransitionOperationId,
          artifactTransitionReceiptDigest:
            result.artifactTransitionReceiptDigest,
          verifierAuthorityId: verifierIdentity.authorityId,
          verifierRevision: verifierIdentity.revision,
          verifierHandlerArtifactDigest: verifierIdentity.handlerArtifactDigest,
        },
      );
      return freeze({
        authenticated: true,
        durable: true,
        tenantId,
        deviceId,
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        planDigest: request.planDigest,
        resultDigest: result.resultDigest,
        envelopeDigest: stored.envelopeDigest,
        artifactCandidateDigest: result.artifactCandidateDigest,
        artifactDigest: result.artifactDigest,
        artifactReleaseId: result.artifactReleaseId,
        artifactTransitionOperationId: result.artifactTransitionOperationId,
        artifactTransitionReceiptDigest: result.artifactTransitionReceiptDigest,
        providerAuthorityId: providerIdentity.authorityId,
        providerRevision: providerIdentity.revision,
        verifierAuthorityId: verifierIdentity.authorityId,
        verifierRevision: verifierIdentity.revision,
        verificationReceiptDigest,
      });
    },
  });
  return createGovernedKnowledgeMergePublisherAuthority({
    tenantId,
    deviceId,
    providerDescriptor: providerIdentity,
    verifierDescriptor: verifierIdentity,
    provider,
    verifier,
    now,
  });
}
