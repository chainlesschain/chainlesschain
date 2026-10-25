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
    "CC_EVOLUTION_LEDGER_PREFIX_READER_FAILED",
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
// Match only fixed source literals paired with their own error code. These
// tokens identify guard blocks; composite guards do not identify a field or
// prove clock rollback. Observed messages are never retained by diagnostics.
const REASONS = new Map([
  [
    "CC_ARTIFACT_BOUNDED_READ_FAILED",
    new Map([
      ["artifact path and descriptor identities differ", "bounded-path-handle"],
      [
        "artifact descriptor changed during bounded read",
        "bounded-descriptor-changed",
      ],
      [
        "artifact pathname changed during bounded read",
        "bounded-pathname-changed",
      ],
      ["artifact path is not physically canonical", "bounded-path-canonical"],
    ]),
  ],
  [
    "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED",
    new Map([
      ["ArtifactStore root physical identity changed", "store-root-identity"],
      [
        "ArtifactStore files root physical identity changed",
        "store-files-identity",
      ],
      [
        "ArtifactStore sealed directory identity or reader changed",
        "sealed-directory-or-reader",
      ],
      [
        "stored artifact history directory identity changed",
        "history-directory-identity",
      ],
      [
        "ArtifactStore index physical identity changed",
        "index-physical-changed",
      ],
      [
        "ArtifactStore index realpath changed or escaped its root",
        "index-realpath-changed",
      ],
      [
        "ArtifactStore index descriptor is replaced or oversized",
        "index-path-handle",
      ],
      [
        "ArtifactStore index changed while its descriptor was read",
        "index-descriptor-changed",
      ],
      [
        "ArtifactStore index pathname changed during descriptor read",
        "index-pathname-changed",
      ],
      [
        "ArtifactStore index generation changed during readback",
        "index-generation-changed",
      ],
      [
        "ArtifactStore.get is not bound to the trusted index snapshot",
        "index-get-unbound",
      ],
      [
        "ArtifactStore index entry was replaced during readback",
        "index-entry-changed",
      ],
      [
        "ArtifactStore index entry was replaced during ledger readback",
        "index-ledger-entry-changed",
      ],
      [
        "ArtifactStore index changed during ledger batch readback",
        "index-batch-changed",
      ],
      [
        "ArtifactStore index changed during ledger history readback",
        "index-history-changed",
      ],
      [
        "ArtifactStore post-read integrity verification threw",
        "artifact-post-read-hook",
      ],
      [
        "stored artifact bytes do not match the signed recordDigest",
        "artifact-record-digest",
      ],
    ]),
  ],
  [
    "CC_EVOLUTION_ARTIFACT_EXPIRED",
    new Map([
      [
        "evolution artifact envelope is not currently valid",
        "envelope-validity-window",
      ],
      [
        "artifact authority expired before envelope authentication completed",
        "authentication-clock-window",
      ],
      [
        "artifact authority expired before canonical bytes could be released",
        "release-clock-window",
      ],
      [
        "artifact publish authority expired before envelope signing completed",
        "signing-clock-window",
      ],
      [
        "artifact authority expired before ledger batch release",
        "batch-clock-window",
      ],
      [
        "artifact authority expired before ledger history release",
        "history-clock-window",
      ],
    ]),
  ],
  [
    "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED",
    new Map([
      ["artifact authority clock moved backwards", "authority-clock-backward"],
      [
        "current artifact authority denied or returned an unbound decision",
        "authority-decision-unbound",
      ],
      [
        "artifact envelope is stale under current policy or revocation authority",
        "authority-policy-stale",
      ],
    ]),
  ],
]);
const TAGGED_REASON_CODES = new Map(
  [
    "auth-clock-backward",
    "auth-envelope-expired",
    "auth-authority-lease-expired",
    "release-clock-backward",
    "release-envelope-expired",
    "release-authority-lease-expired",
  ].map((reason) => [reason, "CC_EVOLUTION_ARTIFACT_EXPIRED"]),
);
const FAILURE_REASONS = new WeakMap();
const REASON_CODES = new Map([
  ...[...REASONS].flatMap(([code, messages]) =>
    [...messages.values()].map((reason) => [reason, code]),
  ),
  ...TAGGED_REASON_CODES,
]);
const REASON_MARKER = " [storage_reason: ";
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
  const reason = storageFailureReason(error);
  return (
    (reason && codes.includes(REASON_CODES.get(reason))
      ? `${REASON_MARKER}${reason}]`
      : "") +
    (stage ? `${STAGE_MARKER}${stage.artifactType}/${stage.phase}]` : "") +
    (codes.length ? `${MARKER}${codes.join(" -> ")}]` : "")
  );
}

// Unlike legacy cause-code projection, reasons require own data properties.
// Callers reject proxies before this helper; no prototype traversal or getters.
function ownData(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Preserve the original error; retain only an allow-listed branch token. */
export function recordStorageFailureReason(error, reason) {
  try {
    if (
      error !== null &&
      typeof error === "object" &&
      !types.isProxy(error) &&
      TAGGED_REASON_CODES.has(reason) &&
      ownData(error, "code") === TAGGED_REASON_CODES.get(reason)
    )
      FAILURE_REASONS.set(error, reason);
  } catch {
    // Diagnostics cannot replace the original exception.
  }
  return error;
}

/** Prefer a fixed branch tag; otherwise keep the deepest exact-message match. */
export function storageFailureReason(error) {
  let reason = null;
  let taggedReason = null;
  try {
    const seen = new Set();
    let current = error;
    for (let depth = 0; depth < MAX_CAUSES; depth++) {
      if (
        current === null ||
        typeof current !== "object" ||
        types.isProxy(current) ||
        seen.has(current)
      )
        break;
      seen.add(current);
      const code = ownData(current, "code");
      const tagged = FAILURE_REASONS.get(current);
      if (tagged && TAGGED_REASON_CODES.get(tagged) === code)
        taggedReason = tagged;
      const messages = typeof code === "string" ? REASONS.get(code) : undefined;
      if (messages) {
        const message = ownData(current, "message");
        const matched =
          typeof message === "string" ? messages.get(message) : undefined;
        if (matched) reason = matched;
      }
      current = ownData(current, "cause");
    }
  } catch {
    // Observation must never change the original error or exit outcome.
  }
  return taggedReason ?? reason;
}

/** Accept only a fixed reason followed by the complete legacy suffix. */
export function storageFailureReasonFromMessage(message) {
  if (typeof message !== "string") return null;
  const tail = message.slice(-1024);
  const offset = tail.lastIndexOf(REASON_MARKER);
  if (offset < 0) return null;
  const end = tail.indexOf("]", offset + REASON_MARKER.length);
  if (end < 0) return null;
  const candidate = tail.slice(offset + REASON_MARKER.length, end);
  const code = REASON_CODES.get(candidate);
  if (!code) return null;
  const remainder = tail.slice(end + 1);
  const codes = storageFailureCodesFromMessage(remainder);
  if (!codes.includes(code)) return null;
  const stage = storageFailureStageFromMessage(remainder);
  const expected =
    (stage ? `${STAGE_MARKER}${stage.artifactType}/${stage.phase}]` : "") +
    `${MARKER}${codes.join(" -> ")}]`;
  if (remainder !== expected) return null;
  // Return the table-owned token rather than retaining untrusted message text.
  for (const reason of REASON_CODES.keys()) {
    if (reason === candidate) return reason;
  }
  return null;
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
