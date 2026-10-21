/** Shared URL and request-shape helpers for provider-specific adapters. */

export function normalizeProviderBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/u, "");
}

/**
 * Google's OpenAI-compatible API lives below `/v1beta/openai`. The provider
 * registry stores the native API root (`/v1beta`), so adapt only that exact
 * official root when a caller explicitly uses the OpenAI-compatible protocol.
 */
export function openAICompatibleBaseUrl(provider, baseUrl) {
  const base = normalizeProviderBaseUrl(baseUrl);
  if (provider !== "gemini") return base;
  try {
    const url = new URL(base);
    if (
      url.hostname === "generativelanguage.googleapis.com" &&
      url.pathname.replace(/\/+$/u, "") === "/v1beta"
    ) {
      url.pathname = "/v1beta/openai";
      return normalizeProviderBaseUrl(url.href);
    }
  } catch {
    // Keep custom compatibility endpoints intact; the request layer reports
    // malformed URLs with the provider's normal transport error.
  }
  return base;
}

export function geminiGenerateContentUrl(baseUrl, model, { stream = false } = {}) {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const endpoint = `${normalizeProviderBaseUrl(baseUrl)}/models/${encodeURIComponent(model)}:${action}`;
  return stream ? `${endpoint}?alt=sse` : endpoint;
}

function geminiTextParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === "string") return [{ text: part }];
    if (part && typeof part.text === "string") return [{ text: part.text }];
    return [];
  });
}

export function geminiRequestBody(
  messages,
  { maxOutputTokens = 4096, temperature } = {},
) {
  const contents = [];
  const systemParts = [];
  for (const message of messages || []) {
    const parts = geminiTextParts(message?.content);
    if (parts.length === 0) continue;
    if (message.role === "system") {
      systemParts.push(...parts);
      continue;
    }
    contents.push({
      role: message.role === "assistant" || message.role === "model" ? "model" : "user",
      parts,
    });
  }
  const generationConfig = { maxOutputTokens };
  if (Number.isFinite(temperature)) generationConfig.temperature = temperature;
  return {
    contents,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    generationConfig,
  };
}

export function geminiResponseText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .filter((part) => part?.thought !== true)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

export function geminiUsage(data) {
  const usage = data?.usageMetadata;
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.promptTokenCount);
  const outputTokens =
    Number(usage.candidatesTokenCount || 0) +
    Number(usage.thoughtsTokenCount || 0);
  const cacheReadTokens = Number(usage.cachedContentTokenCount || 0);
  if (
    !Number.isSafeInteger(promptTokens) ||
    promptTokens < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    !Number.isSafeInteger(cacheReadTokens) ||
    cacheReadTokens < 0 ||
    cacheReadTokens > promptTokens
  )
    return null;
  return {
    inputTokens: promptTokens - cacheReadTokens,
    outputTokens,
    cacheReadTokens,
  };
}
