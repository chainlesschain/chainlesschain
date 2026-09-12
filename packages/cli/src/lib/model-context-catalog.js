// Compatibility catalog: these legacy values are retained verbatim. They are
// planning assumptions, not recently verified provider capability guarantees.
export const CONTEXT_WINDOWS = Object.freeze({
  "qwen2.5:7b": 32768,
  "qwen2.5:14b": 32768,
  "qwen2.5-coder:14b": 32768,
  "qwen2:7b": 32768,
  "llama3:8b": 8192,
  "mistral:7b": 32768,
  "codellama:7b": 16384,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  o1: 200000,
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-haiku-4-5-20251001": 200000,
  "deepseek-chat": 64000,
  "deepseek-coder": 64000,
  "deepseek-reasoner": 64000,
  "qwen-turbo": 131072,
  "qwen-plus": 131072,
  "qwen-max": 32768,
  "gemini-2.0-flash": 1048576,
  "gemini-2.0-pro": 1048576,
  "gemini-1.5-flash": 1048576,
  "moonshot-v1-auto": 131072,
  "moonshot-v1-8k": 8192,
  "moonshot-v1-32k": 32768,
  "moonshot-v1-128k": 131072,
  "doubao-seed-1-6-251015": 32768,
  "doubao-seed-2-1-pro-260628": 32768,
  _provider_defaults: Object.freeze({
    ollama: 32768,
    openai: 128000,
    anthropic: 200000,
    deepseek: 64000,
    dashscope: 131072,
    gemini: 1048576,
    kimi: 131072,
    volcengine: 32768,
    minimax: 32768,
    mistral: 32768,
  }),
});

export const MODEL_CAPABILITY_CATALOG_VERSION = "2026-09-12";

// Explicit ownership prevents a model name served by an unrelated provider
// from silently inheriting another provider's catalog window.
export const LEGACY_MODEL_PROVIDERS = Object.freeze({
  "qwen2.5:7b": "ollama",
  "qwen2.5:14b": "ollama",
  "qwen2.5-coder:14b": "ollama",
  "qwen2:7b": "ollama",
  "llama3:8b": "ollama",
  "mistral:7b": "ollama",
  "codellama:7b": "ollama",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4-turbo": "openai",
  "gpt-3.5-turbo": "openai",
  o1: "openai",
  "claude-opus-4-6": "anthropic",
  "claude-sonnet-4-6": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
  "deepseek-chat": "deepseek",
  "deepseek-coder": "deepseek",
  "deepseek-reasoner": "deepseek",
  "qwen-turbo": "dashscope",
  "qwen-plus": "dashscope",
  "qwen-max": "dashscope",
  "gemini-2.0-flash": "gemini",
  "gemini-2.0-pro": "gemini",
  "gemini-1.5-flash": "gemini",
  "moonshot-v1-auto": "kimi",
  "moonshot-v1-8k": "kimi",
  "moonshot-v1-32k": "kimi",
  "moonshot-v1-128k": "kimi",
  "doubao-seed-1-6-251015": "volcengine",
  "doubao-seed-2-1-pro-260628": "volcengine",
});

// Official pages reviewed on the catalog version date. These describe the
// named models, not endpoint access, account entitlement, or a live CLI run.
export const DOCUMENTED_OPENAI_MODELS = Object.freeze({
  "gpt-4o": Object.freeze({
    contextWindowTokens: 128000,
    advertisedMaxOutputTokens: 16384,
    requiresResponsesForTools: false,
    sources: Object.freeze([
      "https://developers.openai.com/api/docs/models/gpt-4o",
    ]),
  }),
  "gpt-6-astra": Object.freeze({
    contextWindowTokens: 1050000,
    advertisedMaxOutputTokens: 128000,
    requiresResponsesForTools: true,
    sources: Object.freeze([
      "https://developers.openai.com/api/docs/models/gpt-6-astra",
      "https://developers.openai.com/api/docs/guides/migrate-to-responses",
    ]),
  }),
});
