import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { GovernedKnowledgeConflictMergePlanner } from "./governed-knowledge-conflict-merge.js";
import { isGovernedKnowledgeMergeExecutor } from "./governed-knowledge-merge-ledger-executor.js";
import { isGovernedKnowledgeConflictReader } from "./governed-knowledge-sync-ledger-adapter.js";
import { verifyGovernedKnowledgeRecord } from "./governed-knowledge-sync.js";

export const GOVERNED_KNOWLEDGE_REVIEW_REQUEST_SCHEMA =
  "chainlesschain.governed-knowledge-review-request/v1";
export const GOVERNED_KNOWLEDGE_REVIEW_LIST_SCHEMA =
  "chainlesschain.governed-knowledge-review-list/v1";
export const GOVERNED_KNOWLEDGE_REVIEW_RESULT_SCHEMA =
  "chainlesschain.governed-knowledge-review-result/v1";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_REASON_LENGTH = 2048;

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

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
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

function reason(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > MAX_REASON_LENGTH
  ) {
    throw new TypeError("human merge reason is invalid");
  }
  return value;
}

function summary(record) {
  return freeze({
    conflictEnvelopeDigest: record.envelopeDigest,
    knowledgeId: record.knowledge.knowledgeId,
    scope: record.knowledge.scope,
    scopeId: record.knowledge.scopeId,
    action: record.knowledge.action,
    senderDeviceId: record.envelope.senderDeviceId,
    localContentDigest: record.conflictWithDigest,
    remoteContentDigest: record.knowledge.contentDigest,
    remoteVectorClock: clone(record.knowledge.vectorClock),
    committedAt: record.committedAt,
  });
}

export function createGovernedKnowledgeReviewHost({
  conflictReader,
  receiptIssuer,
  receiptVerifier,
  mergeExecutor,
  now = Date.now,
} = {}) {
  if (!isGovernedKnowledgeConflictReader(conflictReader)) {
    throw new TypeError("a branded governed conflict reader is required");
  }
  if (!isGovernedKnowledgeMergeExecutor(mergeExecutor)) {
    throw new TypeError("a branded governed merge executor is required");
  }
  if (
    mergeExecutor.descriptor.tenantId !== conflictReader.tenantId ||
    mergeExecutor.descriptor.deviceId !== conflictReader.deviceId
  ) {
    throw new TypeError("review reader and merge executor boundary mismatch");
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("now must be a non-proxy function");
  }
  const listConflicts = capture(
    conflictReader,
    "listConflicts",
    "conflictReader",
  );
  const getConflict = capture(conflictReader, "getConflict", "conflictReader");
  const load = capture(conflictReader, "load", "conflictReader");
  const issue = capture(receiptIssuer, "issue", "receiptIssuer");
  const execute = capture(mergeExecutor, "execute", "mergeExecutor");
  const isConflictSettled = capture(
    mergeExecutor,
    "isConflictSettled",
    "mergeExecutor",
  );
  const settledConflictDigests = capture(
    mergeExecutor,
    "settledConflictDigests",
    "mergeExecutor",
  );
  const planner = new GovernedKnowledgeConflictMergePlanner({
    conflictReader,
    receiptVerifier,
    now,
  });
  const tenantId = conflictReader.tenantId;
  const deviceId = conflictReader.deviceId;
  const host = Object.freeze({
    tenantId,
    deviceId,
    async list(options = {}) {
      const page = await listConflicts(options);
      const settled = new Set(await settledConflictDigests());
      const unresolved = [];
      for (const record of page.items) {
        if (!settled.has(record.envelopeDigest)) {
          unresolved.push(record);
        }
      }
      return freeze({
        schema: GOVERNED_KNOWLEDGE_REVIEW_LIST_SCHEMA,
        tenantId,
        deviceId,
        items: unresolved.map(summary),
        nextCursor: page.nextCursor,
        total: Math.max(0, page.total - settled.size),
      });
    },
    async merge({
      conflictEnvelopeDigest,
      mergedRecord,
      reason: inputReason,
    } = {}) {
      if (!DIGEST.test(conflictEnvelopeDigest ?? "")) {
        throw new TypeError("conflict envelope digest is invalid");
      }
      const mergeReason = reason(inputReason);
      if (await isConflictSettled({ envelopeDigest: conflictEnvelopeDigest })) {
        throw new Error("governed knowledge conflict is already settled");
      }
      const mergedKnowledge = verifyGovernedKnowledgeRecord(mergedRecord, {
        tenantId,
      });
      const conflict = await getConflict({
        envelopeDigest: conflictEnvelopeDigest,
      });
      if (!conflict)
        throw new Error("governed knowledge conflict was not found");
      const current = await load({
        knowledgeId: conflict.knowledge.knowledgeId,
      });
      if (!current)
        throw new Error("governed knowledge baseline was not found");
      const requestedAtMs = Number(now());
      if (!Number.isFinite(requestedAtMs)) {
        throw new TypeError("review host clock is invalid");
      }
      const requestCore = {
        schema: GOVERNED_KNOWLEDGE_REVIEW_REQUEST_SCHEMA,
        tenantId,
        deviceId,
        conflictEnvelopeDigest,
        knowledgeId: mergedKnowledge.knowledgeId,
        localContentDigest: current.contentDigest,
        remoteContentDigest: conflict.knowledge.contentDigest,
        mergedContentDigest: mergedKnowledge.contentDigest,
        mergedVectorClock: mergedKnowledge.vectorClock,
        reason: mergeReason,
        requestedAt: new Date(requestedAtMs).toISOString(),
      };
      const request = freeze({
        ...requestCore,
        requestDigest: hash(
          GOVERNED_KNOWLEDGE_REVIEW_REQUEST_SCHEMA,
          requestCore,
        ),
      });
      const humanReceipt = await issue(request);
      if (humanReceipt?.reason !== mergeReason) {
        throw new Error("human receipt substituted the review reason");
      }
      const plan = await planner.plan({
        conflictEnvelopeDigest,
        mergedKnowledge,
        humanReceipt,
      });
      const execution = await execute(plan);
      if (
        execution?.authenticated !== true ||
        execution.durable !== true ||
        execution.planDigest !== plan.planDigest ||
        !DIGEST.test(execution.envelopeDigest ?? "") ||
        !DIGEST.test(execution.resultDigest ?? "") ||
        !DIGEST.test(execution.verificationReceiptDigest ?? "")
      ) {
        throw new Error("governed knowledge merge was not durably executed");
      }
      return freeze({
        schema: GOVERNED_KNOWLEDGE_REVIEW_RESULT_SCHEMA,
        tenantId,
        deviceId,
        conflictEnvelopeDigest,
        knowledgeId: plan.knowledgeId,
        mergedContentDigest: plan.mergedKnowledge.contentDigest,
        planDigest: plan.planDigest,
        humanReceiptDigest: plan.humanReceiptDigest,
        envelopeDigest: execution.envelopeDigest,
        publishResultDigest: execution.resultDigest,
        publishVerificationReceiptDigest: execution.verificationReceiptDigest,
        durable: true,
        recovered: execution.recovered === true,
      });
    },
  });
  HOSTS.add(host);
  return host;
}

export function isGovernedKnowledgeReviewHost(value) {
  return HOSTS.has(value);
}
