import { BUILT_IN_PROVIDERS } from "./llm-providers.js";
import { normalizeOllamaBaseUrl } from "./ollama-base-url.js";
import {
  assertCustomProviderConnection,
  normalizeProviderBaseUrl,
} from "./provider-protocol.js";
import { resolveApiKeyFromHelper } from "./api-key-helper.js";

const DEFAULT_PROVIDER = "ollama";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeLlmEndpoint(provider, baseUrl) {
  if (!nonEmpty(baseUrl)) return "";
  return provider === "ollama"
    ? normalizeOllamaBaseUrl(baseUrl)
    : normalizeProviderBaseUrl(baseUrl);
}

/**
 * Resolve provider, model, endpoint, and credential as one configuration.
 * Saved models and credentials are reusable only for the same provider and
 * normalized endpoint. An explicit key always belongs to the explicit target.
 */
export function resolveLlmConnection(
  options = {},
  configuredSources = [],
  {
    env = process.env,
    builtIns = BUILT_IN_PROVIDERS,
    defaultProvider = DEFAULT_PROVIDER,
    defaultModel = null,
    defaultBaseUrl = null,
  } = {},
) {
  const sources = (
    Array.isArray(configuredSources) ? configuredSources : [configuredSources]
  ).filter((source) => source && typeof source === "object");
  const provider =
    (nonEmpty(options.provider) && options.provider) ||
    sources.find((source) => nonEmpty(source.provider))?.provider ||
    defaultProvider;
  const definition = builtIns[provider];
  const matchingSources = sources.filter(
    (source) => source.provider === provider,
  );
  const providerBaseUrl =
    definition?.baseUrl ||
    defaultBaseUrl ||
    (provider === "ollama" ? DEFAULT_OLLAMA_BASE_URL : null);
  const baseUrl =
    (nonEmpty(options.baseUrl) && options.baseUrl) ||
    matchingSources.find((source) => nonEmpty(source.baseUrl))?.baseUrl ||
    providerBaseUrl;
  const normalizedBaseUrl = normalizeLlmEndpoint(provider, baseUrl);
  const endpointSources = matchingSources.filter((source) => {
    const sourceBaseUrl = source.baseUrl || providerBaseUrl;
    return (
      normalizedBaseUrl !== "" &&
      normalizeLlmEndpoint(provider, sourceBaseUrl) === normalizedBaseUrl
    );
  });
  const model =
    (nonEmpty(options.model) && options.model) ||
    endpointSources.find((source) => nonEmpty(source.model))?.model ||
    defaultModel ||
    definition?.models?.[0] ||
    null;
  assertCustomProviderConnection(provider, { baseUrl, model });
  let apiKey =
    (nonEmpty(options.apiKey) && options.apiKey) ||
    (nonEmpty(env?.CC_API_KEY) && env.CC_API_KEY) ||
    endpointSources.find((source) => nonEmpty(source.apiKey))?.apiKey ||
    null;
  if (!apiKey) {
    const helper = endpointSources.find((source) =>
      nonEmpty(source.apiKeyHelper),
    )?.apiKeyHelper;
    if (helper) apiKey = resolveApiKeyFromHelper(helper);
  }
  if (!apiKey && definition?.apiKeyEnv) {
    apiKey = nonEmpty(env?.[definition.apiKeyEnv])
      ? env[definition.apiKeyEnv]
      : null;
  }
  return {
    provider,
    model,
    baseUrl: baseUrl || null,
    apiKey,
    endpoint: normalizedBaseUrl,
    endpointSources,
  };
}
