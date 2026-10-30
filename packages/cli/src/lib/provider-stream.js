import {
  hasFormalBudgetProviderScope,
  providerFetch,
} from "./formal-budget-provider-scope.js";
/**
 * Provider streaming adapters — shared by `cc stream` and the Hosted Session
 * API `stream.run` WS route. Each builder returns an AsyncIterable<string>
 * of token deltas suitable for piping through session-core StreamRouter.
 */

import { resolveProviderDefinition } from "./llm-providers.js";
import { normalizeOllamaBaseUrl } from "./ollama-base-url.js";
import { ollamaProviderFetch } from "./ollama-provider-fetch.js";
import {
  assertCustomProviderConnection,
  geminiGenerateContentUrl,
  geminiRequestBody,
  normalizeProviderBaseUrl,
  openAICompatibleBaseUrl,
} from "./provider-protocol.js";

async function* responseLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        buffer += decoder.decode();
        if (buffer) yield buffer;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        yield line;
      }
    }
  } finally {
    try {
      if (!ended) await reader.cancel();
    } catch {
      // Preserve the original parser/transport failure during cleanup.
    } finally {
      reader.releaseLock();
    }
  }
}

export async function* ollamaTokenStream({
  baseUrl,
  model,
  prompt,
  messages,
  signal,
  requireCompletion = false,
}) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const res = await ollamaProviderFetch(
    `${normalizedBaseUrl}/api/${messages ? "chat" : "generate"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        messages
          ? { model, messages, stream: true }
          : { model, prompt, stream: true },
      ),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Ollama ${res.status} ${res.statusText}`);
  }
  for await (const raw of responseLines(res.body)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (requireCompletion && obj.error)
        throw new Error("Ollama stream returned an error");
      const delta = messages ? obj.message?.content : obj.response;
      if (delta) yield delta;
      if (obj.done) return;
    } catch (error) {
      if (requireCompletion) throw error;
      /* skip malformed */
    }
  }
  if (requireCompletion)
    throw new Error("Ollama stream ended before its completion marker");
}

export async function* openAIStream({
  baseUrl,
  apiKey,
  model,
  prompt,
  messages,
  signal,
  requireCompletion = false,
}) {
  const governed = hasFormalBudgetProviderScope();
  const res = await providerFetch(
    `${normalizeProviderBaseUrl(baseUrl)}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: messages ?? [{ role: "user", content: prompt }],
        stream: true,
        ...(governed ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  let completed = false;
  for await (const raw of responseLines(res.body)) {
    const line = raw.trim();
    if (!line || !line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      completed = true;
      if (!governed) return;
      // A governed stream must reach EOF so durable accounting can settle.
      continue;
    }
    try {
      const obj = JSON.parse(payload);
      if (requireCompletion && obj.error)
        throw new Error("OpenAI stream returned an error");
      const delta = obj?.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    } catch (error) {
      if (requireCompletion) throw error;
      /* skip */
    }
  }
  if (requireCompletion && !completed)
    throw new Error("OpenAI stream ended before its completion marker");
}

export async function* geminiTokenStream({
  baseUrl,
  apiKey,
  model,
  prompt,
  messages,
  signal,
  requireCompletion = false,
}) {
  const requestMessages = messages ?? [{ role: "user", content: prompt }];
  const res = await providerFetch(
    geminiGenerateContentUrl(baseUrl, model, { stream: true }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiRequestBody(requestMessages)),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Gemini ${res.status} ${res.statusText}`);
  }

  let completed = false;
  for await (const raw of responseLines(res.body)) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      if (requireCompletion && data.error)
        throw new Error("Gemini stream returned an error");
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason || data.promptFeedback?.blockReason)
        completed = true;
      for (const part of candidate?.content?.parts || []) {
        if (part?.thought !== true && typeof part?.text === "string")
          yield part.text;
      }
    } catch (error) {
      if (requireCompletion) throw error;
      /* skip malformed chunks when completion isn't enforced */
    }
  }
  if (requireCompletion && !completed)
    throw new Error("Gemini stream ended before its completion marker");
}

export async function* anthropicTokenStream({
  baseUrl,
  apiKey,
  model,
  prompt,
  messages,
  signal,
  requireCompletion = false,
}) {
  const requestMessages = messages ?? [{ role: "user", content: prompt }];
  const system = requestMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const turns = requestMessages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
  const res = await providerFetch(
    `${normalizeProviderBaseUrl(baseUrl)}/messages`,
    {
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
        messages: turns,
      }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Anthropic ${res.status} ${res.statusText}`);
  }

  let completed = false;
  for await (const raw of responseLines(res.body)) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const data = JSON.parse(payload);
      if (requireCompletion && (data.error || data.type === "error"))
        throw new Error("Anthropic stream returned an error");
      if (data.type === "message_stop") completed = true;
      if (
        data.type === "content_block_delta" &&
        typeof data.delta?.text === "string"
      )
        yield data.delta.text;
    } catch (error) {
      if (requireCompletion) throw error;
      /* skip malformed chunks when completion isn't enforced */
    }
  }
  if (requireCompletion && !completed)
    throw new Error("Anthropic stream ended before its completion marker");
}

/**
 * Build an AsyncIterable<string> token stream for the given provider.
 * Throws on unsupported provider / missing API key.
 */
export function buildProviderSource(provider, opts = {}) {
  assertCustomProviderConnection(provider, opts);
  const {
    model,
    baseUrl,
    apiKey,
    prompt,
    messages,
    signal,
    requireCompletion,
  } = opts;
  if (provider === "ollama") {
    return ollamaTokenStream({
      baseUrl: baseUrl || "http://localhost:11434",
      model: model || "qwen2:7b",
      prompt,
      messages,
      signal,
      requireCompletion,
    });
  }
  const def = resolveProviderDefinition(provider);
  if (!def) throw new Error(`Unsupported provider: ${provider}`);
  const finalKey =
    apiKey || (def.apiKeyEnv ? process.env[def.apiKeyEnv] : null);
  if (!finalKey && provider !== "custom") {
    throw new Error(
      `API key required for ${provider} (--api-key or ${def.apiKeyEnv})`,
    );
  }
  if (provider === "anthropic") {
    return anthropicTokenStream({
      baseUrl: baseUrl || def.baseUrl,
      apiKey: finalKey,
      model: model || def.models[0],
      prompt,
      messages,
      signal,
      requireCompletion,
    });
  }
  if (provider === "gemini") {
    return geminiTokenStream({
      baseUrl:
        baseUrl ||
        def.baseUrl ||
        "https://generativelanguage.googleapis.com/v1beta",
      apiKey: finalKey,
      model: model || def.models[0],
      prompt,
      messages,
      signal,
      requireCompletion,
    });
  }
  return openAIStream({
    baseUrl: openAICompatibleBaseUrl(
      provider,
      normalizeProviderBaseUrl(baseUrl || def.baseUrl),
    ),
    apiKey: finalKey,
    model: model || def.models[0],
    prompt,
    messages,
    signal,
    requireCompletion,
  });
}

// =====================================================================
// provider-stream V2 governance overlay (iter27)
// =====================================================================
export const PSTRMGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const PSTRMGOV_CHUNK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  STREAMING: "streaming",
  FLUSHED: "flushed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pstrmgovPTrans = new Map([
  [
    PSTRMGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE,
      PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PSTRMGOV_PROFILE_MATURITY_V2.STALE,
      PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PSTRMGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE,
      PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pstrmgovPTerminal = new Set([PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _pstrmgovJTrans = new Map([
  [
    PSTRMGOV_CHUNK_LIFECYCLE_V2.QUEUED,
    new Set([
      PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING,
      PSTRMGOV_CHUNK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING,
    new Set([
      PSTRMGOV_CHUNK_LIFECYCLE_V2.FLUSHED,
      PSTRMGOV_CHUNK_LIFECYCLE_V2.FAILED,
      PSTRMGOV_CHUNK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PSTRMGOV_CHUNK_LIFECYCLE_V2.FLUSHED, new Set()],
  [PSTRMGOV_CHUNK_LIFECYCLE_V2.FAILED, new Set()],
  [PSTRMGOV_CHUNK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pstrmgovPsV2 = new Map();
const _pstrmgovJsV2 = new Map();
let _pstrmgovMaxActive = 8,
  _pstrmgovMaxPending = 25,
  _pstrmgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _pstrmgovStuckMs = 60 * 1000;
function _pstrmgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pstrmgovCheckP(from, to) {
  const a = _pstrmgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pstrmgov profile transition ${from} → ${to}`);
}
function _pstrmgovCheckJ(from, to) {
  const a = _pstrmgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pstrmgov chunk transition ${from} → ${to}`);
}
function _pstrmgovCountActive(owner) {
  let c = 0;
  for (const p of _pstrmgovPsV2.values())
    if (p.owner === owner && p.status === PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _pstrmgovCountPending(profileId) {
  let c = 0;
  for (const j of _pstrmgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PSTRMGOV_CHUNK_LIFECYCLE_V2.QUEUED ||
        j.status === PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING)
    )
      c++;
  return c;
}
export function setMaxActivePstrmgovProfilesPerOwnerV2(n) {
  _pstrmgovMaxActive = _pstrmgovPos(n, "maxActivePstrmgovProfilesPerOwner");
}
export function getMaxActivePstrmgovProfilesPerOwnerV2() {
  return _pstrmgovMaxActive;
}
export function setMaxPendingPstrmgovChunksPerProfileV2(n) {
  _pstrmgovMaxPending = _pstrmgovPos(n, "maxPendingPstrmgovChunksPerProfile");
}
export function getMaxPendingPstrmgovChunksPerProfileV2() {
  return _pstrmgovMaxPending;
}
export function setPstrmgovProfileIdleMsV2(n) {
  _pstrmgovIdleMs = _pstrmgovPos(n, "pstrmgovProfileIdleMs");
}
export function getPstrmgovProfileIdleMsV2() {
  return _pstrmgovIdleMs;
}
export function setPstrmgovChunkStuckMsV2(n) {
  _pstrmgovStuckMs = _pstrmgovPos(n, "pstrmgovChunkStuckMs");
}
export function getPstrmgovChunkStuckMsV2() {
  return _pstrmgovStuckMs;
}
export function _resetStateProviderStreamGovV2() {
  _pstrmgovPsV2.clear();
  _pstrmgovJsV2.clear();
  _pstrmgovMaxActive = 8;
  _pstrmgovMaxPending = 25;
  _pstrmgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _pstrmgovStuckMs = 60 * 1000;
}
export function registerPstrmgovProfileV2({
  id,
  owner,
  provider,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pstrmgovPsV2.has(id))
    throw new Error(`pstrmgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    provider: provider || "default",
    status: PSTRMGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pstrmgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePstrmgovProfileV2(id) {
  const p = _pstrmgovPsV2.get(id);
  if (!p) throw new Error(`pstrmgov profile ${id} not found`);
  const isInitial = p.status === PSTRMGOV_PROFILE_MATURITY_V2.PENDING;
  _pstrmgovCheckP(p.status, PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pstrmgovCountActive(p.owner) >= _pstrmgovMaxActive)
    throw new Error(
      `max active pstrmgov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePstrmgovProfileV2(id) {
  const p = _pstrmgovPsV2.get(id);
  if (!p) throw new Error(`pstrmgov profile ${id} not found`);
  _pstrmgovCheckP(p.status, PSTRMGOV_PROFILE_MATURITY_V2.STALE);
  p.status = PSTRMGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePstrmgovProfileV2(id) {
  const p = _pstrmgovPsV2.get(id);
  if (!p) throw new Error(`pstrmgov profile ${id} not found`);
  _pstrmgovCheckP(p.status, PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PSTRMGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPstrmgovProfileV2(id) {
  const p = _pstrmgovPsV2.get(id);
  if (!p) throw new Error(`pstrmgov profile ${id} not found`);
  if (_pstrmgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pstrmgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPstrmgovProfileV2(id) {
  const p = _pstrmgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPstrmgovProfilesV2() {
  return [..._pstrmgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPstrmgovChunkV2({
  id,
  profileId,
  tokenId,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pstrmgovJsV2.has(id))
    throw new Error(`pstrmgov chunk ${id} already exists`);
  if (!_pstrmgovPsV2.has(profileId))
    throw new Error(`pstrmgov profile ${profileId} not found`);
  if (_pstrmgovCountPending(profileId) >= _pstrmgovMaxPending)
    throw new Error(
      `max pending pstrmgov chunks for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    tokenId: tokenId || "",
    status: PSTRMGOV_CHUNK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pstrmgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function streamingPstrmgovChunkV2(id) {
  const j = _pstrmgovJsV2.get(id);
  if (!j) throw new Error(`pstrmgov chunk ${id} not found`);
  _pstrmgovCheckJ(j.status, PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING);
  const now = Date.now();
  j.status = PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeChunkPstrmgovV2(id) {
  const j = _pstrmgovJsV2.get(id);
  if (!j) throw new Error(`pstrmgov chunk ${id} not found`);
  _pstrmgovCheckJ(j.status, PSTRMGOV_CHUNK_LIFECYCLE_V2.FLUSHED);
  const now = Date.now();
  j.status = PSTRMGOV_CHUNK_LIFECYCLE_V2.FLUSHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPstrmgovChunkV2(id, reason) {
  const j = _pstrmgovJsV2.get(id);
  if (!j) throw new Error(`pstrmgov chunk ${id} not found`);
  _pstrmgovCheckJ(j.status, PSTRMGOV_CHUNK_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PSTRMGOV_CHUNK_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPstrmgovChunkV2(id, reason) {
  const j = _pstrmgovJsV2.get(id);
  if (!j) throw new Error(`pstrmgov chunk ${id} not found`);
  _pstrmgovCheckJ(j.status, PSTRMGOV_CHUNK_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PSTRMGOV_CHUNK_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPstrmgovChunkV2(id) {
  const j = _pstrmgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPstrmgovChunksV2() {
  return [..._pstrmgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdlePstrmgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pstrmgovPsV2.values())
    if (
      p.status === PSTRMGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pstrmgovIdleMs
    ) {
      p.status = PSTRMGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPstrmgovChunksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _pstrmgovJsV2.values())
    if (
      j.status === PSTRMGOV_CHUNK_LIFECYCLE_V2.STREAMING &&
      j.startedAt != null &&
      t - j.startedAt >= _pstrmgovStuckMs
    ) {
      j.status = PSTRMGOV_CHUNK_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getProviderStreamGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PSTRMGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pstrmgovPsV2.values()) profilesByStatus[p.status]++;
  const chunksByStatus = {};
  for (const v of Object.values(PSTRMGOV_CHUNK_LIFECYCLE_V2))
    chunksByStatus[v] = 0;
  for (const j of _pstrmgovJsV2.values()) chunksByStatus[j.status]++;
  return {
    totalPstrmgovProfilesV2: _pstrmgovPsV2.size,
    totalPstrmgovChunksV2: _pstrmgovJsV2.size,
    maxActivePstrmgovProfilesPerOwner: _pstrmgovMaxActive,
    maxPendingPstrmgovChunksPerProfile: _pstrmgovMaxPending,
    pstrmgovProfileIdleMs: _pstrmgovIdleMs,
    pstrmgovChunkStuckMs: _pstrmgovStuckMs,
    profilesByStatus,
    chunksByStatus,
  };
}
