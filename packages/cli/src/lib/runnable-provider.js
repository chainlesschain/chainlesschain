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

function nonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
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
