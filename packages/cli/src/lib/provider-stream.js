/**
 * Provider streaming adapters — shared by `cc stream` and the Hosted Session
 * API `stream.run` WS route. Each builder returns an AsyncIterable<string>
 * of token deltas suitable for piping through session-core StreamRouter.
 */

import { BUILT_IN_PROVIDERS } from "./llm-providers.js";

export async function* ollamaTokenStream({ baseUrl, model, prompt, signal }) {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.response) yield obj.response;
        if (obj.done) return;
      } catch {
        /* skip malformed */
      }
    }
  }
}

export async function* openAIStream({
  baseUrl,
  apiKey,
  model,
  prompt,
  signal,
}) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip */
      }
    }
  }
}

/**
 * Build an AsyncIterable<string> token stream for the given provider.
 * Throws on unsupported provider / missing API key.
 */
export function buildProviderSource(provider, opts = {}) {
  const { model, baseUrl, apiKey, prompt, signal } = opts;
  if (provider === "ollama") {
    return ollamaTokenStream({
      baseUrl: baseUrl || "http://localhost:11434",
      model: model || "qwen2:7b",
      prompt,
      signal,
    });
  }
  const def = BUILT_IN_PROVIDERS[provider];
  if (!def) throw new Error(`Unsupported provider: ${provider}`);
  const finalKey =
    apiKey || (def.apiKeyEnv ? process.env[def.apiKeyEnv] : null);
  if (!finalKey) {
    throw new Error(
      `API key required for ${provider} (--api-key or ${def.apiKeyEnv})`,
    );
  }
  return openAIStream({
    baseUrl: baseUrl || def.baseUrl,
    apiKey: finalKey,
    model: model || def.models[0],
    prompt,
    signal,
  });
}
