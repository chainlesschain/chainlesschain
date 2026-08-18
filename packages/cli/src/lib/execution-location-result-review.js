import { createHash } from "node:crypto";
import {
  normalizeExecutionLocationResultBundle,
  verifyExecutionLocationResultBundle,
} from "./execution-location-result.js";
import { normalizeExecutionLocationResultStoreReceipt } from "./execution-location-result-store.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const EXECUTION_LOCATION_RESULT_REVIEW_SCHEMA =
  "cc-execution-location-result-review/v1";

const RESULT_SETTLEMENT_RECEIPT_SCHEMA =
  "chainlesschain.session-execution-location-result-collection-receipt/v2";
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const HEAD_RE = /^[a-f0-9]{64}$/u;
const AUTHORITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const RESULT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationResultReview"), "utf8")
    .digest("hex")}`;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid schema`);
  }
  return value;
}

function positiveCount(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return count;
}

function requireDigest(value, label) {
  const result = String(value || "");
  if (!SHA256_RE.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function requireHead(value, label) {
  const result = String(value || "");
  if (!HEAD_RE.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function normalizeSettlement(input) {
  const value = exactObject(
    input,
    [
      "schema",
      "sessionId",
      "settlementId",
      "requestId",
      "requestDigest",
      "resultId",
      "handoffId",
      "sourceHeadHash",
      "sourceEventCount",
      "settlementEventHash",
      "settlementEventCount",
      "targetHeadHash",
      "targetEventCount",
      "bundleDigest",
      "verificationDigest",
      "collectionDigest",
      "storage",
      "totalBytes",
      "applied",
      "receiptDigest",
    ],
    "execution-location result settlement receipt",
  );
  const sessionId = String(value.sessionId || "");
  const requestId = String(value.requestId || "");
  const resultId = String(value.resultId || "");
  const sourceEventCount = positiveCount(
    value.sourceEventCount,
    "source event count",
  );
  const settlementEventCount = positiveCount(
    value.settlementEventCount,
    "settlement event count",
  );
  const targetEventCount = positiveCount(
    value.targetEventCount,
    "target event count",
  );
  const totalBytes = Number(value.totalBytes);
  if (
    value.schema !== RESULT_SETTLEMENT_RECEIPT_SCHEMA ||
    !AUTHORITY_ID_RE.test(sessionId) ||
    !AUTHORITY_ID_RE.test(requestId) ||
    !RESULT_ID_RE.test(resultId) ||
    settlementEventCount !== sourceEventCount + 1 ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 1 ||
    value.applied !== false
  ) {
    throw new TypeError(
      "execution-location result settlement receipt is invalid",
    );
  }
  return Object.freeze({
    schema: value.schema,
    sessionId,
    settlementId: requireDigest(value.settlementId, "settlement id"),
    requestId,
    requestDigest: requireDigest(value.requestDigest, "request digest"),
    resultId,
    handoffId: requireDigest(value.handoffId, "handoff id"),
    sourceHeadHash: requireHead(value.sourceHeadHash, "source head"),
    sourceEventCount,
    settlementEventHash: requireHead(
      value.settlementEventHash,
      "settlement event hash",
    ),
    settlementEventCount,
    targetHeadHash: requireHead(value.targetHeadHash, "target head"),
    targetEventCount,
    bundleDigest: requireDigest(value.bundleDigest, "bundle digest"),
    verificationDigest: requireDigest(
      value.verificationDigest,
      "verification digest",
    ),
    collectionDigest: requireDigest(
      value.collectionDigest,
      "collection digest",
    ),
    storage: normalizeExecutionLocationResultStoreReceipt(value.storage),
    totalBytes,
    applied: false,
    receiptDigest: requireDigest(
      value.receiptDigest,
      "settlement receipt digest",
    ),
  });
}

function metadata(record) {
  return Object.freeze({
    mediaType: record.mediaType,
    byteLength: record.byteLength,
    digest: record.digest,
  });
}

export function createExecutionLocationResultReview(input = {}) {
  const settlement = normalizeSettlement(input.settlement);
  const bundle = normalizeExecutionLocationResultBundle(input.bundle);
  const verification = verifyExecutionLocationResultBundle({
    bundle,
    sourceAuthority: {
      sessionId: settlement.sessionId,
      headHash: settlement.sourceHeadHash,
      eventCount: settlement.sourceEventCount,
    },
    expectedHandoffId: settlement.handoffId,
  });
  const storage = settlement.storage;
  if (
    settlement.resultId !== bundle.resultId ||
    settlement.bundleDigest !== bundle.bundleDigest ||
    settlement.verificationDigest !== verification.verificationDigest ||
    settlement.totalBytes !== bundle.totalBytes ||
    settlement.targetHeadHash !== bundle.session.target.headHash ||
    settlement.targetEventCount !== bundle.session.target.eventCount ||
    storage.sessionId !== settlement.sessionId ||
    storage.resultId !== settlement.resultId ||
    storage.handoffId !== settlement.handoffId ||
    storage.bundleDigest !== settlement.bundleDigest
  ) {
    throw new Error("stored result bundle does not match settlement authority");
  }
  const material = {
    schema: EXECUTION_LOCATION_RESULT_REVIEW_SCHEMA,
    sessionId: settlement.sessionId,
    requestId: settlement.requestId,
    requestDigest: settlement.requestDigest,
    resultId: settlement.resultId,
    handoffId: settlement.handoffId,
    settlement: {
      settlementId: settlement.settlementId,
      eventHash: settlement.settlementEventHash,
      eventCount: settlement.settlementEventCount,
      receiptDigest: settlement.receiptDigest,
    },
    source: {
      headHash: settlement.sourceHeadHash,
      eventCount: settlement.sourceEventCount,
    },
    target: {
      headHash: settlement.targetHeadHash,
      eventCount: settlement.targetEventCount,
    },
    bundleDigest: bundle.bundleDigest,
    verificationDigest: verification.verificationDigest,
    collectionDigest: settlement.collectionDigest,
    storage: {
      storeId: storage.storeId,
      receiptDigest: storage.receiptDigest,
      canonicalBytesDigest: storage.canonicalBytesDigest,
      byteLength: storage.byteLength,
      format: storage.format,
      retention: storage.retention,
    },
    summary: metadata(bundle.summary),
    diff: metadata(bundle.diff),
    artifacts: bundle.artifacts.map(metadata),
    evidence: bundle.evidence.map(metadata),
    totalBytes: bundle.totalBytes,
    applied: false,
    applyPolicy: {
      automaticApply: false,
      requirements: [
        "explicit-review-digest",
        "exact-source-git-identity",
        "managed-workspace-transaction",
        "session-apply-reservation",
      ],
    },
    gaps: [
      "stored-result-not-applied",
      "local-store-not-worm-or-off-box",
      "ide-review-ui-not-integrated",
    ],
  };
  return Object.freeze({
    ...material,
    reviewDigest: digest(
      "chainlesschain.execution-location.result-review.v1\0",
      material,
    ),
  });
}
