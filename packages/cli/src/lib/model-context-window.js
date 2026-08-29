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

export function getContextWindow(model, provider) {
  if (model && CONTEXT_WINDOWS[model]) return CONTEXT_WINDOWS[model];
  if (provider && CONTEXT_WINDOWS._provider_defaults[provider]) {
    return CONTEXT_WINDOWS._provider_defaults[provider];
  }
  return 32768;
}
