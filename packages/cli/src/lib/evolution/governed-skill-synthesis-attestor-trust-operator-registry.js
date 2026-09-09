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

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-record/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT =
  "learning.skill-synthesis-attestor-trust.operator-registry.genesis.committed";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-change-request/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-approval/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_AUTHORIZATION_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-authorization/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-change-record/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_EVENT =
  "learning.skill-synthesis-attestor-trust.operator-registry.change.committed";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT_CODE =
  "CC_LEARNING_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT";

const ARTIFACT_TYPE =
  "governed-skill-synthesis-attestor-trust-operator-registry";
const REGISTRIES = new WeakSet();
const ISSUERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const MAX_OPERATORS = 16;
const MAX_TTL_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const RECORD_KEYS = new Set([
  "createdAt",
  "operatorCount",
  "operators",
  "policyDigest",
  "policyId",
  "recordDigest",
  "requiredApprovals",
  "revision",
  "schema",
  "tenantId",
]);
const OPERATOR_KEYS = new Set(["keyId", "operatorId", "publicKeySpki"]);
const CHANGE_REQUEST_KEYS = new Set([
  "expiresAt",
  "keyId",
  "operation",
  "operatorId",
  "policyDigest",
  "policyId",
  "priorKeyId",
  "publicKeySpki",
  "reason",
  "requestDigest",
  "requestedAt",
  "requiredApprovals",
  "revision",
  "schema",
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
const CHANGE_RECORD_KEYS = new Set([
  "approvals",
  "authorization",
  "effectiveAt",
  "operatorCount",
  "operators",
  "policyDigest",
  "policyId",
  "priorRecordDigest",
  "recordDigest",
  "request",
  "requiredApprovals",
  "revision",
  "schema",
  "tenantId",
]);

function corrupt(message) {
  const error = new Error(message);
  error.code =
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT_CODE;
  throw error;
}

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

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function publicKeyIdentity(value, label) {
  let key;
  try {
    if (
      (utilTypes.isKeyObject(value) && value.type !== "public") ||
      (typeof value === "string" && /PRIVATE KEY/u.test(value)) ||
      (value &&
        typeof value === "object" &&
        !Buffer.isBuffer(value) &&
        Object.hasOwn(value, "d"))
    ) {
      throw new Error();
    }
    key = utilTypes.isKeyObject(value) ? value : createPublicKey(value);
  } catch {
    throw new TypeError(`${label} must be an Ed25519 public key`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be an Ed25519 public key`);
  }
  const bytes = key.export({ type: "spki", format: "der" });
  return Object.freeze({
    keyId: `key:ed25519:${createHash("sha256").update(bytes).digest("hex")}`,
    publicKeySpki: bytes.toString("base64url"),
  });
}

function decodePublicKey(value) {
  if (
    !KEY_ID.test(value.keyId ?? "") ||
    typeof value.publicKeySpki !== "string"
  ) {
    corrupt("operator registry public key identity is invalid");
  }
  const bytes = Buffer.from(value.publicKeySpki, "base64url");
  if (bytes.toString("base64url") !== value.publicKeySpki) {
    corrupt("operator registry public key is not canonical");
  }
  const identity = publicKeyIdentity(
    { key: bytes, type: "spki", format: "der" },
    "stored operator public key",
  );
  if (
    identity.keyId !== value.keyId ||
    identity.publicKeySpki !== value.publicKeySpki
  ) {
    corrupt("operator registry keyId does not bind its SPKI");
  }
  return createPublicKey({ key: bytes, type: "spki", format: "der" });
}

function normalizeOperators(value, tenantId) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_OPERATORS ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("operator identities must be a bounded array");
  }
  const operatorIds = new Set();
  const keyIds = new Set();
  const operators = value.map((entry) => {
    exact(
      entry,
      new Set(["operatorId", "publicKey", "tenantId"]),
      "operator identity",
    );
    if (entry.tenantId !== tenantId) {
      throw new Error("operator identity crossed its tenant boundary");
    }
    const operatorId = identifier(entry.operatorId, "operatorId");
    const key = publicKeyIdentity(entry.publicKey, "operator publicKey");
    if (operatorIds.has(operatorId) || keyIds.has(key.keyId)) {
      throw new Error("operator identity or key is duplicated");
    }
    operatorIds.add(operatorId);
    keyIds.add(key.keyId);
    return { operatorId, ...key };
  });
  return operators.sort((left, right) =>
    left.operatorId.localeCompare(right.operatorId),
  );
}

function policyCore({
  tenantId,
  policyId,
  revision,
  requiredApprovals,
  operators,
}) {
  return {
    tenantId,
    policyId,
    revision,
    requiredApprovals,
    operators: operators.map(({ operatorId, keyId }) => ({
      operatorId,
      keyId,
    })),
  };
}

function recordCore(value) {
  const core = structuredClone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(
  value,
) {
  return hash(
    value?.schema ===
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA
      ? GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA
      : GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA,
    recordCore(value),
  );
}

function validateGenesisRecord(value, descriptor) {
  try {
    exact(value, RECORD_KEYS, "operator registry record");
  } catch {
    corrupt("operator registry record shape is invalid");
  }
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !ID.test(value.policyId ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.requiredApprovals) ||
    value.requiredApprovals < 1 ||
    !Number.isSafeInteger(value.operatorCount) ||
    value.operatorCount < value.requiredApprovals ||
    value.operatorCount > MAX_OPERATORS ||
    !DIGEST.test(value.policyDigest ?? "") ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(Date.parse(value.createdAt)).toISOString() !== value.createdAt ||
    !Array.isArray(value.operators) ||
    value.operators.length !== value.operatorCount ||
    value.recordDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(value)
  ) {
    corrupt("operator registry record binding is invalid");
  }
  const ids = new Set();
  const keys = new Set();
  let previous = null;
  for (const operator of value.operators) {
    try {
      exact(operator, OPERATOR_KEYS, "stored operator identity");
    } catch {
      corrupt("stored operator identity shape is invalid");
    }
    if (
      !ID.test(operator.operatorId ?? "") ||
      ids.has(operator.operatorId) ||
      keys.has(operator.keyId) ||
      (previous !== null && previous.localeCompare(operator.operatorId) >= 0)
    ) {
      corrupt("stored operator identities are not unique and sorted");
    }
    decodePublicKey(operator);
    ids.add(operator.operatorId);
    keys.add(operator.keyId);
    previous = operator.operatorId;
  }
  const expectedPolicy = hash(
    "chainlesschain.attestor-trust-operations-policy/v1",
    policyCore(value),
  );
  if (value.policyDigest !== expectedPolicy) {
    corrupt("operator registry policy digest is invalid");
  }
  return freeze(structuredClone(value));
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
  return value;
}

function changeRequestCore(value) {
  const core = structuredClone(value);
  delete core.requestDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
  value,
) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
    changeRequestCore(value),
  );
}

function approvalCore(value) {
  const core = structuredClone(value);
  delete core.receiptDigest;
  delete core.attestation;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustOperatorRegistryApproval(
  value,
) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA,
    approvalCore(value),
  );
}

export function governedSkillSynthesisAttestorTrustOperatorRegistryApprovalMessage(
  receiptDigest,
) {
  if (!DIGEST.test(receiptDigest ?? "")) {
    throw new TypeError("operator registry approval receiptDigest is invalid");
  }
  return Buffer.from(
    `chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-approval-signature/v1\0${receiptDigest}`,
    "utf8",
  );
}

function validateChangeRequest(value, current, currentTime) {
  exact(value, CHANGE_REQUEST_KEYS, "operator registry change request");
  const requestedAt = timestamp(value.requestedAt, "change requestedAt");
  const expiresAt = timestamp(value.expiresAt, "change expiresAt");
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA ||
    value.tenantId !== current.tenantId ||
    value.policyId !== current.policyId ||
    value.revision !== current.revision ||
    value.policyDigest !== current.policyDigest ||
    value.requiredApprovals !== current.requiredApprovals ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !ID.test(value.operatorId ?? "") ||
    !KEY_ID.test(value.keyId ?? "") ||
    requestedAt > currentTime + FUTURE_SKEW_MS ||
    expiresAt <= currentTime ||
    expiresAt <= requestedAt ||
    expiresAt > requestedAt + MAX_TTL_MS ||
    value.requestDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
        value,
      )
  ) {
    throw new Error("operator registry change request is not policy-bound");
  }
  if (value.operation === "register") {
    if (
      value.priorKeyId !== null ||
      value.reason !== null ||
      typeof value.publicKeySpki !== "string"
    ) {
      throw new Error("operator registration request is invalid");
    }
    decodePublicKey(value);
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
      throw new Error("operator rotation request is invalid");
    }
    decodePublicKey(value);
  } else if (
    value.priorKeyId !== null ||
    value.publicKeySpki !== null ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    throw new Error("operator revocation request is invalid");
  }
  return value;
}

export function validateGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
  value,
  current,
  currentTime = Date.now(),
) {
  const now = Number(currentTime);
  if (!Number.isFinite(now)) {
    throw new TypeError("operator registry validation clock is invalid");
  }
  return freeze(structuredClone(validateChangeRequest(value, current, now)));
}

function normalizeApproval(receipt, request, operator, currentTime) {
  exact(receipt, APPROVAL_KEYS, "operator registry approval");
  const attestation = exact(
    receipt.attestation,
    ATTESTATION_KEYS,
    "operator registry approval attestation",
  );
  const approvedAt = timestamp(receipt.approvedAt, "approval approvedAt");
  const expiresAt = timestamp(receipt.expiresAt, "approval expiresAt");
  if (
    receipt.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA ||
    receipt.tenantId !== request.tenantId ||
    receipt.operatorId !== operator.operatorId ||
    receipt.automated !== false ||
    receipt.requestDigest !== request.requestDigest ||
    receipt.policyDigest !== request.policyDigest ||
    approvedAt < Date.parse(request.requestedAt) - FUTURE_SKEW_MS ||
    approvedAt > currentTime + FUTURE_SKEW_MS ||
    approvedAt >= expiresAt ||
    expiresAt !== Date.parse(request.expiresAt) ||
    expiresAt <= currentTime ||
    receipt.receiptDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryApproval(
        receipt,
      ) ||
    attestation.algorithm !== "Ed25519" ||
    attestation.keyId !== operator.keyId ||
    typeof attestation.value !== "string"
  ) {
    throw new Error("operator registry approval is not exactly bound");
  }
  const signature = Buffer.from(attestation.value, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== attestation.value ||
    !verify(
      null,
      governedSkillSynthesisAttestorTrustOperatorRegistryApprovalMessage(
        receipt.receiptDigest,
      ),
      operator.publicKey,
      signature,
    )
  ) {
    throw new Error("operator registry approval signature is invalid");
  }
  return receipt;
}

function buildAuthorization(request, approvals) {
  const accepted = [...approvals].sort((left, right) =>
    left.operatorId.localeCompare(right.operatorId),
  );
  const core = {
    schema:
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_AUTHORIZATION_SCHEMA,
    tenantId: request.tenantId,
    requestDigest: request.requestDigest,
    policyDigest: request.policyDigest,
    requiredApprovals: request.requiredApprovals,
    operatorIds: accepted.map((approval) => approval.operatorId),
    approvalReceiptDigests: accepted.map((approval) => approval.receiptDigest),
    authorizedAt: accepted
      .map((approval) => approval.approvedAt)
      .sort()
      .at(-1),
  };
  return freeze({
    ...core,
    authorizationDigest: hash(
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_AUTHORIZATION_SCHEMA,
      core,
    ),
  });
}

function operatorMap(record) {
  return new Map(
    record.operators.map((operator) => [
      operator.operatorId,
      {
        ...operator,
        publicKey: decodePublicKey(operator),
      },
    ]),
  );
}

function applyChange(request, current, history) {
  const operators = new Map(
    current.operators.map((operator) => [operator.operatorId, operator]),
  );
  if (request.operation === "register") {
    if (
      history.operatorIds.has(request.operatorId) ||
      history.keyIds.has(request.keyId) ||
      operators.size >= MAX_OPERATORS
    ) {
      throw new Error(
        "operator registration would reuse an identity or exceed capacity",
      );
    }
    operators.set(request.operatorId, {
      operatorId: request.operatorId,
      keyId: request.keyId,
      publicKeySpki: request.publicKeySpki,
    });
  } else if (request.operation === "rotate") {
    const active = operators.get(request.operatorId);
    if (
      !active ||
      active.keyId !== request.priorKeyId ||
      history.keyIds.has(request.keyId)
    ) {
      throw new Error("operator rotation does not match the active identity");
    }
    operators.set(request.operatorId, {
      operatorId: request.operatorId,
      keyId: request.keyId,
      publicKeySpki: request.publicKeySpki,
    });
  } else {
    const active = operators.get(request.operatorId);
    if (!active || active.keyId !== request.keyId) {
      throw new Error("operator revocation does not match the active identity");
    }
    if (operators.size - 1 < current.requiredApprovals) {
      throw new Error(
        "operator revocation would reduce the active set below quorum",
      );
    }
    operators.delete(request.operatorId);
  }
  return [...operators.values()].sort((left, right) =>
    left.operatorId.localeCompare(right.operatorId),
  );
}

function validateAuthorization(value, request, approvals) {
  exact(value, AUTHORIZATION_KEYS, "operator registry authorization");
  const expected = buildAuthorization(request, approvals);
  if (canonical(value) !== canonical(expected)) {
    corrupt("operator registry authorization is not exactly bound");
  }
  return value;
}

function validateChangeRecord(value, descriptor) {
  try {
    exact(value, CHANGE_RECORD_KEYS, "operator registry change record");
  } catch {
    corrupt("operator registry change record shape is invalid");
  }
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !DIGEST.test(value.priorRecordDigest ?? "") ||
    !DIGEST.test(value.policyDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 2 ||
    !Number.isSafeInteger(value.requiredApprovals) ||
    value.requiredApprovals < 1 ||
    !Number.isSafeInteger(value.operatorCount) ||
    value.operatorCount < value.requiredApprovals ||
    value.operatorCount > MAX_OPERATORS ||
    value.effectiveAt !== value.authorization?.authorizedAt ||
    value.recordDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(value)
  ) {
    corrupt("operator registry change record binding is invalid");
  }
  dense(value.operators, "stored active operators");
  dense(value.approvals, "stored operator approvals");
  for (const operator of value.operators) {
    try {
      exact(operator, OPERATOR_KEYS, "stored active operator");
    } catch {
      corrupt("stored active operator shape is invalid");
    }
    decodePublicKey(operator);
  }
  return freeze(structuredClone(value));
}

function normalizeChangeInput(value, current, history, currentTime) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !ID.test(value.operatorId ?? "")
  ) {
    throw new TypeError("operator registry change input is invalid");
  }
  let keyId;
  let publicKeySpki;
  let priorKeyId = null;
  let reason = null;
  if (value.operation === "register" || value.operation === "rotate") {
    exact(
      value,
      value.operation === "register"
        ? new Set(["operation", "operatorId", "publicKey"])
        : new Set([
            "operation",
            "operatorId",
            "priorKeyId",
            "publicKey",
            "reason",
          ]),
      "operator registry change input",
    );
    const key = publicKeyIdentity(value.publicKey, "new operator publicKey");
    keyId = key.keyId;
    publicKeySpki = key.publicKeySpki;
    if (value.operation === "rotate") {
      priorKeyId = value.priorKeyId;
      reason = value.reason;
    }
  } else {
    exact(
      value,
      new Set(["keyId", "operation", "operatorId", "reason"]),
      "operator registry change input",
    );
    keyId = value.keyId;
    publicKeySpki = null;
    reason = value.reason;
  }
  const requestedAt = new Date(currentTime).toISOString();
  const core = {
    schema:
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_REQUEST_SCHEMA,
    tenantId: current.tenantId,
    policyId: current.policyId,
    revision: current.revision,
    policyDigest: current.policyDigest,
    requiredApprovals: current.requiredApprovals,
    operation: value.operation,
    operatorId: value.operatorId,
    keyId,
    publicKeySpki,
    priorKeyId,
    reason,
    requestedAt,
    expiresAt: new Date(currentTime + 5 * 60 * 1000).toISOString(),
  };
  const request = freeze({
    ...core,
    requestDigest:
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryChangeRequest(
        core,
      ),
  });
  validateChangeRequest(request, current, currentTime);
  applyChange(request, current, history);
  return request;
}

function changeResult(record, event, recovered) {
  return freeze({
    authorization: structuredClone(record.authorization),
    persistence: {
      authenticated: true,
      durable: true,
      recovered,
      recordDigest: record.recordDigest,
      eventSequence: event.sequence,
      ledgerEventDigest: event.eventDigest,
    },
    registry: {
      tenantId: record.tenantId,
      policyId: record.policyId,
      revision: record.revision,
      requiredApprovals: record.requiredApprovals,
      operatorCount: record.operatorCount,
      policyDigest: record.policyDigest,
      recordDigest: record.recordDigest,
      operators: record.operators.map(({ operatorId, keyId }) => ({
        operatorId,
        keyId,
      })),
    },
    rebindRequired: true,
  });
}

export function createGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer({
  tenantId: tenantIdInput,
  operatorId: operatorIdInput,
  privateKey: privateKeyInput,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const operatorId = identifier(operatorIdInput, "operatorId");
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("operator registry approval issuer clock is invalid");
  }
  let privateKey;
  try {
    privateKey = utilTypes.isKeyObject(privateKeyInput)
      ? privateKeyInput
      : createPrivateKey(privateKeyInput);
  } catch {
    throw new TypeError(
      "operator registry approval privateKey must be Ed25519",
    );
  }
  if (
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError(
      "operator registry approval privateKey must be Ed25519",
    );
  }
  const publicIdentity = publicKeyIdentity(
    createPublicKey(privateKey),
    "operator approval publicKey",
  );
  const issuer = Object.freeze({
    tenantId,
    operatorId,
    keyId: publicIdentity.keyId,
    issue(request) {
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime)) {
        throw new TypeError(
          "operator registry approval issuer clock is invalid",
        );
      }
      validateChangeRequest(
        request,
        {
          tenantId,
          policyId: request?.policyId,
          revision: request?.revision,
          policyDigest: request?.policyDigest,
          requiredApprovals: request?.requiredApprovals,
        },
        currentTime,
      );
      const core = {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_APPROVAL_SCHEMA,
        tenantId,
        operatorId,
        automated: false,
        requestDigest: request.requestDigest,
        policyDigest: request.policyDigest,
        approvedAt: new Date(currentTime).toISOString(),
        expiresAt: request.expiresAt,
      };
      const receiptDigest =
        digestGovernedSkillSynthesisAttestorTrustOperatorRegistryApproval(core);
      return freeze({
        ...core,
        receiptDigest,
        attestation: {
          algorithm: "Ed25519",
          keyId: publicIdentity.keyId,
          value: sign(
            null,
            governedSkillSynthesisAttestorTrustOperatorRegistryApprovalMessage(
              receiptDigest,
            ),
            privateKey,
          ).toString("base64url"),
        },
      });
    },
  });
  ISSUERS.add(issuer);
  return issuer;
}

export function isGovernedSkillSynthesisAttestorTrustOperatorRegistryApprovalIssuer(
  value,
) {
  return ISSUERS.has(value);
}

function parseArtifact(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("operator registry artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("operator registry artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    corrupt("operator registry durable artifact binding is invalid");
  }
  return artifact.value?.schema ===
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA
    ? validateChangeRecord(artifact.value, descriptor)
    : validateGenesisRecord(artifact.value, descriptor);
}

function sameConfiguration(record, expected) {
  return (
    canonical({
      tenantId: record.tenantId,
      policyId: record.policyId,
      revision: record.revision,
      requiredApprovals: record.requiredApprovals,
      operatorCount: record.operatorCount,
      operators: record.operators,
      policyDigest: record.policyDigest,
    }) === canonical(expected)
  );
}

function snapshot(record, recovered) {
  return freeze({
    authenticated: true,
    durable: true,
    recovered,
    recordDigest: record.recordDigest,
    policyDigest: record.policyDigest,
    policyId: record.policyId,
    revision: record.revision,
    requiredApprovals: record.requiredApprovals,
    operatorCount: record.operatorCount,
    operatorIdentities: record.operators.map((operator) => ({
      tenantId: record.tenantId,
      operatorId: operator.operatorId,
      publicKey: decodePublicKey(operator).export({
        type: "spki",
        format: "pem",
      }),
    })),
  });
}

export function createGovernedSkillSynthesisAttestorTrustOperatorRegistry({
  descriptor: input,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  now = Date.now,
} = {}) {
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_SCHEMA,
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
  const put = capture(artifactPorts, "putCanonical", "artifactPorts");
  const readLedger = capture(ledger, "read", "ledger");
  const verifyLedger = capture(ledger, "verify", "ledger");
  const appendLedger = capture(ledger, "appendDomainEvent", "ledger");
  if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
    throw new TypeError(
      "a branded EvolutionArtifactPorts ledger resolver is required",
    );
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("operator registry clock is invalid");
  }

  const resolveEvent = async (event) => {
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
      corrupt("operator registry resolved a substituted artifact");
    }
    return parseArtifact(resolution, descriptor);
  };

  const load = async () => {
    const ledgerEvents = readLedger();
    if (!Array.isArray(ledgerEvents)) {
      corrupt("EvolutionLedger returned no operator registry events");
    }
    const events = ledgerEvents
      .filter(
        (event) =>
          event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
          event.tenantId === descriptor.tenantId &&
          event.correlationId === descriptor.streamId &&
          [
            GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
            GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_EVENT,
          ].includes(event.type),
      )
      .sort((left, right) => left.sequence - right.sequence);
    if (events.length === 0) return null;
    const genesisEvents = events.filter(
      (event) =>
        event.type ===
        GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
    );
    if (genesisEvents.length !== 1 || events[0] !== genesisEvents[0]) {
      corrupt("operator registry genesis is missing or ambiguous");
    }
    let event = events[0];
    let record = await resolveEvent(event);
    if (
      record.schema !==
        GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA ||
      event.eventId !==
        GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT ||
      event.decision !== "committed" ||
      event.timestamp !== record.createdAt ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      corrupt("operator registry genesis event binding is invalid");
    }
    const history = {
      operatorIds: new Set(record.operators.map((entry) => entry.operatorId)),
      keyIds: new Set(record.operators.map((entry) => entry.keyId)),
    };
    const changes = [];
    for (const nextEvent of events.slice(1)) {
      const next = await resolveEvent(nextEvent);
      if (
        next.schema !==
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA ||
        next.priorRecordDigest !== record.recordDigest ||
        nextEvent.eventId !==
          `${GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_EVENT}.${next.request.requestDigest.slice(7)}` ||
        nextEvent.decision !== "committed" ||
        nextEvent.timestamp !== next.effectiveAt ||
        !Array.isArray(nextEvent.sourceRefs) ||
        nextEvent.sourceRefs.length !== 1 ||
        canonical(nextEvent.sourceRefs[0]) !== canonical(event.subjectRef)
      ) {
        corrupt("operator registry change event lineage is invalid");
      }
      const authorizedAt = timestamp(
        next.authorization?.authorizedAt,
        "stored authorization authorizedAt",
      );
      try {
        validateChangeRequest(next.request, record, authorizedAt);
      } catch {
        corrupt("stored operator registry request is invalid");
      }
      let approvals;
      try {
        dense(next.approvals, "stored operator approvals");
        if (next.approvals.length !== record.requiredApprovals) {
          throw new Error();
        }
        const currentOperators = operatorMap(record);
        const seenOperators = new Set();
        const seenKeys = new Set();
        approvals = next.approvals.map((approval) => {
          const operator = currentOperators.get(approval?.operatorId);
          if (
            !operator ||
            seenOperators.has(operator.operatorId) ||
            seenKeys.has(operator.keyId)
          ) {
            throw new Error();
          }
          normalizeApproval(approval, next.request, operator, authorizedAt);
          seenOperators.add(operator.operatorId);
          seenKeys.add(operator.keyId);
          return approval;
        });
        validateAuthorization(next.authorization, next.request, approvals);
      } catch {
        corrupt("stored operator registry approvals are invalid");
      }
      let expectedOperators;
      try {
        expectedOperators = applyChange(next.request, record, history);
      } catch {
        corrupt("stored operator registry transition is invalid");
      }
      const expectedRevision = record.revision + 1;
      const expectedPolicy = policyCore({
        tenantId: descriptor.tenantId,
        policyId: record.policyId,
        revision: expectedRevision,
        requiredApprovals: record.requiredApprovals,
        operators: expectedOperators,
      });
      const expectedPolicyDigest = hash(
        "chainlesschain.attestor-trust-operations-policy/v1",
        expectedPolicy,
      );
      if (
        next.policyId !== record.policyId ||
        next.revision !== expectedRevision ||
        next.requiredApprovals !== record.requiredApprovals ||
        next.operatorCount !== expectedOperators.length ||
        next.policyDigest !== expectedPolicyDigest ||
        canonical(next.operators) !== canonical(expectedOperators)
      ) {
        corrupt("operator registry transition result is invalid");
      }
      history.operatorIds.add(next.request.operatorId);
      history.keyIds.add(next.request.keyId);
      changes.push({ event: nextEvent, record: next, prior: record });
      event = nextEvent;
      record = next;
    }
    return { event, record, history, changes };
  };

  const registry = Object.freeze({
    descriptor,
    async initialize({
      operatorIdentities,
      policyId: policyIdInput,
      revision: revisionInput,
      requiredApprovals: requiredApprovalsInput,
    } = {}) {
      const policyId = identifier(policyIdInput, "policyId");
      const revision = Number(revisionInput);
      const requiredApprovals = Number(requiredApprovalsInput);
      const operators = normalizeOperators(
        operatorIdentities,
        descriptor.tenantId,
      );
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new TypeError("operator registry revision is invalid");
      }
      if (
        !Number.isSafeInteger(requiredApprovals) ||
        requiredApprovals < 1 ||
        requiredApprovals > operators.length
      ) {
        throw new TypeError("operator registry approval threshold is invalid");
      }
      const policy = policyCore({
        tenantId: descriptor.tenantId,
        policyId,
        revision,
        requiredApprovals,
        operators,
      });
      const expected = {
        ...policy,
        operatorCount: operators.length,
        operators,
        policyDigest: hash(
          "chainlesschain.attestor-trust-operations-policy/v1",
          policy,
        ),
      };
      const existing = await load();
      if (existing) {
        if (!sameConfiguration(existing.record, expected)) {
          throw new Error(
            "operator registry bootstrap differs from its durable state",
          );
        }
        return snapshot(existing.record, true);
      }
      const milliseconds = Number(now());
      if (!Number.isFinite(milliseconds)) {
        throw new TypeError("operator registry clock is invalid");
      }
      const core = {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA,
        tenantId: descriptor.tenantId,
        policyId,
        revision,
        requiredApprovals,
        operatorCount: operators.length,
        operators,
        policyDigest: expected.policyDigest,
        createdAt: new Date(milliseconds).toISOString(),
      };
      const record = freeze({
        ...core,
        recordDigest:
          digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(core),
      });
      validateGenesisRecord(record, descriptor);
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
        corrupt("operator registry genesis was not durably read back");
      }
      try {
        const receipt = appendLedger(
          {
            artifactTenantId: descriptor.artifactTenantId,
            correlationId: descriptor.streamId,
            decision: "committed",
            eventId:
              GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
            reason: `attestor trust operator registry genesis with ${operators.length} operator(s)`,
            skillName: null,
            sourceRefs: [],
            subjectRef: published.ref,
            tenantId: descriptor.tenantId,
            timestamp: record.createdAt,
            type: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
          },
          {
            expectedHeadDigest: head.headDigest,
            expectedSequence: head.sequence,
          },
        );
        if (receipt?.authenticated !== true || receipt.durable !== true) {
          corrupt("operator registry genesis append was not durable");
        }
      } catch (error) {
        const recovered = await load();
        if (!recovered || canonical(recovered.record) !== canonical(record)) {
          throw error;
        }
      }
      const stored = await load();
      if (!stored || canonical(stored.record) !== canonical(record)) {
        corrupt("operator registry genesis readback differs");
      }
      return snapshot(stored.record, false);
    },
    async snapshot() {
      const current = await load();
      if (!current) throw new Error("operator registry is not initialized");
      return snapshot(current.record, true);
    },
    async prepareChange(input) {
      const current = await load();
      if (!current) throw new Error("operator registry is not initialized");
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime)) {
        throw new TypeError("operator registry clock is invalid");
      }
      return normalizeChangeInput(
        input,
        current.record,
        current.history,
        currentTime,
      );
    },
    async executeChange({ request, approvals } = {}) {
      const loaded = await load();
      if (!loaded) throw new Error("operator registry is not initialized");
      const existing = loaded.changes.find(
        (entry) =>
          entry.record.request.requestDigest === request?.requestDigest,
      );
      if (existing) {
        const supplied = Array.isArray(approvals)
          ? [...approvals].sort((left, right) =>
              String(left?.operatorId).localeCompare(String(right?.operatorId)),
            )
          : approvals;
        if (
          canonical(existing.record.request) !== canonical(request) ||
          canonical(existing.record.approvals) !== canonical(supplied)
        ) {
          throw new Error(
            "operator registry request already has a different durable authorization",
          );
        }
        return changeResult(existing.record, existing.event, true);
      }
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime)) {
        throw new TypeError("operator registry clock is invalid");
      }
      validateChangeRequest(request, loaded.record, currentTime);
      dense(approvals, "operator registry approvals");
      if (approvals.length !== loaded.record.requiredApprovals) {
        throw new Error(
          `operator registry change requires exactly ${loaded.record.requiredApprovals} approvals`,
        );
      }
      const currentOperators = operatorMap(loaded.record);
      const seenOperators = new Set();
      const seenKeys = new Set();
      const accepted = approvals.map((approval) => {
        const operator = currentOperators.get(approval?.operatorId);
        if (
          !operator ||
          seenOperators.has(operator.operatorId) ||
          seenKeys.has(operator.keyId)
        ) {
          throw new Error(
            "operator registry approvals must be from distinct active operators",
          );
        }
        normalizeApproval(approval, request, operator, currentTime);
        seenOperators.add(operator.operatorId);
        seenKeys.add(operator.keyId);
        return approval;
      });
      accepted.sort((left, right) =>
        left.operatorId.localeCompare(right.operatorId),
      );
      const authorization = buildAuthorization(request, accepted);
      const operators = applyChange(request, loaded.record, loaded.history);
      const revision = loaded.record.revision + 1;
      const policy = policyCore({
        tenantId: descriptor.tenantId,
        policyId: loaded.record.policyId,
        revision,
        requiredApprovals: loaded.record.requiredApprovals,
        operators,
      });
      const core = {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_RECORD_SCHEMA,
        tenantId: descriptor.tenantId,
        request: structuredClone(request),
        approvals: structuredClone(accepted),
        authorization: structuredClone(authorization),
        priorRecordDigest: loaded.record.recordDigest,
        policyId: loaded.record.policyId,
        revision,
        requiredApprovals: loaded.record.requiredApprovals,
        operatorCount: operators.length,
        operators,
        policyDigest: hash(
          "chainlesschain.attestor-trust-operations-policy/v1",
          policy,
        ),
        effectiveAt: authorization.authorizedAt,
      };
      const record = freeze({
        ...core,
        recordDigest:
          digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(core),
      });
      validateChangeRecord(record, descriptor);
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
        corrupt("operator registry change was not durably read back");
      }
      const eventId = `${GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_EVENT}.${request.requestDigest.slice(7)}`;
      let appendRecovered = false;
      try {
        const receipt = appendLedger(
          {
            artifactTenantId: descriptor.artifactTenantId,
            correlationId: descriptor.streamId,
            decision: "committed",
            eventId,
            reason: `attestor trust operator ${request.operation} authorized by ${accepted.length} operator(s)`,
            skillName: null,
            sourceRefs: [loaded.event.subjectRef],
            subjectRef: published.ref,
            tenantId: descriptor.tenantId,
            timestamp: authorization.authorizedAt,
            type: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CHANGE_EVENT,
          },
          {
            expectedHeadDigest: head.headDigest,
            expectedSequence: head.sequence,
          },
        );
        if (receipt?.authenticated !== true || receipt.durable !== true) {
          corrupt("operator registry change append was not durable");
        }
      } catch (error) {
        const recovered = await load();
        const match = recovered?.changes.find(
          (entry) =>
            entry.record.request.requestDigest === request.requestDigest,
        );
        if (!match || canonical(match.record) !== canonical(record))
          throw error;
        appendRecovered = true;
      }
      const stored = await load();
      const committed = stored?.changes.find(
        (entry) => entry.record.request.requestDigest === request.requestDigest,
      );
      if (!committed || canonical(committed.record) !== canonical(record)) {
        corrupt("operator registry change readback differs");
      }
      return changeResult(committed.record, committed.event, appendRecovered);
    },
  });
  REGISTRIES.add(registry);
  return registry;
}

export function isGovernedSkillSynthesisAttestorTrustOperatorRegistry(value) {
  return REGISTRIES.has(value);
}
