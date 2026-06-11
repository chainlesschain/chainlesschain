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
export function applyConfigLlmDefaults(options = {}, cfgLlm = {}, opts = {}) {
  if (options.provider || !cfgLlm.provider) return options;
  options.provider = cfgLlm.provider;
  if (opts.explicitModel) {
    options.model = opts.explicitModel;
  } else if (cfgLlm.model) {
    options.model = cfgLlm.model;
  }
  if (!options.baseUrl && cfgLlm.baseUrl) options.baseUrl = cfgLlm.baseUrl;
  if (!options.apiKey && cfgLlm.apiKey) options.apiKey = cfgLlm.apiKey;
  return options;
}
