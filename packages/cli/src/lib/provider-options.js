/**
 * Provider-options three-layer deep merge — inspired by open-agents'
 * getAnthropicSettings + mergeProviderOptions pattern.
 *
 * Resolves per-call LLM provider options as a deep merge of:
 *   1. PROVIDER_DEFAULTS[provider]      — hand-curated baseline per provider
 *   2. MODEL_INFERENCE(modelId)         — model-specific overrides (e.g. o1
 *                                         disables temperature, claude-opus
 *                                         enables extended thinking)
 *   3. callOverrides                    — whatever the caller passes
 *
 * Later layers win at leaf keys; objects are merged recursively, arrays are
 * replaced (not concatenated) to keep behavior predictable.
 *
 * @module provider-options
 */

// ─── Layer 1: per-provider defaults ────────────────────────────────────────

export const PROVIDER_DEFAULTS = Object.freeze({
  anthropic: {
    maxTokens: 8192,
    temperature: 1.0,
    anthropic: { thinking: { type: "disabled" } },
  },
  openai: {
    maxTokens: 4096,
    temperature: 0.7,
  },
  ollama: {
    temperature: 0.7,
  },
  deepseek: {
    maxTokens: 4096,
    temperature: 0.7,
  },
  gemini: {
    maxTokens: 8192,
    temperature: 0.7,
  },
  custom: {
    maxTokens: 4096,
    temperature: 0.7,
  },
});

// ─── Layer 2: model-id inference ───────────────────────────────────────────

/**
 * Derive per-model overrides from the model id string. Pure function, no I/O.
 *
 * @param {string} modelId
 * @returns {object} partial options to merge on top of provider defaults.
 */
export function inferModelOverrides(modelId) {
  if (!modelId || typeof modelId !== "string") return {};
  const id = modelId.toLowerCase();

  // OpenAI o1/o3 reasoning models — temperature is unsupported.
  if (
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.includes("-o1-") ||
    id.includes("-o3-")
  ) {
    return { temperature: undefined, reasoning: { effort: "medium" } };
  }

  // Claude Opus — enable extended thinking by default (users can turn off).
  if (id.includes("opus-4") || id.includes("opus-3")) {
    return {
      maxTokens: 16384,
      anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } },
    };
  }

  // Claude Haiku — cheaper, smaller output by default.
  if (id.includes("haiku")) {
    return { maxTokens: 4096 };
  }

  // DeepSeek reasoner — reasoning tokens need headroom.
  if (id.includes("deepseek-reasoner")) {
    return { maxTokens: 8192, reasoning: { enabled: true } };
  }

  return {};
}

// ─── Deep merge primitive ──────────────────────────────────────────────────

function _isPlainObject(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

export function deepMerge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!_isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) {
        // explicit undefined → erase from accumulator (used to disable fields)
        delete out[key];
      } else if (_isPlainObject(value) && _isPlainObject(out[key])) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Merge three layers into a single options object for a given LLM call.
 *
 * @param {string} provider
 * @param {string} modelId
 * @param {object} [callOverrides]
 * @returns {object}
 */
export function mergeProviderOptions(provider, modelId, callOverrides = {}) {
  const defaults = PROVIDER_DEFAULTS[provider] || {};
  const modelLayer = inferModelOverrides(modelId);
  return deepMerge(defaults, modelLayer, callOverrides || {});
}
