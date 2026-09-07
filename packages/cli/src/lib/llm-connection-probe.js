import { formatProviderResponseError } from "./provider-http-error.js";

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
    };
  } else {
    if (!target.apiKey) throw new Error("API key required");
    if (target.provider === "anthropic") {
      url = `${base}/messages`;
      headers["x-api-key"] = target.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model: target.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Say hi in one word." }],
      };
    } else if (target.provider === "gemini") {
      url = `${base}/models/${encodeURIComponent(target.model)}:generateContent`;
      headers["x-goog-api-key"] = target.apiKey;
      body = {
        contents: [{ parts: [{ text: "Say hi in one word." }] }],
        generationConfig: { maxOutputTokens: 16 },
      };
    } else {
      url = `${base}/chat/completions`;
      headers.Authorization = `Bearer ${target.apiKey}`;
      body = {
        model: target.model,
        messages: [{ role: "user", content: "Say hi in one word." }],
        max_tokens: 16,
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
                ?.map((p) => p.text || "")
                .join("")
            : data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw new Error(
        "The endpoint returned no model text; check the protocol and model",
      );
    return text.trim().slice(0, 100);
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Connection test timed out after ${timeoutMs / 1000}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
