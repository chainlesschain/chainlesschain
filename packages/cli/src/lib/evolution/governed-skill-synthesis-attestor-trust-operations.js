import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import { isGovernedSkillSynthesisAttestorTrustLedger } from "./governed-skill-synthesis-attestor-trust-ledger.js";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operation-request/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-approval/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-authorization/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operations/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_RECORD_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-authorization-record/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_LINK_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-authorization-link/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_COMMITTED_EVENT =
  "learning.skill-synthesis-attestor-trust.authorization.committed";

const ARTIFACT_TYPE = "governed-skill-synthesis-attestor-trust-authorization";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SERVICE_ID = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){1,7}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const MAX_OPERATORS = 16;
const MAX_TTL_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const OPERATIONS = new WeakSet();
const ISSUERS = new WeakSet();
const REQUEST_KEYS = new Set([
  "expiresAt",
  "keyId",
  "operation",
  "policyDigest",
  "priorKeyId",
  "publicKeySpki",
  "reason",
  "requestDigest",
  "requestedAt",
  "requiredApprovals",
  "schema",
  "serviceId",
  "tenantId",
]);
const APPROVAL_KEYS = new Set([
  "approvedAt",
  "attestation",
  "automated",
  "expiresAt",
  "operatorId",
  "policyDigest",
  "receiptDigest",
  "requestDigest",
  "schema",
  "tenantId",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);
const AUTHORIZATION_KEYS = new Set([
  "approvalReceiptDigests",
  "authorizationDigest",
  "authorizedAt",
  "operatorIds",
  "policyDigest",
  "requestDigest",
  "requiredApprovals",
  "schema",
  "tenantId",
]);
const AUTHORIZATION_RECORD_KEYS = new Set([
  "approvals",
  "authorization",
  "recordDigest",
  "request",
  "schema",
  "tenantId",
]);

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("value is not finite");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("value must be acyclic JSON");
  }
  if (utilTypes.isProxy(value))
    throw new TypeError("value must not be a Proxy");
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("value must use plain objects");
    }
    output = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return output;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    })
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function dense(value, label, maximum = MAX_OPERATORS) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(`${label} must be a bounded dense array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must contain data entries`);
    }
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return milliseconds;
}

function clock(now, label) {
  const value = Number(now());
  if (!Number.isFinite(value)) throw new TypeError(`${label} clock is invalid`);
  return value;
}

function keyObject(value, type, label) {
  let key;
  try {
    if (utilTypes.isKeyObject(value)) key = value;
    else
      key =
        type === "private" ? createPrivateKey(value) : createPublicKey(value);
  } catch {
    throw new TypeError(`${label} must be Ed25519`);
  }
  if (key.type !== type || key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be Ed25519`);
  }
  return key;
}

function encodedPublicKey(value, label) {
  const key = keyObject(value, "public", label);
  const bytes = key.export({ type: "spki", format: "der" });
  return Object.freeze({
    key,
    keyId: `key:ed25519:${createHash("sha256").update(bytes).digest("hex")}`,
    publicKeySpki: bytes.toString("base64url"),
  });
}

function decodePublicKey(publicKeySpki, expectedKeyId, label) {
  if (typeof publicKeySpki !== "string") {
    throw new TypeError(`${label} SPKI is invalid`);
  }
  const bytes = Buffer.from(publicKeySpki, "base64url");
  if (bytes.toString("base64url") !== publicKeySpki) {
    throw new TypeError(`${label} SPKI is not canonical`);
  }
  const encoded = encodedPublicKey(
    { key: bytes, type: "spki", format: "der" },
    label,
  );
  if (encoded.keyId !== expectedKeyId) {
    throw new Error(`${label} keyId does not bind its SPKI`);
  }
  return encoded.key;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
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

function same(left, right) {
  return canonical(left) === canonical(right);
}

function buildAuthorization(request, approvals) {
  const accepted = [...approvals].sort((left, right) =>
    left.operatorId.localeCompare(right.operatorId),
  );
  const authorizationCore = {
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_SCHEMA,
    tenantId: request.tenantId,
    requestDigest: request.requestDigest,
    policyDigest: request.policyDigest,
    requiredApprovals: request.requiredApprovals,
    operatorIds: accepted.map((receipt) => receipt.operatorId),
    approvalReceiptDigests: accepted.map((receipt) => receipt.receiptDigest),
    authorizedAt: accepted
      .map((receipt) => receipt.approvedAt)
      .sort()
      .at(-1),
  };
  return freeze({
    ...authorizationCore,
    authorizationDigest: hash(
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_SCHEMA,
      authorizationCore,
    ),
  });
}

function authorizationRecordCore(value) {
  const core = structuredClone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustAuthorizationRecord(
  value,
) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_RECORD_SCHEMA,
    authorizationRecordCore(value),
  );
}

function validateAuthorizationRecord(record, descriptor, operators) {
  exact(
    record,
    AUTHORIZATION_RECORD_KEYS,
    "attestor trust authorization record",
  );
  exact(
    record.authorization,
    AUTHORIZATION_KEYS,
    "attestor trust authorization",
  );
  const authorizedAt = timestamp(
    record.authorization.authorizedAt,
    "authorization authorizedAt",
  );
  validateRequest(record.request, descriptor, authorizedAt);
  dense(
    record.approvals,
    "attestor trust authorization approvals",
    operators.size,
  );
  if (
    record.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_RECORD_SCHEMA ||
    record.tenantId !== descriptor.tenantId ||
    record.approvals.length !== descriptor.requiredApprovals ||
    record.recordDigest !==
      digestGovernedSkillSynthesisAttestorTrustAuthorizationRecord(record)
  ) {
    throw new Error("attestor trust authorization record is invalid");
  }
  const seenOperators = new Set();
  const seenKeys = new Set();
  for (const receipt of record.approvals) {
    const operatorId = receipt?.operatorId;
    const operator = operators.get(operatorId);
    if (
      !operator ||
      seenOperators.has(operatorId) ||
      seenKeys.has(operator.keyId)
    ) {
      throw new Error("stored attestor trust approvals are not independent");
    }
    normalizeApproval(
      receipt,
      record.request,
      { ...operator, operatorId },
      authorizedAt,
    );
    seenOperators.add(operatorId);
    seenKeys.add(operator.keyId);
  }
  const expected = buildAuthorization(record.request, record.approvals);
  if (!same(expected, record.authorization)) {
    throw new Error("stored attestor trust authorization is not exactly bound");
  }
  return freeze(structuredClone(record));
}

function parseAuthorizationArtifact(resolution, descriptor, operators) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    throw new Error("attestor trust authorization artifact is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    throw new Error("attestor trust authorization artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    throw new Error("attestor trust authorization artifact binding is invalid");
  }
  return validateAuthorizationRecord(artifact.value, descriptor, operators);
}

function requestCore(value) {
  const core = structuredClone(value);
  delete core.requestDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustOperationRequest(
  value,
) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
    requestCore(value),
  );
}

function approvalCore(value) {
  const core = structuredClone(value);
  delete core.receiptDigest;
  delete core.attestation;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustApproval(value) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA,
    approvalCore(value),
  );
}

export function governedSkillSynthesisAttestorTrustApprovalMessage(
  receiptDigest,
) {
  if (!DIGEST.test(receiptDigest ?? "")) {
    throw new TypeError("attestor trust approval receiptDigest is invalid");
  }
  return Buffer.from(
    `chainlesschain.governed-skill-synthesis-attestor-trust-approval-signature/v1\0${receiptDigest}`,
    "utf8",
  );
}

function validateRequest(value, expected, currentTime) {
  exact(value, REQUEST_KEYS, "attestor trust operation request");
  const requestedAt = timestamp(value.requestedAt, "request requestedAt");
  const expiresAt = timestamp(value.expiresAt, "request expiresAt");
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA ||
    value.tenantId !== expected.tenantId ||
    !DIGEST.test(value.policyDigest ?? "") ||
    value.policyDigest !== expected.policyDigest ||
    !Number.isSafeInteger(value.requiredApprovals) ||
    value.requiredApprovals < 1 ||
    value.requiredApprovals > MAX_OPERATORS ||
    value.requiredApprovals !== expected.requiredApprovals ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !SERVICE_ID.test(value.serviceId ?? "") ||
    !KEY_ID.test(value.keyId ?? "") ||
    requestedAt > currentTime + MAX_FUTURE_SKEW_MS ||
    expiresAt <= currentTime ||
    expiresAt <= requestedAt ||
    expiresAt > requestedAt + expected.requestTtlMs ||
    value.requestDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperationRequest(value)
  ) {
    throw new Error("attestor trust operation request is not authorized");
  }
  if (value.operation === "register") {
    if (
      value.priorKeyId !== null ||
      value.reason !== null ||
      typeof value.publicKeySpki !== "string"
    ) {
      throw new Error("attestor trust registration request is invalid");
    }
    decodePublicKey(value.publicKeySpki, value.keyId, "attestor");
  } else if (value.operation === "rotate") {
    if (
      !KEY_ID.test(value.priorKeyId ?? "") ||
      value.priorKeyId === value.keyId ||
      typeof value.publicKeySpki !== "string" ||
      typeof value.reason !== "string" ||
      value.reason.trim() !== value.reason ||
      value.reason.length < 1 ||
      value.reason.length > 2048
    ) {
      throw new Error("attestor trust rotation request is invalid");
    }
    decodePublicKey(value.publicKeySpki, value.keyId, "attestor");
  } else if (
    value.priorKeyId !== null ||
    value.publicKeySpki !== null ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new Error("attestor trust revocation request is invalid");
  }
  return value;
}

function normalizeOperators(value, tenantId) {
  dense(value, "operatorIdentities");
  const operators = new Map();
  const keys = new Set();
  for (const identity of value) {
    exact(
      identity,
      new Set(["operatorId", "publicKey", "tenantId"]),
      "operator identity",
    );
    if (identity.tenantId !== tenantId) {
      throw new Error("operator identity crossed its tenant boundary");
    }
    const operatorId = identifier(identity.operatorId, "operatorId");
    const encoded = encodedPublicKey(identity.publicKey, "operator publicKey");
    if (operators.has(operatorId) || keys.has(encoded.keyId)) {
      throw new Error("operator identity or key is duplicated");
    }
    keys.add(encoded.keyId);
    operators.set(
      operatorId,
      Object.freeze({ keyId: encoded.keyId, publicKey: encoded.key }),
    );
  }
  return operators;
}

function prepareInput(input, descriptor, now) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    utilTypes.isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new TypeError("attestor trust operation input is invalid");
  }
  const operation = input.operation;
  const serviceId = input.serviceId;
  if (
    !["register", "rotate", "revoke"].includes(operation) ||
    !SERVICE_ID.test(serviceId ?? "")
  ) {
    throw new TypeError("attestor trust operation is invalid");
  }
  let keyId;
  let publicKeySpki;
  let priorKeyId = null;
  let reason = null;
  if (operation === "register" || operation === "rotate") {
    const allowed =
      operation === "register"
        ? new Set(["operation", "publicKey", "serviceId"])
        : new Set([
            "operation",
            "priorKeyId",
            "publicKey",
            "reason",
            "serviceId",
          ]);
    exact(input, allowed, "attestor trust operation input");
    const encoded = encodedPublicKey(input.publicKey, "attestor publicKey");
    keyId = encoded.keyId;
    publicKeySpki = encoded.publicKeySpki;
    if (operation === "rotate") {
      priorKeyId = input.priorKeyId;
      reason = input.reason;
      if (
        !KEY_ID.test(priorKeyId ?? "") ||
        priorKeyId === keyId ||
        typeof reason !== "string" ||
        reason.trim() !== reason ||
        reason.length < 1 ||
        reason.length > 2048
      ) {
        throw new TypeError("attestor trust rotation input is invalid");
      }
    }
  } else {
    exact(
      input,
      new Set(["keyId", "operation", "reason", "serviceId"]),
      "attestor trust operation input",
    );
    keyId = input.keyId;
    publicKeySpki = null;
    reason = input.reason;
    if (
      !KEY_ID.test(keyId ?? "") ||
      typeof reason !== "string" ||
      reason.trim() !== reason ||
      reason.length < 1 ||
      reason.length > 2048
    ) {
      throw new TypeError("attestor trust revocation input is invalid");
    }
  }
  const requestedAt = new Date(now).toISOString();
  const core = {
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATION_REQUEST_SCHEMA,
    tenantId: descriptor.tenantId,
    serviceId,
    operation,
    keyId,
    publicKeySpki,
    priorKeyId,
    reason,
    policyDigest: descriptor.policyDigest,
    requiredApprovals: descriptor.requiredApprovals,
    requestedAt,
    expiresAt: new Date(now + descriptor.requestTtlMs).toISOString(),
  };
  return freeze({
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperationRequest(core),
  });
}

function normalizeApproval(receipt, request, operator, currentTime) {
  exact(receipt, APPROVAL_KEYS, "attestor trust approval");
  const attestation = exact(
    receipt.attestation,
    ATTESTATION_KEYS,
    "attestor trust approval attestation",
  );
  const approvedAt = timestamp(receipt.approvedAt, "approval approvedAt");
  const expiresAt = timestamp(receipt.expiresAt, "approval expiresAt");
  if (
    receipt.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA ||
    receipt.tenantId !== request.tenantId ||
    receipt.operatorId !== operator.operatorId ||
    receipt.automated !== false ||
    receipt.requestDigest !== request.requestDigest ||
    receipt.policyDigest !== request.policyDigest ||
    approvedAt < Date.parse(request.requestedAt) - MAX_FUTURE_SKEW_MS ||
    approvedAt > currentTime + MAX_FUTURE_SKEW_MS ||
    approvedAt >= expiresAt ||
    expiresAt !== Date.parse(request.expiresAt) ||
    expiresAt <= currentTime ||
    receipt.receiptDigest !==
      digestGovernedSkillSynthesisAttestorTrustApproval(receipt) ||
    attestation.algorithm !== "Ed25519" ||
    attestation.keyId !== operator.keyId ||
    typeof attestation.value !== "string"
  ) {
    throw new Error("attestor trust approval is not exactly bound");
  }
  const signature = Buffer.from(attestation.value, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== attestation.value ||
    !verify(
      null,
      governedSkillSynthesisAttestorTrustApprovalMessage(receipt.receiptDigest),
      operator.publicKey,
      signature,
    )
  ) {
    throw new Error("attestor trust approval signature is invalid");
  }
  return receipt;
}

export function createGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer({
  tenantId: tenantIdInput,
  operatorId: operatorIdInput,
  privateKey: privateKeyInput,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const operatorId = identifier(operatorIdInput, "operatorId");
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("approval issuer clock must be a non-proxy function");
  }
  const privateKey = keyObject(
    privateKeyInput,
    "private",
    "operator privateKey",
  );
  const publicKey = encodedPublicKey(
    createPublicKey(privateKey),
    "operator publicKey",
  );
  const issuer = Object.freeze({
    tenantId,
    operatorId,
    keyId: publicKey.keyId,
    issue(request) {
      const currentTime = clock(now, "approval issuer");
      validateRequest(
        request,
        {
          tenantId,
          policyDigest: request?.policyDigest,
          requiredApprovals: request?.requiredApprovals,
          requestTtlMs: MAX_TTL_MS,
        },
        currentTime,
      );
      const core = {
        schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_APPROVAL_SCHEMA,
        tenantId,
        operatorId,
        automated: false,
        requestDigest: request.requestDigest,
        policyDigest: request.policyDigest,
        approvedAt: new Date(currentTime).toISOString(),
        expiresAt: request.expiresAt,
      };
      const receiptDigest =
        digestGovernedSkillSynthesisAttestorTrustApproval(core);
      return freeze({
        ...core,
        receiptDigest,
        attestation: {
          algorithm: "Ed25519",
          keyId: publicKey.keyId,
          value: sign(
            null,
            governedSkillSynthesisAttestorTrustApprovalMessage(receiptDigest),
            privateKey,
          ).toString("base64url"),
        },
      });
    },
  });
  ISSUERS.add(issuer);
  return issuer;
}

export function isGovernedSkillSynthesisAttestorTrustOperatorApprovalIssuer(
  value,
) {
  return ISSUERS.has(value);
}

export function createGovernedSkillSynthesisAttestorTrustOperations({
  tenantId: tenantIdInput,
  authorizationStreamId: authorizationStreamIdInput,
  policyId: policyIdInput,
  revision: revisionInput,
  requiredApprovals: requiredApprovalsInput,
  operatorIdentities,
  trustLedger,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  requestTtlMs: requestTtlMsInput = 5 * 60 * 1000,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const authorizationStreamId = identifier(
    authorizationStreamIdInput,
    "authorizationStreamId",
  );
  const policyId = identifier(policyIdInput, "policyId");
  const revision = Number(revisionInput);
  const requiredApprovals = Number(requiredApprovalsInput);
  const requestTtlMs = Number(requestTtlMsInput);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError("attestor trust policy revision is invalid");
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("attestor trust operations clock is invalid");
  }
  if (
    !Number.isSafeInteger(requestTtlMs) ||
    requestTtlMs < 1_000 ||
    requestTtlMs > MAX_TTL_MS
  ) {
    throw new TypeError("attestor trust request TTL is invalid");
  }
  if (!isGovernedSkillSynthesisAttestorTrustLedger(trustLedger)) {
    throw new TypeError(
      "a branded attestor trust lifecycle writer is required",
    );
  }
  if (trustLedger.descriptor?.tenantId !== tenantId) {
    throw new Error(
      "attestor trust lifecycle writer crossed its tenant boundary",
    );
  }
  const put = capture(artifactPorts, "putCanonical", "artifactPorts");
  const readLedger = capture(ledger, "read", "ledger");
  const verifyLedger = capture(ledger, "verify", "ledger");
  const appendLedger = capture(ledger, "appendDomainEvent", "ledger");
  if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
    throw new TypeError(
      "a branded EvolutionArtifactPorts ledger resolver is required",
    );
  }
  const operators = normalizeOperators(operatorIdentities, tenantId);
  if (
    !Number.isSafeInteger(requiredApprovals) ||
    requiredApprovals < 1 ||
    requiredApprovals > operators.size
  ) {
    throw new TypeError("requiredApprovals must fit the operator registry");
  }
  const policyCore = {
    tenantId,
    policyId,
    revision,
    requiredApprovals,
    operators: [...operators.entries()]
      .map(([operatorId, operator]) => ({
        operatorId,
        keyId: operator.keyId,
      }))
      .sort((left, right) => left.operatorId.localeCompare(right.operatorId)),
  };
  const descriptor = freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATIONS_SCHEMA,
    artifactTenantId: trustLedger.descriptor.artifactTenantId,
    audience: trustLedger.descriptor.audience,
    purpose: trustLedger.descriptor.purpose,
    authorizationStreamId,
    ...policyCore,
    policyDigest: hash(
      "chainlesschain.attestor-trust-operations-policy/v1",
      policyCore,
    ),
    requestTtlMs,
    approvalMode:
      requiredApprovals === 1 ? "single-operator" : "multi-operator",
  });

  const authorizationEvents = () => {
    const events = readLedger();
    if (!Array.isArray(events)) {
      throw new Error("EvolutionLedger returned no authorization events");
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.tenantId === tenantId &&
        event.correlationId === authorizationStreamId &&
        event.type ===
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_COMMITTED_EVENT,
    );
  };

  const resolveAuthorizationEvent = async (event) => {
    const authority = verifyLedger();
    const resolution = await ledgerArtifactResolver({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      throw new Error("authorization ledger resolved a substituted artifact");
    }
    const record = parseAuthorizationArtifact(
      resolution,
      descriptor,
      operators,
    );
    if (
      event.eventId !==
        `${GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_COMMITTED_EVENT}.${record.request.requestDigest.slice(7)}` ||
      event.decision !== "accepted" ||
      event.timestamp !== record.authorization.authorizedAt ||
      event.sourceRefs.length !== 0 ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1
    ) {
      throw new Error("attestor trust authorization event binding is invalid");
    }
    return { event, record };
  };

  const authorizationEntry = async (eventId) => {
    const matches = authorizationEvents().filter(
      (event) => event.eventId === eventId,
    );
    if (matches.length > 1) {
      throw new Error("attestor trust authorization event is ambiguous");
    }
    return matches.length === 0 ? null : resolveAuthorizationEvent(matches[0]);
  };

  const persistAuthorization = async (record) => {
    const eventId = `${GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_COMMITTED_EVENT}.${record.request.requestDigest.slice(7)}`;
    const existing = await authorizationEntry(eventId);
    if (existing) {
      if (!same(existing.record, record)) {
        throw new Error(
          "attestor trust request already has a different durable authorization",
        );
      }
      return freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        recordDigest: record.recordDigest,
        authorizationDigest: record.authorization.authorizationDigest,
        artifactRef: structuredClone(existing.event.subjectRef),
        eventSequence: existing.event.sequence,
        ledgerEventDigest: existing.event.eventDigest,
      });
    }
    const head = verifyLedger();
    const published = put(ARTIFACT_TYPE, record, {
      audience: descriptor.audience,
      purpose: descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      throw new Error("attestor trust authorization was not durably read back");
    }
    let recovered = false;
    try {
      const receipt = appendLedger(
        {
          artifactTenantId: descriptor.artifactTenantId,
          correlationId: authorizationStreamId,
          decision: "accepted",
          eventId,
          reason: `attestor trust ${record.request.operation} authorized by ${requiredApprovals} operator(s)`,
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId,
          timestamp: record.authorization.authorizedAt,
          type: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_COMMITTED_EVENT,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        throw new Error("attestor trust authorization append was not durable");
      }
    } catch (error) {
      const found = await authorizationEntry(eventId);
      if (!found || !same(found.record, record)) throw error;
      recovered = true;
    }
    const stored = await authorizationEntry(eventId);
    if (!stored || !same(stored.record, record)) {
      throw new Error("attestor trust authorization readback differs");
    }
    return freeze({
      authenticated: true,
      durable: true,
      recovered,
      recordDigest: record.recordDigest,
      authorizationDigest: record.authorization.authorizationDigest,
      artifactRef: structuredClone(stored.event.subjectRef),
      eventSequence: stored.event.sequence,
      ledgerEventDigest: stored.event.eventDigest,
    });
  };

  const operations = Object.freeze({
    descriptor,
    prepare(input) {
      return prepareInput(input, descriptor, clock(now, "operations"));
    },
    async execute({ request, approvals } = {}) {
      const currentTime = clock(now, "operations");
      validateRequest(request, descriptor, currentTime);
      dense(approvals, "attestor trust approvals", operators.size);
      if (approvals.length !== requiredApprovals) {
        throw new Error(
          `attestor trust operation requires exactly ${requiredApprovals} approvals`,
        );
      }
      const accepted = [];
      const seenOperators = new Set();
      const seenKeys = new Set();
      for (const receipt of approvals) {
        const operatorId = receipt?.operatorId;
        const operator = operators.get(operatorId);
        if (
          !operator ||
          seenOperators.has(operatorId) ||
          seenKeys.has(operator.keyId)
        ) {
          throw new Error(
            "attestor trust approvals must be from distinct active operators",
          );
        }
        normalizeApproval(
          receipt,
          request,
          { ...operator, operatorId },
          currentTime,
        );
        seenOperators.add(operatorId);
        seenKeys.add(operator.keyId);
        accepted.push(receipt);
      }
      accepted.sort((left, right) =>
        left.operatorId.localeCompare(right.operatorId),
      );
      const authorization = buildAuthorization(request, accepted);
      const authorizationRecordCore = {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_RECORD_SCHEMA,
        tenantId,
        request: structuredClone(request),
        approvals: structuredClone(accepted),
        authorization: structuredClone(authorization),
      };
      const authorizationRecord = freeze({
        ...authorizationRecordCore,
        recordDigest:
          digestGovernedSkillSynthesisAttestorTrustAuthorizationRecord(
            authorizationRecordCore,
          ),
      });
      validateAuthorizationRecord(authorizationRecord, descriptor, operators);
      const persistence = await persistAuthorization(authorizationRecord);
      const authorizationLink = freeze({
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_AUTHORIZATION_LINK_SCHEMA,
        authorizationDigest: authorization.authorizationDigest,
        authorizationStreamId,
        recordDigest: authorizationRecord.recordDigest,
        artifactRef: structuredClone(persistence.artifactRef),
        eventSequence: persistence.eventSequence,
      });
      validateRequest(request, descriptor, clock(now, "operations"));
      let lifecycle;
      if (request.operation === "register") {
        lifecycle = await trustLedger.registerKey({
          serviceId: request.serviceId,
          publicKey: decodePublicKey(
            request.publicKeySpki,
            request.keyId,
            "attestor",
          ),
          authorization: authorizationLink,
        });
      } else if (request.operation === "rotate") {
        lifecycle = await trustLedger.rotateKey({
          serviceId: request.serviceId,
          priorKeyId: request.priorKeyId,
          publicKey: decodePublicKey(
            request.publicKeySpki,
            request.keyId,
            "attestor",
          ),
          reason: request.reason,
          authorization: authorizationLink,
        });
      } else {
        lifecycle = await trustLedger.revokeKey({
          serviceId: request.serviceId,
          keyId: request.keyId,
          reason: request.reason,
          authorization: authorizationLink,
        });
      }
      return freeze({
        authorization,
        persistence: structuredClone(persistence),
        lifecycle: structuredClone(lifecycle),
      });
    },
  });
  OPERATIONS.add(operations);
  return operations;
}

export function isGovernedSkillSynthesisAttestorTrustOperations(value) {
  return OPERATIONS.has(value);
}
