import { createHash, createPublicKey, verify } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA,
  createGovernedKnowledgeReviewerRegistry,
  digestGovernedKnowledgeApprovalReceipt,
  governedKnowledgeApprovalSignatureMessage,
} from "./governed-knowledge-rbac-approval-authority.js";

export const GOVERNED_KNOWLEDGE_TRUST_LEDGER_RECORD_SCHEMA =
  "chainlesschain.governed-knowledge-trust-ledger-record/v1";
export const GOVERNED_KNOWLEDGE_REVIEWER_REGISTERED_EVENT_TYPE =
  "knowledge.trust.reviewer.registered";
export const GOVERNED_KNOWLEDGE_REVIEWER_REVOKED_EVENT_TYPE =
  "knowledge.trust.reviewer.revoked";
export const GOVERNED_KNOWLEDGE_APPROVAL_COMMITTED_EVENT_TYPE =
  "knowledge.trust.approval.committed";
export const GOVERNED_KNOWLEDGE_TRUST_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_TRUST_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "governed-knowledge-trust-record";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const RECORD_KEYS = new Set([
  "schema",
  "tenantId",
  "kind",
  "reviewerId",
  "keyId",
  "publicKeySpki",
  "status",
  "reason",
  "receipt",
  "receiptDigest",
  "effectiveAt",
  "committedAt",
  "recordDigest",
]);
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

function corrupt(message) {
  const error = new Error(message);
  error.code = GOVERNED_KNOWLEDGE_TRUST_LEDGER_CORRUPT_CODE;
  throw error;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.has(key),
    )
  ) {
    corrupt(`${label} is invalid`);
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

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
}

function recordCore(value) {
  const core = clone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedKnowledgeTrustLedgerRecord(value) {
  return hash(GOVERNED_KNOWLEDGE_TRUST_LEDGER_RECORD_SCHEMA, recordCore(value));
}

function decodePublicKey(publicKeySpki, keyId) {
  if (typeof publicKeySpki !== "string")
    corrupt("reviewer public key is invalid");
  const bytes = Buffer.from(publicKeySpki, "base64url");
  if (bytes.toString("base64url") !== publicKeySpki) {
    corrupt("reviewer public key is not canonical base64url");
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    corrupt("reviewer public key SPKI is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    corrupt("reviewer public key is not Ed25519");
  }
  const expectedKeyId = `key:ed25519:${createHash("sha256")
    .update(bytes)
    .digest("hex")}`;
  if (keyId !== expectedKeyId) corrupt("reviewer keyId does not bind its SPKI");
  return publicKey;
}

function validateRecord(value, descriptor) {
  exact(value, RECORD_KEYS, "knowledge trust ledger record");
  if (
    value.schema !== GOVERNED_KNOWLEDGE_TRUST_LEDGER_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !["reviewer", "approval"].includes(value.kind) ||
    value.recordDigest !== digestGovernedKnowledgeTrustLedgerRecord(value)
  ) {
    corrupt("knowledge trust record binding is invalid");
  }
  if (value.kind === "reviewer") {
    if (
      !ID.test(value.reviewerId ?? "") ||
      !ID.test(value.keyId ?? "") ||
      !["active", "revoked"].includes(value.status) ||
      value.receipt !== null ||
      value.receiptDigest !== null ||
      value.committedAt !== null ||
      !Number.isFinite(Date.parse(value.effectiveAt)) ||
      new Date(Date.parse(value.effectiveAt)).toISOString() !==
        value.effectiveAt ||
      (value.status === "active"
        ? value.reason !== null
        : typeof value.reason !== "string" ||
          value.reason.trim() !== value.reason ||
          value.reason.length < 1 ||
          value.reason.length > 2048)
    ) {
      corrupt("reviewer trust record is invalid");
    }
    decodePublicKey(value.publicKeySpki, value.keyId);
  } else {
    if (
      value.reviewerId !== null ||
      value.keyId !== null ||
      value.publicKeySpki !== null ||
      value.status !== null ||
      value.reason !== null ||
      value.effectiveAt !== null ||
      !DIGEST.test(value.receiptDigest ?? "") ||
      !Number.isFinite(Date.parse(value.committedAt)) ||
      new Date(Date.parse(value.committedAt)).toISOString() !==
        value.committedAt
    ) {
      corrupt("approval trust record is invalid");
    }
    exact(value.receipt, RECEIPT_KEYS, "stored knowledge approval receipt");
    exact(
      value.receipt.attestation,
      ATTESTATION_KEYS,
      "stored knowledge approval attestation",
    );
    if (
      value.receiptDigest !== value.receipt.receiptDigest ||
      value.receiptDigest !==
        digestGovernedKnowledgeApprovalReceipt(value.receipt)
    ) {
      corrupt("approval trust record digest is invalid");
    }
  }
  return freeze(clone(value));
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
    corrupt("knowledge trust artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("knowledge trust artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    corrupt("knowledge trust durable artifact binding is invalid");
  }
  return validateRecord(artifact.value, descriptor);
}

export class GovernedKnowledgeTrustLedger {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._readLedger = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events(types = null) {
    const events = this._readLedger();
    if (!Array.isArray(events)) corrupt("EvolutionLedger returned no events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId &&
        (types === null || types.has(event.type)),
    );
  }

  async _resolveEvent(event) {
    const identity = this._verifyLedger();
    const resolution = await this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      corrupt("knowledge trust ledger resolved a substituted artifact");
    }
    const record = parseArtifact(resolution, this.descriptor);
    const expectedType =
      record.kind === "approval"
        ? GOVERNED_KNOWLEDGE_APPROVAL_COMMITTED_EVENT_TYPE
        : record.status === "active"
          ? GOVERNED_KNOWLEDGE_REVIEWER_REGISTERED_EVENT_TYPE
          : GOVERNED_KNOWLEDGE_REVIEWER_REVOKED_EVENT_TYPE;
    const expectedEventId =
      record.kind === "approval"
        ? `${expectedType}.${record.receiptDigest.slice(7)}`
        : `${expectedType}.${record.keyId.slice("key:ed25519:".length)}`;
    const expectedTimestamp =
      record.kind === "approval" ? record.committedAt : record.effectiveAt;
    if (
      event.type !== expectedType ||
      event.eventId !== expectedEventId ||
      event.timestamp !== expectedTimestamp ||
      event.decision !== "committed"
    ) {
      corrupt("knowledge trust event binding is invalid");
    }
    return record;
  }

  async _entry(eventId) {
    const matches = this._events().filter((event) => event.eventId === eventId);
    if (matches.length > 1) corrupt("knowledge trust event is ambiguous");
    return matches.length === 0
      ? null
      : { event: matches[0], record: await this._resolveEvent(matches[0]) };
  }

  async _appendRecord(record, { eventId, type, reason, timestamp }) {
    const existing = await this._entry(eventId);
    if (existing) {
      if (canonical(existing.record) !== canonical(record)) {
        corrupt("knowledge trust event identity resolved different content");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
      });
    }
    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      corrupt("knowledge trust artifact was not durably read back");
    }
    let receipt;
    try {
      receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason,
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp,
          type,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
    } catch (error) {
      const recovered = await this._entry(eventId);
      if (!recovered || canonical(recovered.record) !== canonical(record)) {
        throw error;
      }
      receipt = { authenticated: true, durable: true, recovered: true };
    }
    if (receipt?.authenticated !== true || receipt.durable !== true) {
      corrupt("knowledge trust ledger append was not durably confirmed");
    }
    const stored = await this._entry(eventId);
    if (!stored || canonical(stored.record) !== canonical(record)) {
      corrupt("knowledge trust ledger readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: receipt.recovered === true,
    });
  }

  async _reviewerStates() {
    const types = new Set([
      GOVERNED_KNOWLEDGE_REVIEWER_REGISTERED_EVENT_TYPE,
      GOVERNED_KNOWLEDGE_REVIEWER_REVOKED_EVENT_TYPE,
    ]);
    const states = new Map();
    for (const event of this._events(types)) {
      const record = await this._resolveEvent(event);
      const current = states.get(record.reviewerId) ?? null;
      if (record.status === "active") {
        if (current?.status === "active") {
          corrupt("reviewer has multiple active keys");
        }
      } else if (
        current?.status !== "active" ||
        current.keyId !== record.keyId ||
        current.publicKeySpki !== record.publicKeySpki
      ) {
        corrupt("reviewer revocation has no matching active key");
      }
      states.set(record.reviewerId, record);
    }
    return states;
  }

  async registerReviewer({ reviewerId, publicKey } = {}) {
    const normalizedReviewerId = identifier(reviewerId, "reviewerId");
    let key;
    try {
      key = createPublicKey(publicKey);
    } catch {
      key = publicKey;
    }
    if (!key || key.asymmetricKeyType !== "ed25519") {
      throw new TypeError("reviewer publicKey must be Ed25519");
    }
    const spki = key.export({ format: "der", type: "spki" });
    const publicKeySpki = spki.toString("base64url");
    const keyId = `key:ed25519:${createHash("sha256").update(spki).digest("hex")}`;
    const states = await this._reviewerStates();
    const current = states.get(normalizedReviewerId);
    if (current?.status === "active" && current.keyId !== keyId) {
      throw new Error("active reviewer key must be revoked before rotation");
    }
    if (current?.status === "revoked" && current.keyId === keyId) {
      throw new Error("a revoked reviewer key cannot be reactivated");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_REVIEWER_REGISTERED_EVENT_TYPE}.${keyId.slice("key:ed25519:".length)}`;
    const existing = await this._entry(eventId);
    if (existing) {
      if (
        existing.record.reviewerId !== normalizedReviewerId ||
        existing.record.keyId !== keyId ||
        existing.record.status !== "active"
      ) {
        corrupt("reviewer registration event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        reviewerId: normalizedReviewerId,
        keyId,
      });
    }
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds))
      throw new TypeError("trust ledger clock is invalid");
    const effectiveAt = new Date(milliseconds).toISOString();
    const core = {
      schema: GOVERNED_KNOWLEDGE_TRUST_LEDGER_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      kind: "reviewer",
      reviewerId: normalizedReviewerId,
      keyId,
      publicKeySpki,
      status: "active",
      reason: null,
      receipt: null,
      receiptDigest: null,
      effectiveAt,
      committedAt: null,
    };
    const record = freeze({
      ...core,
      recordDigest: digestGovernedKnowledgeTrustLedgerRecord(core),
    });
    validateRecord(record, this.descriptor);
    const result = await this._appendRecord(record, {
      eventId,
      type: GOVERNED_KNOWLEDGE_REVIEWER_REGISTERED_EVENT_TYPE,
      reason: "governed knowledge reviewer registered",
      timestamp: effectiveAt,
    });
    return Object.freeze({
      ...result,
      reviewerId: normalizedReviewerId,
      keyId,
    });
  }

  async revokeReviewer({ reviewerId, keyId, reason } = {}) {
    const normalizedReviewerId = identifier(reviewerId, "reviewerId");
    const normalizedKeyId = identifier(keyId, "keyId");
    if (
      typeof reason !== "string" ||
      reason.trim() !== reason ||
      !reason ||
      reason.length > 2048
    ) {
      throw new TypeError("reviewer revocation reason is invalid");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_REVIEWER_REVOKED_EVENT_TYPE}.${normalizedKeyId.slice("key:ed25519:".length)}`;
    const existing = await this._entry(eventId);
    if (existing) {
      if (
        existing.record.reviewerId !== normalizedReviewerId ||
        existing.record.keyId !== normalizedKeyId ||
        existing.record.status !== "revoked" ||
        existing.record.reason !== reason
      ) {
        corrupt("reviewer revocation event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        reviewerId: normalizedReviewerId,
        keyId: normalizedKeyId,
      });
    }
    const states = await this._reviewerStates();
    const current = states.get(normalizedReviewerId);
    if (current?.status !== "active" || current.keyId !== normalizedKeyId) {
      throw new Error("reviewer key is not currently active");
    }
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds))
      throw new TypeError("trust ledger clock is invalid");
    const effectiveAt = new Date(milliseconds).toISOString();
    const core = {
      ...recordCore(current),
      status: "revoked",
      reason,
      effectiveAt,
    };
    const record = freeze({
      ...core,
      recordDigest: digestGovernedKnowledgeTrustLedgerRecord(core),
    });
    validateRecord(record, this.descriptor);
    const result = await this._appendRecord(record, {
      eventId,
      type: GOVERNED_KNOWLEDGE_REVIEWER_REVOKED_EVENT_TYPE,
      reason,
      timestamp: effectiveAt,
    });
    return Object.freeze({
      ...result,
      reviewerId: normalizedReviewerId,
      keyId: normalizedKeyId,
    });
  }

  async commitApproval(receiptInput) {
    const receipt = exact(
      receiptInput,
      RECEIPT_KEYS,
      "knowledge approval receipt",
    );
    const attestation = exact(
      receipt.attestation,
      ATTESTATION_KEYS,
      "knowledge approval attestation",
    );
    if (
      receipt.schema !== GOVERNED_KNOWLEDGE_APPROVAL_RECEIPT_SCHEMA ||
      receipt.tenantId !== this.descriptor.tenantId ||
      receipt.receiptDigest !==
        digestGovernedKnowledgeApprovalReceipt(receipt) ||
      attestation.algorithm !== "Ed25519"
    ) {
      throw new Error("knowledge approval receipt is invalid");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_APPROVAL_COMMITTED_EVENT_TYPE}.${receipt.receiptDigest.slice(7)}`;
    const existing = await this._entry(eventId);
    if (existing) {
      if (canonical(existing.record.receipt) !== canonical(receipt)) {
        corrupt("approval commit event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        receiptDigest: receipt.receiptDigest,
      });
    }
    const registry = this.reviewerRegistry();
    const reviewer = await registry.resolve({
      tenantId: this.descriptor.tenantId,
      reviewerId: receipt.reviewerId,
      keyId: attestation.keyId,
    });
    const signature = Buffer.from(attestation.value ?? "", "base64url");
    if (
      !reviewer ||
      signature.length !== 64 ||
      signature.toString("base64url") !== attestation.value ||
      !verify(
        null,
        governedKnowledgeApprovalSignatureMessage(receipt.receiptDigest),
        reviewer.publicKey,
        signature,
      )
    ) {
      throw new Error("knowledge approval signer is not currently trusted");
    }
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds))
      throw new TypeError("trust ledger clock is invalid");
    const committedAt = new Date(milliseconds).toISOString();
    const core = {
      schema: GOVERNED_KNOWLEDGE_TRUST_LEDGER_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      kind: "approval",
      reviewerId: null,
      keyId: null,
      publicKeySpki: null,
      status: null,
      reason: null,
      receipt: clone(receipt),
      receiptDigest: receipt.receiptDigest,
      effectiveAt: null,
      committedAt,
    };
    const record = freeze({
      ...core,
      recordDigest: digestGovernedKnowledgeTrustLedgerRecord(core),
    });
    validateRecord(record, this.descriptor);
    const result = await this._appendRecord(record, {
      eventId,
      type: GOVERNED_KNOWLEDGE_APPROVAL_COMMITTED_EVENT_TYPE,
      reason: "governed knowledge approval committed",
      timestamp: committedAt,
    });
    return Object.freeze({ ...result, receiptDigest: receipt.receiptDigest });
  }

  read = async ({ tenantId, receiptDigest } = {}) => {
    if (
      tenantId !== this.descriptor.tenantId ||
      !DIGEST.test(receiptDigest ?? "")
    ) {
      throw new TypeError("approval lookup boundary is invalid");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_APPROVAL_COMMITTED_EVENT_TYPE}.${receiptDigest.slice(7)}`;
    const entry = await this._entry(eventId);
    return entry?.record.receipt ?? null;
  };

  reviewerRegistry() {
    return createGovernedKnowledgeReviewerRegistry({
      tenantId: this.descriptor.tenantId,
      resolve: async ({ reviewerId, keyId }) => {
        const states = await this._reviewerStates();
        const current = states.get(reviewerId);
        if (current?.status !== "active" || current.keyId !== keyId)
          return null;
        return {
          tenantId: this.descriptor.tenantId,
          reviewerId,
          keyId,
          publicKey: decodePublicKey(current.publicKeySpki, current.keyId),
          status: "active",
        };
      },
    });
  }

  approvalReader() {
    return Object.freeze({ read: this.read });
  }
}
