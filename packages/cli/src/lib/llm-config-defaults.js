/**
 * Config-default LLM resolution for `cc agent` (parity with `cc ask`/`chat`):
 * a bare run honors `~/.chainlesschain/config.json` `llm` —
 * provider/model/baseUrl/apiKey — instead of silently assuming local ollama
 * (the historical default that broke every cloud-configured setup the moment
 * no --provider flag was passed, e.g. the editor chat panel's spawn).
 *
 * Rules (pure; mutates and returns `options` for call-site convenience):
 *  - An explicit --provider wins outright: config is NOT consulted at all
 *    (mixing config's model/key into a different provider would be wrong).
 *  - With no --provider but a configured one: provider + any of
 *    model/baseUrl/apiKey the user did not explicitly set come from config.
 *  - Model pairing: when the provider is adopted from config, the model must
 *    pair with it — only an EXPLICIT --model (opts.explicitModel) survives;
 *    a model that leaked in from .claude/settings.json (meant for whatever
 *    provider that file assumed) is replaced by config's own model. Same
 *    lesson as the --settings "opus"→404 vision trap.
 *  - No configured provider → unchanged (runner defaults apply: ollama).
 */
/**
 * Reconcile a MISLABELED llm config/options object. The `baseUrl` is the
 * authoritative signal of which provider you actually reach, so when `provider`
 * disagrees with the provider its `baseUrl` belongs to, the config is simply
 * mislabeled — the recurring "provider:anthropic + volces baseUrl + model:haiku"
 * corruption that makes runnable-provider relabel (and emit "provider 配置与
 * baseUrl 不一致") on EVERY run because the on-disk config never gets fixed.
 *
 * Correct `provider` to match the endpoint, and if the model is foreign to the
 * corrected provider, replace it with that provider's default. Pure: the input
 * is never mutated — returns `{ llm, changed }` where `llm` is the original
 * object (changed:false) or a corrected shallow copy (changed:true). Works for
 * both a `config.llm` block and a resolved request-`options` (same shape).
 *
 * `inferProviderFromBaseUrl` returns null for unknown/custom hosts (proxies),
 * so an intentionally-custom endpoint is left untouched.
 */
export async function reconcileConfigLlmProvider(cfgLlm = {}) {
  if (!cfgLlm || !cfgLlm.provider || !cfgLlm.baseUrl) {
    return { llm: cfgLlm, changed: false };
  }
  const { inferProviderFromBaseUrl, modelForeignToProvider } =
    await import("./runnable-provider.js");
  const inferred = inferProviderFromBaseUrl(cfgLlm.baseUrl);
  if (!inferred || inferred === cfgLlm.provider) {
    return { llm: cfgLlm, changed: false };
  }
  const corrected = { ...cfgLlm, provider: inferred };
  if (modelForeignToProvider(inferred, cfgLlm.model)) {
    const { selectModelForTask, TaskType } =
      await import("./task-model-selector.js");
    const def = selectModelForTask(inferred, TaskType.CHAT);
    if (def) corrected.model = def;
  }
  return { llm: corrected, changed: true };
}

import { resolveApiKeyFromHelper } from "./api-key-helper.js";

/**
 * Key backfill order: config llm.apiKey (plaintext, legacy) first, then
 * llm.apiKeyHelper (external command → OS credential store). The helper only
 * runs when no key is otherwise present, so configured setups never pay a
 * subprocess spawn.
 */
function backfillApiKey(options, cfgLlm) {
  if (options.apiKey) return;
  if (cfgLlm.apiKey) {
    options.apiKey = cfgLlm.apiKey;
  } else if (cfgLlm.apiKeyHelper) {
    const key = resolveApiKeyFromHelper(cfgLlm.apiKeyHelper);
    if (key) options.apiKey = key;
  }
}

export function applyConfigLlmDefaults(options = {}, cfgLlm = {}, opts = {}) {
  // The IDE chat panel pins --provider/--model (read from config) but DROPS
  // --base-url/--api-key. With an explicit --provider the block below bails, so
  // a cloud provider would lose its endpoint + key → a 401, or a silent
  // fall-through to ollama ("配置了火山却 fetch failed / 切到 ollama"). When the
  // explicit provider MATCHES the configured one, backfill the omitted
  // baseUrl/apiKey (and model) from config — it's the SAME provider, so its
  // credentials are exactly right. Mixing config into a DIFFERENT explicit
  // provider is still avoided (handled by the early return below).
  if (
    options.provider &&
    cfgLlm.provider &&
    options.provider === cfgLlm.provider
  ) {
    if (!options.baseUrl && cfgLlm.baseUrl) options.baseUrl = cfgLlm.baseUrl;
    backfillApiKey(options, cfgLlm);
    if (!options.model && !opts.explicitModel && cfgLlm.model) {
      options.model = cfgLlm.model;
    }
    return options;
  }
  if (options.provider || !cfgLlm.provider) return options;
  options.provider = cfgLlm.provider;
  if (opts.explicitModel) {
    options.model = opts.explicitModel;
  } else if (cfgLlm.model) {
    options.model = cfgLlm.model;
  }
  if (!options.baseUrl && cfgLlm.baseUrl) options.baseUrl = cfgLlm.baseUrl;
  backfillApiKey(options, cfgLlm);
  return options;
}
