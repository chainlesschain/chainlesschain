/**
 * SessionResourceBudget tracks resource admissions for callers that explicitly
 * share the same instance.
 *
 * Admission limits (concurrency, total spawns, depth and turns) are checked
 * synchronously, so multiple Promise continuations cannot oversubscribe them.
 * Continuous limits (tokens, USD, wall time and aggregate tool time) actively
 * abort the session as soon as they are exhausted; callers do not have to wait
 * until the next spawn or model turn to notice.
 *
 * Snapshots retain settled totals and identify work that was in flight. A
 * restored dirty snapshot is fail-closed until the caller adjudicates every
 * listed resource. Process downtime is not charged to wall time, matching the
 * existing resumable TeamBudget contract.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { CostBudget } from "./cost-budget.js";

export const SESSION_RESOURCE_BUDGET_VERSION = 1;
export const SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA =
  "chainlesschain.session-budget-recovery-adjudication/v1";
export const SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA =
  "chainlesschain.session-budget-recovery-receipt-history/v1";

const INTEGER_LIMITS = new Set([
  "maxConcurrent",
  "maxSpawns",
  "maxDepth",
  "maxTurns",
  "maxTokens",
]);

const LIMIT_FIELDS = Object.freeze([
  "maxConcurrent",
  "maxSpawns",
  "maxDepth",
  "maxTurns",
  "maxTokens",
  "maxUsd",
  "maxWallMs",
  "maxToolMs",
]);

const CONTINUOUS_REASONS = new Set([
  "max-tokens",
  "unpriced-usage",
  "max-usd",
  "max-wall-ms",
  "max-tool-ms",
]);

const USAGE_TOKEN_FIELDS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
]);

const MAX_TIMER_DELAY = 2_147_483_647;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_RECOVERY_ADJUDICATION_RECEIPTS = 2048;
const OPAQUE_AUTHORITY_ID_PATTERNS = Object.freeze({
  work: /^work-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  tool: /^tool-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  usage:
    /^usage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
});
const OBSERVER_INVOCATION_CONTEXT = new AsyncLocalStorage();
const PERSISTED_WORK_KINDS = new Set([
  "work",
  "spawn",
  "sub-agent",
  "background",
  "background-task",
  "team-task",
  "usage-settlement",
]);
const PERSISTED_ABORT_REASONS = new Set([
  "session-aborted",
  "parent-aborted",
  "host-aborted",
  "persistence-failed",
  "invalid-usage",
  "max-tokens",
  "unpriced-usage",
  "max-usd",
  "max-wall-ms",
  "max-tool-ms",
  "max-turns",
  "max-spawns",
]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeRecoveryIdentity(field, raw) {
  if (
    typeof raw !== "string" ||
    raw.length < 1 ||
    raw.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(raw)
  ) {
    throw new TypeError(`invalid session budget recovery ${field}`);
  }
  return raw;
}

function normalizeLimit(field, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  const allowsZero = field === "maxDepth";
  if (
    !Number.isFinite(value) ||
    (allowsZero ? value < 0 : value <= 0) ||
    (INTEGER_LIMITS.has(field) && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`invalid session budget limit: ${field}`);
  }
  return value;
}

function normalizeNonNegativeInteger(field, raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`invalid session budget total: ${field}`);
  }
  return value;
}

function normalizeNonNegativeNumber(field, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`invalid session budget total: ${field}`);
  }
  return value;
}

function normalizeUsageTokens(usage) {
  const fields = Object.fromEntries(
    USAGE_TOKEN_FIELDS.map((field) => [field, 0]),
  );
  if (usage == null) return { fields, total: 0 };
  if (!isRecord(usage)) {
    throw new TypeError("invalid session budget usage");
  }
  let total = 0;
  for (const field of USAGE_TOKEN_FIELDS) {
    const raw = usage[field];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`invalid session budget usage: ${field}`);
    }
    fields[field] = value;
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new TypeError("session budget token total exceeds safe integer");
    }
  }
  return { fields, total };
}

function normalizeUsageAccounting({
  usage = null,
  usageRecords = null,
  provider,
  model,
} = {}) {
  if (usageRecords != null && !Array.isArray(usageRecords)) {
    throw new TypeError("invalid session budget usage records");
  }
  if (Array.isArray(usageRecords) && usageRecords.length > 0) {
    const detailedFields = Object.fromEntries(
      USAGE_TOKEN_FIELDS.map((field) => [field, 0]),
    );
    let detailedTokenCount = 0;
    const pricedRecords = usageRecords.map((record, index) => {
      if (!isRecord(record) || !isRecord(record.usage)) {
        throw new TypeError(
          `invalid session budget usage record at index ${index}`,
        );
      }
      const normalized = normalizeUsageTokens(record.usage);
      for (const field of USAGE_TOKEN_FIELDS) {
        detailedFields[field] += normalized.fields[field];
        if (!Number.isSafeInteger(detailedFields[field])) {
          throw new TypeError(
            `session budget usage record aggregate exceeds safe integer: ${field}`,
          );
        }
      }
      detailedTokenCount += normalized.total;
      if (!Number.isSafeInteger(detailedTokenCount)) {
        throw new TypeError("session budget token total exceeds safe integer");
      }
      return { record, tokens: normalized.total };
    });
    if (usage != null) {
      const aggregate = normalizeUsageTokens(usage);
      for (const field of USAGE_TOKEN_FIELDS) {
        if (aggregate.fields[field] !== detailedFields[field]) {
          throw new TypeError(
            `session budget usage records do not match aggregate usage: ${field}`,
          );
        }
      }
      return { tokenCount: aggregate.total, pricedRecords };
    }
    return { tokenCount: detailedTokenCount, pricedRecords };
  }
  const normalized = normalizeUsageTokens(usage);
  return {
    tokenCount: normalized.total,
    pricedRecords:
      usage == null
        ? []
        : [{ record: { provider, model, usage }, tokens: normalized.total }],
  };
}

function cloneCostBudget(cost) {
  const clone = new CostBudget({
    limitUsd: cost.limitUsd,
    table: cost.table,
  });
  clone.spentUsd = cost.spentUsd;
  clone.priced = cost.priced;
  clone.sawUnpriced = cost.sawUnpriced;
  clone.sawFree = cost.sawFree;
  clone._warned = cost._warned;
  return clone;
}

function calculateUsageAccounting(
  { tokens, cost, unpricedUsage },
  usageInput,
) {
  const { tokenCount, pricedRecords } = normalizeUsageAccounting(usageInput);
  const nextTokens = tokens + tokenCount;
  if (!Number.isSafeInteger(nextTokens)) {
    throw new TypeError("session budget token total exceeds safe integer");
  }
  const nextCost = cloneCostBudget(cost);
  let nextUnpricedUsage = unpricedUsage;
  for (const { record, tokens: recordTokens } of pricedRecords) {
    const estimate = nextCost.add(record);
    const price = Number(estimate?.totalCost);
    if (
      nextCost.enabled() &&
      recordTokens > 0 &&
      estimate?.free !== true &&
      (estimate?.matched !== true || !Number.isFinite(price) || price < 0)
    ) {
      nextUnpricedUsage = true;
    }
  }
  return {
    tokens: nextTokens,
    cost: nextCost,
    unpricedUsage: nextUnpricedUsage,
  };
}

function canonicalRecoveryUsageRecord(record, field) {
  if (!isRecord(record) || !isRecord(record.usage)) {
    throw new TypeError(`invalid session budget recovery ${field}`);
  }
  return {
    provider: normalizeRecoveryIdentity(`${field} provider`, record.provider),
    model: normalizeRecoveryIdentity(`${field} model`, record.model),
    usage: normalizeUsageTokens(record.usage).fields,
  };
}

function canonicalRecoverySettlement(record, index) {
  const base = { authorityId: record.authorityId };
  if (Array.isArray(record.usageRecords) && record.usageRecords.length > 0) {
    const usageRecords = record.usageRecords
      .map((entry, recordIndex) =>
        canonicalRecoveryUsageRecord(
          entry,
          `settlement ${index} usage record ${recordIndex}`,
        ),
      )
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
    return {
      ...base,
      ...(record.usage != null
        ? { usage: normalizeUsageTokens(record.usage).fields }
        : {}),
      usageRecords,
    };
  }
  return {
    ...base,
    ...canonicalRecoveryUsageRecord(record, `settlement ${index}`),
  };
}

function cloneCanonicalRecord(value) {
  return JSON.parse(canonicalJson(value));
}

function isOpaqueAuthorityId(value) {
  return Object.values(OPAQUE_AUTHORITY_ID_PATTERNS).some((pattern) =>
    pattern.test(value),
  );
}

function normalizeRecoveryReceipt(value, index) {
  if (
    !isRecord(value) ||
    value.schema !== SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    (value.previousDigest !== null &&
      !SHA256_PATTERN.test(value.previousDigest)) ||
    !Array.isArray(value.abandoned) ||
    !Array.isArray(value.settled) ||
    !isRecord(value.totalsBefore) ||
    !isRecord(value.totalsAfter)
  ) {
    throw new TypeError(
      `invalid session budget recovery receipt at index ${index}`,
    );
  }
  const abandoned = value.abandoned.map((raw) => String(raw)).sort();
  const settled = value.settled
    .map((record, settlementIndex) => {
      if (!isRecord(record)) {
        throw new TypeError(
          `invalid session budget recovery receipt settlement at index ${index}:${settlementIndex}`,
        );
      }
      const authorityId = String(record.authorityId || "");
      if (!OPAQUE_AUTHORITY_ID_PATTERNS.usage.test(authorityId)) {
        throw new TypeError(
          `invalid session budget recovery receipt authority at index ${index}:${settlementIndex}`,
        );
      }
      return canonicalRecoverySettlement(
        { ...record, authorityId },
        settlementIndex,
      );
    })
    .sort((left, right) => left.authorityId.localeCompare(right.authorityId));
  const allAuthorityIds = [
    ...abandoned,
    ...settled.map((record) => record.authorityId),
  ];
  if (
    abandoned.some((authorityId) => !isOpaqueAuthorityId(authorityId)) ||
    new Set(allAuthorityIds).size !== allAuthorityIds.length ||
    canonicalJson(abandoned) !== canonicalJson(value.abandoned) ||
    canonicalJson(settled) !== canonicalJson(value.settled)
  ) {
    throw new TypeError(
      `invalid session budget recovery receipt authorities at index ${index}`,
    );
  }
  const totalsBefore = {
    tokens: normalizeNonNegativeInteger(
      "recovery receipt tokens before",
      value.totalsBefore.tokens,
    ),
    spentUsd: normalizeNonNegativeNumber(
      "recovery receipt USD before",
      value.totalsBefore.spentUsd,
    ),
  };
  const totalsAfter = {
    tokens: normalizeNonNegativeInteger(
      "recovery receipt tokens after",
      value.totalsAfter.tokens,
    ),
    spentUsd: normalizeNonNegativeNumber(
      "recovery receipt USD after",
      value.totalsAfter.spentUsd,
    ),
  };
  if (
    totalsAfter.tokens < totalsBefore.tokens ||
    totalsAfter.spentUsd < totalsBefore.spentUsd
  ) {
    throw new TypeError(
      `invalid session budget recovery receipt totals at index ${index}`,
    );
  }
  const core = {
    schema: SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA,
    sequence: value.sequence,
    previousDigest: value.previousDigest,
    abandoned,
    settled,
    totalsBefore,
    totalsAfter,
  };
  const digest = sha256(canonicalJson(core));
  if (value.digest !== digest) {
    throw new TypeError(
      `invalid session budget recovery receipt digest at index ${index}`,
    );
  }
  return { ...core, digest };
}

function normalizeRecoveryReceiptHistory(value, adjudication, totals) {
  if (
    !isRecord(value) ||
    value.schema !== SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA ||
    !Number.isSafeInteger(value.baseSequence) ||
    value.baseSequence < 0 ||
    (value.baseDigest !== null && !SHA256_PATTERN.test(value.baseDigest)) ||
    (value.baseSequence === 0) !== (value.baseDigest === null) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > MAX_RECOVERY_ADJUDICATION_RECEIPTS ||
    value.baseSequence + value.entries.length !== adjudication.count
  ) {
    throw new TypeError(
      "invalid session budget recovery adjudication receipt history",
    );
  }
  const entries = value.entries.map(normalizeRecoveryReceipt);
  let previousDigest = value.baseDigest;
  let previousTotals = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry.sequence !== value.baseSequence + index + 1 ||
      entry.previousDigest !== previousDigest ||
      (previousTotals !== null &&
        (entry.totalsBefore.tokens !== previousTotals.tokens ||
          entry.totalsBefore.spentUsd !== previousTotals.spentUsd))
    ) {
      throw new TypeError(
        "invalid session budget recovery adjudication receipt chain",
      );
    }
    previousDigest = entry.digest;
    previousTotals = entry.totalsAfter;
  }
  const last = entries.at(-1);
  if (
    last.sequence !== adjudication.count ||
    last.digest !== adjudication.headDigest ||
    last.digest !== adjudication.last.digest ||
    last.previousDigest !== adjudication.last.previousDigest ||
    last.settled.length !== adjudication.last.settledCount ||
    last.abandoned.length !== adjudication.last.abandonedCount ||
    last.totalsAfter.tokens - last.totalsBefore.tokens !==
      adjudication.last.tokenDelta ||
    last.totalsAfter.spentUsd - last.totalsBefore.spentUsd !==
      adjudication.last.spentUsdDelta ||
    last.totalsAfter.tokens !== totals.tokens ||
    last.totalsAfter.spentUsd !== totals.spentUsd
  ) {
    throw new TypeError(
      "invalid session budget recovery adjudication receipt head",
    );
  }
  return {
    schema: SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA,
    baseSequence: value.baseSequence,
    baseDigest: value.baseDigest,
    entries,
  };
}

function normalizeRecoveryAdjudicationState(value, totals) {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    value.schema !== SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA ||
    !Number.isSafeInteger(value.count) ||
    value.count < 1 ||
    !SHA256_PATTERN.test(value.headDigest) ||
    !isRecord(value.last) ||
    value.last.sequence !== value.count ||
    value.last.digest !== value.headDigest ||
    !SHA256_PATTERN.test(value.last.digest) ||
    (value.last.previousDigest !== null &&
      !SHA256_PATTERN.test(value.last.previousDigest)) ||
    !Number.isSafeInteger(value.last.settledCount) ||
    value.last.settledCount < 0 ||
    !Number.isSafeInteger(value.last.abandonedCount) ||
    value.last.abandonedCount < 0 ||
    !Number.isSafeInteger(value.last.tokenDelta) ||
    value.last.tokenDelta < 0 ||
    !Number.isFinite(value.last.spentUsdDelta) ||
    value.last.spentUsdDelta < 0
  ) {
    throw new TypeError("invalid session budget recovery adjudication state");
  }
  if (
    (value.count === 1 && value.last.previousDigest !== null) ||
    (value.count > 1 && value.last.previousDigest === null)
  ) {
    throw new TypeError("invalid session budget recovery adjudication chain");
  }
  const adjudication = {
    schema: SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA,
    count: value.count,
    headDigest: value.headDigest,
    last: {
      sequence: value.last.sequence,
      digest: value.last.digest,
      previousDigest: value.last.previousDigest,
      settledCount: value.last.settledCount,
      abandonedCount: value.last.abandonedCount,
      tokenDelta: value.last.tokenDelta,
      spentUsdDelta: value.last.spentUsdDelta,
    },
  };
  if (value.history !== undefined) {
    adjudication.history = normalizeRecoveryReceiptHistory(
      value.history,
      adjudication,
      totals,
    );
  }
  return adjudication;
}

function cloneRecoveryAdjudication(value, { includeReceipts = true } = {}) {
  if (!value) return null;
  const cloned = {
    schema: value.schema,
    count: value.count,
    headDigest: value.headDigest,
    last: { ...value.last },
  };
  if (value.history) {
    cloned.history = includeReceipts
      ? {
          schema: value.history.schema,
          baseSequence: value.history.baseSequence,
          baseDigest: value.history.baseDigest,
          entries: value.history.entries.map(cloneCanonicalRecord),
        }
      : {
          schema: value.history.schema,
          baseSequence: value.history.baseSequence,
          baseDigest: value.history.baseDigest,
          retainedCount: value.history.entries.length,
          complete: value.history.baseSequence === 0,
        };
  }
  return cloned;
}

function normalizeUsageSettlementLabel(raw) {
  const value = String(raw || "");
  if (!RESOURCE_ID_PATTERN.test(value)) {
    throw new TypeError("invalid session budget usage settlement id");
  }
  return value;
}

function safeReason(reason, fallback = "session-aborted") {
  if (reason instanceof Error) return reason;
  const text = String(reason || fallback).slice(0, 512);
  const error = new Error(text || fallback);
  error.code = "ERR_SESSION_ABORTED";
  return error;
}

function persistedKind(kind, resourceType) {
  if (resourceType === "tool") return "tool";
  return PERSISTED_WORK_KINDS.has(kind) ? kind : "work";
}

function snapshotResource(entry, now, resourceType) {
  return {
    id: entry.id,
    kind: persistedKind(entry.kind, resourceType),
    ...(entry.depth !== null ? { depth: entry.depth } : {}),
    ...(entry.startedAt !== null
      ? { elapsedMs: Math.max(0, now - entry.startedAt) }
      : {}),
  };
}

function validateResourceList(value, field) {
  if (!Array.isArray(value)) {
    throw new TypeError(`invalid session budget in-flight list: ${field}`);
  }
  const seen = new Set();
  return value.map((entry) => {
    const validAuthorityId =
      typeof entry?.id === "string" &&
      (field === "tools"
        ? OPAQUE_AUTHORITY_ID_PATTERNS.tool.test(entry.id)
        : OPAQUE_AUTHORITY_ID_PATTERNS.work.test(entry.id) ||
          OPAQUE_AUTHORITY_ID_PATTERNS.usage.test(entry.id));
    if (
      !isRecord(entry) ||
      !validAuthorityId ||
      typeof entry.kind !== "string" ||
      (field === "tools"
        ? entry.kind !== "tool"
        : !PERSISTED_WORK_KINDS.has(entry.kind)) ||
      seen.has(entry.id)
    ) {
      throw new TypeError(`invalid session budget in-flight entry: ${field}`);
    }
    seen.add(entry.id);
    const normalized = { id: entry.id, kind: entry.kind };
    if (entry.depth !== undefined) {
      normalized.depth = normalizeNonNegativeInteger("depth", entry.depth);
    }
    if (entry.elapsedMs !== undefined) {
      normalized.elapsedMs = normalizeNonNegativeNumber(
        "elapsedMs",
        entry.elapsedMs,
      );
    }
    return normalized;
  });
}

function validateSnapshot(snapshot) {
  if (
    !isRecord(snapshot) ||
    snapshot.version !== SESSION_RESOURCE_BUDGET_VERSION ||
    !isRecord(snapshot.limits) ||
    !isRecord(snapshot.totals) ||
    !isRecord(snapshot.inFlight) ||
    !isRecord(snapshot.state)
  ) {
    throw new TypeError("invalid session resource budget snapshot");
  }
  const limits = {};
  for (const field of LIMIT_FIELDS) {
    if (!Object.hasOwn(snapshot.limits, field)) {
      throw new TypeError(`missing session budget limit: ${field}`);
    }
    limits[field] = normalizeLimit(field, snapshot.limits[field]);
  }
  const totals = {
    spawns: normalizeNonNegativeInteger("spawns", snapshot.totals.spawns),
    turns: normalizeNonNegativeInteger("turns", snapshot.totals.turns),
    tokens: normalizeNonNegativeInteger("tokens", snapshot.totals.tokens),
    spentUsd: normalizeNonNegativeNumber("spentUsd", snapshot.totals.spentUsd),
    elapsedMs: normalizeNonNegativeNumber(
      "elapsedMs",
      snapshot.totals.elapsedMs,
    ),
    toolMs: normalizeNonNegativeNumber("toolMs", snapshot.totals.toolMs),
    unpricedUsage: snapshot.totals.unpricedUsage,
  };
  if (typeof totals.unpricedUsage !== "boolean") {
    throw new TypeError("invalid session budget unpriced usage state");
  }
  if (typeof snapshot.state.started !== "boolean") {
    throw new TypeError("invalid session budget started state");
  }
  if (
    snapshot.state.abort !== null &&
    (!isRecord(snapshot.state.abort) ||
      typeof snapshot.state.abort.reason !== "string" ||
      typeof snapshot.state.abort.message !== "string")
  ) {
    throw new TypeError("invalid session budget abort state");
  }
  const work = validateResourceList(snapshot.inFlight.work, "work");
  const tools = validateResourceList(snapshot.inFlight.tools, "tools");
  const recoveryAdjudication = normalizeRecoveryAdjudicationState(
    snapshot.state.recoveryAdjudication,
    totals,
  );
  const workIds = new Set(work.map((entry) => entry.id));
  if (tools.some((entry) => workIds.has(entry.id))) {
    throw new TypeError(
      "duplicate session budget in-flight id across work and tools",
    );
  }
  return {
    limits,
    totals,
    state: {
      started: snapshot.state.started,
      abort: snapshot.state.abort,
      recoveryAdjudication,
    },
    inFlight: {
      work,
      tools,
    },
  };
}

function tightenLimit(field, stored, override) {
  const prior = normalizeLimit(field, stored);
  if (override === undefined || override === null || override === "") {
    return prior;
  }
  const next = normalizeLimit(field, override);
  if (prior === null) return next;
  return Math.min(prior, next);
}

function hasLimitValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeLimitOverrides(overrides) {
  if (!isRecord(overrides)) {
    throw new TypeError("invalid session budget limit overrides");
  }
  const normalized = {};
  for (const field of LIMIT_FIELDS) {
    if (field !== "maxUsd" && hasLimitValue(overrides[field])) {
      normalized[field] = normalizeLimit(field, overrides[field]);
    }
  }
  const usd = [];
  if (hasLimitValue(overrides.maxUsd)) {
    usd.push(normalizeLimit("maxUsd", overrides.maxUsd));
  }
  if (hasLimitValue(overrides.maxCostUsd)) {
    usd.push(normalizeLimit("maxUsd", overrides.maxCostUsd));
  }
  if (usd.length > 0) normalized.maxUsd = Math.min(...usd);
  return normalized;
}

/**
 * Validate and copy only the content-free authority fields accepted by the
 * durable sidecar. Unknown keys and caller-owned object references never cross
 * this boundary.
 */
export function normalizeSessionResourceBudgetSnapshot(snapshot) {
  const normalized = validateSnapshot(snapshot);
  const rawAbortReason = normalized.state.abort?.reason || "";
  const abortReason = PERSISTED_ABORT_REASONS.has(rawAbortReason)
    ? rawAbortReason
    : "session-aborted";
  return {
    version: SESSION_RESOURCE_BUDGET_VERSION,
    limits: { ...normalized.limits },
    totals: { ...normalized.totals },
    inFlight: {
      work: normalized.inFlight.work.map((entry) => ({ ...entry })),
      tools: normalized.inFlight.tools.map((entry) => ({ ...entry })),
    },
    state: {
      started: normalized.state.started,
      abort: normalized.state.abort
        ? {
            reason: abortReason,
            message: `Session resource budget stopped: ${abortReason}`,
          }
        : null,
      ...(normalized.state.recoveryAdjudication
        ? {
            recoveryAdjudication: cloneRecoveryAdjudication(
              normalized.state.recoveryAdjudication,
            ),
          }
        : {}),
    },
  };
}

export class SessionBudgetError extends Error {
  constructor(reason, message = null) {
    super(message || `Session resource budget exhausted: ${reason}`);
    this.name = "SessionBudgetError";
    this.code = "ERR_SESSION_RESOURCE_BUDGET";
    this.budgetReason = reason;
    this.retryable = false;
  }
}

export class SessionResourceBudget {
  constructor({
    maxConcurrent = null,
    maxSpawns = null,
    maxDepth = null,
    maxTurns = null,
    maxTokens = null,
    maxUsd = null,
    maxCostUsd = undefined,
    maxWallMs = null,
    maxToolMs = null,
    table = undefined,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (timer) => clearTimeout(timer),
    signal = null,
    onEvent = null,
    onAuthorityChange = null,
    queueObservation = (callback) => queueMicrotask(callback),
  } = {}) {
    this._now = typeof now === "function" ? now : () => Number(now);
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._onEvent = typeof onEvent === "function" ? onEvent : null;
    this._onAuthorityChange =
      typeof onAuthorityChange === "function" ? onAuthorityChange : null;
    this._queueObservation =
      typeof queueObservation === "function"
        ? queueObservation
        : (callback) => queueMicrotask(callback);
    this._eventSeq = 0;
    this._eventQueue = [];
    this._eventDrainScheduled = false;

    const normalizedLimits = normalizeLimitOverrides({
      maxConcurrent,
      maxSpawns,
      maxDepth,
      maxTurns,
      maxTokens,
      maxUsd,
      maxCostUsd,
      maxWallMs,
      maxToolMs,
    });
    this.maxConcurrent = normalizedLimits.maxConcurrent ?? null;
    this.maxSpawns = normalizedLimits.maxSpawns ?? null;
    this.maxDepth = normalizedLimits.maxDepth ?? null;
    this.maxTurns = normalizedLimits.maxTurns ?? null;
    this.maxTokens = normalizedLimits.maxTokens ?? null;
    this.maxWallMs = normalizedLimits.maxWallMs ?? null;
    this.maxToolMs = normalizedLimits.maxToolMs ?? null;
    this.cost = new CostBudget({
      limitUsd: normalizedLimits.maxUsd ?? null,
      table,
    });

    this.spawns = 0;
    this.turns = 0;
    this.tokens = 0;
    this.unpricedUsage = false;
    this._elapsedMs = 0;
    this._startedAt = null;
    this._toolMs = 0;
    this._activeWork = new Map();
    this._activeTools = new Map();
    this._activeWorkLabels = new Map();
    this._activeToolLabels = new Map();
    this._pendingUsage = new Map();
    this._pendingUsageLabels = new Map();
    this._issuedAuthorityIds = new Set();
    this._abortables = new Map();
    this._recoveryUnknown = new Map();
    this._recoveryAdjudication = null;
    this._deadlineTimer = null;
    this._abortController = new AbortController();
    this._abortState = null;
    this._authorityFailure = null;
    this._revocationError = null;
    this._externalSignal = signal || null;
    this._externalAbortListener = null;

    if (this._externalSignal) {
      this._externalAbortListener = () => {
        try {
          this.abort(this._externalSignal.reason || "parent-aborted", {
            reason: "parent-aborted",
          });
        } catch {
          // The authority transition already failed closed and cascaded abort.
        }
      };
      if (this._externalSignal.aborted) this._externalAbortListener();
      else {
        this._externalSignal.addEventListener?.(
          "abort",
          this._externalAbortListener,
          { once: true },
        );
      }
    }
  }

  get signal() {
    return this._abortController.signal;
  }

  enabled() {
    return LIMIT_FIELDS.some((field) =>
      field === "maxUsd" ? this.cost.limitUsd !== null : this[field] !== null,
    );
  }

  /**
   * Apply additional limits without ever relaxing an authority that is already
   * in use. This is primarily used when another host opens the same session in
   * the current process: the shared object keeps its identity, while a stricter
   * caller can still reduce the remaining envelope.
   */
  tightenLimits(overrides = {}) {
    this._assertAuthorityMutationAllowed();
    const requested = normalizeLimitOverrides(overrides);
    const next = {};
    for (const field of LIMIT_FIELDS) {
      if (
        requested[field] === undefined ||
        requested[field] === null ||
        requested[field] === ""
      ) {
        continue;
      }
      const current = field === "maxUsd" ? this.cost.limitUsd : this[field];
      next[field] = tightenLimit(field, current, requested[field]);
    }

    for (const [field, value] of Object.entries(next)) {
      if (field === "maxUsd") this.cost.limitUsd = value;
      else this[field] = value;
    }
    if (Object.keys(next).length > 0) {
      this._authorityChanged("budget:limits-tightened", {
        limits: { ...next },
      });
      const reason = this._continuousReason();
      if (reason) this._abortFor(reason);
      else this._armDeadline();
    }
    return this.status();
  }

  start(now = this._now()) {
    this._assertAuthorityMutationAllowed();
    if (this._startedAt === null) {
      this._startedAt = now;
      this._authorityChanged(
        "budget:started",
        {},
        {
          rollback: () => {
            this._startedAt = null;
          },
        },
      );
      this._armDeadline(now);
    }
    return this;
  }

  _emit(type, detail) {
    if (!this._onEvent) return;
    this._eventQueue.push({
      type,
      eventId: `event-${randomUUID()}`,
      sequence: ++this._eventSeq,
      at: this._now(),
      ...detail,
    });
    if (this._eventDrainScheduled) return;
    this._eventDrainScheduled = true;
    try {
      this._queueObservation(() => {
        this._eventDrainScheduled = false;
        const events = this._eventQueue.splice(0);
        for (const event of events) {
          try {
            OBSERVER_INVOCATION_CONTEXT.run(
              Object.freeze({ eventId: event.eventId }),
              () => {
                const pending = this._onEvent?.(event);
                void Promise.resolve(pending).catch(() => {});
              },
            );
          } catch {
            // Observability is never part of the resource authority.
          }
        }
      });
    } catch {
      // A broken observation scheduler may drop diagnostics, but it must never
      // fall back to synchronous callbacks inside an authority method.
      this._eventQueue.length = 0;
      this._eventDrainScheduled = false;
    }
  }

  _assertAuthorityMutationAllowed() {
    if (OBSERVER_INVOCATION_CONTEXT.getStore()) {
      throw new SessionBudgetError(
        "notification-reentrancy",
        "Session budget authority cannot mutate from an observation context",
      );
    }
    if (this._revocationError) throw this._revocationError;
    if (this._authorityFailure) throw this._authorityFailure;
  }

  _nextAuthorityId(resourceType) {
    const pattern = OPAQUE_AUTHORITY_ID_PATTERNS[resourceType];
    if (!pattern) throw new TypeError("invalid session budget authority type");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const authorityId = `${resourceType}-${randomUUID()}`;
      if (
        pattern.test(authorityId) &&
        !this._issuedAuthorityIds.has(authorityId)
      ) {
        this._issuedAuthorityIds.add(authorityId);
        return authorityId;
      }
    }
    throw new Error("could not allocate unique session budget authority id");
  }

  _authorityChanged(type, detail, { rollback = null } = {}) {
    if (this._authorityFailure) throw this._authorityFailure;
    if (this._onAuthorityChange) {
      try {
        this._onAuthorityChange({
          type,
          at: this._now(),
          snapshot: this.snapshot(),
        });
      } catch (error) {
        if (typeof rollback === "function") {
          try {
            rollback();
          } catch {
            // The persistence failure still closes this budget even if a
            // defensive local rollback unexpectedly fails.
          }
        }
        this._failClosedAuthorityPersistence(error, type);
        throw error;
      }
    }
    this._emit(type, detail);
  }

  _failClosedAuthorityPersistence(error, authorityType = "runtime") {
    const failure =
      error instanceof Error
        ? error
        : new Error(String(error || "session budget persistence failed"));
    if (this._authorityFailure) return this._authorityFailure;
    this._authorityFailure = failure;
    try {
      this._abortUnchecked(failure, {
        reason: "persistence-failed",
        skipAuthorityChange: true,
      });
    } catch {
      // The original persistence error remains the rejection authority.
    }
    this._emit("budget:authority-persistence-failed", { authorityType });
    return failure;
  }

  _revokeRuntimeAuthority() {
    if (this._revocationError) return false;
    if (this._authorityFailure) throw this._authorityFailure;
    const error = new SessionBudgetError(
      "runtime-closed",
      "Session resource budget runtime is closed",
    );
    // Install the fence before invoking cleanup callbacks so callback re-entry
    // cannot mutate authority after the final durable snapshot was written.
    this._revocationError = error;
    this._abortUnchecked(error, {
      reason: "runtime-closed",
      skipAuthorityChange: true,
    });
    if (this._externalSignal && this._externalAbortListener) {
      try {
        this._externalSignal.removeEventListener?.(
          "abort",
          this._externalAbortListener,
        );
      } catch {
        // Revocation is already installed; listener cleanup is best effort.
      }
    }
    this._externalAbortListener = null;
    this._emit("budget:runtime-revoked", {
      activeWork: this._activeWork.size,
      activeTools: this._activeTools.size,
    });
    return true;
  }

  _persistenceAdmissionFailure(error, extra = {}) {
    if (!this._authorityFailure || error !== this._authorityFailure) {
      throw error;
    }
    return this._admissionFailure("persistence-failed", extra);
  }

  _elapsedAt(now = this._now()) {
    return (
      this._elapsedMs +
      (this._startedAt === null ? 0 : Math.max(0, now - this._startedAt))
    );
  }

  _toolMsAt(now = this._now()) {
    let live = this._toolMs;
    for (const tool of this._activeTools.values()) {
      live += Math.max(0, now - tool.startedAt);
    }
    return live;
  }

  _continuousReason(now = this._now()) {
    if (this.maxTokens !== null && this.tokens >= this.maxTokens) {
      return "max-tokens";
    }
    if (this.cost.enabled() && this.unpricedUsage) {
      return "unpriced-usage";
    }
    if (this.cost.exceeded()) return "max-usd";
    if (this.maxWallMs !== null && this._elapsedAt(now) >= this.maxWallMs) {
      return "max-wall-ms";
    }
    if (this.maxToolMs !== null && this._toolMsAt(now) >= this.maxToolMs) {
      return "max-tool-ms";
    }
    return null;
  }

  reason(now = this._now()) {
    if (this._abortState) return this._abortState.reason;
    if (this._recoveryUnknown.size > 0) return "recovery-required";
    const continuous = this._continuousReason(now);
    if (continuous) return continuous;
    if (this.maxTurns !== null && this.turns >= this.maxTurns) {
      return "max-turns";
    }
    if (this.maxSpawns !== null && this.spawns >= this.maxSpawns) {
      return "max-spawns";
    }
    return null;
  }

  shouldStop(now = this._now()) {
    return this.reason(now) !== null;
  }

  _admissionFailure(reason, extra = {}) {
    this._emit("budget:admission-denied", { reason, ...extra });
    return { ok: false, reason, retryable: reason === "max-concurrent" };
  }

  consumeTurn({ id = null } = {}) {
    this._assertAuthorityMutationAllowed();
    try {
      this.start();
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id });
    }
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", { id });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id });
    }
    if (this.maxTurns !== null && this.turns >= this.maxTurns) {
      return this._admissionFailure("max-turns", { id });
    }
    const previousTurns = this.turns;
    this.turns = previousTurns + 1;
    try {
      this._authorityChanged(
        "budget:turn-consumed",
        { id, turns: this.turns },
        {
          rollback: () => {
            this.turns = previousTurns;
          },
        },
      );
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id });
    }
    return { ok: true, turns: this.turns, remaining: this.turnsRemaining() };
  }

  turnsRemaining() {
    return this.maxTurns === null
      ? Infinity
      : Math.max(0, this.maxTurns - this.turns);
  }

  acquireWork({ id, kind = "spawn", depth = 1 } = {}) {
    this._assertAuthorityMutationAllowed();
    const key = String(id || "");
    if (!key) throw new TypeError("session budget work id is required");
    if (!RESOURCE_ID_PATTERN.test(key)) {
      throw new TypeError("invalid session budget work id");
    }
    const normalizedKind = String(kind || "spawn");
    if (!normalizedKind || normalizedKind.length > 128) {
      throw new TypeError("invalid session budget work kind");
    }
    const normalizedDepth = normalizeNonNegativeInteger("depth", depth);
    try {
      this.start();
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: key });
    }
    if (this._activeWorkLabels.has(key)) {
      return this._admissionFailure("duplicate-work-id", { id: key });
    }
    if (this._activeToolLabels.has(key)) {
      return this._admissionFailure("duplicate-resource-id", { id: key });
    }
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", {
        id: key,
      });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id: key });
    }
    if (this.maxDepth !== null && normalizedDepth > this.maxDepth) {
      return this._admissionFailure("max-depth", {
        id: key,
        depth: normalizedDepth,
      });
    }
    if (
      this.maxConcurrent !== null &&
      this._activeWork.size >= this.maxConcurrent
    ) {
      return this._admissionFailure("max-concurrent", { id: key });
    }
    if (this.maxSpawns !== null && this.spawns >= this.maxSpawns) {
      return this._admissionFailure("max-spawns", { id: key });
    }

    const authorityId = this._nextAuthorityId("work");
    const entry = {
      id: authorityId,
      label: key,
      kind: normalizedKind,
      depth: normalizedDepth,
      startedAt: this._now(),
    };
    const previousSpawns = this.spawns;
    this._activeWork.set(authorityId, entry);
    this._activeWorkLabels.set(key, authorityId);
    this.spawns = previousSpawns + 1;
    try {
      this._authorityChanged(
        "budget:work-acquired",
        {
          id: key,
          kind: normalizedKind,
          depth: normalizedDepth,
          active: this._activeWork.size,
          spawns: this.spawns,
        },
        {
          rollback: () => {
            this._activeWork.delete(authorityId);
            this._activeWorkLabels.delete(key);
            this.spawns = previousSpawns;
          },
        },
      );
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: key });
    }
    let released = false;
    const release = () => {
      if (released) return false;
      const didRelease = this.releaseWork(authorityId);
      if (didRelease) released = true;
      return didRelease;
    };
    return {
      ok: true,
      id: key,
      authorityId,
      kind: normalizedKind,
      depth: normalizedDepth,
      release,
    };
  }

  releaseWork(id) {
    this._assertAuthorityMutationAllowed();
    const key = String(id || "");
    const entry = this._activeWork.get(key);
    if (!entry) return false;
    this._activeWork.delete(key);
    this._activeWorkLabels.delete(entry.label);
    this._authorityChanged(
      "budget:work-released",
      {
        id: entry.label,
        kind: entry.kind,
        active: this._activeWork.size,
      },
      {
        rollback: () => {
          this._activeWork.set(key, entry);
          this._activeWorkLabels.set(entry.label, key);
        },
      },
    );
    return true;
  }

  beginTool({ id, kind = "tool" } = {}) {
    this._assertAuthorityMutationAllowed();
    const key = String(id || "");
    if (!key) throw new TypeError("session budget tool id is required");
    if (!RESOURCE_ID_PATTERN.test(key)) {
      throw new TypeError("invalid session budget tool id");
    }
    const normalizedKind = String(kind || "tool");
    if (!normalizedKind || normalizedKind.length > 128) {
      throw new TypeError("invalid session budget tool kind");
    }
    try {
      this.start();
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: key });
    }
    if (this._activeToolLabels.has(key)) {
      return this._admissionFailure("duplicate-tool-id", { id: key });
    }
    if (this._activeWorkLabels.has(key)) {
      return this._admissionFailure("duplicate-resource-id", { id: key });
    }
    if (this.signal.aborted) {
      return this._admissionFailure(this.reason() || "session-aborted", {
        id: key,
      });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id: key });
    }
    const now = this._now();
    if (this.maxToolMs !== null && this._toolMsAt(now) >= this.maxToolMs) {
      this._abortFor("max-tool-ms");
      return this._admissionFailure("max-tool-ms", { id: key });
    }
    const authorityId = this._nextAuthorityId("tool");
    this._activeTools.set(authorityId, {
      id: authorityId,
      label: key,
      kind: normalizedKind,
      depth: null,
      startedAt: now,
    });
    this._activeToolLabels.set(key, authorityId);
    try {
      this._authorityChanged(
        "budget:tool-started",
        {
          id: key,
          kind: normalizedKind,
          active: this._activeTools.size,
        },
        {
          rollback: () => {
            this._activeTools.delete(authorityId);
            this._activeToolLabels.delete(key);
          },
        },
      );
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: key });
    }
    this._armDeadline(now);
    let ended = false;
    const end = () => {
      if (ended) return false;
      const didEnd = this.endTool(authorityId);
      if (didEnd) ended = true;
      return didEnd;
    };
    return { ok: true, id: key, authorityId, kind: normalizedKind, end };
  }

  endTool(id, now = this._now()) {
    this._assertAuthorityMutationAllowed();
    const key = String(id || "");
    const entry = this._activeTools.get(key);
    if (!entry) return false;
    const previousToolMs = this._toolMs;
    this._activeTools.delete(key);
    this._activeToolLabels.delete(entry.label);
    this._toolMs += Math.max(0, now - entry.startedAt);
    this._authorityChanged(
      "budget:tool-ended",
      {
        id: entry.label,
        kind: entry.kind,
        toolMs: this._toolMs,
        active: this._activeTools.size,
      },
      {
        rollback: () => {
          this._activeTools.set(key, entry);
          this._activeToolLabels.set(entry.label, key);
          this._toolMs = previousToolMs;
        },
      },
    );
    const reason = this._continuousReason(now);
    if (reason) this._abortFor(reason);
    else this._armDeadline(now);
    return true;
  }

  beginUsageSettlement({ id, settleAfterAbort = false } = {}) {
    this._assertAuthorityMutationAllowed();
    const label = normalizeUsageSettlementLabel(id);
    try {
      this.start();
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: label });
    }
    if (this.signal.aborted && settleAfterAbort !== true) {
      return this._admissionFailure(this.reason() || "session-aborted", {
        id: label,
      });
    }
    if (this._recoveryUnknown.size > 0) {
      return this._admissionFailure("recovery-required", { id: label });
    }
    if (this._pendingUsageLabels.has(label)) {
      return this._admissionFailure("duplicate-usage-settlement-id", {
        id: label,
      });
    }
    const authorityId = this._nextUsageSettlementId();
    const entry = {
      id: authorityId,
      label,
      kind: "usage-settlement",
      depth: 0,
      startedAt: this._now(),
    };
    this._pendingUsage.set(authorityId, entry);
    this._pendingUsageLabels.set(label, authorityId);
    try {
      this._authorityChanged(
        "budget:usage-settlement-started",
        {
          pendingUsage: this._pendingUsage.size,
        },
        {
          rollback: () => {
            this._pendingUsage.delete(authorityId);
            this._pendingUsageLabels.delete(label);
          },
        },
      );
    } catch (error) {
      return this._persistenceAdmissionFailure(error, { id: label });
    }
    return { ok: true, id: label, authorityId };
  }

  _pendingUsageSettlement(callId) {
    if (callId !== undefined && callId !== null) {
      const label = normalizeUsageSettlementLabel(callId);
      const authorityId = this._pendingUsageLabels.get(label);
      if (!authorityId) {
        throw new SessionBudgetError("usage-settlement-not-started");
      }
      return { label, authorityId };
    }
    if (this._pendingUsage.size > 0) {
      throw new SessionBudgetError("usage-settlement-pending");
    }
    const label = `inline:${randomUUID()}`;
    const admission = this.beginUsageSettlement({
      id: label,
      settleAfterAbort: true,
    });
    if (!admission?.ok) {
      if (admission?.reason === "persistence-failed") {
        this._assertAuthorityMutationAllowed();
      }
      throw new SessionBudgetError(
        admission?.reason || "usage-settlement-not-started",
      );
    }
    return { label, authorityId: admission.authorityId };
  }

  markUsageUnknown({ callId } = {}) {
    this._assertAuthorityMutationAllowed();
    const { label, authorityId } = this._pendingUsageSettlement(callId);
    const pending = this._pendingUsage.get(authorityId);
    this._pendingUsage.delete(authorityId);
    this._pendingUsageLabels.delete(label);
    const recovery = { ...pending, resourceType: "work" };
    this._recoveryUnknown.set(authorityId, recovery);
    this._authorityChanged(
      "budget:usage-unknown",
      {
        pendingUsage: this._pendingUsage.size,
        pendingRecovery: this._recoveryUnknown.size,
      },
      {
        rollback: () => {
          this._recoveryUnknown.delete(authorityId);
          this._pendingUsage.set(authorityId, pending);
          this._pendingUsageLabels.set(label, authorityId);
        },
      },
    );
    return this.status();
  }

  recordUsage({
    callId = null,
    usage = null,
    usageRecords = null,
    provider,
    model,
  } = {}) {
    this._assertAuthorityMutationAllowed();
    this.start();
    let accounting;
    try {
      accounting = calculateUsageAccounting(
        {
          tokens: this.tokens,
          cost: this.cost,
          unpricedUsage: this.unpricedUsage,
        },
        { usage, usageRecords, provider, model },
      );
    } catch (error) {
      this.abort(error, { reason: "invalid-usage" });
      throw error;
    }
    const { label, authorityId: settlementId } =
      this._pendingUsageSettlement(callId);
    const pendingSettlement = this._pendingUsage.get(settlementId);
    const previousTokens = this.tokens;
    const previousCost = this.cost;
    const previousUnpricedUsage = this.unpricedUsage;
    this.tokens = accounting.tokens;
    this.cost = accounting.cost;
    this.unpricedUsage = accounting.unpricedUsage;
    this._pendingUsage.delete(settlementId);
    this._pendingUsageLabels.delete(label);
    this._authorityChanged(
      "budget:usage-recorded",
      {
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
      },
      {
        rollback: () => {
          this.tokens = previousTokens;
          this.cost = previousCost;
          this.unpricedUsage = previousUnpricedUsage;
          this._pendingUsage.set(settlementId, pendingSettlement);
          this._pendingUsageLabels.set(label, settlementId);
        },
      },
    );
    const reason = this._continuousReason();
    if (reason) this._abortFor(reason);
    return this.status();
  }

  _nextUsageSettlementId() {
    return this._nextAuthorityId("usage");
  }

  registerAbortable(id, stop) {
    this._assertAuthorityMutationAllowed();
    const key = String(id || "");
    if (!key) throw new TypeError("session budget abortable id is required");
    if (this._abortables.has(key)) {
      throw new Error(`session budget abortable already registered: ${key}`);
    }
    let callback;
    if (typeof stop === "function") callback = stop;
    else if (stop && typeof stop.abort === "function") {
      callback = (reason) => stop.abort(reason);
    } else if (stop && typeof stop.kill === "function") {
      callback = () => stop.kill("SIGTERM");
    } else {
      throw new TypeError("session budget abortable must be callable");
    }

    if (this.signal.aborted) {
      try {
        callback(this.signal.reason);
      } catch {
        // The budget remains aborted even when a descendant cleanup fails.
      }
      return () => false;
    }
    this._abortables.set(key, callback);
    this._emit("budget:abortable-registered", {
      id: key,
      resources: this._abortables.size,
    });
    let registered = true;
    return () => {
      this._assertAuthorityMutationAllowed();
      if (!registered) return false;
      registered = false;
      const deleted = this._abortables.delete(key);
      if (deleted) {
        this._emit("budget:abortable-unregistered", {
          id: key,
          resources: this._abortables.size,
        });
      }
      return deleted;
    };
  }

  _abortFor(reason) {
    return this.abort(new SessionBudgetError(reason), { reason });
  }

  abort(
    reason = "session-aborted",
    { reason: reasonCode = null, skipAuthorityChange = false } = {},
  ) {
    this._assertAuthorityMutationAllowed();
    return this._abortUnchecked(reason, {
      reason: reasonCode,
      skipAuthorityChange,
    });
  }

  _abortUnchecked(
    reason = "session-aborted",
    { reason: reasonCode = null, skipAuthorityChange = false } = {},
  ) {
    if (this._abortState) return false;
    const error = safeReason(reason);
    const code = String(
      reasonCode || error.budgetReason || error.code || "session-aborted",
    ).slice(0, 128);
    this._abortState = {
      reason: code,
      message: String(error.message || code).slice(0, 512),
      at: this._now(),
    };
    this._clearDeadline();
    try {
      this._abortController.abort(error);
    } catch {
      this._abortController.abort();
    }
    const callbacks = [...this._abortables.entries()];
    this._abortables.clear();
    const cleanupErrors = [];
    for (const [id, callback] of callbacks) {
      try {
        callback(error);
      } catch (cleanupError) {
        cleanupErrors.push({
          id,
          message: String(cleanupError?.message || cleanupError).slice(0, 256),
        });
      }
    }
    const detail = {
      reason: code,
      cleanupErrors,
      activeWork: this._activeWork.size,
      activeTools: this._activeTools.size,
      pendingUsage: this._pendingUsage.size,
    };
    if (skipAuthorityChange) this._emit("budget:aborted", detail);
    else this._authorityChanged("budget:aborted", detail);
    return true;
  }

  _clearDeadline() {
    if (this._deadlineTimer === null) return;
    this._clearTimer(this._deadlineTimer);
    this._deadlineTimer = null;
  }

  _armDeadline(now = this._now()) {
    this._clearDeadline();
    if (this.signal.aborted || this._recoveryUnknown.size > 0) return;
    const immediate = this._continuousReason(now);
    if (immediate) {
      this._abortFor(immediate);
      return;
    }
    let delay = Infinity;
    if (this.maxWallMs !== null && this._startedAt !== null) {
      delay = Math.min(delay, this.maxWallMs - this._elapsedAt(now));
    }
    if (this.maxToolMs !== null && this._activeTools.size > 0) {
      const remaining = this.maxToolMs - this._toolMsAt(now);
      delay = Math.min(delay, remaining / this._activeTools.size);
    }
    if (!Number.isFinite(delay)) return;
    const wait = Math.max(1, Math.min(MAX_TIMER_DELAY, Math.ceil(delay)));
    this._deadlineTimer = this._setTimer(() => {
      this._deadlineTimer = null;
      try {
        const reason = this._continuousReason(this._now());
        if (reason) this._abortFor(reason);
        else this._armDeadline(this._now());
      } catch {
        // Persistence rejection already failed the authority closed. Timer
        // callbacks must not turn that handled safety stop into an uncaught
        // process exception.
      }
    }, wait);
    this._deadlineTimer?.unref?.();
  }

  pendingRecovery() {
    return [...this._recoveryUnknown.values()].map((entry) => {
      const copy = { ...entry };
      delete copy.resourceType;
      return copy;
    });
  }

  adjudicateRecovery({ abandoned = [], settled = [] } = {}) {
    this._assertAuthorityMutationAllowed();
    if (!Array.isArray(abandoned)) {
      throw new TypeError(
        "session budget abandoned recovery ids must be an array",
      );
    }
    if (!Array.isArray(settled)) {
      throw new TypeError(
        "session budget settled recovery records must be an array",
      );
    }
    const abandonedIds = abandoned.map((id) => String(id));
    const normalizedSettlements = settled.map((record, index) => {
      if (!isRecord(record)) {
        throw new TypeError(
          `invalid session budget recovery settlement at index ${index}`,
        );
      }
      const authorityId = String(record.authorityId || "");
      if (!OPAQUE_AUTHORITY_ID_PATTERNS.usage.test(authorityId)) {
        throw new TypeError(
          `invalid session budget recovery settlement authority at index ${index}`,
        );
      }
      const normalized = { ...record, authorityId };
      return {
        ...normalized,
        canonical: canonicalRecoverySettlement(normalized, index),
      };
    });
    const settledIds = normalizedSettlements.map(
      (record) => record.authorityId,
    );
    const suppliedIds = [...abandonedIds, ...settledIds];
    const supplied = new Set(suppliedIds);
    const expected = new Set(this._recoveryUnknown.keys());
    if (supplied.size !== suppliedIds.length) {
      return {
        ok: false,
        reason: "recovery-adjudication-duplicate",
        pending: this.pendingRecovery(),
      };
    }
    if (
      supplied.size !== expected.size ||
      [...expected].some((id) => !supplied.has(id))
    ) {
      return {
        ok: false,
        reason: "recovery-adjudication-incomplete",
        pending: this.pendingRecovery(),
      };
    }
    for (const record of normalizedSettlements) {
      const pending = this._recoveryUnknown.get(record.authorityId);
      if (
        pending?.resourceType !== "work" ||
        pending?.kind !== "usage-settlement"
      ) {
        return {
          ok: false,
          reason: "recovery-settlement-not-usage",
          authorityId: record.authorityId,
          pending: this.pendingRecovery(),
        };
      }
    }
    let accounting = {
      tokens: this.tokens,
      cost: this.cost,
      unpricedUsage: this.unpricedUsage,
    };
    for (const record of normalizedSettlements) {
      accounting = calculateUsageAccounting(accounting, record);
    }
    const previousAdjudication = this._recoveryAdjudication;
    const sequence = (previousAdjudication?.count || 0) + 1;
    const previousDigest = previousAdjudication?.headDigest || null;
    const sortedAbandoned = [...abandonedIds].sort();
    const sortedSettlements = normalizedSettlements
      .map((record) => record.canonical)
      .sort((left, right) =>
        left.authorityId.localeCompare(right.authorityId),
      );
    const tokenDelta = accounting.tokens - this.tokens;
    const spentUsdDelta = accounting.cost.spentUsd - this.cost.spentUsd;
    const adjudicationCore = {
      schema: SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA,
      sequence,
      previousDigest,
      abandoned: sortedAbandoned,
      settled: sortedSettlements,
      totalsBefore: {
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
      },
      totalsAfter: {
        tokens: accounting.tokens,
        spentUsd: accounting.cost.spentUsd,
      },
    };
    const adjudicationDigest = sha256(canonicalJson(adjudicationCore));
    const receipt = {
      ...adjudicationCore,
      digest: adjudicationDigest,
    };
    const adjudicationState = {
      sequence,
      digest: adjudicationDigest,
      previousDigest,
      settledCount: settledIds.length,
      abandonedCount: abandonedIds.length,
      tokenDelta,
      spentUsdDelta,
    };
    const adjudication = {
      schema: SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA,
      ...adjudicationState,
    };
    const previousRecovery = [...this._recoveryUnknown.entries()];
    const previousTokens = this.tokens;
    const previousCost = this.cost;
    const previousUnpricedUsage = this.unpricedUsage;
    this.tokens = accounting.tokens;
    this.cost = accounting.cost;
    this.unpricedUsage = accounting.unpricedUsage;
    this._recoveryAdjudication = {
      schema: SESSION_BUDGET_RECOVERY_ADJUDICATION_SCHEMA,
      count: sequence,
      headDigest: adjudicationDigest,
      last: adjudicationState,
      history: {
        schema: SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA,
        baseSequence:
          previousAdjudication?.history?.baseSequence ??
          previousAdjudication?.count ??
          0,
        baseDigest:
          previousAdjudication?.history !== undefined
            ? previousAdjudication.history.baseDigest
            : previousAdjudication?.headDigest || null,
        entries: [
          ...(previousAdjudication?.history?.entries || []).map(
            cloneCanonicalRecord,
          ),
          receipt,
        ],
      },
    };
    this._recoveryUnknown.clear();
    this._authorityChanged(
      "budget:recovery-adjudicated",
      {
        abandonedCount: abandonedIds.length,
        settledCount: settledIds.length,
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
        adjudicationDigest,
      },
      {
        rollback: () => {
          this.tokens = previousTokens;
          this.cost = previousCost;
          this.unpricedUsage = previousUnpricedUsage;
          this._recoveryAdjudication = previousAdjudication;
          for (const [id, entry] of previousRecovery) {
            this._recoveryUnknown.set(id, entry);
          }
        },
      },
    );
    const reason = this._continuousReason();
    if (reason) this._abortFor(reason);
    else this._armDeadline();
    return {
      ok: true,
      abandoned: [...abandonedIds].sort(),
      settled: [...settledIds].sort(),
      adjudication: { ...adjudication },
      receipt: cloneCanonicalRecord(receipt),
    };
  }

  recoveryAdjudicationReceipts() {
    if (!this._recoveryAdjudication) {
      return {
        schema: SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA,
        count: 0,
        headDigest: null,
        baseSequence: 0,
        baseDigest: null,
        complete: true,
        entries: [],
      };
    }
    const history = this._recoveryAdjudication.history;
    return {
      schema: SESSION_BUDGET_RECOVERY_RECEIPT_HISTORY_SCHEMA,
      count: this._recoveryAdjudication.count,
      headDigest: this._recoveryAdjudication.headDigest,
      baseSequence: history?.baseSequence ?? this._recoveryAdjudication.count,
      baseDigest: history
        ? history.baseDigest
        : this._recoveryAdjudication.headDigest,
      complete: history ? history.baseSequence === 0 : false,
      entries: history?.entries.map(cloneCanonicalRecord) || [],
    };
  }

  status(now = this._now()) {
    return {
      spawns: this.spawns,
      maxSpawns: this.maxSpawns,
      active: this._activeWork.size,
      maxConcurrent: this.maxConcurrent,
      maxDepth: this.maxDepth,
      turns: this.turns,
      maxTurns: this.maxTurns,
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      spentUsd: this.cost.spentUsd,
      maxUsd: this.cost.limitUsd,
      elapsedMs: this._elapsedAt(now),
      maxWallMs: this.maxWallMs,
      toolMs: this._toolMsAt(now),
      maxToolMs: this.maxToolMs,
      activeTools: this._activeTools.size,
      pendingUsage: this._pendingUsage.size,
      resources: this._abortables.size,
      recoveryRequired: this._recoveryUnknown.size > 0,
      pendingRecovery: this._recoveryUnknown.size,
      recoveryAdjudication: cloneRecoveryAdjudication(
        this._recoveryAdjudication,
        { includeReceipts: false },
      ),
      unpricedUsage: this.unpricedUsage,
      aborted: this.signal.aborted,
      reason: this.reason(now),
    };
  }

  snapshot(now = this._now()) {
    const activeWork = [...this._activeWork.values()].map((entry) =>
      snapshotResource(entry, now, "work"),
    );
    const pendingUsage = [...this._pendingUsage.values()].map((entry) =>
      snapshotResource(entry, now, "work"),
    );
    const activeTools = [...this._activeTools.values()].map((entry) =>
      snapshotResource(entry, now, "tool"),
    );
    const recoveryWork = [];
    const recoveryTools = [];
    for (const entry of this._recoveryUnknown.values()) {
      const { resourceType, ...persisted } = entry;
      if (resourceType === "tool") recoveryTools.push({ ...persisted });
      else recoveryWork.push({ ...persisted });
    }
    return {
      version: SESSION_RESOURCE_BUDGET_VERSION,
      limits: {
        maxConcurrent: this.maxConcurrent,
        maxSpawns: this.maxSpawns,
        maxDepth: this.maxDepth,
        maxTurns: this.maxTurns,
        maxTokens: this.maxTokens,
        maxUsd: this.cost.limitUsd,
        maxWallMs: this.maxWallMs,
        maxToolMs: this.maxToolMs,
      },
      totals: {
        spawns: this.spawns,
        turns: this.turns,
        tokens: this.tokens,
        spentUsd: this.cost.spentUsd,
        elapsedMs: this._elapsedAt(now),
        toolMs: this._toolMsAt(now),
        unpricedUsage: this.unpricedUsage,
      },
      inFlight: {
        work: [...activeWork, ...pendingUsage, ...recoveryWork],
        tools: [...activeTools, ...recoveryTools],
      },
      state: {
        started: this._startedAt !== null,
        abort: this._abortState ? { ...this._abortState } : null,
        ...(this._recoveryAdjudication
          ? {
              recoveryAdjudication: cloneRecoveryAdjudication(
                this._recoveryAdjudication,
              ),
            }
          : {}),
      },
    };
  }

  static restore(
    snapshot,
    {
      overrides = {},
      table = undefined,
      now = () => Date.now(),
      setTimer = (fn, delay) => setTimeout(fn, delay),
      clearTimer = (timer) => clearTimeout(timer),
      signal = null,
      onEvent = null,
      onAuthorityChange = null,
      queueObservation = (callback) => queueMicrotask(callback),
      recoverUnsettled = "require-adjudication",
    } = {},
  ) {
    const normalized = normalizeSessionResourceBudgetSnapshot(snapshot);
    if (
      recoverUnsettled !== "require-adjudication" &&
      recoverUnsettled !== "abandon"
    ) {
      throw new TypeError("invalid session budget recovery policy");
    }
    const requestedLimits = normalizeLimitOverrides(overrides);
    const limits = {};
    for (const field of LIMIT_FIELDS) {
      limits[field] = tightenLimit(
        field,
        normalized.limits[field],
        requestedLimits[field],
      );
    }
    const budget = new SessionResourceBudget({
      ...limits,
      table,
      now,
      setTimer,
      clearTimer,
      signal,
      onEvent,
      onAuthorityChange,
      queueObservation,
    });
    budget.spawns = normalized.totals.spawns;
    budget.turns = normalized.totals.turns;
    budget.tokens = normalized.totals.tokens;
    budget.cost.spentUsd = normalized.totals.spentUsd;
    if (budget.cost.spentUsd > 0) budget.cost.priced = true;
    budget.unpricedUsage = normalized.totals.unpricedUsage;
    budget._elapsedMs = normalized.totals.elapsedMs;
    budget._toolMs = normalized.totals.toolMs;
    const restoredAt = budget._now();
    budget._startedAt = normalized.state.started ? restoredAt : null;
    budget._recoveryAdjudication = cloneRecoveryAdjudication(
      normalized.state.recoveryAdjudication,
    );

    if (recoverUnsettled === "require-adjudication") {
      for (const entry of normalized.inFlight.work) {
        budget._issuedAuthorityIds.add(entry.id);
        budget._recoveryUnknown.set(entry.id, {
          ...entry,
          resourceType: "work",
        });
      }
      for (const entry of normalized.inFlight.tools) {
        budget._issuedAuthorityIds.add(entry.id);
        budget._recoveryUnknown.set(entry.id, {
          ...entry,
          resourceType: "tool",
        });
      }
    }

    if (normalized.state.abort) {
      const error = new SessionBudgetError(
        normalized.state.abort.reason,
        normalized.state.abort.message,
      );
      budget.abort(error, { reason: normalized.state.abort.reason });
    } else if (budget._recoveryUnknown.size === 0) {
      const reason = budget._continuousReason(restoredAt);
      if (reason) budget._abortFor(reason);
      else budget._armDeadline(restoredAt);
    }
    budget._emit("budget:restored", {
      recoveryRequired: budget._recoveryUnknown.size > 0,
    });
    return budget;
  }

  dispose() {
    this._assertAuthorityMutationAllowed();
    this._clearDeadline();
    if (this._externalSignal && this._externalAbortListener) {
      this._externalSignal.removeEventListener?.(
        "abort",
        this._externalAbortListener,
      );
    }
    this._externalAbortListener = null;
  }
}

export function isContinuousSessionBudgetReason(reason) {
  return CONTINUOUS_REASONS.has(reason);
}
