import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  CONTEXT_WINDOWS,
  DOCUMENTED_OPENAI_MODELS,
  LEGACY_MODEL_PROVIDERS,
  MODEL_CAPABILITY_CATALOG_VERSION,
} from "./model-context-catalog.js";
import { mergeProviderOptions } from "./provider-options.js";

const PROFILE_SCHEMA = "chainlesschain.model-capability-profile/v1";
const MAX_CONTEXT_WINDOW_TOKENS = 16_777_216;
const CHAT_COMPLETIONS_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "dashscope",
  "mistral",
  "gemini",
  "volcengine",
]);

function optionalIdentity(value, field) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 256) {
    throw new TypeError(`${field} must be a string of at most 256 characters`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new TypeError(`${field} must not contain control characters`);
  }
  // Provider/model identity is exact, just like the request transport. Do not
  // certify an alias by trimming or changing the case of an actual request id.
  return value;
}

function optionalPositiveInteger(
  value,
  field,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (value == null) return null;
  const normalized =
    typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : value;
  if (
    typeof normalized !== "number" ||
    !Number.isSafeInteger(normalized) ||
    normalized < min ||
    normalized > max
  ) {
    throw new RangeError(
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return normalized;
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function isOfficialOpenAIBaseUrl(baseUrl) {
  if (baseUrl == null || baseUrl === "") return true;
  if (typeof baseUrl !== "string") {
    throw new TypeError("baseUrl must be a string when provided");
  }
  try {
    // Deliberately excludes credentials, paths other than /v1, query/hash
    // decorations and non-default ports. Never return or hash the input URL.
    return (
      baseUrl === baseUrl.trim() &&
      new URL(baseUrl).href === "https://api.openai.com/v1"
    );
  } catch {
    return false;
  }
}

/**
 * Describe the output cap the existing agent transport actually sends.
 * This does not add a cap to Chat Completions/Ollama or select a new model.
 * The planner may apply its own minimum reserve and reject an impossible
 * input/output allocation; no context-window clipping happens here.
 */
export function resolveAgentOutputBudget({
  provider,
  model,
  maxOutputTokens,
} = {}) {
  const requested = optionalPositiveInteger(maxOutputTokens, "maxOutputTokens");
  if (provider === "anthropic") {
    const effectiveModel = model || "claude-sonnet-4-6";
    const { maxTokens } = mergeProviderOptions("anthropic", effectiveModel);
    const defaultCap = maxTokens || 8192;
    const requestMaxOutputTokens =
      requested === null ? defaultCap : Math.min(defaultCap, requested);
    return Object.freeze({
      requestMaxOutputTokens,
      plannedOutputReserveTokens: requestMaxOutputTokens,
      outputReserveSource:
        requested === null
          ? "anthropic-request-default"
          : requested > defaultCap
            ? "anthropic-request-clamp"
            : "explicit-request-cap",
    });
  }
  return Object.freeze({
    requestMaxOutputTokens: requested,
    plannedOutputReserveTokens: requested ?? 4096,
    outputReserveSource:
      requested === null ? "planning-fallback" : "explicit-request-cap",
  });
}

/**
 * Pure, versioned diagnostics/planning projection. No provider discovery,
 * credential loading, model calls or protocol negotiation is performed.
 * `runtimeVerified:false` applies even to documented model specifications.
 */
export function resolveModelCapabilityProfile({
  provider,
  model,
  baseUrl,
  contextMemoryModelWindowTokens,
  maxOutputTokens,
} = {}) {
  const selectedProvider = optionalIdentity(provider, "provider");
  const selectedModel = optionalIdentity(model, "model");
  if (baseUrl != null && typeof baseUrl !== "string") {
    throw new TypeError("baseUrl must be a string when provided");
  }
  const override = optionalPositiveInteger(
    contextMemoryModelWindowTokens,
    "contextMemoryModelWindowTokens",
    { min: 1024, max: MAX_CONTEXT_WINDOW_TOKENS },
  );
  const officialEndpoint =
    selectedProvider === "openai" && isOfficialOpenAIBaseUrl(baseUrl);
  const documented =
    officialEndpoint &&
    selectedModel &&
    Object.hasOwn(DOCUMENTED_OPENAI_MODELS, selectedModel)
      ? DOCUMENTED_OPENAI_MODELS[selectedModel]
      : null;
  const legacyOwner =
    selectedModel && Object.hasOwn(LEGACY_MODEL_PROVIDERS, selectedModel)
      ? LEGACY_MODEL_PROVIDERS[selectedModel]
      : null;
  let contextWindowTokens;
  let windowSource;
  let windowAssumed = true;
  if (override !== null) {
    contextWindowTokens = override;
    windowSource = "explicit-override";
  } else if (documented) {
    contextWindowTokens = documented.contextWindowTokens;
    windowSource = "official-model-docs";
    windowAssumed = false;
  } else if (
    legacyOwner &&
    (!selectedProvider || legacyOwner === selectedProvider)
  ) {
    contextWindowTokens = CONTEXT_WINDOWS[selectedModel];
    windowSource = selectedProvider
      ? "legacy-catalog"
      : "legacy-catalog-unscoped";
  } else if (
    selectedProvider &&
    Object.hasOwn(CONTEXT_WINDOWS._provider_defaults, selectedProvider)
  ) {
    contextWindowTokens = CONTEXT_WINDOWS._provider_defaults[selectedProvider];
    windowSource = "provider-default";
  } else {
    contextWindowTokens = 32768;
    windowSource = "generic-default";
  }

  const output = resolveAgentOutputBudget({
    provider: selectedProvider,
    model: selectedModel,
    maxOutputTokens,
  });
  const runtimeProtocol =
    selectedProvider === "ollama"
      ? "ollama-chat"
      : selectedProvider === "anthropic"
        ? "anthropic-messages"
        : CHAT_COMPLETIONS_PROVIDERS.has(selectedProvider) || Boolean(baseUrl)
          ? "chat-completions"
          : "unsupported";
  const limitations = [
    "Runtime execution, endpoint access and account entitlement have not been verified.",
    "Native Responses transport is not implemented by the current agent.",
  ];
  if (windowSource === "explicit-override") {
    limitations.push("The context window is operator-declared and unverified.");
  } else if (windowAssumed) {
    limitations.push(
      "The context window is a legacy or fallback planning estimate, not a verified model limit.",
    );
  }
  if (!selectedProvider) {
    limitations.push(
      "No provider was specified; an unscoped legacy model lookup does not establish provider capabilities.",
    );
  }
  if (legacyOwner && selectedProvider && legacyOwner !== selectedProvider) {
    limitations.push(
      "The model's legacy catalog entry belongs to another provider and was not applied.",
    );
  }
  if (selectedProvider === "openai" && !officialEndpoint) {
    limitations.push(
      "Official OpenAI model specifications are not applied to a custom endpoint.",
    );
  }
  if (output.requestMaxOutputTokens === null) {
    limitations.push(
      "The output reserve is a planning fallback, not an output cap sent to the provider.",
    );
  }
  if (documented?.requiresResponsesForTools) {
    limitations.push(
      "This model requires Responses for tool calling; the current agent uses Chat Completions and has no native Responses tool transport.",
    );
  }
  if (runtimeProtocol === "unsupported") {
    limitations.push(
      "No supported agent transport was resolved for this provider and endpoint configuration.",
    );
  }
  if (
    documented &&
    output.requestMaxOutputTokens > documented.advertisedMaxOutputTokens
  ) {
    limitations.push(
      "The requested output cap exceeds the documented model maximum; the profile does not rewrite the request.",
    );
  }

  const identityDigest = canonicalDigest(
    {
      schema: PROFILE_SCHEMA,
      provider: selectedProvider || "unknown",
      model: selectedModel,
    },
    "chainlesschain.model-capability-identity/v1",
  );
  const profile = {
    schema: PROFILE_SCHEMA,
    catalogVersion: MODEL_CAPABILITY_CATALOG_VERSION,
    profileId: `model-capability-v1:${identityDigest.slice(7, 39)}`,
    provider: selectedProvider || "unknown",
    model: selectedModel,
    contextWindowTokens,
    windowSource,
    windowAssumed,
    runtimeProtocol,
    runtimeVerified: false,
    ...output,
    advertisedMaxOutputTokens: documented?.advertisedMaxOutputTokens ?? null,
    sources: documented ? [...documented.sources] : [],
    limitations,
  };
  profile.digest = canonicalDigest(profile, PROFILE_SCHEMA);
  return deepFreeze(profile);
}
