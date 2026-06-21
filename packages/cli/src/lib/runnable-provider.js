/**
 * Runnability guards for LLM model/provider selection.
 *
 * The task-based auto model-selector (lib/task-model-selector.js) switches the
 * model by detected task type — e.g. a "quick" message on the `anthropic`
 * provider becomes `claude-haiku`. That is WRONG when the target provider has
 * no usable API key: it silently routes you onto a model you can't call and you
 * get a 401. These helpers make selection "runnable-first": never switch onto a
 * provider that has no usable (present) key, and let callers detect that the
 * configured provider itself is not runnable.
 *
 * "Usable key" = a keyless local provider (ollama), OR the active session's
 * configured key, OR the provider's standard env var (`<PROVIDER>_API_KEY`).
 * Empty/whitespace keys never count (a missing or cleared key is not usable).
 */
import { BUILT_IN_PROVIDERS } from "./llm-providers.js";
import { selectModelForTask, TaskType } from "./task-model-selector.js";

function nonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/** Is this an authentication/authorization failure (missing/invalid/expired key)? */
export function isAuthError(err) {
  if (!err) return false;
  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : null;
  if (status === 401 || status === 403) return true;
  const msg = String(err.message || err).toLowerCase();
  return /\b401\b|\b403\b|unauthorized|forbidden|authentication failed|api[\s_-]*key required|invalid api[\s_-]*key|incorrect api[\s_-]*key|expired/.test(
    msg,
  );
}

/** Host of a baseUrl, lowercased, or "" — tolerant of a bare host string. */
function hostOf(url) {
  if (!nonEmpty(url)) return "";
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

/**
 * Infer the provider a baseUrl actually belongs to. Catches a config where the
 * provider field disagrees with the endpoint (e.g. provider "anthropic" but
 * baseUrl points at volces.com → really volcengine). Returns null if unknown.
 */
export function inferProviderFromBaseUrl(baseUrl) {
  const host = hostOf(baseUrl);
  if (!host) return null;
  for (const [name, def] of Object.entries(BUILT_IN_PROVIDERS)) {
    const defHost = hostOf(def.baseUrl);
    if (defHost && (host === defHost || host.endsWith("." + defHost))) {
      return name;
    }
  }
  return null;
}

function envKey(provider, env) {
  const def = BUILT_IN_PROVIDERS[provider];
  return def && def.apiKeyEnv ? env[def.apiKeyEnv] : null;
}

/** A sensible default model for a provider (its CHAT task model). */
function defaultModelFor(provider) {
  return selectModelForTask(provider, TaskType.CHAT) || undefined;
}

/**
 * Wrap a chatFn so an AUTH failure (no / wrong / expired key for the resolved
 * provider) self-heals to a provider we can actually run instead of failing the
 * whole turn. Two recovery paths, in order:
 *   1. baseUrl says otherwise — the endpoint belongs to a different provider
 *      than the `provider` field; retry with that provider, SAME baseUrl + key
 *      (fixes a mislabeled config like provider:anthropic + volces baseUrl).
 *   2. env-keyed fallback — some other built-in provider has its key in the
 *      environment; retry with that provider's baseUrl + env key + default model.
 * If neither applies, the original (clear) auth error is rethrown. One hop only;
 * never recurses. Non-auth errors pass straight through.
 *
 * @param {Function} chatFn
 * @param {object} [opts] { env=process.env, onFallback?({from,to,reason}) }
 */
export function makeRunnableProviderFallback(
  chatFn,
  { env = process.env, onFallback } = {},
) {
  // Notify at most once per from→to pair: in an agent loop the same fallback
  // would otherwise re-warn on every turn.
  const notified = new Set();
  const notify = (info) => {
    if (typeof onFallback !== "function") return;
    const key = `${info.from}→${info.to}`;
    if (notified.has(key)) return;
    notified.add(key);
    try {
      onFallback(info);
    } catch {
      /* notification is best-effort */
    }
  };

  // Compute the fallback for these options WITHOUT calling the model — the
  // resolution is deterministic (baseUrl-inferred provider, then env-keyed
  // provider). Returns { to, reason, override } or null. Pure so we can both
  // react to an auth failure AND pre-empt the known-bad attempt on later turns.
  const computeFallback = (options) => {
    const failed = options.provider;
    const inferred = inferProviderFromBaseUrl(options.baseUrl);
    if (inferred && inferred !== failed) {
      return {
        to: inferred,
        reason: "baseurl-mismatch",
        override: {
          provider: inferred,
          model: defaultModelFor(inferred) || options.model,
        },
      };
    }
    for (const [name, def] of Object.entries(BUILT_IN_PROVIDERS)) {
      if (name === failed) continue;
      if (def.apiKeyEnv && nonEmpty(env[def.apiKeyEnv])) {
        return {
          to: name,
          reason: "env-key",
          override: {
            provider: name,
            baseUrl: def.baseUrl,
            apiKey: envKey(name, env),
            model: defaultModelFor(name) || options.model,
          },
        };
      }
    }
    return null;
  };

  // Providers we have already proven need a fallback — later turns route
  // straight to the working provider instead of re-attempting the broken one.
  const stickyFrom = new Set();

  return async function runnableProviderFallback(messages, options = {}) {
    // Known-bad provider: skip the wasted failed attempt and route directly.
    if (stickyFrom.has(options.provider)) {
      const fb = computeFallback(options);
      if (fb) {
        notify({ from: options.provider, to: fb.to, reason: fb.reason });
        return await chatFn(messages, { ...options, ...fb.override });
      }
      // Resolution no longer available — fall through to a normal attempt.
    }
    try {
      return await chatFn(messages, options);
    } catch (err) {
      if (!isAuthError(err)) throw err;
      const fb = computeFallback(options);
      if (!fb) throw err; // nowhere runnable — surface the clear error
      stickyFrom.add(options.provider);
      notify({ from: options.provider, to: fb.to, reason: fb.reason });
      return await chatFn(messages, { ...options, ...fb.override });
    }
  };
}

/**
 * Can we actually call `provider` right now?
 *
 * @param {string} provider
 * @param {object} [opts]
 * @param {string} [opts.apiKey]   the session's configured key — only counts
 *                                 when `isActive` (it belongs to the ACTIVE
 *                                 provider, not an arbitrary one).
 * @param {boolean} [opts.isActive=true]
 * @param {object} [opts.env=process.env]
 * @returns {boolean}
 */
export function hasUsableKey(
  provider,
  { apiKey, isActive = true, env = process.env } = {},
) {
  const def = BUILT_IN_PROVIDERS[provider];
  if (!def) return false;
  if (!def.apiKeyEnv) return true; // keyless local provider (e.g. ollama)
  if (isActive && nonEmpty(apiKey)) return true;
  return nonEmpty(env[def.apiKeyEnv]);
}

/**
 * Gate the task-based auto model-switch on runnability. Returns the recommended
 * model ONLY when the (active) provider is runnable; otherwise returns null so
 * the caller keeps the user's configured model instead of switching onto
 * something it can't call.
 *
 * @param {object} args
 * @param {string} args.provider
 * @param {string} [args.currentModel]
 * @param {string|null} [args.recommended]   from selectModelForTask()
 * @param {string} [args.apiKey]
 * @param {object} [args.env=process.env]
 * @returns {string|null} a model to switch to, or null to keep the current one
 */
export function runnableTaskModel({
  provider,
  currentModel,
  recommended,
  apiKey,
  env = process.env,
} = {}) {
  if (!recommended || recommended === currentModel) return null;
  return hasUsableKey(provider, { apiKey, isActive: true, env })
    ? recommended
    : null;
}

/**
 * Find a provider we can actually run, "runnable-first": keep `provider` when
 * it has a usable key; otherwise fall back to the first built-in provider whose
 * env key is set; otherwise the keyless local provider (ollama). Returns
 * `{ provider, runnable, fellBackFrom?, keyless? }`. Pure given `env`.
 */
export function pickRunnableProvider({
  provider,
  apiKey,
  env = process.env,
} = {}) {
  if (provider && hasUsableKey(provider, { apiKey, isActive: true, env })) {
    return { provider, runnable: true };
  }
  for (const [name, def] of Object.entries(BUILT_IN_PROVIDERS)) {
    if (def.apiKeyEnv && nonEmpty(env[def.apiKeyEnv])) {
      return { provider: name, runnable: true, fellBackFrom: provider || null };
    }
  }
  return {
    provider: "ollama",
    runnable: true,
    keyless: true,
    fellBackFrom: provider || null,
  };
}
