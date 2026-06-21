/**
 * stream-retry — shared classification of transient streaming-chat failures.
 *
 * A streaming LLM call can drop mid-flight (ECONNRESET / "terminated" / socket
 * hangup / DNS). When that happens BEFORE any output reached the user it is safe
 * to re-issue the request. This module is the single source of truth for "is
 * this error a retryable connection drop?" so the agent path (agent-core) and
 * the chat path (chat-core) classify identically.
 *
 * Pure + dependency-light (only the shared abort-utils) so it can be unit-tested
 * and imported by either streaming implementation without pulling in the heavy
 * agent runtime.
 */

import { isAbortError } from "./abort-utils.js";

/** Bounded auto-retry budget for streaming connection drops (Claude-Code 2.1.181). */
export const STREAM_RETRY_MAX = 2;
export const STREAM_RETRY_BASE_MS = 400;

/**
 * Is this error from a streaming chat request a transient API CONNECTION drop
 * that is safe to retry? True only for genuine network failures (reset /
 * timeout / DNS / refused / socket hangup / undici "terminated" / "fetch
 * failed"). False for user aborts and for HTTP/status errors (a 4xx/auth/5xx is
 * the server's verdict carried in the message, not a dropped pipe — retrying a
 * connection that never dropped won't help and could double-bill).
 *
 * @param {unknown} err
 * @param {AbortSignal} [signal]  the caller's signal — a user abort is never retryable
 * @returns {boolean}
 */
export function isRetryableStreamError(err, signal) {
  if (isAbortError(err)) return false;
  if (signal && signal.aborted) return false;
  if (!err) return false;
  const code = String(err.code || err.cause?.code || "").toUpperCase();
  if (
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "EPIPE",
      "ENETUNREACH",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
    ].includes(code)
  ) {
    return true;
  }
  const msg = String(err.message || err).toLowerCase();
  return /econnreset|etimedout|econnrefused|eai_again|socket hang ?up|terminated|fetch failed|network error|timed?\s*out|premature close/.test(
    msg,
  );
}
