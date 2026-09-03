import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { isGovernedKnowledgeConflictReader } from "./governed-knowledge-sync-ledger-adapter.js";
import { verifyGovernedKnowledgeRecord } from "./governed-knowledge-sync.js";

export const GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA =
  "chainlesschain.governed-knowledge-human-merge-receipt/v1";
export const GOVERNED_KNOWLEDGE_MERGE_PLAN_SCHEMA =
  "chainlesschain.governed-knowledge-merge-plan/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_REASON_LENGTH = 2048;
const MAX_RECEIPT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MERGE_PLANS = new WeakSet();
const RECEIPT_KEYS = new Set([
  "attestation",
  "automated",
  "conflictEnvelopeDigest",
  "decidedAt",
  "knowledgeId",
  "localContentDigest",
  "mergedContentDigest",
  "mergedVectorClock",
  "reason",
  "receiptDigest",
  "remoteContentDigest",
  "reviewerId",
  "schema",
  "tenantId",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);
const PLAN_KEYS = new Set([
  "conflictEnvelopeDigest",
  "decidedAt",
  "deviceId",
  "humanReceiptDigest",
  "knowledgeId",
  "localContentDigest",
  "mergedKnowledge",
  "planDigest",
  "remoteContentDigest",
  "requestedBy",
  "schema",
  "scope",
  "scopeId",
  "tenantId",
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

function receiptCore(receipt) {
  const core = clone(receipt);
  delete core.receiptDigest;
  delete core.attestation;
  return core;
}

export function digestGovernedKnowledgeHumanMergeReceipt(receipt) {
  return hash(
    GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA,
    receiptCore(receipt),
  );
}

export function verifyGovernedKnowledgeMergePlan(input) {
  const plan = exact(input, PLAN_KEYS, "governed knowledge merge plan");
  const merged = verifyGovernedKnowledgeRecord(plan.mergedKnowledge, {
    tenantId: plan.tenantId,
  });
  const core = clone(plan);
  delete core.planDigest;
  if (
    plan.schema !== GOVERNED_KNOWLEDGE_MERGE_PLAN_SCHEMA ||
    !identifier(plan.tenantId, "tenantId") ||
    !identifier(plan.deviceId, "deviceId") ||
    !identifier(plan.knowledgeId, "knowledgeId") ||
    !identifier(plan.scopeId, "scopeId") ||
    !identifier(plan.requestedBy, "requestedBy") ||
    plan.knowledgeId !== merged.knowledgeId ||
    plan.scope !== merged.scope ||
    plan.scopeId !== merged.scopeId ||
    !DIGEST.test(plan.conflictEnvelopeDigest ?? "") ||
    !DIGEST.test(plan.localContentDigest ?? "") ||
    !DIGEST.test(plan.remoteContentDigest ?? "") ||
    !DIGEST.test(plan.humanReceiptDigest ?? "") ||
    !DIGEST.test(plan.planDigest ?? "") ||
    !Number.isFinite(Date.parse(plan.decidedAt)) ||
    plan.planDigest !== hash(GOVERNED_KNOWLEDGE_MERGE_PLAN_SCHEMA, core)
  ) {
    throw new Error("governed knowledge merge plan is invalid");
  }
  return freeze(clone(plan));
}

export function isGovernedKnowledgeMergePlan(value) {
  return MERGE_PLANS.has(value);
}

function normalizeReceipt(input, context, now) {
  const receipt = exact(input, RECEIPT_KEYS, "human merge receipt");
  const attestation = exact(
    receipt.attestation,
    ATTESTATION_KEYS,
    "human merge attestation",
  );
  const decidedAt = Date.parse(receipt.decidedAt);
  if (
    receipt.schema !== GOVERNED_KNOWLEDGE_HUMAN_MERGE_RECEIPT_SCHEMA ||
    receipt.tenantId !== context.tenantId ||
    receipt.automated !== false ||
    receipt.knowledgeId !== context.knowledgeId ||
    receipt.conflictEnvelopeDigest !== context.conflictEnvelopeDigest ||
    receipt.localContentDigest !== context.localContentDigest ||
    receipt.remoteContentDigest !== context.remoteContentDigest ||
    receipt.mergedContentDigest !== context.mergedContentDigest ||
    canonical(receipt.mergedVectorClock) !==
      canonical(context.mergedVectorClock) ||
    !identifier(receipt.reviewerId, "reviewerId") ||
    typeof receipt.reason !== "string" ||
    receipt.reason.trim() !== receipt.reason ||
    receipt.reason.length < 1 ||
    receipt.reason.length > MAX_REASON_LENGTH ||
    !Number.isFinite(decidedAt) ||
    decidedAt < now - MAX_RECEIPT_AGE_MS ||
    decidedAt > now + MAX_FUTURE_SKEW_MS ||
    !DIGEST.test(receipt.receiptDigest ?? "") ||
    receipt.receiptDigest !== digestGovernedKnowledgeHumanMergeReceipt(receipt)
  ) {
    throw new Error("human merge receipt is not exactly bound");
  }
  for (const [key, value] of Object.entries(attestation)) {
    if (
      typeof value !== "string" ||
      value.trim() !== value ||
      value.length < 1 ||
      value.length > (key === "value" ? 4096 : 256)
    ) {
      throw new TypeError("human merge attestation is invalid");
    }
  }
  return freeze(clone(receipt));
}

function exactMergeClock(local, remote, merged, deviceId) {
  const devices = new Set([...Object.keys(local), ...Object.keys(remote)]);
  devices.add(deviceId);
  if (
    Object.keys(merged).length !== devices.size ||
    Object.keys(merged).some((device) => !devices.has(device))
  ) {
    return false;
  }
  for (const device of devices) {
    const joined = Math.max(local[device] ?? 0, remote[device] ?? 0);
    const expected = device === deviceId ? joined + 1 : joined;
    if (merged[device] !== expected) return false;
  }
  return true;
}

export class GovernedKnowledgeConflictMergePlanner {
  constructor({ conflictReader, receiptVerifier, now = Date.now } = {}) {
    if (!isGovernedKnowledgeConflictReader(conflictReader)) {
      throw new TypeError(
        "a branded governed knowledge conflict reader is required",
      );
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    this.tenantId = conflictReader.tenantId;
    this.deviceId = conflictReader.deviceId;
    this._getConflict = capture(
      conflictReader,
      "getConflict",
      "conflictReader",
    );
    this._load = capture(conflictReader, "load", "conflictReader");
    this._verifyReceipt = capture(receiptVerifier, "verify", "receiptVerifier");
    this._now = now;
    Object.freeze(this);
  }

  async plan({ conflictEnvelopeDigest, mergedKnowledge, humanReceipt } = {}) {
    if (!DIGEST.test(conflictEnvelopeDigest ?? "")) {
      throw new TypeError("conflictEnvelopeDigest is invalid");
    }
    const conflict = await this._getConflict({
      envelopeDigest: conflictEnvelopeDigest,
    });
    if (
      conflict?.disposition !== "conflict" ||
      conflict.tenantId !== this.tenantId ||
      conflict.deviceId !== this.deviceId ||
      conflict.envelopeDigest !== conflictEnvelopeDigest ||
      !DIGEST.test(conflict.conflictWithDigest ?? "")
    ) {
      throw new Error("governed knowledge conflict is missing or invalid");
    }
    const current = await this._load({
      knowledgeId: conflict.knowledge.knowledgeId,
    });
    if (
      !current ||
      current.contentDigest !== conflict.conflictWithDigest ||
      current.knowledgeId !== conflict.knowledge.knowledgeId
    ) {
      throw new Error("governed knowledge conflict baseline has advanced");
    }
    const merged = verifyGovernedKnowledgeRecord(mergedKnowledge, {
      tenantId: this.tenantId,
    });
    if (
      merged.knowledgeId !== current.knowledgeId ||
      merged.scope !== current.scope ||
      merged.scopeId !== current.scopeId ||
      merged.scope !== conflict.knowledge.scope ||
      merged.scopeId !== conflict.knowledge.scopeId ||
      merged.action !== "upsert" ||
      !exactMergeClock(
        current.vectorClock,
        conflict.knowledge.vectorClock,
        merged.vectorClock,
        this.deviceId,
      )
    ) {
      throw new Error("merged knowledge does not exactly join both histories");
    }
    const now = Number(this._now());
    if (!Number.isFinite(now)) throw new TypeError("merge clock is invalid");
    const context = {
      tenantId: this.tenantId,
      knowledgeId: merged.knowledgeId,
      conflictEnvelopeDigest,
      localContentDigest: current.contentDigest,
      remoteContentDigest: conflict.knowledge.contentDigest,
      mergedContentDigest: merged.contentDigest,
      mergedVectorClock: merged.vectorClock,
    };
    const receipt = normalizeReceipt(humanReceipt, context, now);
    const verified = await this._verifyReceipt({
      receipt,
      conflict,
      currentKnowledge: current,
      mergedKnowledge: merged,
    });
    if (
      verified?.authenticated !== true ||
      verified.durable !== true ||
      verified.automated !== false ||
      verified.tenantId !== this.tenantId ||
      verified.reviewerId !== receipt.reviewerId ||
      verified.knowledgeId !== merged.knowledgeId ||
      verified.conflictEnvelopeDigest !== conflictEnvelopeDigest ||
      verified.receiptDigest !== receipt.receiptDigest
    ) {
      throw new Error(
        "human merge receipt authority did not authenticate the decision",
      );
    }
    const core = {
      schema: GOVERNED_KNOWLEDGE_MERGE_PLAN_SCHEMA,
      tenantId: this.tenantId,
      deviceId: this.deviceId,
      knowledgeId: merged.knowledgeId,
      scope: merged.scope,
      scopeId: merged.scopeId,
      conflictEnvelopeDigest,
      localContentDigest: current.contentDigest,
      remoteContentDigest: conflict.knowledge.contentDigest,
      mergedKnowledge: merged,
      humanReceiptDigest: receipt.receiptDigest,
      requestedBy: receipt.reviewerId,
      decidedAt: receipt.decidedAt,
    };
    const plan = freeze({
      ...core,
      planDigest: hash(GOVERNED_KNOWLEDGE_MERGE_PLAN_SCHEMA, core),
    });
    MERGE_PLANS.add(plan);
    return plan;
  }
}
