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
  // `expired` must be AUTH-scoped (key/token/credential/secret), not bare:
  // a TLS "certificate has expired" or "cache expired" is an infra error, and
  // misclassifying it as auth would trigger an env-key VENDOR hijack on a
  // keyless provider — masking the real problem (the same anti-hijack spirit
  // as the rest of this module). A genuine 401/403 is still caught by status
  // and the explicit auth phrases below.
  return /\b401\b|\b403\b|unauthorized|forbidden|authentication failed|api[\s_-]*key required|invalid api[\s_-]*key|incorrect api[\s_-]*key|(?:api[\s_-]*key|token|credentials?|secret)[\s_-]*(?:has\s+|is\s+|was\s+)?expired|expired[\s_-]+(?:api[\s_-]*key|token|credentials?|secret)/.test(
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

// Model families that unambiguously belong to ONE provider. Used to catch a
// corrupted config that paired a foreign model with a provider (e.g.
// provider:"volcengine" + model:"haiku" → the ark API 404s "model not found").
// Conservative on purpose — only well-known prefixes — so a custom/unknown
// model name never misfires into a swap.
const FOREIGN_MODEL_FAMILY = {
  anthropic: /\b(claude|haiku|sonnet|opus)\b/i,
  openai: /\b(gpt-?\d|o[134]-|chatgpt)\b/i,
  gemini: /\bgemini\b/i,
};

/**
 * Does `model` clearly belong to a DIFFERENT provider than `provider`? True only
 * when the model matches another provider's well-known family signature (and not
 * the configured provider's own family). Lets us swap a foreign model to the
 * provider's default instead of 404-ing on the endpoint.
 */
export function modelForeignToProvider(provider, model) {
  if (!nonEmpty(model)) return false;
  for (const [family, re] of Object.entries(FOREIGN_MODEL_FAMILY)) {
    if (family === provider) continue;
    if (re.test(model)) return true;
  }
  return false;
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
    // Cross-provider env-keyed fallback fires ONLY when the configured provider
    // is itself unrunnable (no key present). If the user EXPLICITLY configured a
    // provider WITH a key and it returned an auth error, that key is bad/expired
    // — surface it instead of silently switching VENDORS and spending on a
    // different account's key. This is the recurring "configured volcengine but
    // it ran Claude/haiku" trap: a volcengine 401 must never hijack the turn
    // onto anthropic just because ANTHROPIC_API_KEY happens to be in the env.
    // (The baseUrl-mismatch path above still relabels a mislabeled config using
    // the SAME key, which is always safe.)
    if (hasUsableKey(failed, { apiKey: options.apiKey, isActive: true, env })) {
      return null;
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
    // PROACTIVE heal #1 — a FOREIGN MODEL on an otherwise-correct provider: a
    // corrupted config left e.g. model:"haiku" on provider:"volcengine", which
    // the ark API 404s ("model not found"). Keep the provider + key + baseUrl;
    // swap ONLY the model to the provider's own default so the call succeeds.
    if (
      nonEmpty(options.provider) &&
      modelForeignToProvider(options.provider, options.model)
    ) {
      const def = defaultModelFor(options.provider);
      if (def && def !== options.model) {
        notify({
          from: options.provider,
          to: options.provider,
          reason: "model-mismatch",
          fromModel: options.model,
          toModel: def,
        });
        options = { ...options, model: def };
      }
    }
    // PROACTIVE heal #2 — a MISLABELED config (provider disagrees with the
    // endpoint its baseUrl belongs to — e.g. a corrupted config left
    // provider:"anthropic" but baseUrl still points at volces.com). The labeled
    // provider's first attempt is doomed AND can fail with a NON-auth error
    // ("fetch failed" / wrong-endpoint 404) that the reactive catch below would
    // rethrow without recovering — the exact "配置了火山却 fetch failed / 切到
    // ollama" trap. The relabel is always safe (SAME baseUrl + key; only the
    // provider name + paired model change), so pre-empt the bad attempt
    // entirely. Env-key fallback stays REACTIVE (it must fire only when the
    // configured provider genuinely cannot run, never to hijack a keyed one).
    {
      const pre = computeFallback(options);
      if (pre && pre.reason === "baseurl-mismatch") {
        stickyFrom.add(options.provider);
        notify({ from: options.provider, to: pre.to, reason: pre.reason });
        return await chatFn(messages, { ...options, ...pre.override });
      }
    }
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
