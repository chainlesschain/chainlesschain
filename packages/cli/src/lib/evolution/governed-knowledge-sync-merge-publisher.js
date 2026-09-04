import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
  createGovernedKnowledgeMergePublisherAuthority,
  digestGovernedKnowledgeMergePublishResult,
} from "./governed-knowledge-merge-publisher-authority.js";
import { isGovernedKnowledgeSync } from "./governed-knowledge-sync.js";
import { isGovernedKnowledgePublicationReader } from "./governed-knowledge-sync-ledger-adapter.js";
import { isEvolvableArtifactTransitionReader } from "./evolvable-artifact-ledger-adapter.js";

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
    !isEvolvableArtifactTransitionReader(verifierArtifactTransitionReader) ||
    verifierArtifactTransitionReader.tenantId !== tenantId
  ) {
    throw new TypeError(
      "an independent tenant-bound artifact transition reader is required",
    );
  }
  const readArtifactTransition = capture(
    verifierArtifactTransitionReader,
    "readTransition",
    "verifierArtifactTransitionReader",
  );
  const providerIdentity = descriptor(providerDescriptor, "provider");
  const verifierIdentity = descriptor(verifierDescriptor, "verifier");
  const publish = capture(sync, "publishWithArtifactEvidence", "sync");
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
      const published = await publish(request.mergedKnowledge, {
        operationId: request.operationId,
        artifactOperation: "merge",
        artifactEvidenceDigest: plan.humanReceiptDigest,
        artifactHumanReviewed: true,
      });
      const { envelope, artifact } = published;
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
        artifactCandidateDigest: artifact.artifactCandidateDigest,
        artifactDigest: artifact.artifactDigest,
        artifactReleaseId: artifact.artifactReleaseId,
        artifactTransitionOperationId: artifact.artifactTransitionOperationId,
        artifactTransitionReceiptDigest:
          artifact.artifactTransitionReceiptDigest,
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
        transition.artifact.runtimeManifest.operation !== "merge" ||
        transition.artifact.runtimeManifest.operationId !==
          request.operationId ||
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
