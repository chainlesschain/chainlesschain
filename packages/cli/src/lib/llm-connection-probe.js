import { formatProviderResponseError } from "./provider-http-error.js";
import { estimateCost } from "./llm-pricing.js";
import { providerFetch } from "./formal-budget-provider-scope.js";
import { isFormalBudgetError } from "./formal-budget-errors.js";
import { normalizeOllamaBaseUrl } from "./ollama-base-url.js";

// Reasoning models spend the same output allowance on thinking before the
// final answer. A 16-token probe can therefore receive HTTP 200 with only
// reasoning_content and finish_reason=length from an otherwise usable model.
const PROBE_OUTPUT_TOKENS = 1024;
export const LLM_PROBE_SCHEMA = "chainlesschain.llm-connection-probe/v1";

const count = (value) => Number.isSafeInteger(value) && value >= 0;

/** Preserve missing/malformed usage as unknown, including cached prompt tokens. */
export function normalizeLlmProbeUsage(provider, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  let usage;
  if (provider === "ollama") {
    usage = {
      input_tokens: data.prompt_eval_count,
      output_tokens: data.eval_count,
    };
  } else if (provider === "anthropic") {
    usage = data.usage;
  } else if (provider === "gemini") {
    const raw = data.usageMetadata;
    if (
      !raw ||
      !count(raw.candidatesTokenCount) ||
      !count(raw.thoughtsTokenCount === undefined ? 0 : raw.thoughtsTokenCount)
    )
      return null;
    const cached =
      raw.cachedContentTokenCount === undefined
        ? 0
        : raw.cachedContentTokenCount;
    if (
      !count(raw.promptTokenCount) ||
      !count(cached) ||
      cached > raw.promptTokenCount
    )
      return null;
    usage = {
      input_tokens: raw.promptTokenCount - cached,
      output_tokens: raw.candidatesTokenCount + (raw.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
    };
  } else {
    const raw = data.usage;
    if (!raw || !count(raw.prompt_tokens) || !count(raw.completion_tokens))
      return null;
    const detailed = raw.prompt_tokens_details?.cached_tokens;
    const legacy = raw.prompt_cache_hit_tokens;
    const cached =
      detailed === undefined ? (legacy === undefined ? 0 : legacy) : detailed;
    if (
      !count(cached) ||
      cached > raw.prompt_tokens ||
      (detailed !== undefined && legacy !== undefined && detailed !== legacy)
    )
      return null;
    usage = {
      input_tokens: raw.prompt_tokens - cached,
      output_tokens: raw.completion_tokens,
      cache_read_input_tokens: cached,
    };
  }
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const normalized = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens:
      usage.cache_read_input_tokens === undefined
        ? 0
        : usage.cache_read_input_tokens,
    cache_creation_input_tokens:
      usage.cache_creation_input_tokens === undefined
        ? 0
        : usage.cache_creation_input_tokens,
  };
  return Object.values(normalized).every(count) ? normalized : null;
}

export function priceLlmProbeUsage(target, usage) {
  if (
    !usage ||
    ![
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_input_tokens,
      usage.cache_creation_input_tokens,
    ].every(count)
  )
    return null;
  const estimate = estimateCost({
    provider: target.provider,
    model: target.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
  });
  return estimate.matched && Number.isFinite(estimate.totalCost)
    ? estimate.totalCost
    : null;
}

export function llmProbeReceipt(
  target,
  { ok = false, reply = null, usage = null } = {},
) {
  const normalizedUsage =
    usage === null
      ? null
      : {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
        };
  return {
    schema: LLM_PROBE_SCHEMA,
    ok,
    provider: target.provider,
    model: target.model,
    reply:
      target.apiKey && typeof reply === "string"
        ? reply.replaceAll(target.apiKey, "[REDACTED]")
        : reply,
    usage: normalizedUsage,
    totalCostUsd: priceLlmProbeUsage(target, normalizedUsage),
    currency: "USD",
    costBasis: "token-estimate",
    billingVerified: false,
  };
}

export async function probeLlmConnection(
  target,
  { fetchImpl = fetch, timeoutMs = 20_000, includeUsage = false } = {},
) {
  const base =
    target.provider === "ollama"
      ? normalizeOllamaBaseUrl(target.baseUrl)
      : target.baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  let url, body;
  if (target.provider === "ollama") {
    url = `${base}/api/generate`;
    body = {
      model: target.model,
      prompt: "Say hi in one word.",
      stream: false,
      options: { num_predict: PROBE_OUTPUT_TOKENS },
    };
  } else {
    if (!target.apiKey) throw new Error("API key required");
    if (target.provider === "anthropic") {
      url = `${base}/messages`;
      headers["x-api-key"] = target.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model: target.model,
        max_tokens: PROBE_OUTPUT_TOKENS,
        messages: [{ role: "user", content: "Say hi in one word." }],
      };
    } else if (target.provider === "gemini") {
      url = `${base}/models/${encodeURIComponent(target.model)}:generateContent`;
      headers["x-goog-api-key"] = target.apiKey;
      body = {
        contents: [{ parts: [{ text: "Say hi in one word." }] }],
        generationConfig: { maxOutputTokens: PROBE_OUTPUT_TOKENS },
      };
    } else {
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${target.apiKey}`;
      body = {
        model: target.model,
        messages: [{ role: "user", content: "Say hi in one word." }],
        max_tokens: PROBE_OUTPUT_TOKENS,
      };
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let usage = null;
  try {
    const response = await providerFetch(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      },
      fetchImpl,
    );
    if (!response.ok)
      throw new Error(
        await formatProviderResponseError(target.provider, response, {
          secrets: [target.apiKey],
        }),
      );
    const data = await response.json();
    usage = normalizeLlmProbeUsage(target.provider, data);
    const text =
      target.provider === "ollama"
        ? data.response
        : target.provider === "anthropic"
          ? data.content
              ?.filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("")
          : target.provider === "gemini"
            ? data.candidates?.[0]?.content?.parts
                ?.filter((p) => p.thought !== true)
                ?.map((p) => p.text || "")
                .join("")
            : data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      const reachedLimit =
        data.choices?.[0]?.finish_reason === "length" ||
        data.candidates?.[0]?.finishReason === "MAX_TOKENS" ||
        data.stop_reason === "max_tokens" ||
        data.done_reason === "length";
      if (reachedLimit)
        throw new Error(
          "The model responded but exhausted the test output limit before a final answer; this does not mean the connection settings are invalid",
        );
      throw new Error(
        "The endpoint returned no model text; check the protocol and model",
      );
    }
    const reply = (
      target.apiKey ? text.replaceAll(target.apiKey, "[REDACTED]") : text
    )
      .trim()
      .slice(0, 100);
    return includeUsage
      ? llmProbeReceipt(target, { ok: true, reply, usage })
      : reply;
  } catch (error) {
    const failure =
      controller.signal.aborted && !isFormalBudgetError(error)
        ? new Error(`Connection test timed out after ${timeoutMs / 1000}s`)
        : error;
    if (includeUsage) failure.probe = llmProbeReceipt(target, { usage });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
