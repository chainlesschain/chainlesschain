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
import {
  isRetryableStreamError,
  STREAM_RETRY_MAX,
  STREAM_RETRY_BASE_MS,
} from "./stream-retry.js";

// A streaming chat call must not hang forever if the API accepts the connection
// but then goes silent (TCP up, no bytes). Abort the request if no data arrives
// for STREAM_STALL_MS — reset on every chunk, so it's a stall detector, not a
// total-time cap (long but healthy responses are unaffected). The default is
// generous (and env-overridable) so a slow local model's first token isn't cut
// off; raise CC_CHAT_STALL_MS if you run very large local models.
export const STREAM_STALL_MS = Number(process.env.CC_CHAT_STALL_MS) || 180000;

function makeStallGuard(stallMs = STREAM_STALL_MS) {
  const controller = new AbortController();
  let timer = null;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), stallMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    signal: controller.signal,
    bump,
    stop,
    stalled: () => controller.signal.aborted,
  };
}

// OpenAI-compatible cached-prompt-token count (mirrors agent-core's
// _openaiCachedTokens). OpenAI/volcengine report it as
// usage.prompt_tokens_details.cached_tokens; DeepSeek as
// usage.prompt_cache_hit_tokens. prompt_tokens INCLUDES the cached count, so
// callers subtract it to recover uncached input (avoids over-pricing in
// `cc cost` for cc chat sessions).
function _cachedPromptTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const detailed = Number(usage.prompt_tokens_details?.cached_tokens);
  if (Number.isFinite(detailed) && detailed > 0) return detailed;
  const deepseek = Number(usage.prompt_cache_hit_tokens);
  if (Number.isFinite(deepseek) && deepseek > 0) return deepseek;
  return 0;
}

/**
 * Stream a response from Ollama.
 * If `onUsage` is provided, it's called with `{inputTokens, outputTokens}`
 * derived from Ollama's terminal `prompt_eval_count` / `eval_count` fields.
 */
export async function streamOllama(messages, model, baseUrl, onToken, onUsage) {
  const guard = makeStallGuard();
  guard.bump();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: guard.signal,
    });
  } catch (e) {
    guard.stop();
    throw guard.stalled()
      ? new Error(
          `Ollama request stalled (no response in ${STREAM_STALL_MS / 1000}s)`,
        )
      : e;
  }

  if (!response.ok) {
    guard.stop();
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.bump();

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
  } catch (e) {
    throw guard.stalled()
      ? new Error(
          `Ollama stream stalled (no data in ${STREAM_STALL_MS / 1000}s)`,
        )
      : e;
  } finally {
    guard.stop();
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
  const guard = makeStallGuard();
  guard.bump();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
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
      signal: guard.signal,
    });
  } catch (e) {
    guard.stop();
    throw guard.stalled()
      ? new Error(
          `API request stalled (no response in ${STREAM_STALL_MS / 1000}s)`,
        )
      : e;
  }

  if (!response.ok) {
    guard.stop();
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.bump();

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
              // Split cached prompt tokens out of prompt_tokens so cc cost
              // prices the cached prefix correctly (matches agent-core).
              const cacheReadTokens = _cachedPromptTokens(json.usage);
              const prompt = Number(json.usage.prompt_tokens) || 0;
              const inputTokens = Math.max(0, prompt - cacheReadTokens);
              const outputTokens = Number(json.usage.completion_tokens) || 0;
              if (inputTokens || outputTokens || cacheReadTokens) {
                onUsage({ inputTokens, outputTokens, cacheReadTokens });
              }
            }
          } catch {
            // Partial data
          }
        }
      }
    }
  } catch (e) {
    throw guard.stalled()
      ? new Error(`API stream stalled (no data in ${STREAM_STALL_MS / 1000}s)`)
      : e;
  } finally {
    guard.stop();
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

  const guard = makeStallGuard();
  guard.bump();
  let response;
  try {
    response = await fetch(`${baseUrl}/messages`, {
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
      signal: guard.signal,
    });
  } catch (e) {
    guard.stop();
    throw guard.stalled()
      ? new Error(
          `Anthropic request stalled (no response in ${STREAM_STALL_MS / 1000}s)`,
        )
      : e;
  }

  if (!response.ok) {
    guard.stop();
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
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      guard.bump();
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
            const u = obj.message?.usage || {};
            inputTokens = Number(u.input_tokens) || inputTokens;
            outputTokens = Number(u.output_tokens) || outputTokens;
            cacheReadTokens =
              Number(u.cache_read_input_tokens) || cacheReadTokens;
            cacheCreationTokens =
              Number(u.cache_creation_input_tokens) || cacheCreationTokens;
          } else if (obj.type === "message_delta") {
            outputTokens = Number(obj.usage?.output_tokens) || outputTokens;
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  } catch (e) {
    throw guard.stalled()
      ? new Error(
          `Anthropic stream stalled (no data in ${STREAM_STALL_MS / 1000}s)`,
        )
      : e;
  } finally {
    guard.stop();
  }

  if (
    onUsage &&
    (inputTokens || outputTokens || cacheReadTokens || cacheCreationTokens)
  ) {
    onUsage({
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    });
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

  // Token queue + waiter promise. onToken (called synchronously by each
  // streamX impl per delta) pushes onto the queue and wakes the generator
  // loop, which yields immediately. Pre-v5.0.3.46 this was a buffering
  // tokens[] array drained only after `await streamX(...)` resolved — so
  // the "stream" surfaced no progress until the LLM call finished, which
  // showed up as the chat.intent placeholder card spinning at "意图: 未识别"
  // for the full LLM duration.
  const queue = [];
  let waiter = null;
  let done = false;
  let capturedUsage = null;

  const wake = () => {
    if (!waiter) return;
    const w = waiter;
    waiter = null;
    w();
  };
  // Count of tokens the provider has actually emitted this turn. A connection
  // drop is only safe to retry while this is 0 — once any token has been
  // streamed, re-issuing would duplicate visible output.
  let tokensEmitted = 0;
  const onToken = (token) => {
    tokensEmitted++;
    queue.push(token);
    wake();
  };
  const onUsage = (u) => {
    capturedUsage = u;
  };

  // Validate creds + assemble URL synchronously so missing-key errors
  // surface immediately to the consumer instead of being deferred until
  // the first queue drain tick.
  let providerCall;
  if (provider === "ollama") {
    providerCall = () =>
      streamOllama(messages, model, baseUrl, onToken, onUsage);
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
    providerCall = () =>
      streamAnthropic(messages, model, url, key, onToken, onUsage);
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
    providerCall = () =>
      streamOpenAI(messages, model, url, key, onToken, onUsage);
  }

  // Run the provider stream concurrently with the queue-drain loop. finally
  // flips `done` and wakes the waiter so a stream that ends without emitting
  // any token still terminates the generator cleanly.
  const streamPromise = (async () => {
    try {
      let attempt = 0;
      for (;;) {
        try {
          return await providerCall();
        } catch (err) {
          // Retry ONLY a transient connection drop that hit before any token
          // reached the user (tokensEmitted === 0) — otherwise the re-issue
          // would duplicate the visible answer. Mirrors agent-core's
          // zero-output retry safety (cc agent parity). Stall aborts (180s) and
          // HTTP/auth errors are not retryable and surface immediately.
          if (
            attempt >= STREAM_RETRY_MAX ||
            tokensEmitted > 0 ||
            !isRetryableStreamError(err)
          ) {
            throw err;
          }
          attempt++;
          if (typeof options.onStreamRetry === "function") {
            try {
              options.onStreamRetry(attempt, err);
            } catch {
              /* retry notice is best-effort */
            }
          }
          await new Promise((r) =>
            setTimeout(r, STREAM_RETRY_BASE_MS * 2 ** (attempt - 1)),
          );
        }
      }
    } finally {
      done = true;
      wake();
    }
  })();
  // Swallow-only handler so an early rejection isn't logged as unhandled
  // before the consumer reaches `await streamPromise` below. The eventual
  // await still rethrows.
  streamPromise.catch(() => {});

  while (true) {
    if (queue.length > 0) {
      yield { type: "response-token", token: queue.shift() };
      continue;
    }
    if (done) break;
    await new Promise((resolve) => {
      waiter = resolve;
    });
  }

  // Rethrows if providerCall rejected.
  const fullResponse = await streamPromise;

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
          cache_read_input_tokens: capturedUsage.cacheReadTokens || 0,
          cache_creation_input_tokens: capturedUsage.cacheCreationTokens || 0,
        },
      });
    } catch {
      // Best-effort — never break the stream because accounting failed.
    }
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

// =====================================================================
// chat-core V2 governance overlay (iter17)
// =====================================================================
export const CHATGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CHATGOV_MESSAGE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _chatgovPTrans = new Map([
  [
    CHATGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CHATGOV_PROFILE_MATURITY_V2.ACTIVE,
      CHATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CHATGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CHATGOV_PROFILE_MATURITY_V2.STALE,
      CHATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CHATGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CHATGOV_PROFILE_MATURITY_V2.ACTIVE,
      CHATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CHATGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _chatgovPTerminal = new Set([CHATGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _chatgovJTrans = new Map([
  [
    CHATGOV_MESSAGE_LIFECYCLE_V2.QUEUED,
    new Set([
      CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING,
      CHATGOV_MESSAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING,
    new Set([
      CHATGOV_MESSAGE_LIFECYCLE_V2.SENT,
      CHATGOV_MESSAGE_LIFECYCLE_V2.FAILED,
      CHATGOV_MESSAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CHATGOV_MESSAGE_LIFECYCLE_V2.SENT, new Set()],
  [CHATGOV_MESSAGE_LIFECYCLE_V2.FAILED, new Set()],
  [CHATGOV_MESSAGE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _chatgovPsV2 = new Map();
const _chatgovJsV2 = new Map();
let _chatgovMaxActive = 8,
  _chatgovMaxPending = 30,
  _chatgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _chatgovStuckMs = 60 * 1000;
function _chatgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _chatgovCheckP(from, to) {
  const a = _chatgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid chatgov profile transition ${from} → ${to}`);
}
function _chatgovCheckJ(from, to) {
  const a = _chatgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid chatgov message transition ${from} → ${to}`);
}
function _chatgovCountActive(owner) {
  let c = 0;
  for (const p of _chatgovPsV2.values())
    if (p.owner === owner && p.status === CHATGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _chatgovCountPending(profileId) {
  let c = 0;
  for (const j of _chatgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CHATGOV_MESSAGE_LIFECYCLE_V2.QUEUED ||
        j.status === CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING)
    )
      c++;
  return c;
}
export function setMaxActiveChatgovProfilesPerOwnerV2(n) {
  _chatgovMaxActive = _chatgovPos(n, "maxActiveChatgovProfilesPerOwner");
}
export function getMaxActiveChatgovProfilesPerOwnerV2() {
  return _chatgovMaxActive;
}
export function setMaxPendingChatgovMessagesPerProfileV2(n) {
  _chatgovMaxPending = _chatgovPos(n, "maxPendingChatgovMessagesPerProfile");
}
export function getMaxPendingChatgovMessagesPerProfileV2() {
  return _chatgovMaxPending;
}
export function setChatgovProfileIdleMsV2(n) {
  _chatgovIdleMs = _chatgovPos(n, "chatgovProfileIdleMs");
}
export function getChatgovProfileIdleMsV2() {
  return _chatgovIdleMs;
}
export function setChatgovMessageStuckMsV2(n) {
  _chatgovStuckMs = _chatgovPos(n, "chatgovMessageStuckMs");
}
export function getChatgovMessageStuckMsV2() {
  return _chatgovStuckMs;
}
export function _resetStateChatCoreV2() {
  _chatgovPsV2.clear();
  _chatgovJsV2.clear();
  _chatgovMaxActive = 8;
  _chatgovMaxPending = 30;
  _chatgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _chatgovStuckMs = 60 * 1000;
}
export function registerChatgovProfileV2({ id, owner, mode, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_chatgovPsV2.has(id))
    throw new Error(`chatgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    mode: mode || "interactive",
    status: CHATGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _chatgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateChatgovProfileV2(id) {
  const p = _chatgovPsV2.get(id);
  if (!p) throw new Error(`chatgov profile ${id} not found`);
  const isInitial = p.status === CHATGOV_PROFILE_MATURITY_V2.PENDING;
  _chatgovCheckP(p.status, CHATGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _chatgovCountActive(p.owner) >= _chatgovMaxActive)
    throw new Error(`max active chatgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CHATGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleChatgovProfileV2(id) {
  const p = _chatgovPsV2.get(id);
  if (!p) throw new Error(`chatgov profile ${id} not found`);
  _chatgovCheckP(p.status, CHATGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CHATGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveChatgovProfileV2(id) {
  const p = _chatgovPsV2.get(id);
  if (!p) throw new Error(`chatgov profile ${id} not found`);
  _chatgovCheckP(p.status, CHATGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CHATGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchChatgovProfileV2(id) {
  const p = _chatgovPsV2.get(id);
  if (!p) throw new Error(`chatgov profile ${id} not found`);
  if (_chatgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal chatgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getChatgovProfileV2(id) {
  const p = _chatgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listChatgovProfilesV2() {
  return [..._chatgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createChatgovMessageV2({ id, profileId, role, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_chatgovJsV2.has(id))
    throw new Error(`chatgov message ${id} already exists`);
  if (!_chatgovPsV2.has(profileId))
    throw new Error(`chatgov profile ${profileId} not found`);
  if (_chatgovCountPending(profileId) >= _chatgovMaxPending)
    throw new Error(
      `max pending chatgov messages for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    role: role || "",
    status: CHATGOV_MESSAGE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _chatgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function sendingChatgovMessageV2(id) {
  const j = _chatgovJsV2.get(id);
  if (!j) throw new Error(`chatgov message ${id} not found`);
  _chatgovCheckJ(j.status, CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING);
  const now = Date.now();
  j.status = CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeMessageChatgovV2(id) {
  const j = _chatgovJsV2.get(id);
  if (!j) throw new Error(`chatgov message ${id} not found`);
  _chatgovCheckJ(j.status, CHATGOV_MESSAGE_LIFECYCLE_V2.SENT);
  const now = Date.now();
  j.status = CHATGOV_MESSAGE_LIFECYCLE_V2.SENT;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failChatgovMessageV2(id, reason) {
  const j = _chatgovJsV2.get(id);
  if (!j) throw new Error(`chatgov message ${id} not found`);
  _chatgovCheckJ(j.status, CHATGOV_MESSAGE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CHATGOV_MESSAGE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelChatgovMessageV2(id, reason) {
  const j = _chatgovJsV2.get(id);
  if (!j) throw new Error(`chatgov message ${id} not found`);
  _chatgovCheckJ(j.status, CHATGOV_MESSAGE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CHATGOV_MESSAGE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getChatgovMessageV2(id) {
  const j = _chatgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listChatgovMessagesV2() {
  return [..._chatgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleChatgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _chatgovPsV2.values())
    if (
      p.status === CHATGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _chatgovIdleMs
    ) {
      p.status = CHATGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckChatgovMessagesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _chatgovJsV2.values())
    if (
      j.status === CHATGOV_MESSAGE_LIFECYCLE_V2.SENDING &&
      j.startedAt != null &&
      t - j.startedAt >= _chatgovStuckMs
    ) {
      j.status = CHATGOV_MESSAGE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getChatCoreGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CHATGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _chatgovPsV2.values()) profilesByStatus[p.status]++;
  const messagesByStatus = {};
  for (const v of Object.values(CHATGOV_MESSAGE_LIFECYCLE_V2))
    messagesByStatus[v] = 0;
  for (const j of _chatgovJsV2.values()) messagesByStatus[j.status]++;
  return {
    totalChatgovProfilesV2: _chatgovPsV2.size,
    totalChatgovMessagesV2: _chatgovJsV2.size,
    maxActiveChatgovProfilesPerOwner: _chatgovMaxActive,
    maxPendingChatgovMessagesPerProfile: _chatgovMaxPending,
    chatgovProfileIdleMs: _chatgovIdleMs,
    chatgovMessageStuckMs: _chatgovStuckMs,
    profilesByStatus,
    messagesByStatus,
  };
}

// === Iter28 V2 governance overlay: Ccoregov ===
export const CCOREGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  IDLE: "idle",
  ARCHIVED: "archived",
});
export const CCOREGOV_MSG_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ccoregovPTrans = new Map([
  [
    CCOREGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CCOREGOV_PROFILE_MATURITY_V2.ACTIVE,
      CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCOREGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CCOREGOV_PROFILE_MATURITY_V2.IDLE,
      CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCOREGOV_PROFILE_MATURITY_V2.IDLE,
    new Set([
      CCOREGOV_PROFILE_MATURITY_V2.ACTIVE,
      CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ccoregovPTerminal = new Set([CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ccoregovJTrans = new Map([
  [
    CCOREGOV_MSG_LIFECYCLE_V2.QUEUED,
    new Set([
      CCOREGOV_MSG_LIFECYCLE_V2.SENDING,
      CCOREGOV_MSG_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CCOREGOV_MSG_LIFECYCLE_V2.SENDING,
    new Set([
      CCOREGOV_MSG_LIFECYCLE_V2.SENT,
      CCOREGOV_MSG_LIFECYCLE_V2.FAILED,
      CCOREGOV_MSG_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CCOREGOV_MSG_LIFECYCLE_V2.SENT, new Set()],
  [CCOREGOV_MSG_LIFECYCLE_V2.FAILED, new Set()],
  [CCOREGOV_MSG_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ccoregovPsV2 = new Map();
const _ccoregovJsV2 = new Map();
let _ccoregovMaxActive = 10,
  _ccoregovMaxPending = 25,
  _ccoregovIdleMs = 2592000000,
  _ccoregovStuckMs = 60 * 1000;
function _ccoregovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ccoregovCheckP(from, to) {
  const a = _ccoregovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccoregov profile transition ${from} → ${to}`);
}
function _ccoregovCheckJ(from, to) {
  const a = _ccoregovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccoregov msg transition ${from} → ${to}`);
}
function _ccoregovCountActive(owner) {
  let c = 0;
  for (const p of _ccoregovPsV2.values())
    if (p.owner === owner && p.status === CCOREGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _ccoregovCountPending(profileId) {
  let c = 0;
  for (const j of _ccoregovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CCOREGOV_MSG_LIFECYCLE_V2.QUEUED ||
        j.status === CCOREGOV_MSG_LIFECYCLE_V2.SENDING)
    )
      c++;
  return c;
}
export function setMaxActiveCcoreProfilesPerOwnerV2(n) {
  _ccoregovMaxActive = _ccoregovPos(n, "maxActiveCcoreProfilesPerOwner");
}
export function getMaxActiveCcoreProfilesPerOwnerV2() {
  return _ccoregovMaxActive;
}
export function setMaxPendingCcoreMsgsPerProfileV2(n) {
  _ccoregovMaxPending = _ccoregovPos(n, "maxPendingCcoreMsgsPerProfile");
}
export function getMaxPendingCcoreMsgsPerProfileV2() {
  return _ccoregovMaxPending;
}
export function setCcoreProfileIdleMsV2(n) {
  _ccoregovIdleMs = _ccoregovPos(n, "ccoregovProfileIdleMs");
}
export function getCcoreProfileIdleMsV2() {
  return _ccoregovIdleMs;
}
export function setCcoreMsgStuckMsV2(n) {
  _ccoregovStuckMs = _ccoregovPos(n, "ccoregovMsgStuckMs");
}
export function getCcoreMsgStuckMsV2() {
  return _ccoregovStuckMs;
}
export function _resetStateCcoregovV2() {
  _ccoregovPsV2.clear();
  _ccoregovJsV2.clear();
  _ccoregovMaxActive = 10;
  _ccoregovMaxPending = 25;
  _ccoregovIdleMs = 2592000000;
  _ccoregovStuckMs = 60 * 1000;
}
export function registerCcoreProfileV2({ id, owner, channel, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ccoregovPsV2.has(id))
    throw new Error(`ccoregov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    channel: channel || "default",
    status: CCOREGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccoregovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCcoreProfileV2(id) {
  const p = _ccoregovPsV2.get(id);
  if (!p) throw new Error(`ccoregov profile ${id} not found`);
  const isInitial = p.status === CCOREGOV_PROFILE_MATURITY_V2.PENDING;
  _ccoregovCheckP(p.status, CCOREGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ccoregovCountActive(p.owner) >= _ccoregovMaxActive)
    throw new Error(
      `max active ccoregov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = CCOREGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function idleCcoreProfileV2(id) {
  const p = _ccoregovPsV2.get(id);
  if (!p) throw new Error(`ccoregov profile ${id} not found`);
  _ccoregovCheckP(p.status, CCOREGOV_PROFILE_MATURITY_V2.IDLE);
  p.status = CCOREGOV_PROFILE_MATURITY_V2.IDLE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCcoreProfileV2(id) {
  const p = _ccoregovPsV2.get(id);
  if (!p) throw new Error(`ccoregov profile ${id} not found`);
  _ccoregovCheckP(p.status, CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CCOREGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCcoreProfileV2(id) {
  const p = _ccoregovPsV2.get(id);
  if (!p) throw new Error(`ccoregov profile ${id} not found`);
  if (_ccoregovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ccoregov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCcoreProfileV2(id) {
  const p = _ccoregovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCcoreProfilesV2() {
  return [..._ccoregovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCcoreMsgV2({ id, profileId, messageId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ccoregovJsV2.has(id))
    throw new Error(`ccoregov msg ${id} already exists`);
  if (!_ccoregovPsV2.has(profileId))
    throw new Error(`ccoregov profile ${profileId} not found`);
  if (_ccoregovCountPending(profileId) >= _ccoregovMaxPending)
    throw new Error(
      `max pending ccoregov msgs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    messageId: messageId || "",
    status: CCOREGOV_MSG_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccoregovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function sendingCcoreMsgV2(id) {
  const j = _ccoregovJsV2.get(id);
  if (!j) throw new Error(`ccoregov msg ${id} not found`);
  _ccoregovCheckJ(j.status, CCOREGOV_MSG_LIFECYCLE_V2.SENDING);
  const now = Date.now();
  j.status = CCOREGOV_MSG_LIFECYCLE_V2.SENDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeMsgCcoreV2(id) {
  const j = _ccoregovJsV2.get(id);
  if (!j) throw new Error(`ccoregov msg ${id} not found`);
  _ccoregovCheckJ(j.status, CCOREGOV_MSG_LIFECYCLE_V2.SENT);
  const now = Date.now();
  j.status = CCOREGOV_MSG_LIFECYCLE_V2.SENT;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCcoreMsgV2(id, reason) {
  const j = _ccoregovJsV2.get(id);
  if (!j) throw new Error(`ccoregov msg ${id} not found`);
  _ccoregovCheckJ(j.status, CCOREGOV_MSG_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CCOREGOV_MSG_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCcoreMsgV2(id, reason) {
  const j = _ccoregovJsV2.get(id);
  if (!j) throw new Error(`ccoregov msg ${id} not found`);
  _ccoregovCheckJ(j.status, CCOREGOV_MSG_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CCOREGOV_MSG_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCcoreMsgV2(id) {
  const j = _ccoregovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCcoreMsgsV2() {
  return [..._ccoregovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoIdleIdleCcoreProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ccoregovPsV2.values())
    if (
      p.status === CCOREGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ccoregovIdleMs
    ) {
      p.status = CCOREGOV_PROFILE_MATURITY_V2.IDLE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCcoreMsgsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ccoregovJsV2.values())
    if (
      j.status === CCOREGOV_MSG_LIFECYCLE_V2.SENDING &&
      j.startedAt != null &&
      t - j.startedAt >= _ccoregovStuckMs
    ) {
      j.status = CCOREGOV_MSG_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCcoregovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CCOREGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ccoregovPsV2.values()) profilesByStatus[p.status]++;
  const msgsByStatus = {};
  for (const v of Object.values(CCOREGOV_MSG_LIFECYCLE_V2)) msgsByStatus[v] = 0;
  for (const j of _ccoregovJsV2.values()) msgsByStatus[j.status]++;
  return {
    totalCcoreProfilesV2: _ccoregovPsV2.size,
    totalCcoreMsgsV2: _ccoregovJsV2.size,
    maxActiveCcoreProfilesPerOwner: _ccoregovMaxActive,
    maxPendingCcoreMsgsPerProfile: _ccoregovMaxPending,
    ccoregovProfileIdleMs: _ccoregovIdleMs,
    ccoregovMsgStuckMs: _ccoregovStuckMs,
    profilesByStatus,
    msgsByStatus,
  };
}
