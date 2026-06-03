/**
 * DeepSeek vendor adapter — Phase 10.2 wiring.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.1
 *   - login   https://chat.deepseek.com/
 *   - convs   GET /api/v0/chat_session/fetch_page?count=N&before=<cursor>
 *   - msgs    GET /api/v0/chat/history_messages?chat_session_id=<id>
 *   - cookies userToken / session cookie
 *
 * The vendor exposes three async surfaces:
 *
 *   validateCookie(ctx)        — HEAD on userinfo endpoint, classifies cookie state.
 *   listConversations(ctx, o)  — paginate via `before` cursor, yield RawConversation.
 *   listMessages(ctx, id, o)   — return chronological RawMessage[] for one conversation.
 *
 * Each surface receives `ctx.httpClient` (a configured HttpClient bound to
 * this vendor's rateLimits + cookie session). Tests pass a stub HttpClient
 * with deterministic responses; production wires the real one via
 * AIChatHistoryAdapter.
 *
 * Response shape notes (reverse-engineered, may shift — capture in fixtures
 * before changing wire parser):
 *
 *   /chat_session/fetch_page →
 *     { data: { biz_data: { chat_sessions: [{ id, title, model, inserted_at,
 *       updated_at, current_message_id, ... }] } } }
 *
 *   /chat/history_messages →
 *     { data: { biz_data: { chat_messages: [{ id, parent_id, role,
 *       message_content, content, inserted_at, model, thinking_enabled,
 *       files: [...] }] } } }
 */

"use strict";

const BASE = "https://chat.deepseek.com";
const CONV_PAGE_PATH = "/api/v0/chat_session/fetch_page";
const MSG_PATH = "/api/v0/chat/history_messages";
const USER_INFO_PATH = "/api/v0/user/get_user_info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error("deepseek: ctx.httpClient required (AIChatHistoryAdapter must wire one)");
  }
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, { session: ctx.session });
    if (data && data.code === 0 && data.data) {
      return { ok: true, userId: data.data.biz_data && data.data.biz_data.user_id };
    }
    return { ok: false, reason: "UNEXPECTED_RESPONSE_SHAPE" };
  } catch (err) {
    return { ok: false, reason: err.code || err.message };
  }
}

/**
 * Yield one RawConversation per remote chat session, newest first. Pagination
 * uses the `before` cursor returned by deepseek (the inserted_at of the last
 * returned session). Stop when `chat_sessions` is empty OR we hit
 * opts.since (timestamp watermark from prior sync).
 */
async function *listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const limit = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
  const sinceTs = opts.since && opts.since.lastUpdatedAt ? Number(opts.since.lastUpdatedAt) : 0;
  let cursor = null;

  while (true) {
    const url = new URL(BASE + CONV_PAGE_PATH);
    url.searchParams.set("count", String(limit));
    if (cursor != null) url.searchParams.set("before", String(cursor));

    const data = await client.getJson(url.toString(), { session: ctx.session });
    const sessions = data && data.data && data.data.biz_data && data.data.biz_data.chat_sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) return;

    let stopped = false;
    for (const s of sessions) {
      const updatedAt = _toMs(s.updated_at || s.inserted_at);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "deepseek",
        originalId: String(s.id),
        title: s.title || undefined,
        modelName: s.model || undefined,
        createdAt: _toMs(s.inserted_at),
        updatedAt,
        messageCount: s.message_count || undefined,
        archived: false,
        extra: {
          currentMessageId: s.current_message_id,
        },
      };
    }
    if (stopped) return;
    // Advance cursor — `before` expects the oldest timestamp from this page.
    const last = sessions[sessions.length - 1];
    cursor = last.inserted_at || last.updated_at;
    if (!cursor) return;
  }
}

/**
 * Yield each message in a conversation. DeepSeek already returns messages in
 * chronological order — we re-yield them as-is.
 */
async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const url = new URL(BASE + MSG_PATH);
  url.searchParams.set("chat_session_id", String(conversationId));

  const data = await client.getJson(url.toString(), { session: ctx.session });
  const msgs = data && data.data && data.data.biz_data && data.data.biz_data.chat_messages;
  if (!Array.isArray(msgs)) return;

  for (const m of msgs) {
    yield {
      vendor: "deepseek",
      originalId: String(m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.role),
      content: _buildContent(m),
      createdAt: _toMs(m.inserted_at),
      parentMessageId: m.parent_id ? String(m.parent_id) : undefined,
      modelName: m.model || undefined,
      extra: {
        thinking: m.thinking_content || undefined,
        thinkingEnabled: Boolean(m.thinking_enabled),
      },
    };
  }
}

function _normalizeRole(r) {
  if (r === "USER" || r === "user") return "user";
  if (r === "ASSISTANT" || r === "assistant") return "assistant";
  if (r === "SYSTEM" || r === "system") return "system";
  if (r === "TOOL" || r === "tool") return "tool";
  return r || "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || m.message_content || "" };
  if (Array.isArray(m.files) && m.files.length > 0) {
    content.attachments = m.files
      .map((f) => ({
        type: f.kind === "image" ? "image" : "file",
        filename: f.name || f.file_name,
        url: f.url || f.download_url,
        size: f.size,
        mimeType: f.mime_type,
      }))
      .filter((a) => a.url || a.filename);
  }
  return content;
}

function _toMs(t) {
  if (typeof t === "number") {
    // deepseek uses seconds since epoch on this endpoint.
    return t > 1e12 ? t : t * 1000;
  }
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(t);
    return Number.isFinite(d) ? d : 0;
  }
  return 0;
}

const SPEC = {
  name: "deepseek",
  displayName: "DeepSeek",
  androidPackage: "com.deepseek.chat",
  loginUrl: "https://chat.deepseek.com/",
  cookieDomains: ["chat.deepseek.com", ".deepseek.com"],
  rateLimits: { perMinute: 30, minIntervalMs: 1500 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  // exported for tests
  _internal: { _toMs, _normalizeRole, _buildContent, BASE, CONV_PAGE_PATH, MSG_PATH },
};
