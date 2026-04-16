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
import { appendTokenUsage } from "../harness/jsonl-session-store.js";

/**
 * Stream a response from Ollama.
 * If `onUsage` is provided, it's called with `{inputTokens, outputTokens}`
 * derived from Ollama's terminal `prompt_eval_count` / `eval_count` fields.
 */
export async function streamOllama(messages, model, baseUrl, onToken, onUsage) {
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
        if (json.done && onUsage) {
          const inputTokens = Number(json.prompt_eval_count) || 0;
          const outputTokens = Number(json.eval_count) || 0;
          if (inputTokens || outputTokens) {
            onUsage({ inputTokens, outputTokens });
          }
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
export async function streamOpenAI(
  messages,
  model,
  baseUrl,
  apiKey,
  onToken,
  onUsage,
) {
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
      // Opt-in token usage in the terminal chunk (OpenAI-compatible).
      // Servers that don't understand it simply ignore it.
      stream_options: { include_usage: true },
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
          if (json.usage && onUsage) {
            const inputTokens = Number(json.usage.prompt_tokens) || 0;
            const outputTokens = Number(json.usage.completion_tokens) || 0;
            if (inputTokens || outputTokens) {
              onUsage({ inputTokens, outputTokens });
            }
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
 * Stream a response from Anthropic's /v1/messages API.
 * SSE chunks carry `message_start` (usage.input_tokens) and `message_delta`
 * (usage.output_tokens). Content comes from `content_block_delta` events.
 */
export async function streamAnthropic(
  messages,
  model,
  baseUrl,
  apiKey,
  onToken,
  onUsage,
) {
  // Split out a leading system prompt (Anthropic requires it as top-level
  // `system`, not an OpenAI-style role=system message).
  let system;
  const convo = [];
  for (const m of messages) {
    if (m.role === "system" && system === undefined) {
      system = m.content;
    } else {
      convo.push(m);
    }
  }

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: convo,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic error: ${response.status} ${response.statusText}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let buf = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        if (obj.type === "content_block_delta") {
          const delta = obj.delta?.text;
          if (delta) {
            fullResponse += delta;
            onToken(delta);
          }
        } else if (obj.type === "message_start") {
          inputTokens = Number(obj.message?.usage?.input_tokens) || inputTokens;
          outputTokens =
            Number(obj.message?.usage?.output_tokens) || outputTokens;
        } else if (obj.type === "message_delta") {
          outputTokens = Number(obj.usage?.output_tokens) || outputTokens;
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  if (onUsage && (inputTokens || outputTokens)) {
    onUsage({ inputTokens, outputTokens });
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
  const { provider, model, baseUrl, apiKey, sessionId } = options;

  const tokens = [];
  const onToken = (token) => {
    tokens.push(token);
  };

  let capturedUsage = null;
  const onUsage = (u) => {
    capturedUsage = u;
  };

  let fullResponse;

  if (provider === "ollama") {
    fullResponse = await streamOllama(
      messages,
      model,
      baseUrl,
      onToken,
      onUsage,
    );
  } else if (provider === "anthropic") {
    const providerDef = BUILT_IN_PROVIDERS.anthropic;
    const url =
      baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : providerDef?.baseUrl || "https://api.anthropic.com/v1";
    const key =
      apiKey ||
      (providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
    if (!key) {
      throw new Error(
        `API key required for anthropic (set ${providerDef?.apiKeyEnv || "ANTHROPIC_API_KEY"})`,
      );
    }
    fullResponse = await streamAnthropic(
      messages,
      model,
      url,
      key,
      onToken,
      onUsage,
    );
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
    fullResponse = await streamOpenAI(
      messages,
      model,
      url,
      key,
      onToken,
      onUsage,
    );
  }

  // Phase J — auto-record token usage to JSONL session store so
  // `cc session usage` and the `usage.*` WS routes see real data.
  if (sessionId && capturedUsage) {
    try {
      appendTokenUsage(sessionId, {
        provider,
        model,
        usage: {
          input_tokens: capturedUsage.inputTokens,
          output_tokens: capturedUsage.outputTokens,
        },
      });
    } catch {
      // Best-effort — never break the stream because accounting failed.
    }
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
