import {
  readVerifiedProjection,
  resolveSessionAuthority,
} from "../harness/jsonl-session-store.js";

export const CHAT_CALL_LEDGER_UNSUPPORTED = "CC_CHAT_CALL_LEDGER_UNSUPPORTED";
export const CHAT_SESSION_NOT_FOUND = "CC_CHAT_SESSION_NOT_FOUND";
export const CHAT_SESSION_UNAVAILABLE = "CC_CHAT_SESSION_UNAVAILABLE";

function admissionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sessionDeclaresProtectedUsage(sessionId, projectionReader) {
  return projectionReader(sessionId, () => {
    let protectedUsage = false;
    let sessionStartSeen = false;
    return {
      accept(event) {
        if (event?.type !== "session_start" || sessionStartSeen) return;
        sessionStartSeen = true;
        const data =
          event.data &&
          typeof event.data === "object" &&
          !Array.isArray(event.data)
            ? event.data
            : {};
        protectedUsage = [
          "observabilityScope",
          "usageTelemetryProtocol",
          "usageTelemetryVersion",
        ].some((field) => Object.hasOwn(data, field));
      },
      finish() {
        return protectedUsage;
      },
    };
  });
}

/**
 * Admit only an explicitly present, readable and fully verified legacy session.
 * Interactive chat cannot yet durably bracket its provider calls, so any scope
 * or call-ledger declaration must fail before the REPL appends or spends.
 */
export function assertChatSessionUsageAdmission(
  sessionReference,
  {
    resolveAuthority = resolveSessionAuthority,
    readProjection = readVerifiedProjection,
  } = {},
) {
  if (!sessionReference) return;
  const authority = resolveAuthority(sessionReference);
  if (!authority) {
    throw admissionError(
      CHAT_SESSION_NOT_FOUND,
      "Interactive chat session was not found",
    );
  }
  if (!authority.readable) {
    throw admissionError(
      CHAT_SESSION_UNAVAILABLE,
      "Interactive chat session is not readable and cannot be resumed safely",
    );
  }
  if (!sessionDeclaresProtectedUsage(authority.id, readProjection)) {
    return authority.id;
  }
  throw admissionError(
    CHAT_CALL_LEDGER_UNSUPPORTED,
    "Scoped call-ledger sessions are not supported by interactive chat; use agent mode or an IDE host with usage-ledger support",
  );
}
