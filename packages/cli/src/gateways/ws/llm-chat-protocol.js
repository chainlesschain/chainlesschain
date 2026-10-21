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
 *   3. Current saved `config.llm`
 *   4. process.env[BUILT_IN_PROVIDERS[provider].apiKeyEnv]
 *
 * Without any source of credentials we send a clean ok:false frame instantly
 * — the user sees an actionable error rather than a 60s hang.
 */

import {
  streamOllama,
  streamOpenAI,
  streamAnthropic,
  streamGemini,
  STREAM_STALL_MS,
} from "../../lib/chat-core.js";
import { BUILT_IN_PROVIDERS } from "../../lib/llm-providers.js";
import { resolveLlmCreds } from "./llm-creds.js";
import { prepareGovernedModelTurn } from "../../lib/evolution/governed-model-turn.js";
import { normalizeOllamaBaseUrl } from "../../lib/ollama-base-url.js";
import { normalizeProviderBaseUrl } from "../../lib/provider-protocol.js";
import { raceWithAbort } from "../../lib/abort-utils.js";

const activeChats = new WeakMap();
const CHAT_SETUP_TIMEOUT_MS = 60_000;

/** A request id is scoped to its originating socket, never another client. */
export function cancelLlmChat(ws, id) {
  activeChats.get(ws)?.get(id)?.abort(new Error("Chat cancelled"));
}

async function waitForChatPhase(operation, controller, phase) {
  const timer = setTimeout(
    () => controller.abort(new Error(`Chat ${phase} timed out after 60s`)),
    CHAT_SETUP_TIMEOUT_MS,
  );
  timer.unref?.();
  try {
    return await raceWithAbort(operation, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

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

  let creds;
  try {
    creds = resolveLlmCreds(server, message);
  } catch (error) {
    send({
      type: `${topic}.result`,
      ok: false,
      error: error?.message || String(error),
    });
    return;
  }
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
    controller.signal.throwIfAborted();
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

  const controller = new AbortController();
  let requests = null;
  if (ws && (typeof ws === "object" || typeof ws === "function")) {
    requests = activeChats.get(ws);
    if (!requests) activeChats.set(ws, (requests = new Map()));
    if (requests.has(id)) {
      send({
        type: `${topic}.result`,
        ok: false,
        error: "Chat request is already active",
      });
      return;
    }
    requests.set(id, controller);
  }
  const disconnect = () =>
    controller.abort(new Error("Chat connection closed"));
  const onStall = (elapsedMs, timeoutMs) => {
    if (controller.signal.aborted) return;
    send({
      type: `${topic}.status`,
      status: {
        stage: "waiting",
        provider: creds.provider,
        model: creds.model,
        elapsedMs,
        timeoutMs,
      },
    });
  };
  ws?.once?.("close", disconnect);
  try {
    const turn = await waitForChatPhase(
      prepareGovernedModelTurn(server.evolutionCompositionFactory ?? null, {
        mode: "ws-llm-chat",
        messages: message.messages,
        signal: controller.signal,
      }),
      controller,
      "initialization",
    );
    const streamOptions = {
      requireCompletion: turn.governed,
      signal: controller.signal,
    };
    // Tell the browser the configured deadline even when waiting hints are
    // disabled, so a slow local model gets its full loading budget.
    onStall(0, STREAM_STALL_MS);
    const baseUrl =
      creds.provider === "ollama"
        ? normalizeOllamaBaseUrl(creds.baseUrl)
        : normalizeProviderBaseUrl(creds.baseUrl);
    if (creds.provider === "ollama") {
      await raceWithAbort(
        streamOllama(
          turn.messages,
          creds.model,
          baseUrl,
          onToken,
          onUsage,
          onStall,
          streamOptions,
        ),
        controller.signal,
      );
    } else if (creds.provider === "anthropic") {
      const url = baseUrl;
      await raceWithAbort(
        streamAnthropic(
          turn.messages,
          creds.model,
          url,
          creds.apiKey,
          onToken,
          onUsage,
          onStall,
          streamOptions,
        ),
        controller.signal,
      );
    } else if (creds.provider === "gemini") {
      const url = baseUrl;
      await raceWithAbort(
        streamGemini(
          turn.messages,
          creds.model,
          url,
          creds.apiKey,
          onToken,
          onUsage,
          onStall,
          streamOptions,
        ),
        controller.signal,
      );
    } else {
      // OpenAI-compatible — covers openai / volcengine / deepseek / dashscope /
      // kimi / minimax / mistral / custom. baseUrl from creds; default-from
      // BUILT_IN_PROVIDERS already applied above.
      const def = BUILT_IN_PROVIDERS[creds.provider];
      const url = baseUrl || def?.baseUrl;
      await raceWithAbort(
        streamOpenAI(
          turn.messages,
          creds.model,
          url,
          creds.apiKey,
          onToken,
          onUsage,
          onStall,
          streamOptions,
        ),
        controller.signal,
      );
    }

    await waitForChatPhase(
      turn.complete(accumulator),
      controller,
      "completion",
    );
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
  } finally {
    requests?.delete(id);
    if (requests?.size === 0) activeChats.delete(ws);
    ws?.removeListener?.("close", disconnect);
  }
}
