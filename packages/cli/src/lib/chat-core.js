/**
 * Chat Core — transport-independent streaming chat logic
 *
 * Extracted from chat-repl.js so that both the terminal REPL and the
 * WebSocket chat handler can consume the same streaming API.
 *
 * Key exports:
 *  - chatStream — async generator yielding response-token / response-complete events
 *  - streamOllama / streamOpenAI — low-level streaming helpers
 */

import { BUILT_IN_PROVIDERS } from "./llm-providers.js";

/**
 * Stream a response from Ollama
 */
export async function streamOllama(messages, model, baseUrl, onToken) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullResponse += json.message.content;
          onToken(json.message.content);
        }
      } catch {
        // Partial JSON, skip
      }
    }
  }

  return fullResponse;
}

/**
 * Stream a response from OpenAI-compatible API
 */
export async function streamOpenAI(messages, model, baseUrl, apiKey, onToken) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n").filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            onToken(content);
          }
        } catch {
          // Partial data
        }
      }
    }
  }

  return fullResponse;
}

/**
 * Async generator that streams a chat response.
 *
 * Yields events:
 *   { type: "response-token", token }
 *   { type: "response-complete", content }
 *
 * @param {Array} messages
 * @param {object} options - provider, model, baseUrl, apiKey
 */
export async function* chatStream(messages, options) {
  const { provider, model, baseUrl, apiKey } = options;

  const tokens = [];
  const onToken = (token) => {
    tokens.push(token);
  };

  let fullResponse;

  if (provider === "ollama") {
    fullResponse = await streamOllama(messages, model, baseUrl, onToken);
  } else {
    const providerDef = BUILT_IN_PROVIDERS[provider];
    const url =
      baseUrl !== "http://localhost:11434"
        ? baseUrl
        : providerDef?.baseUrl || "https://api.openai.com/v1";
    const key =
      apiKey ||
      (providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
    if (!key) {
      throw new Error(
        `API key required for ${provider} (set ${providerDef?.apiKeyEnv || "API key"})`,
      );
    }
    fullResponse = await streamOpenAI(messages, model, url, key, onToken);
  }

  // Yield all collected tokens
  for (const token of tokens) {
    yield { type: "response-token", token };
  }

  yield { type: "response-complete", content: fullResponse };
}

/**
 * Non-streaming version: chatStream but collects tokens and returns full response.
 * Yields events incrementally via the onEvent callback.
 *
 * @param {Array} messages
 * @param {object} options - provider, model, baseUrl, apiKey
 * @param {function} [onEvent] - called with each event { type, token?, content? }
 * @returns {Promise<string>} full response
 */
export async function chatWithStreaming(messages, options, onEvent) {
  let fullContent = "";
  for await (const event of chatStream(messages, options)) {
    if (onEvent) onEvent(event);
    if (event.type === "response-complete") {
      fullContent = event.content;
    }
  }
  return fullContent;
}
