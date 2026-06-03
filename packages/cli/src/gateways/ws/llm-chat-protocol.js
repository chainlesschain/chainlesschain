/**
 * llm.chat WS protocol — single-shot streaming chat for cc ui's QuickAsk page.
 *
 * The desktop web-shell has had this topic since `4eaf90137` (Phase 2). cc ui
 * never registered it, so QuickAsk would hit ws.sendStream's 60s idle timer
 * and surface "Stream idle timeout" forever. Filed as a regression report
 * comparing v5.0.3.43 desktop (works) with v5.0.3.44 cc ui (hung) — root
 * cause is the missing handler, not a code regression.
 *
 * Frame shape mirrors the desktop's llm-handlers.js so the SPA's
 * `useLlmChat()` consumer is environment-agnostic:
 *
 *   client → server: { id, type:"llm.chat", messages:[{role, content}],
 *                      sessionId?, options?:{ provider?, model?, baseUrl?,
 *                      apiKey?, temperature? } }
 *
 *   server → client (streaming):
 *     { id, type:"llm.chat.chunk", chunk:{ delta, content } }
 *     ... per-token ...
 *     { id, type:"llm.chat.result", ok:true,
 *       result:{ message:{role:"assistant", content}, model, tokens? } }
 *
 *   On error before / mid-stream:
 *     { id, type:"llm.chat.result", ok:false, error:"<msg>" }
 *
 * Provider resolution (first non-null wins):
 *   1. message.options — explicit provider/model/apiKey from the client
 *   2. server.sessionManager.getSession(sessionId) — set via `cc auth llm`
 *   3. process.env[BUILT_IN_PROVIDERS[provider].apiKeyEnv]
 *
 * Without any source of credentials we send a clean ok:false frame instantly
 * — the user sees an actionable error rather than a 60s hang.
 */

import {
  streamOllama,
  streamOpenAI,
  streamAnthropic,
} from "../../lib/chat-core.js";
import { BUILT_IN_PROVIDERS } from "../../lib/llm-providers.js";
import { resolveLlmCreds } from "./llm-creds.js";

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    return "messages_required";
  for (const m of messages) {
    if (
      !m ||
      typeof m !== "object" ||
      typeof m.role !== "string" ||
      typeof m.content !== "string"
    ) {
      return "invalid_message_shape";
    }
  }
  return null;
}

/**
 * Streaming handler for `llm.chat`. The dispatcher invokes it; we own the
 * full frame protocol (chunks + terminal result) so the consumer-side
 * useLlmChat() works unchanged whether the WS gateway is desktop's
 * web-shell or cc ui.
 */
export async function handleLlmChat(server, id, ws, message) {
  const topic = "llm.chat";
  const send = (frame) => server._send(ws, { id, ...frame });

  const validationError = validateMessages(message?.messages);
  if (validationError) {
    send({ type: `${topic}.result`, ok: false, error: validationError });
    return;
  }

  const creds = resolveLlmCreds(server, message);
  if (!creds || !creds.provider) {
    send({
      type: `${topic}.result`,
      ok: false,
      error:
        "no_llm_provider_configured: pass options.provider + apiKey, sessionId with creds, or set <PROVIDER>_API_KEY env",
    });
    return;
  }

  if (creds.provider !== "ollama" && !creds.apiKey) {
    const envHint = BUILT_IN_PROVIDERS[creds.provider]?.apiKeyEnv;
    send({
      type: `${topic}.result`,
      ok: false,
      error: `missing_api_key for ${creds.provider}${envHint ? ` (set ${envHint})` : ""}`,
    });
    return;
  }

  let accumulator = "";
  const onToken = (token) => {
    if (typeof token !== "string" || token.length === 0) return;
    accumulator += token;
    send({
      type: `${topic}.chunk`,
      chunk: { delta: token, content: accumulator },
    });
  };

  let usage = null;
  const onUsage = (u) => {
    usage = u;
  };

  try {
    const baseUrl = creds.baseUrl || "http://localhost:11434";
    if (creds.provider === "ollama") {
      await streamOllama(
        message.messages,
        creds.model,
        baseUrl,
        onToken,
        onUsage,
      );
    } else if (creds.provider === "anthropic") {
      const def = BUILT_IN_PROVIDERS.anthropic;
      const url = baseUrl !== "http://localhost:11434" ? baseUrl : def.baseUrl;
      await streamAnthropic(
        message.messages,
        creds.model,
        url,
        creds.apiKey,
        onToken,
        onUsage,
      );
    } else {
      // OpenAI-compatible — covers openai / volcengine / deepseek / dashscope /
      // kimi / minimax / mistral / custom. baseUrl from creds; default-from
      // BUILT_IN_PROVIDERS already applied above.
      const def = BUILT_IN_PROVIDERS[creds.provider];
      const url = baseUrl !== "http://localhost:11434" ? baseUrl : def?.baseUrl;
      await streamOpenAI(
        message.messages,
        creds.model,
        url,
        creds.apiKey,
        onToken,
        onUsage,
      );
    }

    send({
      type: `${topic}.result`,
      ok: true,
      result: {
        message: { role: "assistant", content: accumulator },
        model: creds.model,
        provider: creds.provider,
        tokens: usage?.outputTokens ?? null,
        promptTokens: usage?.inputTokens ?? null,
      },
    });
  } catch (err) {
    send({
      type: `${topic}.result`,
      ok: false,
      error: err?.message || String(err),
    });
  }
}
