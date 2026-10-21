/**
 * Shared LLM credential resolver for WS handlers.
 *
 * Used by both `llm.chat` (single-shot streaming) and `chat.intent.*`
 * (intent-understanding flow). Encapsulates the precedence rules so adding
 * a third consumer doesn't fork them again.
 *
 * Resolution order (first non-null wins):
 *   1. Explicit `message.options.{provider,model,baseUrl,apiKey}` from client.
 *   2. WS session creds via `server.sessionManager.getSession(sessionId)`.
 *   3. Current saved `config.llm` (refreshed per request by the WS server).
 *   4. Process env — first BUILT_IN_PROVIDERS entry whose apiKeyEnv is set.
 *
 * Fall-throughs:
 *   - Provider with `free: true` (ollama) doesn't need apiKey; a session
 *     entry with provider=ollama and no apiKey is valid.
 *   - For non-ollama providers, missing apiKey is a fatal — the caller
 *     should send a clean error frame instead of hanging on a 401.
 *   - When no source has any creds, returns null. Caller decides whether
 *     to fail-fast (llm.chat) or yield "LLM not configured" (chat-intent).
 *
 * @returns {{provider, model, baseUrl, apiKey} | null}
 */

import { BUILT_IN_PROVIDERS } from "../../lib/llm-providers.js";

const ENV_PREFERRED_ORDER = [
  "volcengine",
  "openai",
  "anthropic",
  "deepseek",
  "dashscope",
  "gemini",
  "kimi",
  "minimax",
  "mistral",
];

export function resolveLlmCreds(server, message) {
  const opts = message?.options || {};
  const optProvider = opts.provider;
  const optModel = opts.model;
  const optBaseUrl = opts.baseUrl;
  const optApiKey = opts.apiKey;
  let cfgLlm = {};
  if (typeof server?._loadLlmConfig === "function") {
    try {
      const configured = server._loadLlmConfig();
      cfgLlm = configured?.llm || configured || {};
    } catch {
      // If the saved config cannot be refreshed, continue with explicit
      // options, session credentials, or environment credentials. The
      // session manager snapshot may contain merged defaults rather than
      // values the user actually saved.
    }
  } else {
    cfgLlm = server?.sessionManager?.config?.llm || {};
  }

  const buildCreds = (provider, inherited = {}) => {
    const def = BUILT_IN_PROVIDERS[provider];
    const sameConfiguredProvider = provider === cfgLlm.provider;
    return {
      provider,
      model:
        optModel ||
        inherited.model ||
        (sameConfiguredProvider ? cfgLlm.model : null) ||
        def?.models?.[0] ||
        null,
      baseUrl:
        optBaseUrl ||
        inherited.baseUrl ||
        (sameConfiguredProvider ? cfgLlm.baseUrl : null) ||
        def?.baseUrl ||
        (provider === "ollama" ? "http://localhost:11434" : null),
      apiKey:
        optApiKey ||
        inherited.apiKey ||
        (sameConfiguredProvider ? cfgLlm.apiKey : null) ||
        (def?.apiKeyEnv ? process.env[def.apiKeyEnv] : null),
    };
  };

  if (optProvider) {
    return buildCreds(optProvider);
  }

  const sessionId = message?.sessionId;
  if (sessionId && server?.sessionManager?.getSession) {
    let session;
    try {
      session = server.sessionManager.getSession(sessionId);
    } catch {
      session = null;
    }
    if (session?.provider) {
      // Don't default baseUrl to ollama — that breaks every cloud provider
      // when the session was created without an explicit baseUrl. Fall back
      // to the provider's own default endpoint instead.
      return buildCreds(session.provider, {
        model: session.model,
        baseUrl: session.baseUrl,
        apiKey: session.apiKey,
      });
    }
  }

  if (cfgLlm.provider) {
    return buildCreds(cfgLlm.provider);
  }

  for (const name of ENV_PREFERRED_ORDER) {
    const def = BUILT_IN_PROVIDERS[name];
    if (def?.apiKeyEnv && process.env[def.apiKeyEnv]) {
      return buildCreds(name);
    }
  }

  return null;
}
