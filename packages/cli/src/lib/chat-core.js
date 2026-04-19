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
