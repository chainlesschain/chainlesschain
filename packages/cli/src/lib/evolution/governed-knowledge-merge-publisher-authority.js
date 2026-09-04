import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { verifyGovernedKnowledgeMergePlan } from "./governed-knowledge-conflict-merge.js";

export const GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA =
  "chainlesschain.governed-knowledge-merge-publish-request/v1";
export const GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_LEGACY_SCHEMA =
  "chainlesschain.governed-knowledge-merge-publish-result/v1";
export const GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA =
  "chainlesschain.governed-knowledge-merge-publish-result/v2";

const AUTHORITIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_RESULT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "revision",
]);
const RESULT_KEYS = new Set([
  "attestation",
  "artifactCandidateDigest",
  "artifactDigest",
  "artifactReleaseId",
  "artifactTransitionOperationId",
  "artifactTransitionReceiptDigest",
  "deviceId",
  "durable",
  "envelopeDigest",
  "idempotent",
  "knowledgeId",
  "mergedContentDigest",
  "operationId",
  "planDigest",
  "providerAuthorityId",
  "providerHandlerArtifactDigest",
  "providerRevision",
  "publishedAt",
  "requestDigest",
  "resultDigest",
  "schema",
  "tenantId",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);

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

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size ||
    actual.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
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

function descriptor(input, label) {
  exact(input, DESCRIPTOR_KEYS, `${label} descriptor`);
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !DIGEST.test(input.handlerArtifactDigest ?? "")
  ) {
    throw new TypeError(`${label} descriptor is invalid`);
  }
  return freeze({
    authorityId: identifier(input.authorityId, `${label} authorityId`),
    revision: input.revision,
    handlerArtifactDigest: input.handlerArtifactDigest,
  });
}

function requestFor(plan) {
  const core = {
    schema: GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA,
    tenantId: plan.tenantId,
    deviceId: plan.deviceId,
    operationId: `knowledge-merge:${plan.planDigest.slice(7)}`,
    planDigest: plan.planDigest,
    knowledgeId: plan.knowledgeId,
    mergedContentDigest: plan.mergedKnowledge.contentDigest,
    mergedKnowledge: plan.mergedKnowledge,
  };
  return freeze({
    ...core,
    requestDigest: hash(GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA, core),
  });
}

function validateResult(input, request, providerDescriptor, now) {
  const result = exact(input, RESULT_KEYS, "merge publish result");
  const attestation = exact(
    result.attestation,
    ATTESTATION_KEYS,
    "merge publish attestation",
  );
  const core = clone(result);
  delete core.resultDigest;
  delete core.attestation;
  const publishedAt = Date.parse(result.publishedAt);
  if (
    result.schema !== GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA ||
    result.tenantId !== request.tenantId ||
    result.deviceId !== request.deviceId ||
    result.operationId !== request.operationId ||
    result.requestDigest !== request.requestDigest ||
    result.planDigest !== request.planDigest ||
    result.knowledgeId !== request.knowledgeId ||
    result.mergedContentDigest !== request.mergedContentDigest ||
    result.providerAuthorityId !== providerDescriptor.authorityId ||
    result.providerRevision !== providerDescriptor.revision ||
    result.providerHandlerArtifactDigest !==
      providerDescriptor.handlerArtifactDigest ||
    result.durable !== true ||
    result.idempotent !== true ||
    !DIGEST.test(result.artifactCandidateDigest ?? "") ||
    !DIGEST.test(result.artifactDigest ?? "") ||
    !ID.test(result.artifactReleaseId ?? "") ||
    !ID.test(result.artifactTransitionOperationId ?? "") ||
    !result.artifactTransitionOperationId.startsWith("artifact-transition:") ||
    !DIGEST.test(result.artifactTransitionReceiptDigest ?? "") ||
    !DIGEST.test(result.envelopeDigest ?? "") ||
    !DIGEST.test(result.resultDigest ?? "") ||
    result.resultDigest !==
      hash(GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA, core) ||
    !Number.isFinite(publishedAt) ||
    publishedAt < now - MAX_RESULT_AGE_MS ||
    publishedAt > now + MAX_FUTURE_SKEW_MS
  ) {
    throw new Error("merge publisher returned an invalid durable result");
  }
  for (const [key, value] of Object.entries(attestation)) {
    if (
      typeof value !== "string" ||
      value.trim() !== value ||
      value.length < 1 ||
      value.length > (key === "value" ? 4096 : 256)
    ) {
      throw new TypeError("merge publish attestation is invalid");
    }
  }
  return freeze(clone(result));
}

export function digestGovernedKnowledgeMergePublishResult(value) {
  const core = clone(value);
  delete core.resultDigest;
  delete core.attestation;
  delete core.verificationReceiptDigest;
  if (
    ![
      GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
      GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_LEGACY_SCHEMA,
    ].includes(value.schema)
  ) {
    throw new TypeError("merge publish result schema is invalid");
  }
  return hash(value.schema, core);
}

export function createGovernedKnowledgeMergePublisherAuthority({
  tenantId: tenantIdInput,
  deviceId: deviceIdInput,
  providerDescriptor: providerDescriptorInput,
  verifierDescriptor: verifierDescriptorInput,
  provider,
  verifier,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const deviceId = identifier(deviceIdInput, "deviceId");
  const providerDescriptor = descriptor(providerDescriptorInput, "provider");
  const verifierDescriptor = descriptor(verifierDescriptorInput, "verifier");
  if (
    providerDescriptor.authorityId === verifierDescriptor.authorityId ||
    providerDescriptor.handlerArtifactDigest ===
      verifierDescriptor.handlerArtifactDigest
  ) {
    throw new TypeError("merge provider and verifier must be independent");
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const publish = capture(provider, "publish", "provider");
  const verify = capture(verifier, "verify", "verifier");
  const authority = Object.freeze({
    tenantId,
    deviceId,
    async publish(planInput) {
      const plan = verifyGovernedKnowledgeMergePlan(planInput);
      if (plan.tenantId !== tenantId || plan.deviceId !== deviceId) {
        throw new Error("merge publish plan crossed its authority boundary");
      }
      const request = requestFor(plan);
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime)) {
        throw new TypeError("merge publisher authority clock is invalid");
      }
      const result = validateResult(
        await publish(request, plan),
        request,
        providerDescriptor,
        currentTime,
      );
      const verified = await verify({
        request,
        result,
        providerDescriptor,
        verifierDescriptor,
      });
      if (
        verified?.authenticated !== true ||
        verified.durable !== true ||
        verified.tenantId !== tenantId ||
        verified.deviceId !== deviceId ||
        verified.operationId !== request.operationId ||
        verified.requestDigest !== request.requestDigest ||
        verified.planDigest !== plan.planDigest ||
        verified.resultDigest !== result.resultDigest ||
        verified.envelopeDigest !== result.envelopeDigest ||
        verified.artifactCandidateDigest !== result.artifactCandidateDigest ||
        verified.artifactDigest !== result.artifactDigest ||
        verified.artifactReleaseId !== result.artifactReleaseId ||
        verified.artifactTransitionOperationId !==
          result.artifactTransitionOperationId ||
        verified.artifactTransitionReceiptDigest !==
          result.artifactTransitionReceiptDigest ||
        verified.providerAuthorityId !== providerDescriptor.authorityId ||
        verified.providerRevision !== providerDescriptor.revision ||
        verified.verifierAuthorityId !== verifierDescriptor.authorityId ||
        verified.verifierRevision !== verifierDescriptor.revision ||
        !DIGEST.test(verified.verificationReceiptDigest ?? "")
      ) {
        throw new Error(
          "merge publisher result was not independently verified",
        );
      }
      return freeze({
        ...clone(result),
        verificationReceiptDigest: verified.verificationReceiptDigest,
      });
    },
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function isGovernedKnowledgeMergePublisherAuthority(value) {
  return AUTHORITIES.has(value);
}
