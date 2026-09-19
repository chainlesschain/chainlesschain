/**
 * Public/read and write projections for the renderer-facing LLM config IPC.
 */

const PROVIDER_FIELDS = Object.freeze({
  ollama: {
    public: ["model", "embeddingModel"],
    private: ["url"],
  },
  openai: {
    public: ["model", "embeddingModel"],
    private: ["apiKey", "baseURL", "organization"],
  },
  anthropic: {
    public: ["model", "embeddingModel", "version"],
    private: ["apiKey", "baseURL"],
  },
  deepseek: {
    public: ["model", "embeddingModel"],
    private: ["apiKey", "baseURL"],
  },
  volcengine: {
    public: ["model", "embeddingModel", "videoModel"],
    private: ["apiKey", "baseURL"],
  },
  gemini: {
    public: ["model", "embeddingModel"],
    private: ["apiKey", "baseURL"],
  },
  mistral: {
    public: ["model", "embeddingModel"],
    private: ["apiKey", "baseURL"],
  },
  custom: {
    public: ["name", "model", "embeddingModel"],
    private: ["apiKey", "baseURL"],
  },
});

const OPTION_FIELDS = Object.freeze([
  "temperature",
  "top_p",
  "top_k",
  "max_tokens",
  "timeout",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function projectOptions(value) {
  const input = record(value);
  const projected = {};
  for (const field of OPTION_FIELDS) {
    if (typeof input[field] === "number" && Number.isFinite(input[field])) {
      projected[field] = input[field];
    }
  }
  return projected;
}

function mergeOptions(submittedValue, currentValue) {
  const submitted = record(submittedValue);
  const current = record(currentValue);
  const merged = {};
  for (const field of OPTION_FIELDS) {
    const value =
      typeof submitted[field] === "number" ? submitted[field] : current[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[field] = value;
    }
  }
  return merged;
}

function projectLlmConfigForRenderer(config) {
  const input = record(config);
  const projected = {
    provider: stringValue(input.provider),
    options: projectOptions(input.options),
    systemPrompt: "",
    systemPromptConfigured: stringValue(input.systemPrompt).length > 0,
    streamEnabled: input.streamEnabled === true,
    autoSaveConversations: input.autoSaveConversations === true,
  };

  for (const [provider, fields] of Object.entries(PROVIDER_FIELDS)) {
    const providerConfig = record(input[provider]);
    const publicProvider = {};
    for (const field of fields.public) {
      publicProvider[field] = stringValue(providerConfig[field]);
    }
    for (const field of fields.private) {
      publicProvider[field] = "";
      publicProvider[`${field}Configured`] =
        stringValue(providerConfig[field]).length > 0;
    }
    projected[provider] = publicProvider;
  }

  return projected;
}

function mergePrivateString(submitted, current) {
  if (submitted === null) return "";
  if (typeof submitted === "string" && submitted.length > 0) return submitted;
  return stringValue(current);
}

function mergeLlmConfigWrite(submittedConfig, currentConfig) {
  const submitted = record(submittedConfig);
  const current = record(currentConfig);
  const merged = {
    provider: stringValue(submitted.provider || current.provider),
    options: mergeOptions(submitted.options, current.options),
    systemPrompt: mergePrivateString(
      submitted.systemPrompt,
      current.systemPrompt,
    ),
    streamEnabled:
      typeof submitted.streamEnabled === "boolean"
        ? submitted.streamEnabled
        : current.streamEnabled === true,
    autoSaveConversations:
      typeof submitted.autoSaveConversations === "boolean"
        ? submitted.autoSaveConversations
        : current.autoSaveConversations === true,
  };

  for (const [provider, fields] of Object.entries(PROVIDER_FIELDS)) {
    const providerInput = record(submitted[provider]);
    const providerCurrent = record(current[provider]);
    const next = {};
    for (const field of fields.public) {
      next[field] = stringValue(providerInput[field] ?? providerCurrent[field]);
    }
    for (const field of fields.private) {
      next[field] = mergePrivateString(
        providerInput[field],
        providerCurrent[field],
      );
    }
    merged[provider] = next;
  }

  return merged;
}

module.exports = {
  mergeLlmConfigWrite,
  projectLlmConfigForRenderer,
};
