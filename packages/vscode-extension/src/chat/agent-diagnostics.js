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

function isCompactionUsageUnknownResult(event) {
  return (
    event?.type === "result" &&
    event.is_error === true &&
    (event.subtype === "error_compaction_usage_unknown" ||
      event.code === "CC_COMPACTION_USAGE_UNKNOWN")
  );
}

function isSessionReviewResult(event) {
  return isPersistenceResult(event) || isCompactionUsageUnknownResult(event);
}

function errorDiagnostic(event) {
  const code = boundedErrorCode(event.code);
  const identifier = code ? { code } : {};
  if (isCompactionUsageUnknownResult(event)) {
    const hints = {
      authentication:
        "Provider authentication failed; check the API credentials.",
      access_denied: "Provider access was denied; check model permissions.",
      rate_limit: "The provider rate limit was reached; wait before resuming.",
      server_error:
        "The provider returned a server error; check service availability.",
      http_error:
        "The provider rejected the request; check the model endpoint.",
      network: "The model connection failed; check network and proxy settings.",
      invalid_response:
        "The provider returned an invalid response; check API compatibility.",
    };
    const category = event.provider_error?.category;
    const hint = Object.hasOwn(hints, category || "")
      ? ` ${hints[category]}`
      : "";
    const reason =
      event.usage_unknown_reason === "provider_usage_not_reported"
        ? "The compaction provider did not report valid token usage."
        : event.usage_unknown_reason === "provider_transport_outcome_unknown"
          ? "The compaction request failed before its usage could be confirmed."
          : "The compaction provider's token usage could not be confirmed.";
    return {
      ...identifier,
      text: `${reason}${code ? ` [${code}]` : ""} The session stopped without retrying the request.${hint} Review the saved session and provider usage, check the model connection, then resume explicitly.`,
    };
  }
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

module.exports = {
  boundedErrorCode,
  isPersistenceResult,
  isCompactionUsageUnknownResult,
  isSessionReviewResult,
  errorDiagnostic,
};
