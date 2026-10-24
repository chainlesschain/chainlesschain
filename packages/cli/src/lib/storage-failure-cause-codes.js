import { types } from "node:util";

// Fixed identifiers only. An error's text, stack, paths and arbitrary code
// strings are never retained by this diagnostic projection.
const CODES = new Map(
  [
    "CC_ARTIFACT_BOUNDED_READ_FAILED",
    "SECURE_FILE_IDENTITY_INVALID_PARENT",
    "SECURE_FILE_IDENTITY_PARENT_RACE",
    "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED",
    "CC_EVOLUTION_ARTIFACT_EXPIRED",
    "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
    "CC_EVOLUTION_ARTIFACT_INVALID",
    "CC_EVOLUTION_ARTIFACT_NOT_FOUND",
    "CC_EVOLUTION_ARTIFACT_SIGNATURE_INVALID",
    "CC_EVOLUTION_ARTIFACT_STORE_FAILED",
    "CC_EVOLUTION_ARTIFACT_TYPE_DENIED",
    "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
    "CC_EVOLUTION_LEDGER_ARTIFACT_UNAVAILABLE",
    "CC_EVOLUTION_LEDGER_AUDIT_INVALID",
    "CC_EVOLUTION_LEDGER_CAPACITY_EXCEEDED",
    "CC_EVOLUTION_LEDGER_CLOCK_FAILED",
    "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
    "CC_EVOLUTION_LEDGER_CORRUPT",
    "CC_EVOLUTION_LEDGER_CRASH_HOOK_INVALID",
    "CC_EVOLUTION_LEDGER_DURABILITY_UNAVAILABLE",
    "CC_EVOLUTION_LEDGER_EVENT_CONFLICT",
    "CC_EVOLUTION_LEDGER_HEAD_CONFLICT",
    "CC_EVOLUTION_LEDGER_LOCK_UNAVAILABLE",
    "CC_EVOLUTION_LEDGER_RANDOM_FAILED",
    "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
    "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
    "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
    "CC_EVOLUTION_LEDGER_SIGNING_FAILED",
    "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
    "CC_EVOLUTION_LEDGER_TRUST_INVALID",
    "CC_EVOLUTION_LEDGER_TRUST_MISMATCH",
    "CC_EVOLUTION_LEDGER_TRUST_PORT_REQUIRED",
    "CC_EVOLUTION_LEDGER_V2_REQUIRED",
    "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
    "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
    "CC_EVOLUTION_LEDGER_WITNESS_REQUIRED",
    "CC_EVOLUTION_LEDGER_WITNESS_UNAVAILABLE",
    "CC_EVOLUTION_LEDGER_WRITE_FAILED",
    "CC_EVOLUTION_RUN_LEDGER_CONFLICT",
    "CC_EVOLUTION_RUN_LEDGER_CORRUPT",
    "CONFIG_HOME_UNSAFE",
    "EACCES",
    "EBUSY",
    "EEXIST",
    "EIO",
    "EISDIR",
    "EMFILE",
    "ENFILE",
    "ENOENT",
    "ENOSPC",
    "ENOTDIR",
    "EPERM",
    "EROFS",
    "ETIMEDOUT",
  ].map((code) => [code, code]),
);
const MAX_CAUSES = 6;
const MARKER = " [storage_cause_codes: ";
const STAGE_MARKER = " [storage_stage: ";
const FAILURE_STAGES = new WeakMap();
const ARTIFACT_TYPES = new Set([
  "source-evidence",
  "model-projection",
  "trusted-projection",
  "receipt",
  "evidence",
  "other",
]);
const PHASES = new Set([
  "validate",
  "pre-index",
  "authority",
  "sign",
  "publish",
  "post-index",
  "authentication",
  "read-bytes",
  "final-lease",
  "receipt",
]);

/** Error-path observation only: preserve the original error and its causes. */
export function recordStorageFailureStage(error, artifactType, phase) {
  try {
    if (
      error !== null &&
      typeof error === "object" &&
      !types.isProxy(error) &&
      typeof artifactType === "string" &&
      PHASES.has(phase)
    ) {
      FAILURE_STAGES.set(
        error,
        Object.freeze({
          artifactType: ARTIFACT_TYPES.has(artifactType)
            ? artifactType
            : "other",
          phase,
        }),
      );
    }
  } catch {
    // Diagnostics cannot replace the original exception.
  }
  return error;
}

export function storageFailureStage(error) {
  try {
    const seen = new Set();
    let current = error;
    for (let depth = 0; depth < MAX_CAUSES && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const stage = FAILURE_STAGES.get(current);
      if (stage) return stage;
      current = data(current, "cause");
    }
  } catch {
    // Observation must never change the original error or exit outcome.
  }
  return null;
}

function data(value, key) {
  for (let depth = 0; depth < 4 && value !== null; depth++) {
    if (typeof value !== "object" || types.isProxy(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    value = Object.getPrototypeOf(value);
  }
  return undefined;
}

/** Optional diagnostics; this never adjudicates a failure or grants a retry. */
export function storageFailureCauseCodes(error) {
  const codes = [];
  try {
    const seen = new Set();
    let current = error;
    for (let depth = 0; depth < MAX_CAUSES && current; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const known = CODES.get(data(current, "code"));
      if (known && !codes.includes(known)) codes.push(known);
      current = data(current, "cause");
    }
  } catch {
    // Observation must never change the original error or exit outcome.
  }
  return Object.freeze(codes);
}

export function storageFailureCauseSuffix(error) {
  const codes = storageFailureCauseCodes(error);
  const stage = storageFailureStage(error);
  return (
    (stage ? `${STAGE_MARKER}${stage.artifactType}/${stage.phase}]` : "") +
    (codes.length ? `${MARKER}${codes.join(" -> ")}]` : "")
  );
}

/** Fixed stage identifiers only; accept a complete marker at the suffix. */
export function storageFailureStageFromMessage(message) {
  if (typeof message !== "string") return null;
  const tail = message.slice(-1024);
  const offset = tail.lastIndexOf(STAGE_MARKER);
  if (offset < 0) return null;
  const end = tail.indexOf("]", offset + STAGE_MARKER.length);
  if (end < 0) return null;
  const remainder = tail.slice(end + 1);
  if (remainder !== "") {
    const codes = storageFailureCodesFromMessage(remainder);
    if (!codes.length || remainder !== `${MARKER}${codes.join(" -> ")}]`)
      return null;
  }
  const identifiers = tail.slice(offset + STAGE_MARKER.length, end).split("/");
  if (
    identifiers.length !== 2 ||
    !ARTIFACT_TYPES.has(identifiers[0]) ||
    !PHASES.has(identifiers[1])
  )
    return null;
  return Object.freeze({ artifactType: identifiers[0], phase: identifiers[1] });
}

/** Re-project the bounded marker without retaining any preceding error text. */
export function storageFailureCodesFromMessage(message) {
  if (typeof message !== "string") return Object.freeze([]);
  const tail = message.slice(-1024);
  const offset = tail.lastIndexOf(MARKER);
  if (offset < 0 || !tail.endsWith("]")) return Object.freeze([]);
  const values = tail.slice(offset + MARKER.length, -1).split(" -> ");
  if (values.length < 1 || values.length > MAX_CAUSES) return Object.freeze([]);
  const result = [];
  for (const value of values) {
    const known = CODES.get(value);
    if (!known) return Object.freeze([]);
    if (!result.includes(known)) result.push(known);
  }
  return Object.freeze(result);
}
