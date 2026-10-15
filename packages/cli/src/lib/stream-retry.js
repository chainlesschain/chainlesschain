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

import {
  createAbortError,
  isAbortError,
  raceWithAbort,
  throwIfAborted,
} from "./abort-utils.js";
import { isFormalBudgetError } from "./formal-budget-errors.js";

/** Bounded auto-retry budget for streaming connection drops (Claude-Code 2.1.181). */
export const STREAM_RETRY_MAX = 2;
export const STREAM_RETRY_BASE_MS = 400;
export const STREAM_RETRY_MAX_DELAY_MS = 60_000;

function isFailureStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

function retryAfterHeader(headers) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get("retry-after");
  const entries = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === "retry-after",
  );
  // Multiple spellings or a list of values are ambiguous, not a delay.
  return entries.length === 1 ? entries[0][1] : undefined;
}

function httpDate(value, now) {
  // Accept the three HTTP-date wire formats, not Date.parse's permissive
  // numeric/local-date syntax (e.g. "-1", "1.5", or "2026-10-12").
  const weekday = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const month = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  let match = new RegExp(
    `^(${weekday}), (\\d{2}) ${month} (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
  ).exec(value);
  let day, monthName, year, hour, minute, second, dayName;
  if (match) {
    [, dayName, day, monthName, year, hour, minute, second] = match;
  } else {
    match = new RegExp(
      `^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-${month}-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
    ).exec(value);
    if (match) {
      [, dayName, day, monthName, year, hour, minute, second] = match;
      const currentYear = new Date(now).getUTCFullYear();
      year = Math.floor(currentYear / 100) * 100 + Number(year);
      if (year > currentYear + 50) year -= 100;
    } else {
      match = new RegExp(
        `^(${weekday}) ${month} ( [1-9]|[12]\\d|3[01]) (\\d{2}):(\\d{2}):(\\d{2}) (\\d{4})$`,
      ).exec(value);
      if (!match) return undefined;
      [, dayName, monthName, day, hour, minute, second, year] = match;
    }
  }
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const monthIndex = months.indexOf(monthName);
  const date = new Date(0);
  date.setUTCFullYear(Number(year), monthIndex, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  // Reject normalized invalid calendar dates/times and mismatched weekdays.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second) ||
    date.toUTCString().slice(0, 3) !== dayName.slice(0, 3)
  ) {
    return undefined;
  }
  return date.getTime();
}

/** Capture a deadline when headers arrive, before reading a slow response body.
 * No metadata here grants permission to retry an HTTP/provider verdict.
 */
export function captureStreamRetryMetadata(response, now = Date.now()) {
  const metadata = {};
  if (Number.isInteger(response?.status)) metadata.status = response.status;
  const raw = retryAfterHeader(response?.headers);
  if (typeof raw !== "string" || !Number.isFinite(now)) return metadata;
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const deadline = now + seconds * 1000;
    // A valid but unrepresentably large delay is a refusal to retry within our
    // budget, NOT a missing header. Infinity is an internal fail-closed sentinel.
    metadata.retryAfterAt = Number.isSafeInteger(deadline)
      ? deadline
      : Infinity;
  } else {
    const deadline = httpDate(value, now);
    if (deadline !== undefined) metadata.retryAfterAt = deadline;
  }
  return metadata;
}

/** Preserve the original Error identity/code and the strongest known verdict. */
export function attachStreamRetryMetadata(error, metadata = {}) {
  if (!error || (typeof error !== "object" && typeof error !== "function"))
    return error;
  const hasFailureStatus = [
    error.status,
    error.statusCode,
    error.cause?.status,
    error.cause?.statusCode,
  ].some(isFailureStatus);
  if (!hasFailureStatus && Number.isInteger(metadata.status)) {
    error.status = metadata.status;
  }
  if (
    typeof metadata.retryAfterAt === "number" &&
    !Number.isNaN(metadata.retryAfterAt) &&
    metadata.retryAfterAt !== -Infinity
  ) {
    const previous = [error.retryAfterAt, error.cause?.retryAfterAt].filter(
      (value) => typeof value === "number" && !Number.isNaN(value),
    );
    error.retryAfterAt = Math.max(metadata.retryAfterAt, ...previous);
  }
  return error;
}

/** Resolve the wait AFTER retry eligibility is checked; null means give up.
 * Never clamp a server deadline to a shorter wait or authorize an HTTP replay.
 * Attempt 1 is the first retry, matching the existing retry observer contract.
 */
export function resolveStreamRetryDelay(error, attempt, options = {}) {
  const base = options.baseDelayMs ?? STREAM_RETRY_BASE_MS;
  const now = options.now ?? Date.now();
  const max = options.maxDelayMs ?? STREAM_RETRY_MAX_DELAY_MS;
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !Number.isFinite(base) ||
    base < 0 ||
    !Number.isFinite(now) ||
    !Number.isFinite(max) ||
    max < 0
  )
    return null;
  const deadlines = [error?.retryAfterAt, error?.cause?.retryAfterAt].filter(
    (value) => typeof value === "number" && !Number.isNaN(value),
  );
  const delay = Math.ceil(
    Math.max(base * 2 ** (attempt - 1), 0, ...deadlines.map((at) => at - now)),
  );
  // Node clamps overflowing setTimeout delays to 1ms. Reject rather than
  // accidentally turning a requested long delay into an immediate replay.
  return Number.isFinite(delay) && delay <= max && delay <= 2_147_483_647
    ? delay
    : null;
}

/** Wait without keeping an obsolete backoff alive after user cancellation. */
export async function waitForStreamRetry(ms, signal, { sleep } = {}) {
  throwIfAborted(signal);
  if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_483_647)
    throw new RangeError("Invalid streaming retry delay");
  if (sleep) {
    await raceWithAbort(
      Promise.resolve().then(() => {
        throwIfAborted(signal);
        return sleep(ms);
      }),
      signal,
    );
    throwIfAborted(signal);
    return;
  }
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason || createAbortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  throwIfAborted(signal);
}

/**
 * Hard ceiling on the *configurable* retry budget (Claude-Code 2.1.186:
 * "CLAUDE_CODE_MAX_RETRIES capped at 15") — keeps a stray huge value from
 * turning a dead endpoint into a multi-minute exponential-backoff hang.
 */
export const STREAM_RETRY_MAX_CAP = 15;

/**
 * Resolve the streaming-retry budget. Users can raise (or lower) the default
 * via `CC_MAX_RETRIES` (native) or `CLAUDE_CODE_MAX_RETRIES` (Claude-Code
 * parity); the value is clamped to `[0, STREAM_RETRY_MAX_CAP]`. Unset / blank /
 * non-numeric falls back to the default `STREAM_RETRY_MAX`; a negative value
 * clamps to 0 (retries disabled). `CC_MAX_RETRIES` wins when both are set.
 *
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {number}
 */
export function resolveStreamRetryMax(env = process.env) {
  const raw = env.CC_MAX_RETRIES ?? env.CLAUDE_CODE_MAX_RETRIES;
  if (raw == null || String(raw).trim() === "") return STREAM_RETRY_MAX;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return STREAM_RETRY_MAX;
  if (n < 0) return 0;
  if (n > STREAM_RETRY_MAX_CAP) return STREAM_RETRY_MAX_CAP;
  return n;
}

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
  if (isFormalBudgetError(err)) return false;
  if (isAbortError(err)) return false;
  if (signal && signal.aborted) return false;
  if (!err) return false;
  if (
    [err, err.cause].some(
      (error) =>
        error?.noReplay === true ||
        error?.streamOutputVisible === true ||
        error?.isOutputBackpressureFailure === true,
    )
  )
    return false;
  const msg = String(err.message || err).toLowerCase();
  // A provider verdict stays terminal even when its detail mentions a timeout,
  // reset or network failure. Inspect it before transport codes and wording so
  // formatted HTTP diagnostics and failed Responses cannot trigger a replay.
  if (
    err.code === "CC_OPENAI_RESPONSES_FAILED" ||
    err.cause?.code === "CC_OPENAI_RESPONSES_FAILED" ||
    [err.status, err.statusCode, err.cause?.status, err.cause?.statusCode].some(
      (status) => Number.isInteger(status) && status >= 400 && status <= 599,
    ) ||
    /\bhttp\s+[45]\d{2}\b/.test(msg)
  ) {
    return false;
  }
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
  return /econnreset|etimedout|econnrefused|eai_again|socket hang ?up|terminated|fetch failed|network error|timed?\s*out|premature close/.test(
    msg,
  );
}

/**
 * Reduce a retryable stream failure to a small, secret-free reason vocabulary
 * suitable for persisted usage telemetry. Never persist the provider's raw
 * error message: it can contain a request URL, tenant id, or proxy details.
 */
export function classifyStreamRetryReason(err) {
  const code = String(err?.code || err?.cause?.code || "").toUpperCase();
  if (code === "ETIMEDOUT") return "timeout";
  if (["EAI_AGAIN", "ENOTFOUND"].includes(code)) return "dns";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ENETUNREACH") return "network_unreachable";
  if (["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code)) {
    return "connection_reset";
  }
  const msg = String(err?.message || err || "").toLowerCase();
  if (/timed?\s*out|etimedout/.test(msg)) return "timeout";
  if (/eai_again|enotfound|dns/.test(msg)) return "dns";
  if (/econnrefused/.test(msg)) return "connection_refused";
  if (/network unreachable|enetunreach/.test(msg)) return "network_unreachable";
  if (
    /econnreset|socket hang ?up|terminated|fetch failed|network error|premature close/.test(
      msg,
    )
  ) {
    return "connection_reset";
  }
  return "unknown";
}
