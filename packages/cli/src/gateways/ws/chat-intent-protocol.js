/**
 * Chat Intent WS Protocol — exposes the chat-intent-service over the WS
 * gateway so the web-shell can drive the V5 desktop intent flows.
 *
 * Topics:
 *   chat.intent.understand          → understandIntent
 *   chat.intent.classify-followup   → classifyFollowupIntent
 *
 * Handlers extract LLM credentials from the session named by message.sessionId
 * (active WSSessionManager session). When sessionId is omitted or unknown,
 * the service degrades gracefully (rule-only / pass-through).
 */

import {
  understandIntent,
  understandIntentStream,
  classifyFollowupIntent,
} from "../../lib/chat-intent-service.js";
import { resolveLlmCreds } from "./llm-creds.js";

/**
 * Look up LLM creds for the intent flow.
 *
 * Shared resolver covers session creds + env fallback (`VOLCENGINE_API_KEY`
 * etc.), so a user without `cc auth llm` configured but with an env var
 * exported still gets intent recognition. Pre-v5.0.3.45 this path
 * hardcoded `baseUrl` to `http://localhost:11434` when the session lacked
 * one — fatal for cloud providers when ollama wasn't running locally.
 */
function resolveLlmOptions(server, message) {
  return resolveLlmCreds(server, message);
}

/**
 * @param {*} server
 * @param {string} id
 * @param {*} ws
 * @param {*} message - { id, type, sessionId, userInput, contextMode? }
 */
export async function handleChatIntentUnderstand(server, id, ws, message) {
  try {
    const userInput = message.userInput || message.input || "";
    if (!userInput.trim()) {
      server._send(ws, {
        id,
        type: "error",
        code: "BAD_REQUEST",
        message: "userInput required",
      });
      return;
    }
    const llmOptions = resolveLlmOptions(server, message);
    // Cap the history payload server-side so a misbehaving client can't
    // blow out the context window.
    const history = Array.isArray(message.history)
      ? message.history.slice(-10)
      : undefined;
    const result = await understandIntent({
      userInput,
      contextMode: message.contextMode || "global",
      history,
      llmOptions,
    });
    server._send(ws, {
      id,
      type: "chat.intent.understand.response",
      ...result,
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "INTENT_UNDERSTAND_FAILED",
      message: err?.message || String(err),
    });
  }
}

/**
 * Streaming variant of understandIntent. Emits per-token chunks so the UI
 * can show a "理解中…" placeholder card immediately, then renders the full
 * confirmation card when the terminal `.result` frame lands. Frame shapes
 * follow the established `<topic>.chunk` / `<topic>.result` / `<topic>.error`
 * convention that web-panel `ws.sendStream` already understands.
 *
 * @param {*} server
 * @param {string} id
 * @param {*} ws
 * @param {*} message - { id, type, sessionId, userInput, contextMode?, history? }
 */
export async function handleChatIntentUnderstandStream(
  server,
  id,
  ws,
  message,
) {
  const topic = "chat.intent.understand-stream";
  try {
    const userInput = message.userInput || message.input || "";
    if (!userInput.trim()) {
      server._send(ws, {
        id,
        type: `${topic}.error`,
        code: "BAD_REQUEST",
        message: "userInput required",
      });
      return;
    }
    const llmOptions = resolveLlmOptions(server, message);
    const history = Array.isArray(message.history)
      ? message.history.slice(-10)
      : undefined;

    let final = null;
    for await (const event of understandIntentStream({
      userInput,
      contextMode: message.contextMode || "global",
      history,
      llmOptions,
    })) {
      if (event.type === "token") {
        server._send(ws, {
          id,
          type: `${topic}.chunk`,
          chunk: event.token,
        });
      } else if (event.type === "final") {
        final = event;
      }
    }
    server._send(ws, {
      id,
      type: `${topic}.result`,
      ok: final?.success !== false,
      result: final || {
        success: false,
        correctedInput: message.userInput,
        intent: "general",
        keyPoints: [],
        error: "no final frame",
      },
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: `${topic}.error`,
      code: "INTENT_UNDERSTAND_STREAM_FAILED",
      message: err?.message || String(err),
    });
  }
}

/**
 * @param {*} server
 * @param {string} id
 * @param {*} ws
 * @param {*} message - { id, type, sessionId, input, context? }
 */
export async function handleChatIntentClassifyFollowup(
  server,
  id,
  ws,
  message,
) {
  try {
    const input = message.input || "";
    const llmOptions = resolveLlmOptions(server, message);
    const result = await classifyFollowupIntent({
      input,
      context: message.context || {},
      llmOptions,
    });
    server._send(ws, {
      id,
      type: "chat.intent.classify-followup.response",
      ...result,
    });
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "INTENT_CLASSIFY_FAILED",
      message: err?.message || String(err),
    });
  }
}
