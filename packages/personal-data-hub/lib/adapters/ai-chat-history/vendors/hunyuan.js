/**
 * 腾讯混元 / 元宝 (Tencent Hunyuan / Yuanbao) vendor adapter — Phase 10.2.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.5
 *   - login  https://yuanbao.tencent.com/
 *   - convs  POST /api/user/conv/list
 *   - msgs   POST /api/user/conv/<id>/message/list
 *   - cookies hy_token + 腾讯 uin series
 *   - 风控 strong — keep conservative rateLimits.
 *
 * Special: 微信生态联动 messages may reference 微信公众号 articles via
 * `extra.linkedArticles` (link cards). We preserve them as attachments[].
 */

"use strict";

const BASE = "https://yuanbao.tencent.com";
const CONV_LIST_PATH = "/api/user/conv/list";
const MSG_LIST_PATH = (id) =>
  `/api/user/conv/${encodeURIComponent(id)}/message/list`;
const USER_INFO_PATH = "/api/user/info";
const {
  resolveMaxPages,
  paginationError,
  pageSignature,
  hasMoreState,
} = require("./pagination");
const { extractVendorArray } = require("./strict-response");

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MESSAGE_PAGE_SIZE = 200;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient)
    throw new Error("hunyuan: ctx.httpClient required");
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, {
      session: ctx.session,
    });
    if (
      data &&
      (data.ret === 0 || data.code === 0) &&
      (data.data || data.user)
    ) {
      const u = data.data || data.user;
      return { ok: true, userId: u.userId || u.uin || u.uid };
    }
    return { ok: false, reason: "UNEXPECTED_RESPONSE_SHAPE" };
  } catch (err) {
    return { ok: false, reason: err.code || err.message };
  }
}

async function* listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize)
    ? opts.pageSize
    : DEFAULT_PAGE_SIZE;
  const maxPages = resolveMaxPages(opts);
  const sinceTs =
    opts.since && opts.since.lastUpdatedAt
      ? Number(opts.since.lastUpdatedAt)
      : 0;

  let cursor = null;
  let pagesFetched = 0;
  const seenCursors = new Set();
  const seenPages = new Set();
  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_LIMIT",
        `hunyuan: conversation pagination exceeded ${maxPages} pages`,
        { maxPages, cursor },
      );
    }

    const body = { count: pageSize, ...(cursor ? { cursor } : {}) };
    const data = await client.postJson(BASE + CONV_LIST_PATH, body, {
      session: ctx.session,
    });
    pagesFetched++;
    const items = _extractList(data, "conversations");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor =
      meta.next_cursor ||
      meta.nextCursor ||
      meta.cursor ||
      (items[items.length - 1] && items[items.length - 1].cursor) ||
      "";
    if (items.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "hunyuan",
          "AI_CHAT_PAGINATION_STALLED",
          "hunyuan: conversation pagination reported more data but returned an empty page",
          { cursor, pagesFetched },
        );
      }
      return;
    }

    const signature = pageSignature(items, ["convId", "conv_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        `hunyuan: conversation pagination repeated page for cursor ${cursor || "initial"}`,
        { cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore !== false && rawNextCursor !== "") {
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "hunyuan",
          "AI_CHAT_PAGINATION_STALLED",
          `hunyuan: conversation pagination repeated cursor ${nextCursor}`,
          { cursor: nextCursor, pagesFetched },
        );
      }
    } else if (hasMore === true) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        "hunyuan: conversation pagination reported more data without a cursor",
        { cursor, pagesFetched },
      );
    } else if (hasMore == null) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        "hunyuan: non-empty conversation page had no continuation cursor",
        { cursor, pagesFetched, pageSize },
      );
    }

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(c.updateTime || c.update_time || c.createTime);
      if (sinceTs && updatedAt > 0 && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "hunyuan",
        originalId: String(c.convId || c.conv_id || c.id),
        title: c.title || c.summary || undefined,
        modelName: c.model || undefined,
        createdAt: _toMs(c.createTime || c.create_time),
        updatedAt,
        messageCount: c.msgCount || c.message_count,
        archived: Boolean(c.archived),
      };
    }
    if (stopped) return;
    if (hasMore === false) return;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

async function* listMessages(ctx, conversationId, opts = {}) {
  const client = _ensureClient(ctx);
  const url = BASE + MSG_LIST_PATH(conversationId);
  const pageSize = Number.isFinite(opts.pageSize)
    ? opts.pageSize
    : DEFAULT_MESSAGE_PAGE_SIZE;
  const maxPages = resolveMaxPages(opts);
  const msgs = [];
  let cursor = null;
  let pagesFetched = 0;
  const seenCursors = new Set();
  const seenPages = new Set();

  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_LIMIT",
        `hunyuan: message pagination exceeded ${maxPages} pages`,
        { conversationId: String(conversationId), maxPages, cursor },
      );
    }

    const body = {
      convId: String(conversationId),
      count: pageSize,
      ...(cursor ? { cursor } : {}),
    };
    const data = await client.postJson(url, body, { session: ctx.session });
    pagesFetched++;
    const page = _extractList(data, "messages");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor =
      meta.next_cursor ||
      meta.nextCursor ||
      meta.cursor ||
      (page[page.length - 1] && page[page.length - 1].cursor) ||
      "";
    if (page.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "hunyuan",
          "AI_CHAT_PAGINATION_STALLED",
          "hunyuan: message pagination reported more data but returned an empty page",
          { conversationId: String(conversationId), cursor, pagesFetched },
        );
      }
      break;
    }

    const signature = pageSignature(page, ["msgId", "msg_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        `hunyuan: message pagination repeated page for cursor ${cursor || "initial"}`,
        { conversationId: String(conversationId), cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore !== false && rawNextCursor !== "") {
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "hunyuan",
          "AI_CHAT_PAGINATION_STALLED",
          `hunyuan: message pagination repeated cursor ${nextCursor}`,
          {
            conversationId: String(conversationId),
            cursor: nextCursor,
            pagesFetched,
          },
        );
      }
    } else if (hasMore === true) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        "hunyuan: message pagination reported more data without a cursor",
        { conversationId: String(conversationId), cursor, pagesFetched },
      );
    } else if (hasMore == null) {
      throw paginationError(
        "hunyuan",
        "AI_CHAT_PAGINATION_STALLED",
        "hunyuan: non-empty message page had no continuation cursor",
        {
          conversationId: String(conversationId),
          cursor,
          pagesFetched,
          pageSize,
        },
      );
    }

    msgs.push(...page);
    if (hasMore === false) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  msgs.sort(
    (a, b) =>
      _toMs(a.createTime || a.create_time) -
      _toMs(b.createTime || b.create_time),
  );

  for (const m of msgs) {
    yield {
      vendor: "hunyuan",
      originalId: String(m.msgId || m.msg_id || m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.speaker || m.role || m.type),
      content: _buildContent(m),
      createdAt: _toMs(m.createTime || m.create_time),
      parentMessageId: m.parentMsgId ? String(m.parentMsgId) : undefined,
      modelName: m.model || undefined,
      extra: m.linkedArticles
        ? { linkedArticles: m.linkedArticles }
        : undefined,
    };
  }
}

function _extractList(data, stream) {
  return extractVendorArray(
    data,
    [
      ["data", "list"],
      ["data", "convs"],
      ["data", "messages"],
      ["data"],
      ["list"],
    ],
    {
      vendor: "hunyuan",
      stream,
      businessStatus: { code: [0], ret: [0] },
    },
  );
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER" || r === "human") return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot" || r === "ai")
    return "assistant";
  if (r === "system" || r === "SYSTEM") return "system";
  return r ? String(r).toLowerCase() : "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || m.text || "" };
  const attachments = [];
  if (Array.isArray(m.files)) {
    for (const f of m.files) {
      attachments.push({
        type:
          f.type === "image" || /image/i.test(f.mimeType || "")
            ? "image"
            : "file",
        filename: f.name,
        url: f.url,
        mimeType: f.mimeType,
        size: f.size,
      });
    }
  }
  if (Array.isArray(m.linkedArticles)) {
    for (const link of m.linkedArticles) {
      attachments.push({
        type: "file",
        filename: link.title,
        url: link.url,
        mimeType: "text/html",
      });
    }
  }
  if (attachments.length > 0) content.attachments = attachments;
  return content;
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
  name: "hunyuan",
  displayName: "腾讯元宝",
  androidPackage: "com.tencent.hunyuan.app.chat",
  loginUrl: "https://yuanbao.tencent.com/",
  cookieDomains: ["yuanbao.tencent.com", ".tencent.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, _extractList, BASE },
};
