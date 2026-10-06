"use strict";

const { types } = require("node:util");

const AUDIT_POLICY_VERSION = "audit-metadata/v1";
const REDACTED = "[REDACTED]";
const OMITTED = "[Content omitted]";
const FIELD_CLASSES = Object.freeze({
  METADATA: "metadata",
  IDENTIFIER: "identifier",
  SECRET: "secret",
  CONTENT: "content",
  UNKNOWN: "unknown",
});
const normalize = (key) => key.toLowerCase().replace(/[\s_.-]/g, "");
const identifiers = new Set([
  "id",
  "actor",
  "target",
  "requestid",
  "traceid",
  "eventid",
  "logid",
  "projectid",
  "taskid",
  "runid",
  "actionrunid",
  "devicedid",
  "owner",
]);
const numbers = new Set([
  "count",
  "bulkcount",
  "tokencount",
  "duration",
  "durationms",
  "latencyms",
  "attempt",
  "attempts",
  "retrycount",
  "statuscode",
  "bytelength",
  "timestamp",
  "createdat",
  "updatedat",
  "expiresat",
  "inputtokens",
  "outputtokens",
]);
const booleans = new Set([
  "success",
  "retryable",
  "allowed",
  "denied",
  "cached",
]);
const labels = new Set([
  "eventtype",
  "operation",
  "namespace",
  "action",
  "status",
  "level",
  "risklevel",
  "code",
  "errorcode",
  "phase",
  "service",
  "reasoncode",
]);
const containers = new Set([
  "metadata",
  "metrics",
  "error",
  "cause",
  "context",
  "request",
  "result",
  "steps",
  "timings",
]);

function classifyAuditField(key) {
  if (typeof key !== "string") return FIELD_CLASSES.UNKNOWN;
  const name = normalize(key);
  if (
    /(?:password|passwd|pwd|passphrase|secret(?:key)?|privatekey|apikey|token|authorization|cookie|mnemonic|seedphrase|credentials?|encryptionkey|signingkey|sessionid|auth)$/.test(
      name,
    )
  ) {
    return FIELD_CLASSES.SECRET;
  }
  if (identifiers.has(name)) return FIELD_CLASSES.IDENTIFIER;
  if (
    numbers.has(name) ||
    booleans.has(name) ||
    labels.has(name) ||
    containers.has(name)
  ) {
    return FIELD_CLASSES.METADATA;
  }
  if (
    /(?:content|description|snapshot|prompt|text|body|message|stack|url|uri|path|headers|name|email|address|agent|query|input|output)$/.test(
      name,
    )
  ) {
    return FIELD_CLASSES.CONTENT;
  }
  return FIELD_CLASSES.UNKNOWN;
}

// Codes and IDs are structured metadata, never arbitrary prose/URLs. The caller
// must supply real IDs, not a credential in an ID field. Unknown keys are dropped
// as well as values (a user-controlled map key can itself contain private text).
function projectAuditField(key, value) {
  const name = normalize(key);
  const classification = classifyAuditField(key);
  if (classification === FIELD_CLASSES.SECRET) return REDACTED;
  if (classification === FIELD_CLASSES.CONTENT) return OMITTED;
  if (value == null) return null;
  if (numbers.has(name)) {
    if (
      typeof value === "bigint" &&
      value >= 0n &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
    )
      return Number(value);
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  }
  if (booleans.has(name)) return typeof value === "boolean" ? value : null;
  if (labels.has(name) || identifiers.has(name)) {
    if (
      name === "status" &&
      Number.isSafeInteger(value) &&
      value >= 100 &&
      value <= 599
    )
      return value;
    return typeof value === "string" &&
      value.length <= 160 &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)
      ? value
      : OMITTED;
  }
  return undefined;
}

function projectAuditMetadata(value) {
  let nodes = 512;
  const seen = new WeakSet();
  function visit(input, depth = 0) {
    if (--nodes < 0 || depth >= 8) return "[Truncated]";
    if (input == null) return input;
    if (typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input !== "object") return OMITTED;
    if (types.isProxy(input)) return OMITTED;
    if (seen.has(input)) return "[Circular Reference]";
    seen.add(input);
    try {
      if (Array.isArray(input)) {
        return Array.from({ length: Math.min(input.length, 100) }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          return descriptor && "value" in descriptor
            ? visit(descriptor.value, depth + 1)
            : OMITTED;
        });
      }
      if (
        !(input instanceof Error) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      )
        return OMITTED;
      const result = {};
      // Inspect only fixed classified names; no getters or toJSON methods run.
      for (const key of Object.keys(input).slice(0, 100)) {
        const classification = classifyAuditField(key);
        if (classification === FIELD_CLASSES.UNKNOWN || key.length > 160)
          continue;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor)) continue;
        result[key] = containers.has(normalize(key))
          ? visit(descriptor.value, depth + 1)
          : projectAuditField(key, descriptor.value);
      }
      return result;
    } catch {
      return OMITTED;
    } finally {
      seen.delete(input);
    }
  }
  return visit(value);
}

function validateRetentionDays(days, maximum = 365) {
  if (!Number.isSafeInteger(days) || days < 1 || days > maximum) {
    throw new RangeError(
      `Audit retention must be an integer from 1 to ${maximum} days`,
    );
  }
  return days;
}

function validateAuditRetention({
  maxLogAge,
  maxLogCount,
  autoCleanupInterval,
}) {
  for (const [name, value, maximum] of [
    ["maxLogAge", maxLogAge, 365 * 86400000],
    ["maxLogCount", maxLogCount, 1000000],
    ["autoCleanupInterval", autoCleanupInterval, 86400000],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(`Invalid audit retention ${name}`);
    }
  }
}

module.exports = {
  AUDIT_POLICY_VERSION,
  FIELD_CLASSES,
  classifyAuditField,
  projectAuditField,
  projectAuditMetadata,
  validateRetentionDays,
  validateAuditRetention,
};
