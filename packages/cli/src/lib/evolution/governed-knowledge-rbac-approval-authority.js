import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { types as utilTypes } from "node:util";

import { getUserPermissions } from "../permission-engine.js";

export const GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA =
  "chainlesschain.governed-knowledge-approval-receipt/v1";
export const GOVERNED_KNOWLEDGE_AUTHORIZATION_DECISION_SCHEMA =
  "chainlesschain.governed-knowledge-authorization-decision/v1";

const RBAC_ADAPTERS = new WeakSet();
const APPROVAL_ISSUERS = new WeakSet();
const AUTHORITIES = new WeakSet();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RECEIPT_KEYS = new Set([
  "schema",
  "tenantId",
  "reviewerId",
  "automated",
  "knowledgeId",
  "scope",
  "scopeId",
  "action",
  "contentDigest",
  "approvedAt",
  "expiresAt",
  "receiptDigest",
  "attestation",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);
const MAX_RECEIPT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

function keyObject(value, kind, label) {
  let key;
  try {
    if (
      value &&
      typeof value === "object" &&
      !utilTypes.isProxy(value) &&
      value.type === kind
    ) {
      key = value;
    } else {
      key =
        kind === "private" ? createPrivateKey(value) : createPublicKey(value);
    }
  } catch {
    throw new TypeError(`${label} is not a valid ${kind} key`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be Ed25519`);
  }
  return key;
}

function publicKeyId(key) {
  const spki = key.export({ format: "der", type: "spki" });
  return `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`;
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

function receiptCore(value) {
  const core = structuredClone(value);
  delete core.receiptDigest;
  delete core.attestation;
  return core;
}

export function digestGovernedKnowledgeApprovalReceipt(value) {
  return hash(GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA, receiptCore(value));
}

function signatureMessage(receiptDigest) {
  if (!DIGEST.test(receiptDigest ?? "")) {
    throw new TypeError("approval receiptDigest is invalid");
  }
  return Buffer.from(
    `chainlesschain.governed-knowledge-approval-signature/v1\0${receiptDigest}`,
    "utf8",
  );
}

function receiptCoreFromInput(input, tenantId, reviewerId, now) {
  const approvedAt = Date.parse(input?.approvedAt);
  const expiresAt = Date.parse(input?.expiresAt);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.tenantId !== tenantId ||
    input.reviewerId !== reviewerId ||
    input.automated !== false ||
    !identifier(input.knowledgeId, "knowledgeId") ||
    !["team", "org"].includes(input.scope) ||
    !identifier(input.scopeId, "scopeId") ||
    !["upsert", "tombstone", "revoke"].includes(input.action) ||
    !DIGEST.test(input.contentDigest ?? "") ||
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > now + MAX_FUTURE_SKEW_MS ||
    approvedAt < now - MAX_RECEIPT_AGE_MS ||
    expiresAt <= now ||
    expiresAt > approvedAt + MAX_RECEIPT_AGE_MS
  ) {
    throw new Error("governed knowledge approval input is invalid");
  }
  return Object.freeze({
    schema: GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA,
    tenantId,
    reviewerId,
    automated: false,
    knowledgeId: input.knowledgeId,
    scope: input.scope,
    scopeId: input.scopeId,
    action: input.action,
    contentDigest: input.contentDigest,
    approvedAt: new Date(approvedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

export function createGovernedKnowledgeEd25519ApprovalIssuer({
  tenantId: tenantIdInput,
  reviewerId: reviewerIdInput,
  privateKey: privateKeyInput,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const reviewerId = identifier(reviewerIdInput, "reviewerId");
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const privateKey = keyObject(privateKeyInput, "private", "privateKey");
  const keyId = publicKeyId(createPublicKey(privateKey));
  const issuer = Object.freeze({
    tenantId,
    reviewerId,
    keyId,
    issue(input) {
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime))
        throw new TypeError("issuer clock is invalid");
      const core = receiptCoreFromInput(
        input,
        tenantId,
        reviewerId,
        currentTime,
      );
      const receiptDigest = digestGovernedKnowledgeApprovalReceipt(core);
      return Object.freeze({
        ...core,
        receiptDigest,
        attestation: Object.freeze({
          algorithm: "Ed25519",
          keyId,
          value: sign(
            null,
            signatureMessage(receiptDigest),
            privateKey,
          ).toString("base64url"),
        }),
      });
    },
  });
  APPROVAL_ISSUERS.add(issuer);
  return issuer;
}

export function isGovernedKnowledgeApprovalIssuer(value) {
  return APPROVAL_ISSUERS.has(value);
}

export function permissionForGovernedKnowledge({
  scope,
  scopeId,
  operation,
  action,
} = {}) {
  if (!["project", "team", "org"].includes(scope)) {
    throw new TypeError("knowledge permission scope is invalid");
  }
  identifier(scopeId, "scopeId");
  if (!["publish", "receive"].includes(operation)) {
    throw new TypeError("knowledge permission operation is invalid");
  }
  if (!["upsert", "tombstone", "revoke"].includes(action)) {
    throw new TypeError("knowledge permission action is invalid");
  }
  const encodedScopeId = Buffer.from(scopeId, "utf8").toString("base64url");
  return `knowledge:${scope}:${encodedScopeId}:${operation}:${action}`;
}

function permissionAllowed(effectivePermissions, permission) {
  if (
    effectivePermissions.includes("*") ||
    effectivePermissions.includes(permission)
  ) {
    return true;
  }
  const segments = permission.split(":");
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    if (
      effectivePermissions.includes(`${segments.slice(0, length).join(":")}:*`)
    ) {
      return true;
    }
  }
  return false;
}

export function createPermissionEngineGovernedKnowledgeRbac({
  db,
  tenantId: tenantIdInput,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  if (!db || typeof db !== "object" || utilTypes.isProxy(db)) {
    throw new TypeError("permission database is required");
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const adapter = Object.freeze({
    tenantId,
    check({ principalId, permission } = {}) {
      identifier(principalId, "principalId");
      if (typeof permission !== "string" || permission.length > 1024) {
        throw new TypeError("permission is invalid");
      }
      const nowMs = Number(now());
      if (!Number.isFinite(nowMs)) throw new TypeError("RBAC clock is invalid");
      const permissions = getUserPermissions(db, principalId, { nowMs });
      const effectivePermissions = [...permissions.effectivePermissions].sort();
      return Object.freeze({
        authenticated: true,
        tenantId,
        principalId,
        permission,
        allowed: permissionAllowed(effectivePermissions, permission),
        policyDigest: hash("chainlesschain.permission-engine-policy/v1", {
          tenantId,
          principalId,
          permission,
          effectivePermissions,
        }),
      });
    },
  });
  RBAC_ADAPTERS.add(adapter);
  return adapter;
}

function normalizeReviewers(reviewers, tenantId) {
  if (
    !Array.isArray(reviewers) ||
    reviewers.length < 1 ||
    reviewers.length > 256
  ) {
    throw new TypeError("reviewerIdentities must contain 1..256 reviewers");
  }
  const result = new Map();
  const keyIds = new Set();
  for (const input of reviewers) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("reviewer identity is invalid");
    }
    if (input.tenantId !== tenantId) {
      throw new Error("reviewer identity crossed its tenant boundary");
    }
    const reviewerId = identifier(input.reviewerId, "reviewerId");
    const publicKey = keyObject(
      input.publicKey,
      "public",
      "reviewer publicKey",
    );
    const keyId = publicKeyId(publicKey);
    if (input.keyId !== undefined && input.keyId !== keyId) {
      throw new Error("reviewer keyId does not bind its Ed25519 public key");
    }
    if (result.has(reviewerId) || keyIds.has(keyId)) {
      throw new Error("reviewer identity or Ed25519 key is duplicated");
    }
    keyIds.add(keyId);
    result.set(reviewerId, { publicKey, keyId });
  }
  return result;
}

function validateApproval(receipt, knowledge, tenantId, reviewers, now) {
  exact(receipt, RECEIPT_KEYS, "knowledge approval receipt");
  const attestation = exact(
    receipt.attestation,
    ATTESTATION_KEYS,
    "knowledge approval attestation",
  );
  const reviewer = reviewers.get(receipt.reviewerId);
  const approvedAt = Date.parse(receipt.approvedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (
    receipt.schema !== GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA ||
    receipt.tenantId !== tenantId ||
    receipt.automated !== false ||
    receipt.knowledgeId !== knowledge.knowledgeId ||
    receipt.scope !== knowledge.scope ||
    receipt.scopeId !== knowledge.scopeId ||
    receipt.action !== knowledge.action ||
    receipt.contentDigest !== knowledge.contentDigest ||
    !reviewer ||
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(approvedAt).toISOString() !== receipt.approvedAt ||
    new Date(expiresAt).toISOString() !== receipt.expiresAt ||
    approvedAt > now + MAX_FUTURE_SKEW_MS ||
    approvedAt < now - MAX_RECEIPT_AGE_MS ||
    expiresAt <= now ||
    expiresAt > approvedAt + MAX_RECEIPT_AGE_MS ||
    receipt.receiptDigest !== digestGovernedKnowledgeApprovalReceipt(receipt) ||
    receipt.receiptDigest !== knowledge.approvalReceiptDigest ||
    attestation.algorithm !== "Ed25519" ||
    attestation.keyId !== reviewer.keyId ||
    typeof attestation.value !== "string"
  ) {
    throw new Error("knowledge approval receipt is not exactly bound");
  }
  const signature = Buffer.from(attestation.value, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== attestation.value ||
    !verify(
      null,
      signatureMessage(receipt.receiptDigest),
      reviewer.publicKey,
      signature,
    )
  ) {
    throw new Error("knowledge approval receipt signature is invalid");
  }
  return receipt;
}

export function createGovernedKnowledgeRbacApprovalAuthority({
  tenantId: tenantIdInput,
  principalId: principalIdInput,
  rbac,
  approvalReader,
  reviewerIdentities,
  now = Date.now,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const principalId = identifier(principalIdInput, "principalId");
  if (!RBAC_ADAPTERS.has(rbac) || rbac.tenantId !== tenantId) {
    throw new TypeError(
      "a same-tenant Permission Engine RBAC adapter is required",
    );
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const check = capture(rbac, "check", "rbac");
  const readApproval = capture(approvalReader, "read", "approvalReader");
  const reviewers = normalizeReviewers(reviewerIdentities, tenantId);
  const authority = Object.freeze({
    tenantId,
    principalId,
    async authorize({ operation, knowledge } = {}) {
      if (
        !knowledge ||
        typeof knowledge !== "object" ||
        Array.isArray(knowledge) ||
        utilTypes.isProxy(knowledge) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(knowledge)) ||
        knowledge.tenantId !== tenantId
      ) {
        throw new Error("knowledge authorization crossed its tenant boundary");
      }
      const permission = permissionForGovernedKnowledge({
        scope: knowledge.scope,
        scopeId: knowledge.scopeId,
        operation,
        action: knowledge.action,
      });
      const decision = await check({ principalId, permission });
      if (
        decision?.authenticated !== true ||
        decision.allowed !== true ||
        decision.tenantId !== tenantId ||
        decision.principalId !== principalId ||
        decision.permission !== permission ||
        !DIGEST.test(decision.policyDigest ?? "")
      ) {
        throw new Error("Permission Engine denied governed knowledge access");
      }
      let approvalReceiptDigest = null;
      if (["team", "org"].includes(knowledge.scope)) {
        if (!DIGEST.test(knowledge.approvalReceiptDigest ?? "")) {
          throw new Error("team or org knowledge requires human approval");
        }
        const receipt = await readApproval({
          tenantId,
          receiptDigest: knowledge.approvalReceiptDigest,
        });
        const currentTime = Number(now());
        if (!Number.isFinite(currentTime)) {
          throw new TypeError("authorization authority clock is invalid");
        }
        validateApproval(receipt, knowledge, tenantId, reviewers, currentTime);
        approvalReceiptDigest = receipt.receiptDigest;
      }
      const authorizedAtMs = Number(now());
      if (!Number.isFinite(authorizedAtMs)) {
        throw new TypeError("authorization authority clock is invalid");
      }
      const core = {
        schema: GOVERNED_KNOWLEDGE_AUTHORIZATION_DECISION_SCHEMA,
        tenantId,
        principalId,
        operation,
        knowledgeId: knowledge.knowledgeId,
        scope: knowledge.scope,
        scopeId: knowledge.scopeId,
        action: knowledge.action,
        contentDigest: knowledge.contentDigest,
        policyDigest: decision.policyDigest,
        approvalReceiptDigest,
        authorizedAt: new Date(authorizedAtMs).toISOString(),
      };
      return Object.freeze({
        authenticated: true,
        allowed: true,
        tenantId,
        knowledgeId: knowledge.knowledgeId,
        scope: knowledge.scope,
        scopeId: knowledge.scopeId,
        receiptDigest: hash(
          GOVERNED_KNOWLEDGE_AUTHORIZATION_DECISION_SCHEMA,
          core,
        ),
      });
    },
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function isGovernedKnowledgeRbacApprovalAuthority(value) {
  return AUTHORITIES.has(value);
}
