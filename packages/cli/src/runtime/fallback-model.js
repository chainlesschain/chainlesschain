/**
 * `--fallback-model` support — Claude-Code parity for unattended runs.
 *
 * Wraps the agent loop's LLM call so a request that fails with a *retryable*
 * error (overload / rate-limit / transient network) — or because the primary
 * model is *not found* (decommissioned / mistyped id) — is transparently
 * re-issued against a chain of up to a few backup models, in order. Because it
 * sits at the chatFn seam (`agentLoop` uses `options.chatFn || chatWithTools`),
 * fallback needs no changes to the runners — the wrapped fn is passed in via
 * `options.chatFn`.
 *
 * Parity reference: Claude Code 2.1.166 added an ordered fallback chain (up to
 * 3 models) and 2.1.152 switches to the configured fallback when the primary
 * model is "not found".
 *
 * Same-provider only: each hop swaps `options.model`, keeping the configured
 * provider / baseUrl / apiKey. Cross-provider fallback is a larger feature.
 */

import { chatWithTools } from "./agent-core.js";

// Claude Code caps the fallback chain at 3 backups; mirror that here so a
// mis-configured comma list can't fan out into an unbounded retry storm.
const MAX_FALLBACK_MODELS = 3;

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

// A primary model that no longer exists (decommissioned / typo / not enabled
// for this key) is NOT transient, but it IS exactly the case the fallback
// chain exists for. Detected separately from RETRYABLE so an auth/quota 4xx
// (which a different model would also hit) is still surfaced, not masked.
const MODEL_NOT_FOUND_PATTERNS = [
  /model[^a-z]*not[^a-z]*found/i,
  /model_not_found/i,
  /no such model/i,
  /unknown model/i,
  /model .* does not exist/i,
  /does not exist.*model/i,
  /invalid model/i,
  /model .* is not (?:available|supported)/i,
  /unsupported model/i,
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
 * Decide whether an error means the *primary model is unavailable* (not found /
 * decommissioned / not enabled), which a different model in the chain might
 * resolve. Kept separate from {@link isRetryableModelError} so generic 4xx
 * (auth / quota / bad request) is never silently retried.
 * @param {any} err
 * @returns {boolean}
 */
export function isModelNotFoundError(err) {
  if (!err) return false;
  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : null;
  // A bare 404 from a model endpoint almost always means "this model id".
  if (status === 404) return true;

  const parts = [
    err.message,
    typeof err.code === "string" ? err.code : "",
    err.cause?.message,
    err.cause?.code,
  ]
    .filter(Boolean)
    .join(" ");
  return MODEL_NOT_FOUND_PATTERNS.some((re) => re.test(parts));
}

/**
 * Normalize a fallback-model spec into an ordered, de-duplicated list.
 * Accepts a single string, a comma-separated string, an array (whose entries
 * may themselves be comma-separated), or nullish. Trims, drops empties, removes
 * duplicates (first wins), and caps at {@link MAX_FALLBACK_MODELS}.
 * @param {string|string[]|null|undefined} input
 * @returns {string[]}
 */
export function normalizeFallbackModels(input) {
  if (input == null) return [];
  const raw = Array.isArray(input) ? input : [input];
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    for (const piece of entry.split(",")) {
      const m = piece.trim();
      if (m && !out.includes(m)) out.push(m);
      if (out.length >= MAX_FALLBACK_MODELS) return out;
    }
  }
  return out;
}

/**
 * Build a chatFn that walks an ordered fallback chain when the primary fails.
 *
 * On a retryable error (or a model-not-found error) the call is re-issued
 * against the next distinct model in the chain; this repeats down the chain
 * until one succeeds or the chain is exhausted (then the last error is thrown).
 * A fallback equal to the model just tried is skipped (no wasted round-trip).
 *
 * @param {object} opts
 * @param {string|string[]} [opts.fallbackModels]    ordered backup model(s)
 * @param {string} [opts.fallbackModel]              single backup (back-compat)
 * @param {Function} [opts.baseChatFn=chatWithTools] underlying LLM call
 * @param {Function} [opts.isRetryable]              transient-error predicate (seam)
 * @param {Function} [opts.isModelNotFound]          missing-model predicate (seam)
 * @param {Function} [opts.onFallback]               notified ({from,to,error}) per hop
 * @returns {Function} a (messages, options) => Promise<result> chatFn
 */
export function makeFallbackChatFn(opts = {}) {
  const models = normalizeFallbackModels(
    opts.fallbackModels != null ? opts.fallbackModels : opts.fallbackModel,
  );
  const baseChatFn = opts.baseChatFn || chatWithTools;
  const isRetryable = opts.isRetryable || isRetryableModelError;
  const isModelNotFound = opts.isModelNotFound || isModelNotFoundError;
  const onFallback = opts.onFallback;

  return async function chatWithFallback(messages, options = {}) {
    try {
      return await baseChatFn(messages, options);
    } catch (firstErr) {
      let err = firstErr;
      let lastTried = options.model;
      for (const candidate of models) {
        // Skip a no-op hop (fallback identical to the model just attempted).
        if (!candidate || candidate === lastTried) continue;
        // Only advance the chain for transient failures or a missing primary;
        // a real bad-request / auth error is surfaced immediately.
        if (!isRetryable(err) && !isModelNotFound(err)) throw err;
        if (typeof onFallback === "function") {
          try {
            onFallback({
              from: lastTried,
              to: candidate,
              error: err?.message || String(err),
            });
          } catch {
            // Notification is best-effort — never mask the retry.
          }
        }
        lastTried = candidate;
        try {
          return await baseChatFn(messages, { ...options, model: candidate });
        } catch (nextErr) {
          err = nextErr;
        }
      }
      throw err;
    }
  };
}
