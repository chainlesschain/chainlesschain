/**
 * Cowork Adapter — bridges CLI's LLM infrastructure to cowork modules.
 *
 * Provides:
 *  - Unified LLM chat function (works with any configured provider)
 *  - Logger shim compatible with desktop modules
 *  - Module initialization helper
 */

import { LLMProviderRegistry, BUILT_IN_PROVIDERS } from "./llm-providers.js";

/**
 * Create a chat completion function that routes through the active LLM provider.
 *
 * @param {object} [options]
 * @param {string} [options.provider] - Provider name override
 * @param {string} [options.model] - Model name override
 * @param {string} [options.baseUrl] - Base URL override
 * @param {string} [options.apiKey] - API key override
 * @returns {(messages: object[], opts?: object) => Promise<string>}
 */
export function createChatFn(options = {}) {
  const provider = options.provider || process.env.LLM_PROVIDER || "ollama";
  const providerDef = BUILT_IN_PROVIDERS[provider] || BUILT_IN_PROVIDERS.ollama;
  const model = options.model || process.env.LLM_MODEL || providerDef.models[0];
  const baseUrl = options.baseUrl || providerDef.baseUrl;

  return async function chat(messages, opts = {}) {
    const currentModel = opts.model || model;
    const maxTokens = opts.maxTokens || 2048;

    if (provider === "ollama") {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: currentModel,
          messages,
          stream: false,
          options: { num_predict: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      return data.message?.content || "";
    }

    if (provider === "anthropic") {
      const key = options.apiKey || process.env[providerDef.apiKeyEnv];
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      // Extract system message if present
      const systemMsgs = messages.filter((m) => m.role === "system");
      const otherMsgs = messages.filter((m) => m.role !== "system");
      const body = {
        model: currentModel,
        max_tokens: maxTokens,
        messages: otherMsgs,
      };
      if (systemMsgs.length > 0) {
        body.system = systemMsgs.map((m) => m.content).join("\n");
      }
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text || "";
    }

    // OpenAI-compatible (openai, deepseek, dashscope, mistral, gemini)
    const key = options.apiKey || process.env[providerDef.apiKeyEnv];
    if (!key) throw new Error(`${providerDef.apiKeyEnv} not set`);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: currentModel,
        messages,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  };
}

/**
 * Logger shim — compatible with desktop module expectations
 */
export const coworkLogger = {
  info: (...args) => console.log("[cowork]", ...args),
  warn: (...args) => console.warn("[cowork]", ...args),
  error: (...args) => console.error("[cowork]", ...args),
  debug: () => {},
};
