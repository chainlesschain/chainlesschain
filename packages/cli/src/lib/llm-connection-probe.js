import { formatProviderResponseError } from "./provider-http-error.js";

// Reasoning models spend the same output allowance on thinking before the
// final answer. A 16-token probe can therefore receive HTTP 200 with only
// reasoning_content and finish_reason=length from an otherwise usable model.
const PROBE_OUTPUT_TOKENS = 1024;

export async function probeLlmConnection(
  target,
  { fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const base = target.baseUrl.replace(/\/+$/, "");
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
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        await formatProviderResponseError(target.provider, response),
      );
    const data = await response.json();
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
    return text.trim().slice(0, 100);
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Connection test timed out after ${timeoutMs / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
