/**
 * Streaming structural authority for canonical session transcripts.
 *
 * Hash-chain verification proves that bytes were not changed after they were
 * anchored. It does not prove that the event protocol has one genesis marker.
 * Every usable session must therefore contain exactly one `session_start`, and
 * that marker must be the first event.
 */

export const SESSION_TRANSCRIPT_STRUCTURE_ERROR_CODE =
  "CC_SESSION_TRANSCRIPT_STRUCTURE_INVALID";

function structureReason({ eventCount, sessionStartCount, sessionStartIndex }) {
  if (eventCount > 0 && sessionStartIndex !== 0) {
    return "session_start must be the first event";
  }
  if (sessionStartCount !== 1) {
    return "session must contain exactly one session_start event";
  }
  return null;
}

function structureError(sessionId, reason, projection) {
  const label =
    typeof sessionId === "string" && sessionId.length > 0
      ? sessionId.slice(0, 256)
      : "unknown";
  const error = new Error(`session ${label} ${reason}`);
  error.code = SESSION_TRANSCRIPT_STRUCTURE_ERROR_CODE;
  error.sessionId = sessionId ?? null;
  error.structure = projection;
  return error;
}

/**
 * Build a constant-space structure projection for a stream of session events.
 *
 * `failFast` rejects violations that are already irreversible while events are
 * accepted. `finish({ assertValid: true })` additionally rejects a missing
 * marker once the complete stream is known.
 */
export function createSessionTranscriptStructureProjection(
  sessionId,
  { failFast = false } = {},
) {
  let eventCount = 0;
  let sessionStartCount = 0;
  let sessionStartIndex = null;

  const snapshot = () => {
    const projection = {
      eventCount,
      sessionStartCount,
      sessionStartIndex,
      hasStartEvent: sessionStartCount > 0,
    };
    const reason = structureReason(projection);
    return Object.freeze({
      ...projection,
      sessionStartIsFirst: sessionStartIndex === 0,
      valid: reason === null,
      reason,
    });
  };

  const assertProjection = (projection) => {
    if (!projection.valid) {
      throw structureError(sessionId, projection.reason, projection);
    }
    return projection;
  };

  return Object.freeze({
    accept(event) {
      const index = eventCount;
      eventCount += 1;
      if (event?.type === "session_start") {
        sessionStartCount += 1;
        if (sessionStartIndex === null) sessionStartIndex = index;
      }

      const projection = snapshot();
      const irreversibleViolation =
        (index === 0 && event?.type !== "session_start") ||
        sessionStartCount > 1;
      if (failFast && irreversibleViolation) {
        assertProjection(projection);
      }
      return projection;
    },
    finish({ assertValid = failFast } = {}) {
      const projection = snapshot();
      return assertValid ? assertProjection(projection) : projection;
    },
  });
}
