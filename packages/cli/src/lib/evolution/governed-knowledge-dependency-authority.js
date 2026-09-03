import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA =
  "chainlesschain.governed-knowledge-dependency-request/v1";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA =
  "chainlesschain.governed-knowledge-dependency-result/v1";

const AUTHORITIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "revision",
]);
const RESULT_KEYS = new Set([
  "applied",
  "appliedAt",
  "attestation",
  "authorityId",
  "authorityRevision",
  "dependencyDigest",
  "dependencyDisposition",
  "dependencyKind",
  "deviceId",
  "durable",
  "handlerArtifactDigest",
  "idempotent",
  "knowledgeId",
  "operationId",
  "requestDigest",
  "resultDigest",
  "revocationReceiptDigest",
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

function requestFor({
  tenantId,
  deviceId,
  operationDigest,
  knowledge,
  dependency,
}) {
  const core = {
    schema: GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA,
    tenantId,
    deviceId,
    operationId: `knowledge-dependency:${operationDigest.slice(7)}:${dependency.digest.slice(7)}`,
    operationDigest,
    knowledgeId: knowledge.knowledgeId,
    action: knowledge.action,
    contentDigest: knowledge.contentDigest,
    revocationReceiptDigest: knowledge.revocationReceiptDigest,
    dependency: clone(dependency),
  };
  return freeze({
    ...core,
    requestDigest: hash(GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA, core),
  });
}

export function digestGovernedKnowledgeDependencyResult(value) {
  const core = clone(value);
  delete core.resultDigest;
  delete core.attestation;
  delete core.verificationReceiptDigest;
  return hash(GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA, core);
}

function validateResult(value, request, authorityDescriptor) {
  const result = exact(value, RESULT_KEYS, "dependency result");
  const attestation = exact(
    result.attestation,
    ATTESTATION_KEYS,
    "dependency attestation",
  );
  if (
    result.schema !== GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA ||
    result.tenantId !== request.tenantId ||
    result.deviceId !== request.deviceId ||
    result.operationId !== request.operationId ||
    result.requestDigest !== request.requestDigest ||
    result.knowledgeId !== request.knowledgeId ||
    result.revocationReceiptDigest !== request.revocationReceiptDigest ||
    result.dependencyKind !== request.dependency.kind ||
    result.dependencyDigest !== request.dependency.digest ||
    result.dependencyDisposition !== request.dependency.disposition ||
    result.authorityId !== authorityDescriptor.authorityId ||
    result.authorityRevision !== authorityDescriptor.revision ||
    result.handlerArtifactDigest !==
      authorityDescriptor.handlerArtifactDigest ||
    result.applied !== true ||
    result.durable !== true ||
    result.idempotent !== true ||
    !Number.isFinite(Date.parse(result.appliedAt)) ||
    !DIGEST.test(result.resultDigest ?? "") ||
    result.resultDigest !== digestGovernedKnowledgeDependencyResult(result)
  ) {
    throw new Error("dependency authority returned an invalid durable result");
  }
  for (const [key, item] of Object.entries(attestation)) {
    if (
      typeof item !== "string" ||
      item.trim() !== item ||
      item.length < 1 ||
      item.length > (key === "value" ? 4096 : 256)
    ) {
      throw new TypeError("dependency attestation is invalid");
    }
  }
  return freeze(clone(result));
}

export function createGovernedKnowledgeDependencyAuthority({
  tenantId: tenantIdInput,
  deviceId: deviceIdInput,
  providerDescriptor: providerDescriptorInput,
  verifierDescriptor: verifierDescriptorInput,
  provider,
  verifier,
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
    throw new TypeError("dependency provider and verifier must be independent");
  }
  const apply = capture(provider, "apply", "provider");
  const verify = capture(verifier, "verify", "verifier");
  const authority = Object.freeze({
    tenantId,
    deviceId,
    async apply(input) {
      if (
        input?.tenantId !== tenantId ||
        input.deviceId !== deviceId ||
        !DIGEST.test(input.operationDigest ?? "")
      ) {
        throw new Error("dependency request crossed its authority boundary");
      }
      const request = requestFor(input);
      const result = validateResult(
        await apply(request),
        request,
        providerDescriptor,
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
        verified.resultDigest !== result.resultDigest ||
        verified.providerAuthorityId !== providerDescriptor.authorityId ||
        verified.providerRevision !== providerDescriptor.revision ||
        verified.verifierAuthorityId !== verifierDescriptor.authorityId ||
        verified.verifierRevision !== verifierDescriptor.revision ||
        !DIGEST.test(verified.verificationReceiptDigest ?? "")
      ) {
        throw new Error("dependency result was not independently verified");
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

export function isGovernedKnowledgeDependencyAuthority(value) {
  return AUTHORITIES.has(value);
}
