/**
 * `--fallback-model` support — Claude-Code parity for unattended runs.
 *
 * Wraps the agent loop's LLM call so a single request that fails with a
 * *retryable* error (overload / rate-limit / transient network) is transparently
 * re-issued once with a backup model. Because it sits at the chatFn seam
 * (`agentLoop` uses `options.chatFn || chatWithTools`), fallback needs no changes
 * to the runners — the wrapped fn is passed in via `options.chatFn`.
 *
 * Same-provider only: the fallback swaps `options.model`, keeping the configured
 * provider / baseUrl / apiKey. Cross-provider fallback is a larger feature.
 */

import { chatWithTools } from "./agent-core.js";

// Heuristics for "try again on a different model" — overloaded backends,
// rate limits, and transient connectivity. Deliberately conservative: a 4xx
// that is not 429 (bad request / auth) is NOT retried.
const RETRYABLE_PATTERNS = [
  /overload/i,
  /rate.?limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /\b429\b/,
  /\b50[0234]\b/,
  /\b529\b/,
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /fetch failed/i,
  /network error/i,
];

/**
 * Decide whether an error from an LLM call warrants a fallback retry.
 * @param {any} err
 * @returns {boolean}
 */
export function isRetryableModelError(err) {
  if (!err) return false;
  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : null;
  if (status === 429) return true;
  if (status !== null && status >= 500 && status <= 599) return true;

  const parts = [
    err.message,
    typeof err.code === "string" ? err.code : "",
    err.cause?.message,
    err.cause?.code,
  ]
    .filter(Boolean)
    .join(" ");
  return RETRYABLE_PATTERNS.some((re) => re.test(parts));
}

/**
 * Build a chatFn that retries once on the fallback model.
 *
 * @param {object} opts
 * @param {string} opts.fallbackModel              backup model name (required)
 * @param {Function} [opts.baseChatFn=chatWithTools] underlying LLM call
 * @param {Function} [opts.isRetryable]            error predicate (testing seam)
 * @param {Function} [opts.onFallback]             notified ({from,to,error}) on retry
 * @returns {Function} a (messages, options) => Promise<result> chatFn
 */
export function makeFallbackChatFn(opts = {}) {
  const fallbackModel = opts.fallbackModel;
  const baseChatFn = opts.baseChatFn || chatWithTools;
  const isRetryable = opts.isRetryable || isRetryableModelError;
  const onFallback = opts.onFallback;

  return async function chatWithFallback(messages, options = {}) {
    try {
      return await baseChatFn(messages, options);
    } catch (err) {
      const primaryModel = options.model;
      // Skip a no-op retry when the fallback is the same model as the primary.
      if (
        !fallbackModel ||
        fallbackModel === primaryModel ||
        !isRetryable(err)
      ) {
        throw err;
      }
      if (typeof onFallback === "function") {
        try {
          onFallback({
            from: primaryModel,
            to: fallbackModel,
            error: err?.message || String(err),
          });
        } catch {
          // Notification is best-effort — never mask the retry.
        }
      }
      return await baseChatFn(messages, { ...options, model: fallbackModel });
    }
  };
}
