/**
 * Doubao / 豆包 (ByteDance text AI) vendor adapter.
 *
 * Doubao is ByteDance's flagship text AI assistant — sibling to Dreamina
 * (image/video) but on a separate domain and surface. Treated as the 9th
 * AIChatHistory vendor.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.9 (added 2026-05-20).
 *
 *   - login        https://www.doubao.com/chat/
 *   - convs        POST /samantha/conversation/list
 *                  body: { cursor: "<opaque>", count: N }
 *                  response: { data: { conversation_list: [...], cursor, has_more } }
 *   - msgs         POST /samantha/conversation/<id>/message/list
 *                  body: { conversation_id, cursor, count }
 *                  response: { data: { message_list: [...], cursor, has_more } }
 *   - user info    POST /samantha/user/info
 *
 * The implementation validates cookies and paginates conversations/messages.
 * Response extraction is defensive because this private web API can drift;
 * real-account HAR fixtures are still required for version-by-version sign-off.
 */

"use strict";

const BASE = "https://www.doubao.com";
const CONV_LIST_PATH = "/samantha/conversation/list";
const MSG_LIST_PATH = (id) =>
  `/samantha/conversation/${encodeURIComponent(id)}/message/list`;
const USER_INFO_PATH = "/samantha/user/info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error("doubao: ctx.httpClient required (AIChatHistoryAdapter must wire one)");
  }
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.postJson(
      BASE + USER_INFO_PATH,
      {},
      { session: ctx.session },
    );
    if (data && (data.code === 0 || data.code === "0") && data.data) {
      return { ok: true, userId: data.data.user_id || data.data.uid };
    }
    return { ok: false, reason: "UNEXPECTED_RESPONSE_SHAPE" };
  } catch (err) {
    return { ok: false, reason: err.code || err.message };
  }
}

/**
 * Yield one RawConversation per remote chat session, newest first.
 * Pagination uses an opaque `cursor` returned by the previous page plus
 * `has_more` boolean (Doubao does not use offset / page numbers).
 */
async function *listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const limit = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
  const sinceTs =
    opts.since && opts.since.lastUpdatedAt ? Number(opts.since.lastUpdatedAt) : 0;

  let cursor = "";
  let safety = 0;
  while (true) {
    safety++;
    if (safety > 200) return; // hard cap

    const body = { count: limit };
    if (cursor) body.cursor = cursor;

    const data = await client.postJson(BASE + CONV_LIST_PATH, body, {
      session: ctx.session,
    });
    const list = _extractConvList(data);
    if (list.length === 0) return;

    let stopped = false;
    for (const c of list) {
      const updatedAt = _toMs(c.last_message_time || c.update_time || c.create_time);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "doubao",
        originalId: String(c.conversation_id || c.id),
        title: c.name || c.title || undefined,
        modelName: c.bot_name || c.model || undefined,
        createdAt: _toMs(c.create_time),
        updatedAt,
        messageCount: c.message_count || undefined,
        archived: Boolean(c.archived || c.deleted),
        extra: { botId: c.bot_id, botName: c.bot_name },
      };
    }
    if (stopped) return;

    const meta = (data && data.data) || {};
    const hasMore = meta.has_more === true || meta.hasMore === true;
    const nextCursor = meta.cursor || meta.next_cursor || "";
    if (!hasMore || !nextCursor) return;
    cursor = nextCursor;
  }
}

/**
 * Yield each message in a conversation in chronological order.
 * Doubao paginates messages too — historical conversations can have
 * thousands of turns.
 */
async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  let cursor = "";
  let safety = 0;
  const collected = [];

  while (true) {
    safety++;
    if (safety > 200) break;

    const body = { conversation_id: String(conversationId), count: 100 };
    if (cursor) body.cursor = cursor;

    const data = await client.postJson(BASE + MSG_LIST_PATH(conversationId), body, {
      session: ctx.session,
    });
    const list = _extractMsgList(data);
    if (list.length === 0) break;

    for (const m of list) collected.push(m);

    const meta = (data && data.data) || {};
    const hasMore = meta.has_more === true || meta.hasMore === true;
    const nextCursor = meta.cursor || meta.next_cursor || "";
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }

  // Newest-first → reverse to chronological
  collected.sort((a, b) => _toMs(a.create_time) - _toMs(b.create_time));

  for (const m of collected) {
    yield {
      vendor: "doubao",
      originalId: String(m.id || m.message_id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.sender_type || m.role),
      content: _buildContent(m),
      createdAt: _toMs(m.create_time),
      parentMessageId: m.parent_id ? String(m.parent_id) : undefined,
      modelName: m.model || undefined,
      extra: {
        botId: m.bot_id,
        thinking: m.thinking || undefined,
      },
    };
  }
}

function _extractConvList(data) {
  if (!data || !data.data) return [];
  if (Array.isArray(data.data.conversation_list)) return data.data.conversation_list;
  if (Array.isArray(data.data.conversations)) return data.data.conversations;
  if (Array.isArray(data.data.list)) return data.data.list;
  return [];
}

function _extractMsgList(data) {
  if (!data || !data.data) return [];
  if (Array.isArray(data.data.message_list)) return data.data.message_list;
  if (Array.isArray(data.data.messages)) return data.data.messages;
  if (Array.isArray(data.data.list)) return data.data.list;
  return [];
}

function _normalizeRole(r) {
  // Doubao uses sender_type "USER" / "ASSISTANT" / "SYSTEM" or numeric codes.
  if (r === 1 || r === "1" || r === "USER" || r === "user") return "user";
  if (r === 2 || r === "2" || r === "ASSISTANT" || r === "assistant") return "assistant";
  if (r === 3 || r === "3" || r === "SYSTEM" || r === "system") return "system";
  return r || "assistant";
}

function _buildContent(m) {
  // Doubao messages can carry text + attachments (images uploaded by user,
  // search refs, code blocks). Preserve text plus the stable attachment subset;
  // additional variants can be pinned from authorized account fixtures.
  const text = m.content || m.text || m.message_content || "";
  const out = { text };
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    out.attachments = m.attachments
      .map((a) => ({
        type: a.kind === "image" ? "image" : "file",
        filename: a.name || a.file_name,
        url: a.url || a.download_url,
        size: a.size,
        mimeType: a.mime_type,
      }))
      .filter((a) => a.url || a.filename);
  }
  return out;
}

function _toMs(t) {
  if (typeof t === "number") return t > 1e12 ? t : t * 1000;
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(t);
    return Number.isFinite(d) ? d : 0;
  }
  return 0;
}

const SPEC = {
  name: "doubao",
  displayName: "豆包 Doubao",
  androidPackage: "com.larus.nova",
  loginUrl: "https://www.doubao.com/chat/",
  cookieDomains: ["www.doubao.com", ".doubao.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: {
    _toMs,
    _normalizeRole,
    _buildContent,
    _extractConvList,
    _extractMsgList,
    BASE,
    CONV_LIST_PATH,
    MSG_LIST_PATH,
  },
};
