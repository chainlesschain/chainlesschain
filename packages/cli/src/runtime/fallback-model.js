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
 * Cross-provider fallback (v2): a fallback entry may name a DIFFERENT provider
 * as `provider:model` (e.g. `openai:gpt-4o`, `ollama:qwen2.5:7b`). A cross-
 * provider hop swaps provider + baseUrl + apiKey too, resolving the target
 * provider's connection from BUILT_IN_PROVIDERS + its `apiKeyEnv`. SECURITY: a
 * cross-provider hop is used ONLY when the user EXPLICITLY named that provider in
 * the fallback chain AND the target provider's API key is present in the env —
 * we never reuse the primary provider's key against a different vendor (that
 * would be the silent auth-substitution this project forbids). A cross-provider
 * entry whose key is missing is SKIPPED with a clear reason, not attempted with
 * the wrong credential.
 */

import { chatWithTools } from "./agent-core.js";
import { BUILT_IN_PROVIDERS } from "../lib/llm-providers.js";

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
 * Parse a fallback entry into `{ provider, model }`. A `provider:model` prefix
 * is recognized ONLY when the prefix is a KNOWN provider name — so an
 * ollama-style model id that itself contains a colon (`qwen2.5:7b`) is NOT
 * mis-split, while `ollama:qwen2.5:7b` correctly yields provider `ollama` +
 * model `qwen2.5:7b`. A plain `model` (no known-provider prefix) means
 * "same provider" (provider: null).
 *
 * @param {string} entry
 * @param {Set<string>} [knownProviders]  provider names to recognize as prefixes
 * @returns {{ provider: string|null, model: string }}
 */
export function parseFallbackEntry(entry, knownProviders) {
  const known =
    knownProviders || new Set(Object.keys(BUILT_IN_PROVIDERS || {}));
  const s = String(entry || "").trim();
  const idx = s.indexOf(":");
  if (idx > 0) {
    const head = s.slice(0, idx);
    const rest = s.slice(idx + 1);
    if (rest && known.has(head)) {
      return { provider: head, model: rest };
    }
  }
  return { provider: null, model: s };
}

/**
 * Resolve a fallback entry into a concrete call target. For a SAME-provider hop
 * (no known provider prefix), only the model changes. For a CROSS-provider hop,
 * resolve the target provider's baseUrl + apiKey (from its `apiKeyEnv` in the
 * environment); if the target needs a key and none is set, the hop is
 * `unavailable` (skipped) — we never fall back onto a different vendor with the
 * wrong/absent credential.
 *
 * @param {string} entry
 * @param {object} [opts] { env, providers, knownProviders }
 * @returns {{ model, provider?, baseUrl?, apiKey?, crossProvider:boolean } | { unavailable:true, reason:string, model:string, provider:string }}
 */
export function resolveFallbackTarget(entry, opts = {}) {
  const env = opts.env || process.env;
  const providers = opts.providers || BUILT_IN_PROVIDERS || {};
  const { provider, model } = parseFallbackEntry(
    entry,
    opts.knownProviders || new Set(Object.keys(providers)),
  );
  if (!provider) {
    return { model, crossProvider: false };
  }
  const def = providers[provider];
  if (!def) {
    return {
      unavailable: true,
      reason: `unknown provider "${provider}"`,
      provider,
      model,
    };
  }
  let apiKey = null;
  if (def.apiKeyEnv) {
    apiKey = env[def.apiKeyEnv] || null;
    if (!apiKey) {
      return {
        unavailable: true,
        reason: `${provider} fallback skipped: ${def.apiKeyEnv} not set`,
        provider,
        model,
      };
    }
  }
  return {
    model,
    provider,
    baseUrl: def.baseUrl || null,
    apiKey,
    crossProvider: true,
  };
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

  const env = opts.env || process.env;
  const providers = opts.providers || BUILT_IN_PROVIDERS || {};

  return async function chatWithFallback(messages, options = {}) {
    try {
      return await baseChatFn(messages, options);
    } catch (firstErr) {
      let err = firstErr;
      let lastTried = options.model;
      for (const candidate of models) {
        const target = resolveFallbackTarget(candidate, { env, providers });
        // A cross-provider hop whose key is absent (or an unknown provider) is
        // skipped — never attempted with the wrong credential. Surface why.
        if (target.unavailable) {
          if (typeof onFallback === "function") {
            try {
              onFallback({
                from: lastTried,
                to: candidate,
                skipped: true,
                reason: target.reason,
                error: err?.message || String(err),
              });
            } catch {
              /* best-effort */
            }
          }
          continue;
        }
        // Skip a no-op hop (same provider + same model just attempted).
        const sameModel = target.model === lastTried;
        const sameProvider =
          !target.crossProvider || target.provider === options.provider;
        if (!target.model || (sameModel && sameProvider)) continue;
        // Only advance the chain for transient failures or a missing primary;
        // a real bad-request / auth error is surfaced immediately.
        if (!isRetryable(err) && !isModelNotFound(err)) throw err;
        if (typeof onFallback === "function") {
          try {
            onFallback({
              from: lastTried,
              to: target.crossProvider
                ? `${target.provider}:${target.model}`
                : target.model,
              crossProvider: target.crossProvider,
              error: err?.message || String(err),
            });
          } catch {
            // Notification is best-effort — never mask the retry.
          }
        }
        lastTried = target.model;
        // Build the per-hop options: same-provider swaps only the model; a
        // cross-provider hop also swaps provider/baseUrl/apiKey.
        const hopOptions = target.crossProvider
          ? {
              ...options,
              model: target.model,
              provider: target.provider,
              baseUrl: target.baseUrl,
              apiKey: target.apiKey,
            }
          : { ...options, model: target.model };
        try {
          return await baseChatFn(messages, hopOptions);
        } catch (nextErr) {
          err = nextErr;
        }
      }
      throw err;
    }
  };
}
