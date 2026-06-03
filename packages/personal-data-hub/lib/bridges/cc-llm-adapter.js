/**
 * CcLLMAdapter — bridges the hub's LLMClient contract to ChainlessChain's
 * existing llm-manager (or any compatible client).
 *
 * Hub package stays decoupled from cc by INJECTING the cc-specific bits:
 *
 *   const llmManager = require("desktop-app-vue/src/main/llm/llm-manager");
 *   const adapter = new CcLLMAdapter({
 *     chat: (messages, opts) => llmManager.getInstance().chat(messages, opts),
 *     getActiveProvider: () => llmManager.getInstance().getActiveProvider(),
 *     getActiveModel: () => llmManager.getInstance().getActiveModel(),
 *   });
 *   // adapter satisfies LLMClient — drop into new AnalysisEngine({ vault, llm: adapter }).
 *
 * Why injection: the hub is CJS + workspace-portable. cli is ESM, desktop
 * main is CJS, future iOS bridge is yet another runtime. Each caller knows
 * how to obtain a `chat(messages, opts)` function in its own module system.
 * The hub just adapts the response shape.
 *
 * Privacy: isLocal is computed from the caller-supplied getActiveProvider().
 * Providers we consider local (no network egress on chat): ollama, llama-cpp,
 * vllm-local, lm-studio. Everything else is non-local — AnalysisEngine will
 * refuse to call unless caller explicitly opts in via acceptNonLocal: true.
 *
 * Response normalization: cc's llm-manager returns slightly different
 * shapes per provider. We coerce to the hub's { text, model, usage }
 * contract, preferring (in order):
 *   result.content                       // llm-manager wraps with .content
 *   result.message.content               // raw provider message
 *   result.text                          // some clients
 *   result.choices[0].message.content    // OpenAI-style
 */

"use strict";

const LOCAL_PROVIDERS = new Set([
  "ollama",
  "llama-cpp",
  "llamacpp",
  "vllm-local",
  "lm-studio",
  "lmstudio",
]);

function extractText(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;
  if (result.message && typeof result.message.content === "string") {
    return result.message.content;
  }
  if (
    Array.isArray(result.choices) &&
    result.choices[0] &&
    result.choices[0].message &&
    typeof result.choices[0].message.content === "string"
  ) {
    return result.choices[0].message.content;
  }
  return "";
}

function extractUsage(result) {
  if (!result || typeof result !== "object" || !result.usage) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  const u = result.usage;
  // cc llm-manager + OpenAI-compat: prompt_tokens / completion_tokens / total_tokens
  // hub contract: camelCase
  return {
    promptTokens: u.promptTokens ?? u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completionTokens ?? u.completion_tokens ?? u.output_tokens ?? 0,
    totalTokens:
      u.totalTokens ??
      u.total_tokens ??
      (u.promptTokens ?? u.prompt_tokens ?? 0) + (u.completionTokens ?? u.completion_tokens ?? 0),
  };
}

class CcLLMAdapter {
  /**
   * @param {object} deps
   * @param {(messages: Array, opts?: object) => Promise<object>} deps.chat
   * @param {() => string} [deps.getActiveProvider]
   * @param {() => string} [deps.getActiveModel]
   * @param {Set<string>|string[]} [deps.localProviders]   override the default local-provider whitelist
   * @param {string} [deps.name]                            override the .name surface
   */
  constructor(deps) {
    if (!deps || typeof deps !== "object") {
      throw new Error("CcLLMAdapter: deps required");
    }
    if (typeof deps.chat !== "function") {
      throw new Error("CcLLMAdapter: deps.chat(messages, opts) required");
    }
    this._chat = deps.chat;
    this._getActiveProvider = typeof deps.getActiveProvider === "function" ? deps.getActiveProvider : null;
    this._getActiveModel = typeof deps.getActiveModel === "function" ? deps.getActiveModel : null;
    this._localProviders =
      deps.localProviders instanceof Set
        ? deps.localProviders
        : Array.isArray(deps.localProviders)
          ? new Set(deps.localProviders)
          : LOCAL_PROVIDERS;
    this._name = deps.name || null;
  }

  get name() {
    if (this._name) return this._name;
    const model = this._getActiveModel ? this._tryCall(this._getActiveModel, "model") : null;
    const provider = this._getActiveProvider
      ? this._tryCall(this._getActiveProvider, "provider")
      : null;
    if (provider && model) return `${provider}:${model}`;
    if (model) return model;
    if (provider) return provider;
    return "cc-llm";
  }

  /**
   * Privacy invariant: report whether this LLM keeps data on-device. The
   * AnalysisEngine consults this BEFORE calling chat; non-local clients
   * are refused unless the caller explicitly passes acceptNonLocal: true.
   */
  get isLocal() {
    if (!this._getActiveProvider) {
      // No provider info → conservative: assume non-local. Caller must
      // explicitly mark via constructor opts.localProviders if needed.
      return false;
    }
    const provider = this._tryCall(this._getActiveProvider, "provider");
    if (!provider) return false;
    return this._localProviders.has(String(provider).toLowerCase());
  }

  async chat(messages, opts = {}) {
    if (!Array.isArray(messages)) {
      throw new Error("CcLLMAdapter.chat: messages must be an array");
    }
    let result;
    try {
      result = await this._chat(messages, opts);
    } catch (err) {
      const wrapped = new Error(
        `CcLLMAdapter.chat: underlying client failed — ${err && err.message ? err.message : err}`
      );
      wrapped.cause = err;
      throw wrapped;
    }
    return {
      text: extractText(result),
      model: this._getActiveModel ? this._tryCall(this._getActiveModel, "model") : result && result.model,
      usage: extractUsage(result),
      raw: result,
    };
  }

  _tryCall(fn, label) {
    try {
      return fn();
    } catch (err) {
      // Don't let getActiveProvider/getActiveModel side-effects abort isLocal
      // computation or name lookup. Fall through to default.
      return null;
    }
  }
}

module.exports = { CcLLMAdapter, LOCAL_PROVIDERS };
