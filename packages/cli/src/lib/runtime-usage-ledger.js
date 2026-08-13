const MAX_LABEL_LENGTH = 160;
const MAX_CALL_ID_LENGTH = 128;
const MAX_ATTRIBUTION_ID_LENGTH = 256;
let fallbackToolSequence = 0;
const USAGE_FIELDS = Object.freeze([
  ["input_tokens", "prompt_tokens"],
  ["output_tokens", "completion_tokens"],
  ["cache_read_input_tokens", "cache_read_tokens"],
  ["cache_creation_input_tokens", "cache_creation_tokens"],
]);
const SOURCES = new Set(["model", "semantic-compaction", "subagent"]);
const UNKNOWN_CODES = new Set([
  "provider_call_failed",
  "provider_usage_missing",
  "provider_transport_outcome_unknown",
]);

function cleanLabel(value, max = MAX_LABEL_LENGTH) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\p{Cc}/gu, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function tokenCount(usage, canonical, alias, { required = false } = {}) {
  const hasCanonical = Object.hasOwn(usage, canonical);
  const hasAlias = Object.hasOwn(usage, alias);
  if (!hasCanonical && !hasAlias) {
    if (required) {
      throw new TypeError(
        `runtime token usage requires ${canonical} or ${alias}`,
      );
    }
    return 0;
  }
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias]) {
    throw new TypeError("runtime token usage aliases conflict");
  }
  const selected = hasCanonical ? usage[canonical] : usage[alias];
  if (
    typeof selected !== "number" ||
    !Number.isSafeInteger(selected) ||
    selected < 0
  ) {
    throw new TypeError(
      "runtime token usage must contain non-negative safe integers",
    );
  }
  return selected;
}

function source(value, fallback = "model") {
  return SOURCES.has(value) ? value : fallback;
}

function callId(value, { required = false } = {}) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_CALL_ID_LENGTH ||
    /\p{Cc}/u.test(value)
  ) {
    if (!required && value === undefined) return null;
    throw new TypeError("runtime usage boundary requires a bounded call id");
  }
  return value.trim();
}

function projectAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projected = {};
  for (const field of [
    "origin",
    "skill",
    "subagentId",
    "role",
    "parentSessionId",
  ]) {
    const clean = cleanLabel(value[field], MAX_ATTRIBUTION_ID_LENGTH);
    if (clean) projected[field] = clean;
  }
  if (
    typeof value.depth === "number" &&
    Number.isSafeInteger(value.depth) &&
    value.depth >= 0 &&
    value.depth <= 64
  ) {
    projected.depth = value.depth;
  }
  return Object.keys(projected).length > 0 ? projected : null;
}

/** Project a runtime token event onto the secret-free persisted ledger schema. */
export function projectRuntimeTokenUsage(event = {}) {
  if (
    !event.usage ||
    typeof event.usage !== "object" ||
    Array.isArray(event.usage)
  ) {
    throw new TypeError("runtime token usage requires an object");
  }
  const usage = {};
  for (const [index, [canonical, alias]] of USAGE_FIELDS.entries()) {
    usage[canonical] = tokenCount(event.usage, canonical, alias, {
      // A known settlement must prove both billable input and output counts.
      // Cache counters are optional because many providers do not expose them.
      required: index < 2,
    });
  }
  if (Object.hasOwn(event.usage, "total_tokens")) {
    const total = event.usage.total_tokens;
    if (
      typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total !== usage.input_tokens + usage.output_tokens
    ) {
      throw new TypeError(
        "runtime token usage total conflicts with components",
      );
    }
  }
  const projectedCallId = callId(event.callId);
  const attribution = projectAttribution(event.attribution);
  return {
    provider: cleanLabel(event.provider),
    model: cleanLabel(event.model),
    usage,
    ...(projectedCallId ? { callId: projectedCallId } : {}),
    ...(event.source ? { source: source(event.source) } : {}),
    ...(attribution ? { attribution } : {}),
  };
}

/** Project started/unknown boundaries without retaining provider error text. */
export function projectRuntimeUsageBoundary(event = {}, outcome) {
  if (outcome !== "started" && outcome !== "unknown") {
    throw new TypeError(
      "runtime usage boundary outcome must be started or unknown",
    );
  }
  const projected = {
    callId: callId(event.callId, { required: true }),
    provider: cleanLabel(event.provider),
    model: cleanLabel(event.model),
    source: source(event.source),
  };
  const attribution = projectAttribution(event.attribution);
  if (attribution) projected.attribution = attribution;
  if (outcome === "unknown") {
    projected.code = UNKNOWN_CODES.has(event.code)
      ? event.code
      : "provider_transport_outcome_unknown";
  }
  return projected;
}

export function runtimeUsageEventType(outcome) {
  return outcome === "started" ? "model_usage_started" : "model_usage_unknown";
}

export function runtimeToolCallId(value) {
  const projected = callId(value);
  if (projected) return projected;
  fallbackToolSequence = (fallbackToolSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `tool-${Date.now().toString(36)}-${fallbackToolSequence.toString(36)}`;
}

export function markRuntimeLedgerPersistenceError(error) {
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      error.runtimeLedgerPersistence = true;
      if (error.runtimeLedgerPersistence === true) return error;
    } catch {
      // Frozen/non-extensible errors are wrapped below.
    }
  }
  const wrapped = new Error("runtime usage ledger persistence failed", {
    cause: error,
  });
  wrapped.runtimeLedgerPersistence = true;
  return wrapped;
}
