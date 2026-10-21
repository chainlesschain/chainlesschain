/**
 * Shared LLM connection resolver for WS handlers.
 *
 * Provider, model, endpoint, and credential are resolved together so a
 * provider override cannot inherit a model or key from another endpoint.
 */
import { BUILT_IN_PROVIDERS } from "../../lib/llm-providers.js";
import { resolveLlmConnection } from "../../lib/llm-connection-resolution.js";

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
  let cfgLlm = {};
  if (typeof server?._loadLlmConfig === "function") {
    try {
      const configured = server._loadLlmConfig();
      cfgLlm = configured?.llm || configured || {};
    } catch {
      // A stale config snapshot can still be bypassed with session or env data.
    }
  } else {
    cfgLlm = server?.sessionManager?.config?.llm || {};
  }

  let session = null;
  const sessionId = message?.sessionId;
  if (sessionId && server?.sessionManager?.getSession) {
    try {
      session = server.sessionManager.getSession(sessionId);
    } catch {
      session = null;
    }
  }

  const envProvider = ENV_PREFERRED_ORDER.find((name) => {
    const envName = BUILT_IN_PROVIDERS[name]?.apiKeyEnv;
    return envName && process.env[envName];
  });
  const defaultProvider =
    opts.provider || session?.provider || cfgLlm.provider || envProvider || "ollama";
  if (!opts.provider && !session?.provider && !cfgLlm.provider && !envProvider) {
    return null;
  }

  return resolveLlmConnection(
    opts,
    [
      session
        ? {
            provider: session.provider,
            model: session.model,
            baseUrl: session.baseUrl,
            apiKey: session.apiKey,
          }
        : null,
      cfgLlm,
    ],
    { defaultProvider },
  );
}
