export const SESSION_PERSISTENCE_FAILURE_SCHEMA =
  "chainlesschain.session-persistence-failure.v1";
export const SESSION_PERSISTENCE_FAILURE_CODE = "CC_SESSION_PERSISTENCE_FAILED";

// EIO is a common fsync/FlushFileBuffers failure. Once the append bytes have
// been issued its outcome is unknown, so it belongs in the same bounded,
// content-free persistence error domain as ENOSPC/EROFS.
const STORAGE_FAILURE_CODES = new Set(["ENOSPC", "EROFS", "EIO"]);
const COMMIT_STATES = new Set(["not-committed", "unknown", "committed"]);
const OPERATIONS = new Set([
  "append-event",
  "append-authority-event",
  "transcript-append",
  "transcript-settlement",
  "session-start",
  "user-turn-append",
  "assistant-turn-append",
]);
const PHASES = new Set(["before-model", "after-model", "unspecified"]);

function normalizedOperation(value) {
  return OPERATIONS.has(value) ? value : "unknown";
}

function normalizedPhase(value) {
  return PHASES.has(value) ? value : "unspecified";
}

function storageCode(error) {
  const seen = new Set();
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    for (const code of [current.fsCode, current.code]) {
      if (STORAGE_FAILURE_CODES.has(code)) return code;
    }
    current = current.cause;
  }
  return null;
}

function normalizedCommitState(value, fsCode) {
  if (COMMIT_STATES.has(value)) return value;
  // Opening an append target on a read-only filesystem cannot publish the
  // requested record. ENOSPC may be reported after a short write, so callers
  // must verify the transcript instead of retrying blindly.
  return fsCode === "EROFS" ? "not-committed" : "unknown";
}

function retryableFor(fsCode, commitState) {
  return fsCode === "ENOSPC" && commitState === "not-committed";
}

export function isSessionPersistenceFailure(error) {
  return (
    error?.code === SESSION_PERSISTENCE_FAILURE_CODE &&
    STORAGE_FAILURE_CODES.has(error?.fsCode) &&
    COMMIT_STATES.has(error?.commitState)
  );
}

export function createSessionPersistenceFailure(
  cause,
  { sessionId = null, operation = "append-event", commitState } = {},
) {
  if (isSessionPersistenceFailure(cause)) {
    const expectedRetryable = retryableFor(cause.fsCode, cause.commitState);
    if (cause.retryable === expectedRetryable) return cause;
    const normalized = new Error(
      `Session persistence failed during ${normalizedOperation(cause.operation)} (${cause.fsCode})`,
      { cause },
    );
    normalized.code = SESSION_PERSISTENCE_FAILURE_CODE;
    normalized.fsCode = cause.fsCode;
    normalized.operation = normalizedOperation(cause.operation);
    normalized.commitState = cause.commitState;
    normalized.retryable = expectedRetryable;
    if (cause.sessionId) normalized.sessionId = cause.sessionId;
    return normalized;
  }
  const fsCode = storageCode(cause);
  if (!fsCode) return cause;

  const error = new Error(
    `Session persistence failed during ${normalizedOperation(operation)} (${fsCode})`,
    { cause },
  );
  error.code = SESSION_PERSISTENCE_FAILURE_CODE;
  error.fsCode = fsCode;
  error.operation = normalizedOperation(operation);
  error.commitState = normalizedCommitState(commitState, fsCode);
  // ENOSPC is retryable only when the failed append is known not to have
  // committed. An unknown short-write result requires transcript verification
  // first; exposing it as retryable would invite a duplicate event.
  error.retryable = retryableFor(fsCode, error.commitState);
  if (sessionId) error.sessionId = sessionId;
  return error;
}

export function projectSessionPersistenceFailure(error, { phase } = {}) {
  if (!isSessionPersistenceFailure(error)) return null;
  return Object.freeze({
    schema: SESSION_PERSISTENCE_FAILURE_SCHEMA,
    code: SESSION_PERSISTENCE_FAILURE_CODE,
    fs_code: error.fsCode,
    operation: normalizedOperation(error.operation),
    phase: normalizedPhase(phase),
    commit_state: error.commitState,
    retryable: retryableFor(error.fsCode, error.commitState),
  });
}
