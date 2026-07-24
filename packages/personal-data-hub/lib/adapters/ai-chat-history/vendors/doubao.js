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
const {
  resolveMaxPages,
  paginationError,
  pageSignature,
  hasMoreState,
} = require("./pagination");
const { extractVendorArray } = require("./strict-response");

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MESSAGE_PAGE_SIZE = 100;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error(
      "doubao: ctx.httpClient required (AIChatHistoryAdapter must wire one)",
    );
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
async function* listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const limit = Number.isFinite(opts.pageSize)
    ? opts.pageSize
    : DEFAULT_PAGE_SIZE;
  const maxPages = resolveMaxPages(opts);
  const sinceTs =
    opts.since && opts.since.lastUpdatedAt
      ? Number(opts.since.lastUpdatedAt)
      : 0;

  let cursor = "";
  let pagesFetched = 0;
  const seenCursors = new Set();
  const seenPages = new Set();
  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_LIMIT",
        `doubao: conversation pagination exceeded ${maxPages} pages`,
        { maxPages, cursor },
      );
    }

    const body = { count: limit };
    if (cursor) body.cursor = cursor;

    const data = await client.postJson(BASE + CONV_LIST_PATH, body, {
      session: ctx.session,
    });
    pagesFetched++;
    const list = _extractConvList(data);
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor =
      meta.cursor || meta.next_cursor || meta.nextCursor || "";
    if (list.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          "doubao: conversation pagination reported more data but returned an empty page",
          { cursor, pagesFetched },
        );
      }
      return;
    }

    const signature = pageSignature(list, ["conversation_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_STALLED",
        `doubao: conversation pagination repeated page for cursor ${cursor || "initial"}`,
        { cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
      if (rawNextCursor === "") {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          "doubao: conversation pagination reported more data without a cursor",
          { cursor, pagesFetched },
        );
      }
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          `doubao: conversation pagination repeated cursor ${nextCursor}`,
          { cursor: nextCursor, pagesFetched },
        );
      }
    } else if (hasMore == null) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_STALLED",
        "doubao: non-empty conversation page had no continuation cursor",
        { cursor, pagesFetched, pageSize: limit },
      );
    }

    let stopped = false;
    for (const c of list) {
      const updatedAt = _toMs(
        c.last_message_time || c.update_time || c.create_time,
      );
      if (sinceTs && updatedAt > 0 && updatedAt <= sinceTs) {
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

    if (hasMore === false) return;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

/**
 * Yield each message in a conversation in chronological order.
 * Doubao paginates messages too — historical conversations can have
 * thousands of turns.
 */
async function* listMessages(ctx, conversationId, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize)
    ? opts.pageSize
    : DEFAULT_MESSAGE_PAGE_SIZE;
  const maxPages = resolveMaxPages(opts);
  let cursor = "";
  let pagesFetched = 0;
  const seenCursors = new Set();
  const seenPages = new Set();
  const collected = [];

  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_LIMIT",
        `doubao: message pagination exceeded ${maxPages} pages`,
        { conversationId: String(conversationId), maxPages, cursor },
      );
    }

    const body = { conversation_id: String(conversationId), count: pageSize };
    if (cursor) body.cursor = cursor;

    const data = await client.postJson(
      BASE + MSG_LIST_PATH(conversationId),
      body,
      {
        session: ctx.session,
      },
    );
    pagesFetched++;
    const list = _extractMsgList(data);
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor =
      meta.cursor || meta.next_cursor || meta.nextCursor || "";
    if (list.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          "doubao: message pagination reported more data but returned an empty page",
          { conversationId: String(conversationId), cursor, pagesFetched },
        );
      }
      break;
    }

    const signature = pageSignature(list, ["id", "message_id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_STALLED",
        `doubao: message pagination repeated page for cursor ${cursor || "initial"}`,
        { conversationId: String(conversationId), cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
      if (rawNextCursor === "") {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          "doubao: message pagination reported more data without a cursor",
          { conversationId: String(conversationId), cursor, pagesFetched },
        );
      }
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "doubao",
          "AI_CHAT_PAGINATION_STALLED",
          `doubao: message pagination repeated cursor ${nextCursor}`,
          {
            conversationId: String(conversationId),
            cursor: nextCursor,
            pagesFetched,
          },
        );
      }
    } else if (hasMore == null) {
      throw paginationError(
        "doubao",
        "AI_CHAT_PAGINATION_STALLED",
        "doubao: non-empty message page had no continuation cursor",
        {
          conversationId: String(conversationId),
          cursor,
          pagesFetched,
          pageSize,
        },
      );
    }

    collected.push(...list);
    if (hasMore === false) break;
    seenCursors.add(nextCursor);
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
  return extractVendorArray(
    data,
    [
      ["data", "conversation_list"],
      ["data", "conversations"],
      ["data", "list"],
    ],
    {
      vendor: "doubao",
      stream: "conversations",
      businessStatus: { code: [0] },
    },
  );
}

function _extractMsgList(data) {
  return extractVendorArray(
    data,
    [
      ["data", "message_list"],
      ["data", "messages"],
      ["data", "list"],
    ],
    {
      vendor: "doubao",
      stream: "messages",
      businessStatus: { code: [0] },
    },
  );
}

function _normalizeRole(r) {
  // Doubao uses sender_type "USER" / "ASSISTANT" / "SYSTEM" or numeric codes.
  if (r === 1 || r === "1" || r === "USER" || r === "user") return "user";
  if (r === 2 || r === "2" || r === "ASSISTANT" || r === "assistant")
    return "assistant";
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
