const PERSISTENCE_SUBTYPES = new Set([
  "error_persistence",
  "error_session_persistence",
]);
const PERSISTENCE_CODES = new Set([
  "CC_SESSION_PERSISTENCE_FAILED",
  "CC_SESSION_TOOL_ROUND_PERSISTENCE_FAILED",
  "SESSION_REVISION_STALE",
  "CC_COMPACTION_REVISION_STALE",
  "CC_COMPACTION_SETTLEMENT_FAILED",
]);
const PERSISTENCE_PHASES = new Set([
  "before-model",
  "after-model",
  "unspecified",
]);

function boundedErrorCode(value) {
  return typeof value === "string" &&
    value.length <= 120 &&
    /^[A-Z]/u.test(value) &&
    !/[^A-Z0-9_]/u.test(value)
    ? value
    : null;
}

function isPersistenceResult(event) {
  return (
    event?.type === "result" &&
    event.is_error === true &&
    (PERSISTENCE_SUBTYPES.has(event.subtype) ||
      PERSISTENCE_CODES.has(event.code))
  );
}

function errorDiagnostic(event) {
  const code = boundedErrorCode(event.code);
  const identifier = code ? { code } : {};
  if (!isPersistenceResult(event)) {
    // Ordinary provider/configuration errors still need their actionable reason.
    const reason = event.error || event.result || "turn failed";
    return { ...identifier, text: code ? `${reason} [${code}]` : reason };
  }
  // Persistence failures can wrap a provider request. Only project the known
  // protocol fields; do not infer the failure phase from arbitrary prose.
  const phase = PERSISTENCE_PHASES.has(event.persistence?.phase)
    ? event.persistence.phase
    : "unspecified";
  return {
    ...identifier,
    phase,
    text: `Session persistence failed${code ? ` [${code}]` : ""} (phase: ${phase}). Inspect the saved session before continuing.`,
  };
}

module.exports = { boundedErrorCode, isPersistenceResult, errorDiagnostic };
