/**
 * Bounded, secret-free causal observability projections.
 *
 * Session projections are reduced while readVerifiedProjection() holds the
 * transcript lock. They never retain prompts, tool arguments/results or raw
 * events. Delivery snapshots must already have passed restoreDeliveryFlow().
 */

import crypto from "node:crypto";
import { PRICE_TABLE, priceRollup } from "./llm-pricing.js";
import { canonicalDeliveryJson } from "./delivery-evidence.js";
import { createSessionTranscriptStructureProjection } from "./session-transcript-structure.js";

export const CAUSAL_OBSERVABILITY_SCHEMA =
  "chainlesschain.causal-observability-report";
export const CAUSAL_OBSERVABILITY_VERSION = 1;
export const CAUSAL_OBSERVABILITY_REQUEST_SCHEMA =
  "chainlesschain.causal-observability-request";

const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 128;
const MAX_PROVIDER_LENGTH = 64;
const MAX_TOOL_LENGTH = 256;
const MAX_REQUEST_DELIVERIES = 128;
const MAX_DELIVERY_ASSOCIATIONS = 128;
const MAX_REPORT_SESSIONS = 512;
const MAX_REPORT_MODEL_ROWS = 4096;
const MAX_REPORT_TOOL_ROWS = 16384;
const MAX_DELIVERY_SELECTED_GATES = 256;
const MAX_DELIVERY_GATE_RESULTS = 256;
const MAX_DELIVERY_GATE_MATRIX_CELLS = 1024;
const MAX_DELIVERY_PREVIEW_ARTIFACTS = 256;
const MAX_REPORT_GATE_ROWS = 4096;
const MAX_REPORT_GATE_MATRIX_CELLS = 16384;
const MAX_REPORT_PREVIEW_ARTIFACTS = 4096;
const MAX_DISTINCT_MODELS = 1024;
const MAX_DISTINCT_TOOLS = 4096;
const MAX_TOOL_DURATION_SAMPLES = 100_000;
const MAX_SAFE_TOKEN_BUDGET = Number.MAX_SAFE_INTEGER;
const SCOPE_KEYS = Object.freeze(["workspaceId", "teamId", "policyId"]);
const REQUEST_KEYS = Object.freeze([
  "schema",
  "version",
  "deliveryStates",
  "filter",
  "budgets",
]);
const BUDGET_KEYS = Object.freeze([
  "maxTokens",
  "maxUsd",
  "maxRetries",
  "maxRetryRatio",
  "maxToolP95Ms",
]);
const DELIVERY_STATUSES = new Set([
  "active",
  "blocked",
  "stopped",
  "completed",
]);
const DELIVERY_PHASES = new Set([
  "gates",
  "preview",
  "review",
  "fix",
  "pr",
  "ci",
  "evidence",
  "merge",
  "archive",
  "completed",
]);
const TOKEN_FIELD_ALIASES = Object.freeze([
  "input_tokens",
  "prompt_tokens",
  "inputTokens",
  "output_tokens",
  "completion_tokens",
  "outputTokens",
  "cache_read_input_tokens",
  "cacheReadTokens",
  "cache_creation_input_tokens",
  "cacheCreationTokens",
  "total_tokens",
  "totalTokens",
]);
const USAGE_SOURCES = new Set(["model", "semantic-compaction", "subagent"]);
const RETRY_REASONS = new Set([
  "timeout",
  "dns",
  "connection_refused",
  "network_unreachable",
  "connection_reset",
  "unknown",
]);

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalDeliveryJson(value))
    .digest("hex")}`;
}

function compareStrings(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertKnownOwnKeys(value, allowed, field) {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new Error(`${field} contains unsupported key: ${String(key)}`);
    }
  }
}

function safeInteger(value, field, { min = 0, required = true } = {}) {
  if (value == null && !required) return null;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${field} must be a safe integer >= ${min}`);
  }
  return value;
}

function finiteNonnegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function exactCommit(value, field, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (
    typeof value !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)
  ) {
    throw new Error(`${field} must be an exact commit SHA`);
  }
  return value.toLowerCase();
}

function sha256Digest(value, field, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${field} must be a SHA-256 digest`);
  }
  return value.toLowerCase();
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function asId(
  value,
  field,
  { required = false, maxLength = MAX_ID_LENGTH } = {},
) {
  if (value == null) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be blank`);
  if (normalized.length > maxLength || hasControlCharacters(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function boundedLabel(value, field, max, { fallback = null } = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > max ||
    hasControlCharacters(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizePricingTable(table = PRICE_TABLE) {
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("pricing table must be an object");
  }
  const providers = Object.entries(table);
  if (providers.length > 256) {
    throw new Error("pricing table exceeds the provider limit");
  }
  let entryCount = 0;
  const normalized = new Map();
  for (const [provider, entries] of providers) {
    const providerKey = boundedLabel(
      provider,
      "pricing provider",
      MAX_PROVIDER_LENGTH,
    ).toLowerCase();
    if (normalized.has(providerKey)) {
      throw new Error(`pricing table has duplicate provider: ${providerKey}`);
    }
    if (!Array.isArray(entries)) {
      throw new Error(`pricing entries for ${providerKey} must be an array`);
    }
    entryCount += entries.length;
    if (entryCount > 4096) {
      throw new Error("pricing table exceeds the entry limit");
    }
    const seenMatches = new Set();
    const normalizedEntries = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("pricing entry must be an object");
      }
      const match = boundedLabel(
        entry.match,
        "pricing match",
        MAX_MODEL_LENGTH,
      ).toLowerCase();
      if (seenMatches.has(match)) {
        throw new Error(
          `pricing entries for ${providerKey} duplicate match: ${match}`,
        );
      }
      seenMatches.add(match);
      const input = entry.in;
      const output = entry.out;
      if (
        typeof input !== "number" ||
        !Number.isFinite(input) ||
        input < 0 ||
        typeof output !== "number" ||
        !Number.isFinite(output) ||
        output < 0
      ) {
        throw new Error("pricing rates must be finite non-negative numbers");
      }
      return { match, in: input, out: output };
    });
    normalized.set(providerKey, normalizedEntries);
  }
  return Object.fromEntries(
    [...normalized.entries()].sort(([left], [right]) =>
      compareStrings(left, right),
    ),
  );
}

function normalizeScope(scope, field = "scope", { requireAny = false } = {}) {
  if (scope != null && (typeof scope !== "object" || Array.isArray(scope))) {
    throw new Error(`${field} must be an object`);
  }
  const value = scope || {};
  assertKnownOwnKeys(value, SCOPE_KEYS, field);
  const normalized = Object.fromEntries(
    SCOPE_KEYS.map((key) => [key, asId(value[key], `${field}.${key}`)]),
  );
  if (requireAny && SCOPE_KEYS.every((key) => normalized[key] === null)) {
    throw new Error(`${field} must define at least one scope dimension`);
  }
  return normalized;
}

function sameScope(left, right) {
  const a = normalizeScope(left, "delivery.scope", { requireAny: true });
  const b = normalizeScope(right, "session.scope", { requireAny: true });
  return SCOPE_KEYS.every((key) => a[key] === b[key]);
}

function normalizeBudgetNumber(value, field, { max = Number.MAX_VALUE } = {}) {
  if (value == null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  ) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function normalizeBudgetInteger(value, field) {
  const normalized = normalizeBudgetNumber(value, field, {
    max: MAX_SAFE_TOKEN_BUDGET,
  });
  if (normalized != null && !Number.isSafeInteger(normalized)) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return normalized;
}

export function normalizeCausalBudgets(budgets) {
  if (
    budgets != null &&
    (typeof budgets !== "object" || Array.isArray(budgets))
  ) {
    throw new Error("budgets must be an object");
  }
  const value = budgets || {};
  assertKnownOwnKeys(value, BUDGET_KEYS, "budgets");
  return {
    maxTokens: normalizeBudgetInteger(value.maxTokens, "budgets.maxTokens"),
    maxUsd: normalizeBudgetNumber(value.maxUsd, "budgets.maxUsd"),
    maxRetries: normalizeBudgetInteger(value.maxRetries, "budgets.maxRetries"),
    maxRetryRatio: normalizeBudgetNumber(
      value.maxRetryRatio,
      "budgets.maxRetryRatio",
      { max: 1 },
    ),
    maxToolP95Ms: normalizeBudgetNumber(
      value.maxToolP95Ms,
      "budgets.maxToolP95Ms",
      { max: MAX_DURATION_MS },
    ),
  };
}

export function normalizeCausalRequest(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("observability request must be an object");
  }
  assertKnownOwnKeys(request, REQUEST_KEYS, "observability request");
  if (
    request.schema != null &&
    request.schema !== CAUSAL_OBSERVABILITY_REQUEST_SCHEMA
  ) {
    throw new Error("observability request schema is unsupported");
  }
  if (request.version != null && request.version !== 1) {
    throw new Error("observability request version is unsupported");
  }
  if (
    !Array.isArray(request.deliveryStates) ||
    request.deliveryStates.length === 0
  ) {
    throw new Error("deliveryStates must contain at least one snapshot path");
  }
  if (request.deliveryStates.length > MAX_REQUEST_DELIVERIES) {
    throw new Error(
      `deliveryStates exceeds the ${MAX_REQUEST_DELIVERIES} snapshot limit`,
    );
  }
  const deliveryStates = [
    ...new Set(
      request.deliveryStates.map((value) =>
        asId(value, "deliveryStates entry", {
          required: true,
          maxLength: 4096,
        }),
      ),
    ),
  ].sort(compareStrings);
  return {
    schema: CAUSAL_OBSERVABILITY_REQUEST_SCHEMA,
    version: 1,
    deliveryStates,
    filter: normalizeScope(request.filter, "filter"),
    budgets: normalizeCausalBudgets(request.budgets),
  };
}

export function scopeMatches(scope, filter) {
  const actual = normalizeScope(scope, "scope");
  const wanted = normalizeScope(filter, "filter");
  return SCOPE_KEYS.every(
    (key) => wanted[key] == null || actual[key] === wanted[key],
  );
}

function observedDuration(event) {
  const data = event?.data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const observed = [];
  for (const key of ["duration_ms", "durationMs"]) {
    if (Object.hasOwn(data, key)) observed.push(data[key]);
  }
  const telemetry = data.result?.toolTelemetryRecord;
  if (
    telemetry &&
    typeof telemetry === "object" &&
    !Array.isArray(telemetry) &&
    Object.hasOwn(telemetry, "durationMs")
  ) {
    observed.push(telemetry.durationMs);
  }
  if (observed.length === 0) return null;
  for (const value of observed) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_DURATION_MS
    ) {
      throw new Error(
        `session duration must be a finite number between 0 and ${MAX_DURATION_MS}`,
      );
    }
  }
  if (new Set(observed).size > 1) {
    throw new Error("session duration aliases are inconsistent");
  }
  return Math.round(observed[0]);
}

export function nearestRankPercentile(values, percentile) {
  const finite = (values || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const rank = Math.max(1, Math.ceil(finite.length * Number(percentile)));
  return finite[Math.min(finite.length, rank) - 1];
}

function nearestRankLowerBoundWithMissingZeros(
  values,
  missingCount,
  percentile,
) {
  if (!Number.isSafeInteger(missingCount) || missingCount < 0) {
    throw new Error("missing percentile samples must be a safe integer");
  }
  const finite = (values || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const population = checkedAdd(
    finite.length,
    missingCount,
    "percentile lower-bound population",
  );
  if (population === 0) return null;
  const rank = Math.max(1, Math.ceil(population * Number(percentile)));
  const observedRank = rank - missingCount;
  return observedRank <= 0 ? 0 : finite[observedRank - 1];
}

function tokenField(raw, aliases, field, { required = false } = {}) {
  const observed = [];
  for (const alias of aliases) {
    if (!Object.hasOwn(raw, alias)) continue;
    const value = raw[alias];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `session usage ${field} must be a non-negative safe integer`,
      );
    }
    observed.push(value);
  }
  if (observed.length > 1) {
    throw new Error(
      `session usage ${field} aliases are inconsistent or ambiguous`,
    );
  }
  if (required && observed.length === 0) {
    throw new Error(`session usage ${field} is required`);
  }
  return observed[0] ?? 0;
}

function usageIdentity(data, raw, key, field, maxLength) {
  const outerOwn = Object.hasOwn(data, key);
  const innerOwn = raw !== data && Object.hasOwn(raw, key);
  const outer = outerOwn
    ? boundedLabel(data[key], `${field} outer`, maxLength)
    : null;
  const inner = innerOwn
    ? boundedLabel(raw[key], `${field} inner`, maxLength)
    : null;
  if (
    outerOwn &&
    innerOwn &&
    (outer ?? "").toLowerCase() !== (inner ?? "").toLowerCase()
  ) {
    throw new Error(`${field} authorities are inconsistent`);
  }
  return outerOwn ? outer : inner;
}

function normalizedUsageSource(value, field, { missing = "model" } = {}) {
  if (value === undefined) return missing;
  if (typeof value !== "string" || !USAGE_SOURCES.has(value)) {
    throw new Error(`${field} is unsupported`);
  }
  return value;
}

function usageSourceIdentity(data, raw) {
  const outerOwn = Object.hasOwn(data, "source");
  const innerOwn = raw !== data && Object.hasOwn(raw, "source");
  const outer = outerOwn
    ? normalizedUsageSource(data.source, "session usage source")
    : null;
  const inner = innerOwn
    ? normalizedUsageSource(raw.source, "session usage source")
    : null;
  if (outerOwn && innerOwn && outer !== inner) {
    throw new Error("session usage source authorities are inconsistent");
  }
  return outerOwn ? outer : innerOwn ? inner : "model";
}

function modelUsageBoundaryIdentity(data, field) {
  return {
    provider: boundedLabel(
      data.provider,
      `${field} provider`,
      MAX_PROVIDER_LENGTH,
    ),
    model: boundedLabel(data.model, `${field} model`, MAX_MODEL_LENGTH),
    source: normalizedUsageSource(data.source, `${field} source`),
    operationId: boundedLabel(
      data.operationId,
      `${field} operationId`,
      MAX_ID_LENGTH,
    ),
  };
}

function sameModelUsageIdentity(left, right) {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.source === right.source &&
    left.operationId === right.operationId
  );
}

function strictUsage(event) {
  if (
    !["token_usage", "assistant_message", "llm_call", "llm_response"].includes(
      event?.type,
    )
  ) {
    return null;
  }
  if (
    event.data != null &&
    (typeof event.data !== "object" || Array.isArray(event.data))
  ) {
    throw new Error("session usage event data must be an object");
  }
  const data = event.data || {};
  const hasUsage = Object.hasOwn(data, "usage");
  const hasTokenUsage = Object.hasOwn(data, "tokenUsage");
  if (hasUsage && hasTokenUsage) {
    throw new Error("session usage payload aliases are ambiguous");
  }
  for (const [key, present] of [
    ["usage", hasUsage],
    ["tokenUsage", hasTokenUsage],
  ]) {
    if (
      present &&
      (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key]))
    ) {
      throw new Error(`session ${key} payload must be an object`);
    }
  }
  const hasOuterTokens = TOKEN_FIELD_ALIASES.some((alias) =>
    Object.hasOwn(data, alias),
  );
  if ((hasUsage || hasTokenUsage) && hasOuterTokens) {
    throw new Error("session usage outer token fields are ambiguous");
  }
  const raw = hasUsage
    ? data.usage
    : hasTokenUsage
      ? data.tokenUsage
      : event.type === "token_usage"
        ? data
        : null;
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("session usage payload must be an object");
  }
  const inputTokens = tokenField(
    raw,
    ["input_tokens", "prompt_tokens", "inputTokens"],
    "inputTokens",
    { required: true },
  );
  const outputTokens = tokenField(
    raw,
    ["output_tokens", "completion_tokens", "outputTokens"],
    "outputTokens",
    { required: true },
  );
  const cacheReadTokens = tokenField(
    raw,
    ["cache_read_input_tokens", "cacheReadTokens"],
    "cacheReadTokens",
  );
  const cacheCreationTokens = tokenField(
    raw,
    ["cache_creation_input_tokens", "cacheCreationTokens"],
    "cacheCreationTokens",
  );
  const expectedTotal = inputTokens + outputTokens;
  if (!Number.isSafeInteger(expectedTotal)) {
    throw new Error("session usage totalTokens exceeds the safe integer limit");
  }
  const totalAliases = ["total_tokens", "totalTokens"];
  const hasSuppliedTotal = totalAliases.some((alias) =>
    Object.hasOwn(raw, alias),
  );
  if (hasSuppliedTotal) {
    const suppliedTotal = tokenField(raw, totalAliases, "totalTokens");
    if (suppliedTotal !== expectedTotal) {
      throw new Error("session usage totalTokens is inconsistent");
    }
  }
  const callId = Object.hasOwn(data, "callId")
    ? asId(data.callId, "session usage callId", { required: true })
    : null;
  if (
    callId == null &&
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheCreationTokens === 0
  ) {
    return null;
  }
  return {
    callId,
    operationId: boundedLabel(
      data.operationId,
      "session usage operationId",
      MAX_ID_LENGTH,
    ),
    provider: usageIdentity(
      data,
      raw,
      "provider",
      "session usage provider",
      MAX_PROVIDER_LENGTH,
    ),
    model: usageIdentity(
      data,
      raw,
      "model",
      "session usage model",
      MAX_MODEL_LENGTH,
    ),
    source: usageSourceIdentity(data, raw),
    inputTokens,
    outputTokens,
    totalTokens: expectedTotal,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function checkedAdd(left, right, field) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} exceeds the safe integer limit`);
  }
  return value;
}

function nestedRow(rowMap, provider, model, createRow) {
  const providerKey = provider ?? null;
  const modelKey = model ?? null;
  let models = rowMap.get(providerKey);
  if (!models) {
    models = new Map();
    rowMap.set(providerKey, models);
  }
  let row = models.get(modelKey);
  if (!row) {
    row = createRow();
    models.set(modelKey, row);
  }
  return row;
}

function nestedRows(rowMap) {
  return [...rowMap.values()].flatMap((models) => [...models.values()]);
}

function emptyUsageSums() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    budgetTokens: 0,
    calls: 0,
  };
}

function addUsageSums(target, usage, field) {
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
  ]) {
    target[key] = checkedAdd(target[key], usage[key], `${field}.${key}`);
  }
  target.budgetTokens = checkedAdd(
    target.budgetTokens,
    checkedAdd(
      usage.totalTokens,
      checkedAdd(
        usage.cacheReadTokens,
        usage.cacheCreationTokens,
        `${field}.cacheTokens`,
      ),
      `${field}.budgetTokens`,
    ),
    `${field}.budgetTokens`,
  );
  target.calls = checkedAdd(target.calls, 1, `${field}.calls`);
}

function firstAndLastTime(current, timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return current;
  return {
    first: current.first == null ? value : Math.min(current.first, value),
    last: current.last == null ? value : Math.max(current.last, value),
  };
}

function observedIsoTime(value, field) {
  if (value == null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} is outside the supported timestamp range`);
  }
  return date.toISOString();
}

/** Create a bounded streaming reducer for readVerifiedProjection(). */
export function createVerifiedSessionObservabilityProjection(
  sessionId,
  { pricingTable } = {},
) {
  const id = asId(sessionId, "sessionId", { required: true });
  const effectivePricingTable = normalizePricingTable(pricingTable);
  const usageTotal = emptyUsageSums();
  const usageByModel = new Map();
  const toolRows = new Map();
  const durations = [];
  const retryByReason = new Map();
  const retryByModel = new Map();
  const unknownUsageByCode = new Map();
  const modelUsageCalls = new Map();
  const toolUsageCalls = new Map();
  const transcriptStructure = createSessionTranscriptStructureProjection(id, {
    failFast: true,
  });
  let scope = null;
  let sessionUsageDefaults = { provider: null, model: null };
  let callLedgerRequired = false;
  let sawModelUsageStarted = false;
  let times = { first: null, last: null };
  let totalRetries = 0;
  let retryDurationMs = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalToolDurationMs = 0;
  let timedToolCalls = 0;
  let retryToolCalls = 0;
  let pendingTool = null;
  let toolFailures = new Map();
  let acceptedEvents = 0;
  let finished = false;
  let toolTelemetryComplete = true;
  let unknownToolEvents = 0;

  const recordUnknownUsage = (code, count = 1) => {
    unknownUsageByCode.set(
      code,
      checkedAdd(
        unknownUsageByCode.get(code) || 0,
        count,
        `session ${id} unknown usage evidence`,
      ),
    );
  };

  const toolRow = (name) => {
    let row = toolRows.get(name);
    if (!row) {
      if (toolRows.size >= MAX_DISTINCT_TOOLS) {
        throw new Error(`session ${id} exceeds the distinct tool limit`);
      }
      row = { tool: name, calls: 0, errors: 0, retries: 0 };
      toolRows.set(name, row);
    }
    return row;
  };

  const recordDuration = (row, duration) => {
    if (duration == null) return;
    if (durations.length >= MAX_TOOL_DURATION_SAMPLES) {
      throw new Error(
        `session ${id} exceeds the ${MAX_TOOL_DURATION_SAMPLES} tool timing sample limit`,
      );
    }
    durations.push(duration);
    totalToolDurationMs = checkedAdd(
      totalToolDurationMs,
      duration,
      "session tools.totalDurationMs",
    );
    timedToolCalls = checkedAdd(timedToolCalls, 1, "session tools.timedCalls");
    row.durationMs = checkedAdd(
      row.durationMs || 0,
      duration,
      "session tool.durationMs",
    );
    row.timedCalls = checkedAdd(
      row.timedCalls || 0,
      1,
      "session tool.timedCalls",
    );
  };

  const recordUnknownToolEvent = () => {
    toolTelemetryComplete = false;
    unknownToolEvents = checkedAdd(
      unknownToolEvents,
      1,
      "session unknown tool events",
    );
  };

  const markToolFailure = (name) => {
    const previous = toolFailures.get(name);
    toolFailures.set(name, {
      active: true,
      generation: checkedAdd(
        previous?.generation || 0,
        1,
        "session tool failure generation",
      ),
    });
  };

  const clearToolFailure = (name, retryGeneration) => {
    if (retryGeneration == null) return;
    const current = toolFailures.get(name);
    if (current?.active === true && current.generation === retryGeneration) {
      toolFailures.set(name, { ...current, active: false });
    }
  };

  return {
    accept(event) {
      transcriptStructure.accept(event);
      acceptedEvents = checkedAdd(
        acceptedEvents,
        1,
        `session ${id} observed event count`,
      );
      times = firstAndLastTime(times, event?.timestamp);
      if (event?.type === "session_start" && scope === null) {
        if (!event.data?.observabilityScope) {
          throw new Error(`session ${id} has no observabilityScope authority`);
        }
        scope = normalizeScope(
          event.data.observabilityScope,
          "session_start.observabilityScope",
          { requireAny: true },
        );
        const provider = boundedLabel(
          event.data.provider,
          "session_start provider",
          MAX_PROVIDER_LENGTH,
        );
        const model = boundedLabel(
          event.data.model,
          "session_start model",
          MAX_MODEL_LENGTH,
        );
        sessionUsageDefaults = { provider, model };
        const hasTelemetryProtocol = Object.hasOwn(
          event.data,
          "usageTelemetryProtocol",
        );
        const hasTelemetryVersion = Object.hasOwn(
          event.data,
          "usageTelemetryVersion",
        );
        if (hasTelemetryProtocol !== hasTelemetryVersion) {
          throw new Error(
            "session usage telemetry protocol marker is incomplete",
          );
        }
        if (hasTelemetryProtocol) {
          if (
            event.data.usageTelemetryProtocol !== "call-ledger" ||
            event.data.usageTelemetryVersion !== 1
          ) {
            throw new Error("session usage telemetry protocol is unsupported");
          }
          callLedgerRequired = true;
        }
      } else if (event?.type === "session_start") {
        throw new Error(`session ${id} contains multiple session_start events`);
      }

      if (event?.type === "model_usage_started") {
        if (
          !event.data ||
          typeof event.data !== "object" ||
          Array.isArray(event.data)
        ) {
          throw new Error("model_usage_started data must be an object");
        }
        const callId = asId(event.data.callId, "model_usage_started callId", {
          required: true,
        });
        const identity = modelUsageBoundaryIdentity(
          event.data,
          "model_usage_started",
        );
        if (modelUsageCalls.has(callId)) {
          throw new Error(`model usage callId already exists: ${callId}`);
        }
        if (modelUsageCalls.size >= MAX_TOOL_DURATION_SAMPLES) {
          throw new Error(
            `session ${id} exceeds the pending model usage limit`,
          );
        }
        modelUsageCalls.set(callId, { status: "started", ...identity });
        sawModelUsageStarted = true;
      } else if (event?.type === "model_usage_unknown") {
        if (
          !event.data ||
          typeof event.data !== "object" ||
          Array.isArray(event.data)
        ) {
          throw new Error("model_usage_unknown data must be an object");
        }
        const callId = asId(event.data.callId, "model_usage_unknown callId", {
          required: true,
        });
        const identity = modelUsageBoundaryIdentity(
          event.data,
          "model_usage_unknown",
        );
        const previous = modelUsageCalls.get(callId);
        if (previous && previous.status !== "started") {
          throw new Error(
            `model usage callId has conflicting settlement: ${callId}`,
          );
        }
        if (previous && !sameModelUsageIdentity(previous, identity)) {
          throw new Error(
            `model usage callId changed provider/model/source identity: ${callId}`,
          );
        }
        if (!previous && callLedgerRequired) {
          throw new Error(`model usage settlement has no start: ${callId}`);
        }
        if (!previous && modelUsageCalls.size >= MAX_TOOL_DURATION_SAMPLES) {
          throw new Error(`session ${id} exceeds the model usage call limit`);
        }
        modelUsageCalls.set(callId, { status: "unknown", ...identity });
        recordUnknownUsage("model-usage-unknown");
      } else if (
        event?.type === "compaction_usage_unknown" ||
        event?.type === "compaction-usage-unknown"
      ) {
        if (
          event.data != null &&
          (typeof event.data !== "object" || Array.isArray(event.data))
        ) {
          throw new Error("compaction usage unknown data must be an object");
        }
        recordUnknownUsage("compaction-usage-unknown");
      }

      if (event?.type === "tool_call_started") {
        if (
          !event.data ||
          typeof event.data !== "object" ||
          Array.isArray(event.data)
        ) {
          throw new Error("tool_call_started data must be an object");
        }
        const toolCallId = asId(event.data.id, "tool_call_started id", {
          required: true,
        });
        const tool = boundedLabel(
          event.data.tool,
          "tool_call_started tool",
          MAX_TOOL_LENGTH,
          { fallback: "?" },
        );
        if (toolUsageCalls.has(toolCallId)) {
          throw new Error(`tool call id already exists: ${toolCallId}`);
        }
        if (toolUsageCalls.size >= MAX_TOOL_DURATION_SAMPLES) {
          throw new Error(`session ${id} exceeds the tool call ledger limit`);
        }
        const failure = toolFailures.get(tool);
        toolUsageCalls.set(toolCallId, {
          status: "started",
          tool,
          retryGeneration: failure?.active === true ? failure.generation : null,
        });
      }

      let usage = strictUsage(event);
      if (usage) {
        if (
          usage.provider == null &&
          usage.model == null &&
          sessionUsageDefaults.provider != null &&
          sessionUsageDefaults.model != null
        ) {
          usage = {
            ...usage,
            provider: sessionUsageDefaults.provider,
            model: sessionUsageDefaults.model,
          };
        }
        if (usage.callId) {
          const previous = modelUsageCalls.get(usage.callId);
          if (previous && previous.status !== "started") {
            throw new Error(
              `model usage callId has conflicting settlement: ${usage.callId}`,
            );
          }
          const identity = {
            provider: usage.provider,
            model: usage.model,
            source: usage.source,
            operationId: usage.operationId,
          };
          if (previous && !sameModelUsageIdentity(previous, identity)) {
            throw new Error(
              `model usage callId changed provider/model/source identity: ${usage.callId}`,
            );
          }
          if (!previous && callLedgerRequired) {
            throw new Error(
              `model usage settlement has no start: ${usage.callId}`,
            );
          }
          if (!previous && modelUsageCalls.size >= MAX_TOOL_DURATION_SAMPLES) {
            throw new Error(`session ${id} exceeds the model usage call limit`);
          }
          modelUsageCalls.set(usage.callId, {
            status: "known",
            ...identity,
          });
        } else if (callLedgerRequired) {
          throw new Error("call-ledger token usage has no callId");
        }
        addUsageSums(usageTotal, usage, "session usage total");
        const existingRow = usageByModel
          .get(usage.provider ?? null)
          ?.get(usage.model ?? null);
        if (
          !existingRow &&
          nestedRows(usageByModel).length >= MAX_DISTINCT_MODELS
        ) {
          throw new Error(`session ${id} exceeds the distinct model limit`);
        }
        const row = nestedRow(
          usageByModel,
          usage.provider,
          usage.model,
          () => ({
            provider: usage.provider,
            model: usage.model,
            ...emptyUsageSums(),
          }),
        );
        addUsageSums(row, usage, "session usage model");
      }

      if (event?.type === "tool_call") {
        const name = boundedLabel(
          event.data?.tool,
          "session tool name",
          MAX_TOOL_LENGTH,
          { fallback: "?" },
        );
        const toolCallId = Object.hasOwn(event.data || {}, "id")
          ? asId(event.data.id, "session tool call id", { required: true })
          : null;
        let startedCall = null;
        if (toolCallId) {
          const previous = toolUsageCalls.get(toolCallId);
          if (previous && previous.status !== "started") {
            throw new Error(
              `tool call id has conflicting settlement: ${toolCallId}`,
            );
          }
          if (previous && previous.tool !== name) {
            throw new Error(
              `tool call id changed tool identity: ${toolCallId}`,
            );
          }
          if (!previous) recordUnknownToolEvent();
          if (!previous && toolUsageCalls.size >= MAX_TOOL_DURATION_SAMPLES) {
            throw new Error(`session ${id} exceeds the tool call ledger limit`);
          }
          startedCall = previous || null;
          toolUsageCalls.set(toolCallId, {
            status: "settled",
            tool: name,
            retryGeneration: previous?.retryGeneration ?? null,
          });
        } else {
          recordUnknownToolEvent();
        }
        const row = toolRow(name);
        const retryGeneration = startedCall?.retryGeneration ?? null;
        const isRetry = retryGeneration != null;
        row.calls = checkedAdd(row.calls, 1, "session tool.calls");
        totalToolCalls = checkedAdd(
          totalToolCalls,
          1,
          "session tools.totalCalls",
        );
        const isError = event.data?.is_error === true;
        if (isRetry) {
          row.retries = checkedAdd(row.retries, 1, "session tool.retries");
          retryToolCalls = checkedAdd(
            retryToolCalls,
            1,
            "session tools.retryCalls",
          );
        }
        if (isError) {
          row.errors = checkedAdd(row.errors, 1, "session tool.errors");
          totalToolErrors = checkedAdd(
            totalToolErrors,
            1,
            "session tools.totalErrors",
          );
          markToolFailure(name);
        } else {
          clearToolFailure(name, retryGeneration);
        }
        const duration = observedDuration(event);
        recordDuration(row, duration);
        pendingTool = {
          name,
          durationCounted: duration != null,
          errorCounted: isError,
          retryGeneration,
        };
      } else if (event?.type === "tool_result") {
        const name = boundedLabel(
          event.data?.tool,
          "session tool name",
          MAX_TOOL_LENGTH,
          { fallback: "?" },
        );
        const row = toolRow(name);
        const paired = pendingTool?.name === name ? pendingTool : null;
        const isError = Boolean(
          event.data?.error ||
          event.data?.result?.error ||
          event.data?.result?.is_error ||
          event.data?.result?.isError,
        );
        if (paired && isError && !paired.errorCounted) {
          row.errors = checkedAdd(row.errors, 1, "session tool.errors");
          totalToolErrors = checkedAdd(
            totalToolErrors,
            1,
            "session tools.totalErrors",
          );
        }
        if (paired && !paired.errorCounted) {
          if (isError) markToolFailure(name);
          else clearToolFailure(name, paired.retryGeneration);
        }
        const duration = observedDuration(event);
        if (duration != null && paired && !paired.durationCounted) {
          recordDuration(row, duration);
        }
        pendingTool = null;
      } else if (event?.type === "user_message") {
        toolFailures = new Map();
        pendingTool = null;
      }

      if (event?.type === "llm_retry") {
        recordUnknownUsage("llm-retry-usage-unknown");
        const reason = RETRY_REASONS.has(event.data?.reason)
          ? event.data.reason
          : "unknown";
        const provider = boundedLabel(
          event.data?.provider,
          "session retry provider",
          MAX_PROVIDER_LENGTH,
        );
        const model = boundedLabel(
          event.data?.model,
          "session retry model",
          MAX_MODEL_LENGTH,
        );
        const duration = observedDuration(event) || 0;
        totalRetries = checkedAdd(
          totalRetries,
          1,
          "session retries.totalRetries",
        );
        retryDurationMs = checkedAdd(
          retryDurationMs,
          duration,
          "session retries.durationMs",
        );
        const reasonRow = retryByReason.get(reason) || {
          reason,
          retries: 0,
          durationMs: 0,
        };
        reasonRow.retries = checkedAdd(
          reasonRow.retries,
          1,
          "session retry reason.retries",
        );
        reasonRow.durationMs = checkedAdd(
          reasonRow.durationMs,
          duration,
          "session retry reason.durationMs",
        );
        retryByReason.set(reason, reasonRow);
        const existingModelRow = retryByModel
          .get(provider ?? null)
          ?.get(model ?? null);
        if (
          !existingModelRow &&
          nestedRows(retryByModel).length >= MAX_DISTINCT_MODELS
        ) {
          throw new Error(
            `session ${id} exceeds the distinct retry model limit`,
          );
        }
        const modelRow = nestedRow(retryByModel, provider, model, () => ({
          provider,
          model,
          retries: 0,
          durationMs: 0,
        }));
        modelRow.retries = checkedAdd(
          modelRow.retries,
          1,
          "session retry model.retries",
        );
        modelRow.durationMs = checkedAdd(
          modelRow.durationMs,
          duration,
          "session retry model.durationMs",
        );
      }
    },
    finish(authority = {}) {
      if (finished)
        throw new Error(`session ${id} projection is already finished`);
      finished = true;
      if (
        typeof authority.headHash !== "string" ||
        !/^[0-9a-f]{64}$/i.test(authority.headHash) ||
        !Number.isSafeInteger(authority.eventCount) ||
        authority.eventCount <= 0
      ) {
        throw new Error(`session ${id} has no verified transcript authority`);
      }
      if (authority.eventCount !== acceptedEvents) {
        throw new Error(
          `session ${id} verified event count does not match projection`,
        );
      }
      transcriptStructure.finish();
      if (!scope) {
        throw new Error(`session ${id} has no observabilityScope authority`);
      }
      const unsettledModelUsage = [...modelUsageCalls.values()].filter(
        (entry) => entry.status === "started",
      ).length;
      if (unsettledModelUsage > 0) {
        recordUnknownUsage("model-usage-unsettled", unsettledModelUsage);
      }
      if (callLedgerRequired && !sawModelUsageStarted) {
        recordUnknownUsage("call-ledger-evidence-missing");
      } else if (!callLedgerRequired) {
        recordUnknownUsage("call-ledger-protocol-undeclared");
      }
      const unsettledToolCalls = [...toolUsageCalls.values()].filter(
        (entry) => entry.status === "started",
      ).length;
      if (unsettledToolCalls > 0) {
        toolTelemetryComplete = false;
        unknownToolEvents = checkedAdd(
          unknownToolEvents,
          unsettledToolCalls,
          "session unknown tool events",
        );
      }
      const toolTimingPopulation = checkedAdd(
        totalToolCalls,
        unsettledToolCalls,
        "session tool timing population",
      );
      const missingToolDurations = toolTimingPopulation - timedToolCalls;
      const p95DurationLowerBoundMs = nearestRankLowerBoundWithMissingZeros(
        durations,
        missingToolDurations,
        0.95,
      );
      const usage = {
        total: usageTotal,
        byModel: nestedRows(usageByModel).sort(
          (a, b) => b.totalTokens - a.totalTokens,
        ),
      };
      const priced = priceRollup(usage, { table: effectivePricingTable });
      for (const row of priced.byModel) {
        for (const field of [
          "cost",
          "inputCost",
          "outputCost",
          "cacheReadCost",
          "cacheCreationCost",
        ]) {
          if (!Number.isFinite(row[field]) || row[field] < 0) {
            throw new Error(`session ${id} has invalid priced ${field}`);
          }
        }
      }
      if (
        !Number.isFinite(priced.cost.totalCost) ||
        priced.cost.totalCost < 0
      ) {
        throw new Error(`session ${id} has invalid aggregate estimated cost`);
      }
      const unpriced = priced.byModel
        .filter((row) => !row.matched && row.budgetTokens > 0)
        .map((row) => ({
          provider: row.provider,
          model: row.model,
          totalTokens: row.totalTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheCreationTokens: row.cacheCreationTokens,
          budgetTokens: row.budgetTokens,
        }))
        .sort(
          (a, b) =>
            b.budgetTokens - a.budgetTokens ||
            compareStrings(
              `${a.provider || ""}/${a.model || ""}`,
              `${b.provider || ""}/${b.model || ""}`,
            ),
        );
      const byCalls = (a, b) =>
        b.calls - a.calls || compareStrings(a.tool, b.tool);
      const byRetries = (a, b) =>
        b.retries - a.retries ||
        b.durationMs - a.durationMs ||
        compareStrings(
          `${a.reason || a.provider || ""}/${a.model || ""}`,
          `${b.reason || b.provider || ""}/${b.model || ""}`,
        );
      return {
        id,
        authority: {
          verified: true,
          headHash: authority.headHash.toLowerCase(),
          eventCount: authority.eventCount,
          usageTelemetry: {
            protocolDeclared: callLedgerRequired,
            protocol: callLedgerRequired ? "call-ledger" : null,
            version: callLedgerRequired ? 1 : null,
            assurance: callLedgerRequired
              ? "call-ledger-bound"
              : "recorded-events-only",
          },
        },
        scope,
        startedAt: observedIsoTime(times.first, `session ${id} startedAt`),
        endedAt: observedIsoTime(times.last, `session ${id} endedAt`),
        usage: {
          ...priced.total,
          estimatedUsd: priced.cost.totalCost,
          currency: priced.cost.currency,
          pricingTableDigest: digest(effectivePricingTable),
          telemetryComplete: unknownUsageByCode.size === 0,
          unknownEvidence: {
            count: [...unknownUsageByCode.values()].reduce(
              (total, count) =>
                checkedAdd(total, count, `session ${id} unknown usage count`),
              0,
            ),
            byCode: [...unknownUsageByCode.entries()]
              .map(([code, count]) => ({ code, count }))
              .sort((a, b) => compareStrings(a.code, b.code)),
          },
          unpriced,
          byModel: priced.byModel,
        },
        retries: {
          totalRetries,
          durationMs: retryDurationMs,
          byReason: [...retryByReason.values()].sort(byRetries),
          byModel: nestedRows(retryByModel).sort(byRetries),
        },
        tools: {
          totalCalls: totalToolCalls,
          totalErrors: totalToolErrors,
          totalDurationMs: totalToolDurationMs,
          timedCalls: timedToolCalls,
          retryCalls: retryToolCalls,
          byTool: [...toolRows.values()].sort(byCalls),
          p50DurationMs: nearestRankPercentile(durations, 0.5),
          p95DurationMs: nearestRankPercentile(durations, 0.95),
          p95DurationLowerBoundMs,
          timingCoverage:
            totalToolCalls > 0 ? timedToolCalls / totalToolCalls : 1,
          telemetryComplete: toolTelemetryComplete,
          unknownEvents: unknownToolEvents,
          percentileMethod: "nearest-rank",
        },
      };
    },
  };
}

export function projectVerifiedSession(
  sessionId,
  events,
  authority = {},
  options = {},
) {
  const projection = createVerifiedSessionObservabilityProjection(
    sessionId,
    options,
  );
  for (const event of events || []) projection.accept(event);
  return projection.finish(authority);
}

function projectGates(state) {
  const selectedSource = state.gateSelection?.selectedGateIds;
  if (!Array.isArray(selectedSource)) {
    throw new Error("delivery selected gates must be an array");
  }
  if (selectedSource.length > MAX_DELIVERY_SELECTED_GATES) {
    throw new Error(
      `delivery exceeds the ${MAX_DELIVERY_SELECTED_GATES} selected gate limit`,
    );
  }
  if (!Array.isArray(state.gateResults)) {
    throw new Error("delivery gate results must be an array");
  }
  if (state.gateResults.length > MAX_DELIVERY_GATE_RESULTS) {
    throw new Error(
      `delivery exceeds the ${MAX_DELIVERY_GATE_RESULTS} gate result limit`,
    );
  }
  const selectedIds = selectedSource
    .map((id) =>
      boundedLabel(id, "delivery selected gate id", MAX_ID_LENGTH, {
        fallback: "unknown",
      }),
    )
    .sort(compareStrings);
  let matrixCells = 0;
  const results = state.gateResults
    .map((result) => ({
      id: boundedLabel(result?.id, "delivery gate id", MAX_ID_LENGTH, {
        fallback: "unknown",
      }),
      status: boundedLabel(
        result?.status,
        "delivery gate status",
        MAX_ID_LENGTH,
        { fallback: "unknown" },
      ),
      commitSha: exactCommit(result?.commitSha, "delivery gate commitSha"),
      matrix: (() => {
        if (result?.matrix == null) return [];
        if (!Array.isArray(result.matrix)) {
          throw new Error("delivery gate matrix must be an array");
        }
        matrixCells += result.matrix.length;
        if (matrixCells > MAX_DELIVERY_GATE_MATRIX_CELLS) {
          throw new Error(
            `delivery exceeds the ${MAX_DELIVERY_GATE_MATRIX_CELLS} gate matrix cell limit`,
          );
        }
        return result.matrix;
      })()
        .map((cell) => ({
          id: boundedLabel(cell?.id, "delivery gate matrix id", MAX_ID_LENGTH, {
            fallback: "unknown",
          }),
          status: boundedLabel(
            cell?.status,
            "delivery gate matrix status",
            MAX_ID_LENGTH,
            { fallback: "unknown" },
          ),
          commitSha: exactCommit(
            cell?.commitSha,
            "delivery gate matrix commitSha",
          ),
        }))
        .sort((a, b) => compareStrings(a.id, b.id)),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));
  return { selectedIds, results };
}

function projectArtifacts(state) {
  if (!Array.isArray(state.previewArtifacts)) {
    throw new Error("delivery preview artifacts must be an array");
  }
  if (state.previewArtifacts.length > MAX_DELIVERY_PREVIEW_ARTIFACTS) {
    throw new Error(
      `delivery exceeds the ${MAX_DELIVERY_PREVIEW_ARTIFACTS} preview artifact limit`,
    );
  }
  return {
    preview: state.previewArtifacts.map((artifact, index) => ({
      id: `preview:${index + 1}`,
      kind: boundedLabel(artifact?.kind, "artifact kind", MAX_ID_LENGTH, {
        fallback: "unknown",
      }),
      tier: boundedLabel(artifact?.tier, "artifact tier", MAX_ID_LENGTH),
    })),
    evidence: state.evidence
      ? {
          artifactId: boundedLabel(
            state.evidence.artifact?.id,
            "evidence artifact id",
            MAX_ID_LENGTH,
          ),
          recordDigest: sha256Digest(
            state.evidence.record?.recordDigest,
            "evidence recordDigest",
          ),
          ready: state.evidence.readiness?.ready === true,
        }
      : null,
  };
}

export function projectVerifiedDelivery(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("delivery state must be an object");
  }
  const causality = state.causality || { scope: {}, sessions: [] };
  if (!Array.isArray(causality.sessions)) {
    throw new Error("delivery causal sessions must be an array");
  }
  if (causality.sessions.length > MAX_DELIVERY_ASSOCIATIONS) {
    throw new Error(
      `delivery exceeds the ${MAX_DELIVERY_ASSOCIATIONS} causal session limit`,
    );
  }
  const associationIds = new Set();
  const associations = causality.sessions
    .map((binding) => {
      const sessionId = asId(binding?.sessionId, "delivery sessionId", {
        required: true,
      });
      if (associationIds.has(sessionId)) {
        throw new Error(
          `delivery has duplicate session association: ${sessionId}`,
        );
      }
      associationIds.add(sessionId);
      return {
        sessionId,
        headHash:
          typeof binding?.headHash === "string" &&
          /^[0-9a-f]{64}$/i.test(binding.headHash)
            ? binding.headHash.toLowerCase()
            : (() => {
                throw new Error("delivery session headHash is invalid");
              })(),
        eventCount: safeInteger(
          binding?.eventCount,
          "delivery session eventCount",
          { min: 1 },
        ),
      };
    })
    .sort((a, b) => compareStrings(a.sessionId, b.sessionId));
  const status = boundedLabel(state.status, "delivery status", MAX_ID_LENGTH);
  if (!DELIVERY_STATUSES.has(status)) {
    throw new Error(`delivery status is unsupported: ${status}`);
  }
  const phase = boundedLabel(state.phase, "delivery phase", MAX_ID_LENGTH);
  if (!DELIVERY_PHASES.has(phase)) {
    throw new Error(`delivery phase is unsupported: ${phase}`);
  }
  return {
    id: asId(state.flowId, "delivery.flowId", { required: true }),
    authority: {
      verified: true,
      stateDigest: sha256Digest(state.stateDigest, "delivery stateDigest", {
        required: true,
      }),
      revision: safeInteger(state.revision, "delivery revision"),
    },
    scope: normalizeScope(causality.scope, "delivery.scope", {
      requireAny: associations.length > 0,
    }),
    associations,
    status,
    phase,
    commitSha: exactCommit(state.commitSha, "delivery commitSha", {
      required: true,
    }),
    diff: {
      baseCommitSha: exactCommit(
        state.diff?.baseCommitSha,
        "delivery diff baseCommitSha",
      ),
      headCommitSha: exactCommit(
        state.diff?.headCommitSha,
        "delivery diff headCommitSha",
      ),
      digest: sha256Digest(state.diff?.digest, "delivery diff digest"),
      changedFileCount: safeInteger(
        (Array.isArray(state.diff?.changedFiles) ? state.diff.changedFiles : [])
          .length,
        "delivery changedFileCount",
      ),
    },
    gates: projectGates(state),
    artifacts: projectArtifacts(state),
    pr: state.pr
      ? {
          number: safeInteger(state.pr.number, "delivery PR number", {
            min: 1,
          }),
          headCommitSha: exactCommit(
            state.pr.headCommitSha,
            "delivery PR headCommitSha",
          ),
          ciCommitSha: exactCommit(
            state.pr.ciCommitSha,
            "delivery PR ciCommitSha",
          ),
          branchProtectionSatisfied:
            state.pr.branchProtectionSatisfied === true,
          reviewApproved: state.pr.reviewApproved === true,
          requiredMatrixComplete: state.pr.requiredMatrixComplete === true,
          mergeAllowed: state.mergeDecision?.allow === true,
        }
      : null,
    merge: state.merge
      ? {
          merged: state.merge.merged === true,
          headCommitSha: exactCommit(
            state.merge.headCommitSha,
            "delivery merge headCommitSha",
          ),
          mergeCommitSha: exactCommit(
            state.merge.mergeCommitSha,
            "delivery merge mergeCommitSha",
          ),
        }
      : null,
  };
}

function emptyTotals() {
  return {
    sessions: 0,
    deliveries: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    budgetTokens: 0,
    calls: 0,
    estimatedUsd: 0,
    unpricedTokens: 0,
    unknownUsageEvents: 0,
    usageTelemetryComplete: true,
    llmRetries: 0,
    llmRetryDurationMs: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolRetryCalls: 0,
    toolTimedCalls: 0,
    toolDurationMs: 0,
    toolP95DurationMs: null,
    toolP95DurationLowerBoundMs: null,
    toolTimingCoverage: 1,
    toolTelemetryComplete: true,
    unknownToolEvents: 0,
    retryRatio: null,
    retryRatioApproximate: true,
    retryRatioDenominator: "recorded-usage-events",
    toolP95Aggregation: "conservative-max-session-p95",
  };
}

function exactUsd(value) {
  const number = finiteNonnegative(value, "estimated USD total");
  // Do not round authority-bearing budget values. A single token on a cheap
  // model can cost less than one microdollar; rounding would make maxUsd=0 pass.
  return number;
}

function projectedToolDuration(value, field) {
  if (value == null) return null;
  const duration = safeInteger(value, field);
  if (duration > MAX_DURATION_MS) {
    throw new Error(`${field} exceeds the supported duration range`);
  }
  return duration;
}

function validateProjectedSessionTools(session) {
  const tools = session.tools;
  for (const field of [
    "p50DurationMs",
    "p95DurationMs",
    "p95DurationLowerBoundMs",
    "timingCoverage",
    "percentileMethod",
  ]) {
    if (!Object.hasOwn(tools, field)) {
      throw new Error(`session tool timing field is missing: ${field}`);
    }
  }
  const toolCalls = safeInteger(tools.totalCalls, "session toolCalls");
  const toolErrors = safeInteger(tools.totalErrors, "session toolErrors");
  const toolRetryCalls = safeInteger(
    tools.retryCalls,
    "session toolRetryCalls",
  );
  const toolTimedCalls = safeInteger(
    tools.timedCalls,
    "session toolTimedCalls",
  );
  const toolDurationMs = safeInteger(
    tools.totalDurationMs,
    "session toolDurationMs",
  );
  const unknownToolEvents = safeInteger(
    tools.unknownEvents,
    "session unknownToolEvents",
  );
  if (tools.telemetryComplete !== (unknownToolEvents === 0)) {
    throw new Error("session tool telemetry completeness is inconsistent");
  }
  if (
    toolErrors > toolCalls ||
    toolRetryCalls > toolCalls ||
    toolTimedCalls > toolCalls
  ) {
    throw new Error("session tool call totals are inconsistent");
  }
  if (!Array.isArray(tools.byTool)) {
    throw new Error("session tool rows must be an array");
  }

  const rowTotals = {
    calls: 0,
    errors: 0,
    retries: 0,
    timedCalls: 0,
    durationMs: 0,
  };
  const toolNames = new Set();
  for (const row of tools.byTool) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("session tool row must be an object");
    }
    const name = boundedLabel(
      row.tool,
      "session tool row name",
      MAX_TOOL_LENGTH,
      { fallback: "?" },
    );
    if (name !== row.tool || toolNames.has(name)) {
      throw new Error("session tool row name is duplicate or noncanonical");
    }
    toolNames.add(name);
    const calls = safeInteger(row.calls, "session tool row calls");
    const errors = safeInteger(row.errors, "session tool row errors");
    const retries = safeInteger(row.retries, "session tool row retries");
    const hasTimedCalls = Object.hasOwn(row, "timedCalls");
    const hasDuration = Object.hasOwn(row, "durationMs");
    const timedCalls = hasTimedCalls
      ? safeInteger(row.timedCalls, "session tool row timedCalls")
      : 0;
    const durationMs = hasDuration
      ? safeInteger(row.durationMs, "session tool row durationMs")
      : 0;
    if (
      errors > calls ||
      retries > calls ||
      timedCalls > calls ||
      hasTimedCalls !== hasDuration ||
      hasTimedCalls !== timedCalls > 0
    ) {
      throw new Error("session tool row totals are inconsistent");
    }
    for (const [field, value] of [
      ["calls", calls],
      ["errors", errors],
      ["retries", retries],
      ["timedCalls", timedCalls],
      ["durationMs", durationMs],
    ]) {
      rowTotals[field] = checkedAdd(
        rowTotals[field],
        value,
        `session tool row ${field} total`,
      );
    }
  }
  for (const [field, expected] of [
    ["calls", toolCalls],
    ["errors", toolErrors],
    ["retries", toolRetryCalls],
    ["timedCalls", toolTimedCalls],
    ["durationMs", toolDurationMs],
  ]) {
    if (rowTotals[field] !== expected) {
      throw new Error(`session tool ${field} disagrees with tool rows`);
    }
  }

  const expectedCoverage = toolCalls > 0 ? toolTimedCalls / toolCalls : 1;
  if (
    typeof tools.timingCoverage !== "number" ||
    !Number.isFinite(tools.timingCoverage) ||
    tools.timingCoverage !== expectedCoverage
  ) {
    throw new Error("session tool timing coverage is inconsistent");
  }
  if (tools.percentileMethod !== "nearest-rank") {
    throw new Error("session tool percentile method is unsupported");
  }

  const p50 = projectedToolDuration(
    tools.p50DurationMs,
    "session tools.p50DurationMs",
  );
  const p95 = projectedToolDuration(
    tools.p95DurationMs,
    "session tools.p95DurationMs",
  );
  const p95LowerBound = projectedToolDuration(
    tools.p95DurationLowerBoundMs,
    "session tools.p95DurationLowerBoundMs",
  );
  if (toolTimedCalls === 0) {
    if (p50 !== null || p95 !== null || toolDurationMs !== 0) {
      throw new Error("session tool percentiles require timed calls");
    }
    const expectedLowerBound =
      toolCalls > 0 || unknownToolEvents > 0 ? 0 : null;
    if (p95LowerBound !== expectedLowerBound) {
      throw new Error("session tool P95 lower bound is inconsistent");
    }
  } else {
    if (p50 === null || p95 === null || p95LowerBound === null) {
      throw new Error("session timed tools require complete percentile fields");
    }
    if (p50 > p95 || p95 > toolDurationMs || p95LowerBound > p95) {
      throw new Error("session tool percentile ordering is inconsistent");
    }
    if (
      tools.telemetryComplete === true &&
      toolTimedCalls === toolCalls &&
      p95LowerBound !== p95
    ) {
      throw new Error(
        "session complete tool timing requires an exact P95 lower bound",
      );
    }
  }

  return {
    toolCalls,
    toolErrors,
    toolRetryCalls,
    toolTimedCalls,
    toolDurationMs,
    unknownToolEvents,
    p95,
    p95LowerBound,
  };
}

function sumTotals(sessions, deliveries) {
  const totals = emptyTotals();
  const p95Values = [];
  const p95LowerBoundValues = [];
  totals.sessions = sessions.length;
  totals.deliveries = deliveries.length;
  for (const session of sessions) {
    if (!session?.usage || !session?.retries || !session?.tools) {
      throw new Error(
        `session projection schema is incomplete: ${session?.id}`,
      );
    }
    const usageInteger = (field) =>
      safeInteger(session.usage[field], `session usage.${field}`);
    const inputTokens = usageInteger("inputTokens");
    const outputTokens = usageInteger("outputTokens");
    const totalTokens = usageInteger("totalTokens");
    const cacheReadTokens = usageInteger("cacheReadTokens");
    const cacheCreationTokens = usageInteger("cacheCreationTokens");
    const budgetTokens = usageInteger("budgetTokens");
    const expectedTotalTokens = checkedAdd(
      inputTokens,
      outputTokens,
      "session usage expected totalTokens",
    );
    const expectedBudgetTokens = checkedAdd(
      expectedTotalTokens,
      checkedAdd(
        cacheReadTokens,
        cacheCreationTokens,
        "session usage expected cache tokens",
      ),
      "session usage expected budgetTokens",
    );
    if (
      totalTokens !== expectedTotalTokens ||
      budgetTokens !== expectedBudgetTokens
    ) {
      throw new Error("session usage token totals are inconsistent");
    }
    totals.inputTokens = checkedAdd(
      totals.inputTokens,
      inputTokens,
      "report totals.inputTokens",
    );
    totals.outputTokens = checkedAdd(
      totals.outputTokens,
      outputTokens,
      "report totals.outputTokens",
    );
    totals.totalTokens = checkedAdd(
      totals.totalTokens,
      totalTokens,
      "report totals.totalTokens",
    );
    totals.cacheReadTokens = checkedAdd(
      totals.cacheReadTokens,
      cacheReadTokens,
      "report totals.cacheReadTokens",
    );
    totals.cacheCreationTokens = checkedAdd(
      totals.cacheCreationTokens,
      cacheCreationTokens,
      "report totals.cacheCreationTokens",
    );
    totals.budgetTokens = checkedAdd(
      totals.budgetTokens,
      budgetTokens,
      "report totals.budgetTokens",
    );
    totals.calls = checkedAdd(
      totals.calls,
      usageInteger("calls"),
      "report totals.calls",
    );
    totals.estimatedUsd = exactUsd(
      totals.estimatedUsd +
        finiteNonnegative(
          session.usage.estimatedUsd,
          "session usage.estimatedUsd",
        ),
    );
    if (!Array.isArray(session.usage.unpriced)) {
      throw new Error("session usage.unpriced must be an array");
    }
    for (const row of session.usage.unpriced) {
      totals.unpricedTokens = checkedAdd(
        totals.unpricedTokens,
        safeInteger(row?.budgetTokens, "session usage.unpriced.budgetTokens"),
        "report totals.unpricedTokens",
      );
    }
    totals.unknownUsageEvents = checkedAdd(
      totals.unknownUsageEvents,
      safeInteger(
        session.usage.unknownEvidence?.count,
        "session usage.unknownEvidence.count",
      ),
      "report totals.unknownUsageEvents",
    );
    if (session.usage.telemetryComplete !== true) {
      totals.usageTelemetryComplete = false;
    }
    const {
      toolCalls,
      toolErrors,
      toolRetryCalls,
      toolTimedCalls,
      toolDurationMs,
      unknownToolEvents,
      p95,
      p95LowerBound,
    } = validateProjectedSessionTools(session);
    if (!session.tools.telemetryComplete) {
      totals.toolTelemetryComplete = false;
    }
    totals.unknownToolEvents = checkedAdd(
      totals.unknownToolEvents,
      unknownToolEvents,
      "report totals.unknownToolEvents",
    );
    for (const [field, value] of [
      ["llmRetries", session.retries.totalRetries],
      ["llmRetryDurationMs", session.retries.durationMs],
      ["toolCalls", toolCalls],
      ["toolErrors", toolErrors],
      ["toolRetryCalls", toolRetryCalls],
      ["toolTimedCalls", toolTimedCalls],
      ["toolDurationMs", toolDurationMs],
    ]) {
      totals[field] = checkedAdd(
        totals[field],
        safeInteger(value, `session ${field}`),
        `report totals.${field}`,
      );
    }
    if (p95 != null) p95Values.push(p95);
    if (p95LowerBound != null) p95LowerBoundValues.push(p95LowerBound);
  }
  totals.toolP95DurationMs = p95Values.length ? Math.max(...p95Values) : null;
  totals.toolP95DurationLowerBoundMs = p95LowerBoundValues.length
    ? Math.max(...p95LowerBoundValues)
    : null;
  totals.toolTimingCoverage =
    totals.toolCalls > 0 ? totals.toolTimedCalls / totals.toolCalls : 1;
  totals.retryRatio =
    totals.calls > 0
      ? totals.llmRetries / totals.calls
      : totals.llmRetries > 0
        ? null
        : 0;
  return totals;
}

function assessBudgets(totals, budgets, { completeness, noData }) {
  const alerts = [];
  const check = (code, metric, actual, limit, unit) => {
    if (limit == null) return;
    alerts.push({
      code,
      metric,
      status: actual > limit ? "exceeded" : "within_budget",
      actual,
      limit,
      unit,
    });
  };
  if (budgets.maxTokens != null && !totals.usageTelemetryComplete) {
    alerts.push({
      code: "token-budget-usage-unknown",
      metric: "budgetTokens",
      status: totals.budgetTokens > budgets.maxTokens ? "exceeded" : "unknown",
      actual: totals.budgetTokens,
      limit: budgets.maxTokens,
      unit: "tokens",
      unknownUsageEvents: totals.unknownUsageEvents,
    });
  } else {
    check(
      "token-budget",
      "budgetTokens",
      totals.budgetTokens,
      budgets.maxTokens,
      "tokens",
    );
  }
  if (
    budgets.maxUsd != null &&
    (totals.unpricedTokens > 0 || !totals.usageTelemetryComplete)
  ) {
    alerts.push({
      code: totals.usageTelemetryComplete
        ? "usd-budget-unpriced"
        : "usd-budget-usage-unknown",
      metric: "estimatedUsd",
      status: totals.estimatedUsd > budgets.maxUsd ? "exceeded" : "unknown",
      actual: totals.estimatedUsd,
      limit: budgets.maxUsd,
      unit: "USD",
      unpricedTokens: totals.unpricedTokens,
      unknownUsageEvents: totals.unknownUsageEvents,
    });
  } else {
    check(
      "usd-budget",
      "estimatedUsd",
      totals.estimatedUsd,
      budgets.maxUsd,
      "USD",
    );
  }
  check(
    "retry-budget",
    "llmRetries",
    totals.llmRetries,
    budgets.maxRetries,
    "retries",
  );
  if (budgets.maxRetryRatio != null && !totals.usageTelemetryComplete) {
    alerts.push({
      code: "retry-ratio-budget-usage-unknown",
      metric: "retryRatio",
      status: "unknown",
      actual: totals.retryRatio,
      limit: budgets.maxRetryRatio,
      unit: "ratio",
      denominator: totals.retryRatioDenominator,
      unknownUsageEvents: totals.unknownUsageEvents,
    });
  } else if (budgets.maxRetryRatio != null && totals.retryRatio == null) {
    alerts.push({
      code: "retry-ratio-budget-unobserved",
      metric: "retryRatio",
      status: "unknown",
      actual: null,
      limit: budgets.maxRetryRatio,
      unit: "ratio",
      denominator: totals.retryRatioDenominator,
    });
  } else {
    check(
      "retry-ratio-budget",
      "retryRatio",
      totals.retryRatio,
      budgets.maxRetryRatio,
      "ratio",
    );
  }
  if (
    budgets.maxToolP95Ms != null &&
    (totals.toolP95DurationMs == null ||
      totals.toolTimingCoverage < 1 ||
      !totals.toolTelemetryComplete)
  ) {
    alerts.push({
      code: "tool-latency-budget-unobserved",
      metric: "toolP95DurationMs",
      status:
        totals.toolP95DurationLowerBoundMs != null &&
        totals.toolP95DurationLowerBoundMs > budgets.maxToolP95Ms
          ? "exceeded"
          : "unknown",
      actual: totals.toolP95DurationMs,
      lowerBound: totals.toolP95DurationLowerBoundMs,
      limit: budgets.maxToolP95Ms,
      unit: "ms",
      timingCoverage: totals.toolTimingCoverage,
      unknownToolEvents: totals.unknownToolEvents,
    });
  } else {
    check(
      "tool-latency-budget",
      "toolP95DurationMs",
      totals.toolP95DurationMs,
      budgets.maxToolP95Ms,
      "ms",
    );
  }
  if (noData) {
    alerts.push({
      code: "causal-selection-empty",
      metric: "deliveries",
      status: "unknown",
      actual: 0,
      limit: null,
      unit: "deliveries",
    });
  } else if (completeness !== "complete") {
    alerts.push({
      code: "causal-evidence-incomplete",
      metric: "completeness",
      status: "unknown",
      actual: completeness,
      limit: "complete",
      unit: "state",
    });
  }
  if (alerts.length === 0) {
    return { status: "not_evaluated", limits: budgets, alerts: [] };
  }
  const hasExceeded = alerts.some((alert) => alert.status === "exceeded");
  const hasUnknown = alerts.some((alert) => alert.status === "unknown");
  return {
    status: hasExceeded ? "exceeded" : hasUnknown ? "unknown" : "within_budget",
    limits: budgets,
    alerts,
  };
}

function graphFor(deliveries, sessions) {
  const nodes = [];
  const edges = [];
  for (const session of sessions) {
    nodes.push({ id: `session:${session.id}`, type: "session" });
  }
  for (const delivery of deliveries) {
    const deliveryId = `delivery:${delivery.id}`;
    nodes.push({ id: deliveryId, type: "delivery" });
    for (const [type, present] of [
      ["diff", Boolean(delivery.diff.digest)],
      ["gate", delivery.gates.selectedIds.length > 0],
      [
        "artifact",
        delivery.artifacts.preview.length > 0 ||
          Boolean(delivery.artifacts.evidence),
      ],
      ["pr", Boolean(delivery.pr)],
      ["merge", Boolean(delivery.merge)],
    ]) {
      if (!present) continue;
      const id = `${type}:${delivery.id}`;
      nodes.push({ id, type });
      edges.push({ from: deliveryId, to: id, relation: "produced" });
    }
    for (const association of delivery.associations) {
      edges.push({
        from: `session:${association.sessionId}`,
        to: deliveryId,
        relation: "contributed_to",
      });
    }
  }
  return { nodes, edges };
}

export function selectCausalDeliveries(deliveries = [], filter = {}) {
  const normalizedFilter = normalizeScope(filter, "filter");
  const byId = new Map();
  for (const delivery of deliveries) {
    if (!scopeMatches(delivery.scope, normalizedFilter)) continue;
    const previous = byId.get(delivery.id);
    if (previous) {
      if (previous.authority.stateDigest !== delivery.authority.stateDigest) {
        throw new Error(
          `delivery flow id is bound to conflicting state: ${delivery.id}`,
        );
      }
      continue;
    }
    byId.set(delivery.id, delivery);
  }
  return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
}

export function causalSessionIds(deliveries = []) {
  const ids = [
    ...new Set(
      deliveries.flatMap((delivery) =>
        delivery.associations.map((association) => association.sessionId),
      ),
    ),
  ].sort(compareStrings);
  if (ids.length > MAX_REPORT_SESSIONS) {
    throw new Error(
      `causal report exceeds the ${MAX_REPORT_SESSIONS} session limit`,
    );
  }
  return ids;
}

/** Track cross-delivery/session projection limits without retaining projections. */
export function createCausalObservabilityLimitTracker() {
  let gateRows = 0;
  let matrixCells = 0;
  let previewArtifacts = 0;
  let modelRows = 0;
  let retryModelRows = 0;
  let toolRows = 0;

  const rows = (value, field) => {
    if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
    return value.length;
  };
  const enforce = (actual, maximum, field) => {
    if (actual > maximum) {
      throw new Error(`causal report exceeds the ${maximum} ${field} limit`);
    }
  };

  return {
    acceptDelivery(delivery) {
      const selected = rows(
        delivery?.gates?.selectedIds,
        "delivery selected gates",
      );
      const results = rows(delivery?.gates?.results, "delivery gate results");
      const preview = rows(
        delivery?.artifacts?.preview,
        "delivery preview artifacts",
      );
      enforce(selected, MAX_DELIVERY_SELECTED_GATES, "selected gate");
      enforce(results, MAX_DELIVERY_GATE_RESULTS, "gate result");
      enforce(preview, MAX_DELIVERY_PREVIEW_ARTIFACTS, "preview artifact");
      let deliveryMatrixCells = 0;
      for (const result of delivery.gates.results) {
        deliveryMatrixCells += rows(result?.matrix, "delivery gate matrix");
      }
      enforce(
        deliveryMatrixCells,
        MAX_DELIVERY_GATE_MATRIX_CELLS,
        "gate matrix cell",
      );
      gateRows += selected + results;
      matrixCells += deliveryMatrixCells;
      previewArtifacts += preview;
      enforce(gateRows, MAX_REPORT_GATE_ROWS, "gate row");
      enforce(matrixCells, MAX_REPORT_GATE_MATRIX_CELLS, "gate matrix cell");
      enforce(
        previewArtifacts,
        MAX_REPORT_PREVIEW_ARTIFACTS,
        "preview artifact",
      );
    },
    acceptSession(session) {
      const sessionModelRows = rows(
        session?.usage?.byModel,
        "session usage model rows",
      );
      const sessionRetryModelRows = rows(
        session?.retries?.byModel,
        "session retry model rows",
      );
      const sessionToolRows = rows(session?.tools?.byTool, "session tool rows");
      enforce(sessionModelRows, MAX_DISTINCT_MODELS, "session model row");
      enforce(
        sessionRetryModelRows,
        MAX_DISTINCT_MODELS,
        "session retry model row",
      );
      enforce(sessionToolRows, MAX_DISTINCT_TOOLS, "session tool row");
      modelRows += sessionModelRows;
      retryModelRows += sessionRetryModelRows;
      toolRows += sessionToolRows;
      enforce(modelRows, MAX_REPORT_MODEL_ROWS, "model row");
      enforce(retryModelRows, MAX_REPORT_MODEL_ROWS, "retry model row");
      enforce(toolRows, MAX_REPORT_TOOL_ROWS, "tool row");
    },
  };
}

export function buildCausalObservabilityReport({
  deliveries = [],
  sessionsById = new Map(),
  filter = {},
  budgets = {},
  pricingTable = PRICE_TABLE,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!(sessionsById instanceof Map)) {
    throw new Error("sessionsById must be a Map");
  }
  const normalizedFilter = normalizeScope(filter, "filter");
  const normalizedBudgets = normalizeCausalBudgets(budgets);
  const effectivePricingTable = normalizePricingTable(pricingTable);
  const pricingTableDigest = digest(effectivePricingTable);
  const selectedDeliveries = selectCausalDeliveries(
    deliveries,
    normalizedFilter,
  );
  const limitTracker = createCausalObservabilityLimitTracker();
  for (const delivery of selectedDeliveries) {
    if (delivery?.authority?.verified !== true) {
      throw new Error(`delivery authority is not verified: ${delivery?.id}`);
    }
    if (asId(delivery.id, "delivery.id", { required: true }) !== delivery.id) {
      throw new Error(`delivery id is not canonical: ${delivery.id}`);
    }
    sha256Digest(
      delivery.authority.stateDigest,
      "delivery authority stateDigest",
      { required: true },
    );
    safeInteger(delivery.authority.revision, "delivery authority revision");
    limitTracker.acceptDelivery(delivery);
  }
  const selectedSessionIds = causalSessionIds(selectedDeliveries);
  const selectedSessionIdSet = new Set(selectedSessionIds);
  for (const sessionId of sessionsById.keys()) {
    const session = sessionsById.get(sessionId);
    if (session?.id !== sessionId) {
      throw new Error(
        `session map key does not match projection id: ${sessionId}`,
      );
    }
    if (session?.authority?.verified !== true) {
      throw new Error(`session authority is not verified: ${sessionId}`);
    }
    if (asId(session.id, "session.id", { required: true }) !== session.id) {
      throw new Error(`session id is not canonical: ${session.id}`);
    }
    if (
      typeof session.authority.headHash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(session.authority.headHash)
    ) {
      throw new Error(`session authority headHash is invalid: ${sessionId}`);
    }
    safeInteger(session.authority.eventCount, "session authority eventCount", {
      min: 1,
    });
    if (!selectedSessionIdSet.has(sessionId)) {
      throw new Error(
        `sessionsById contains an unselected session: ${sessionId}`,
      );
    }
  }
  const missingSessionIds = selectedSessionIds.filter(
    (sessionId) => !sessionsById.has(sessionId),
  );
  if (missingSessionIds.length > 0) {
    throw new Error(
      `verified causal sessions are missing: ${missingSessionIds.join(", ")}`,
    );
  }
  const sessions = selectedSessionIds.map((sessionId) =>
    sessionsById.get(sessionId),
  );
  for (const session of sessions) {
    if (session?.usage?.pricingTableDigest !== pricingTableDigest) {
      throw new Error(
        `session pricing table mismatch: ${session?.id || "unknown"}`,
      );
    }
    if (!Array.isArray(session.usage.unknownEvidence?.byCode)) {
      throw new Error("session usage unknown evidence must be an array");
    }
    if (!Array.isArray(session.usage.byModel)) {
      throw new Error("session usage model rows must be an array");
    }
    let modelInputTokens = 0;
    let modelOutputTokens = 0;
    let modelTotalTokens = 0;
    let modelCacheReadTokens = 0;
    let modelCacheCreationTokens = 0;
    let modelBudgetTokens = 0;
    let modelCalls = 0;
    let modelEstimatedUsd = 0;
    for (const row of session.usage.byModel) {
      const rowInputTokens = safeInteger(
        row?.inputTokens,
        "session model inputTokens",
      );
      const rowOutputTokens = safeInteger(
        row?.outputTokens,
        "session model outputTokens",
      );
      const rowTotalTokens = safeInteger(
        row?.totalTokens,
        "session model totalTokens",
      );
      const rowCacheReadTokens = safeInteger(
        row?.cacheReadTokens,
        "session model cacheReadTokens",
      );
      const rowCacheCreationTokens = safeInteger(
        row?.cacheCreationTokens,
        "session model cacheCreationTokens",
      );
      const rowBudgetTokens = safeInteger(
        row?.budgetTokens,
        "session model budgetTokens",
      );
      if (
        rowTotalTokens !== rowInputTokens + rowOutputTokens ||
        rowBudgetTokens !==
          rowTotalTokens + rowCacheReadTokens + rowCacheCreationTokens
      ) {
        throw new Error("session model token totals are inconsistent");
      }
      for (const [field, accumulator] of [
        ["inputTokens", "input"],
        ["outputTokens", "output"],
        ["totalTokens", "total"],
        ["cacheReadTokens", "cacheRead"],
        ["cacheCreationTokens", "cacheCreation"],
        ["budgetTokens", "budget"],
        ["calls", "calls"],
      ]) {
        const value = safeInteger(row?.[field], `session model ${field}`);
        if (accumulator === "input") modelInputTokens += value;
        else if (accumulator === "output") modelOutputTokens += value;
        else if (accumulator === "total") modelTotalTokens += value;
        else if (accumulator === "cacheRead") modelCacheReadTokens += value;
        else if (accumulator === "cacheCreation")
          modelCacheCreationTokens += value;
        else if (accumulator === "budget") modelBudgetTokens += value;
        else modelCalls += value;
        if (
          !Number.isSafeInteger(
            accumulator === "input"
              ? modelInputTokens
              : accumulator === "output"
                ? modelOutputTokens
                : accumulator === "total"
                  ? modelTotalTokens
                  : accumulator === "cacheRead"
                    ? modelCacheReadTokens
                    : accumulator === "cacheCreation"
                      ? modelCacheCreationTokens
                      : accumulator === "budget"
                        ? modelBudgetTokens
                        : modelCalls,
          )
        ) {
          throw new Error(
            "session model usage totals exceed the safe integer limit",
          );
        }
      }
      modelEstimatedUsd = exactUsd(
        modelEstimatedUsd +
          finiteNonnegative(row?.cost, "session model estimated cost"),
      );
    }
    for (const [field, actual] of [
      ["inputTokens", modelInputTokens],
      ["outputTokens", modelOutputTokens],
      ["totalTokens", modelTotalTokens],
      ["cacheReadTokens", modelCacheReadTokens],
      ["cacheCreationTokens", modelCacheCreationTokens],
      ["budgetTokens", modelBudgetTokens],
      ["calls", modelCalls],
    ]) {
      if (session.usage[field] !== actual) {
        throw new Error(`session usage ${field} disagrees with model rows`);
      }
    }
    if (exactUsd(session.usage.estimatedUsd) !== modelEstimatedUsd) {
      throw new Error("session estimated USD disagrees with model rows");
    }
    let unknownEvidenceCount = 0;
    for (const row of session.usage.unknownEvidence.byCode) {
      boundedLabel(
        row?.code,
        "session usage unknown evidence code",
        MAX_ID_LENGTH,
      );
      unknownEvidenceCount = checkedAdd(
        unknownEvidenceCount,
        safeInteger(row?.count, "session usage unknown evidence count", {
          min: 1,
        }),
        "session usage unknown evidence count",
      );
    }
    if (unknownEvidenceCount !== session.usage.unknownEvidence.count) {
      throw new Error("session usage unknown evidence count is inconsistent");
    }
    if (
      session.usage.telemetryComplete !==
      (session.usage.unknownEvidence.count === 0)
    ) {
      throw new Error("session usage telemetry completeness is inconsistent");
    }
    limitTracker.acceptSession(session);
  }
  for (const delivery of selectedDeliveries) {
    for (const association of delivery.associations) {
      const session = sessionsById.get(association.sessionId);
      if (
        association.headHash !== session.authority.headHash ||
        association.eventCount !== session.authority.eventCount
      ) {
        throw new Error(
          `session authority binding changed: ${association.sessionId}`,
        );
      }
      if (!sameScope(delivery.scope, session.scope)) {
        throw new Error(`session scope mismatch: ${association.sessionId}`);
      }
    }
  }
  const evidenceGaps = selectedDeliveries
    .filter((delivery) => delivery.associations.length === 0)
    .map((delivery) => ({
      code: "delivery-session-link-missing",
      deliveryId: delivery.id,
    }));
  const noData = selectedDeliveries.length === 0;
  const completeness = noData
    ? "no_data"
    : evidenceGaps.length === 0
      ? "complete"
      : "partial";
  const totals = sumTotals(sessions, selectedDeliveries);
  const material = {
    schema: CAUSAL_OBSERVABILITY_SCHEMA,
    version: CAUSAL_OBSERVABILITY_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    filter: normalizedFilter,
    authority: {
      assurance: "declared-association-bound-to-verified-inputs",
      completeness,
      verifiedSessionCount: sessions.length,
      verifiedDeliveryCount: selectedDeliveries.length,
      usageTelemetry: {
        complete: totals.usageTelemetryComplete,
        protocolDeclaredSessionCount: sessions.filter(
          (session) =>
            session.authority?.usageTelemetry?.protocolDeclared === true,
        ).length,
        recordedEventsOnlySessionCount: sessions.filter(
          (session) =>
            session.authority?.usageTelemetry?.assurance ===
            "recorded-events-only",
        ).length,
      },
      toolTelemetry: {
        complete: totals.toolTelemetryComplete,
        unknownEvents: totals.unknownToolEvents,
      },
      evidenceGaps,
    },
    pricing: {
      kind: "estimated-list-price",
      currency: "USD",
      tableDigest: pricingTableDigest,
    },
    totals,
    budget: assessBudgets(totals, normalizedBudgets, {
      completeness,
      noData,
    }),
    deliveries: selectedDeliveries,
    sessions,
    graph: graphFor(selectedDeliveries, sessions),
  };
  return { ...material, reportDigest: digest(material) };
}
