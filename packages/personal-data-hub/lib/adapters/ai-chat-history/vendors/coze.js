/**
 * 扣子 (Coze, ByteDance) vendor adapter — Phase 10.2 wiring.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.7
 *   - login   https://www.coze.cn/
 *   - convs   GET /api/conversation/list
 *   - msgs    GET /api/conversation/<id>/message
 *   - cookies 字节通用 s_v_web_id (+ session)
 *   - 特别 — agent 平台：tool_calls 多，workflow 可能嵌套。v1 flatten 为消息序列；
 *             保留 extra.toolCalls 与 extra.botId.
 */

"use strict";

const BASE = "https://www.coze.cn";
const CONV_LIST_PATH = "/api/conversation/list";
const MSG_LIST_PATH = (id) =>
  `/api/conversation/${encodeURIComponent(id)}/message`;
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
  if (!ctx || !ctx.httpClient) throw new Error("coze: ctx.httpClient required");
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, {
      session: ctx.session,
      matchDomain: "www.coze.cn",
    });
    if (data && data.code === 0 && data.data) {
      return { ok: true, userId: data.data.user_id || data.data.uid };
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

  let cursor = "0";
  let pagesFetched = 0;
  const seenCursors = new Set([cursor]);
  const seenPages = new Set();
  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_LIMIT",
        `coze: conversation pagination exceeded ${maxPages} pages`,
        { maxPages, cursor },
      );
    }

    const url = new URL(BASE + CONV_LIST_PATH);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("cursor", cursor);
    const data = await client.getJson(url.toString(), {
      session: ctx.session,
      matchDomain: "www.coze.cn",
    });
    pagesFetched++;
    const items = _extractList(data, "conversations");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor = meta.next_cursor || meta.nextCursor || "";
    if (items.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "coze",
          "AI_CHAT_PAGINATION_STALLED",
          "coze: conversation pagination reported more data but returned an empty page",
          { cursor, pagesFetched },
        );
      }
      return;
    }

    const signature = pageSignature(items, ["conversation_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        `coze: conversation pagination repeated page for cursor ${cursor}`,
        { cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore !== false && rawNextCursor !== "") {
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "coze",
          "AI_CHAT_PAGINATION_STALLED",
          `coze: conversation pagination repeated cursor ${nextCursor}`,
          { cursor: nextCursor, pagesFetched },
        );
      }
    } else if (hasMore === true) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        "coze: conversation pagination reported more data without a cursor",
        { cursor, pagesFetched },
      );
    } else if (hasMore == null) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        "coze: non-empty conversation page had no continuation cursor",
        { cursor, pagesFetched, pageSize },
      );
    }

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(
        c.last_updated_time || c.updated_at || c.created_at,
      );
      if (sinceTs && updatedAt > 0 && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "coze",
        originalId: String(c.conversation_id || c.id),
        title: c.title || c.name || undefined,
        modelName: undefined,
        createdAt: _toMs(c.created_at || c.create_time),
        updatedAt,
        messageCount: c.message_count || undefined,
        archived: Boolean(c.archived),
        extra: { botId: c.bot_id, scene: c.scene },
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
        "coze",
        "AI_CHAT_PAGINATION_LIMIT",
        `coze: message pagination exceeded ${maxPages} pages`,
        { conversationId: String(conversationId), maxPages, cursor },
      );
    }

    const url = new URL(BASE + MSG_LIST_PATH(conversationId));
    url.searchParams.set("limit", String(pageSize));
    if (cursor != null) url.searchParams.set("cursor", cursor);
    const data = await client.getJson(url.toString(), {
      session: ctx.session,
      matchDomain: "www.coze.cn",
    });
    pagesFetched++;
    const page = _extractList(data, "messages");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    const rawNextCursor = meta.next_cursor || meta.nextCursor || "";
    if (page.length === 0) {
      if (hasMore === true || (hasMore == null && rawNextCursor !== "")) {
        throw paginationError(
          "coze",
          "AI_CHAT_PAGINATION_STALLED",
          "coze: message pagination reported more data but returned an empty page",
          { conversationId: String(conversationId), cursor, pagesFetched },
        );
      }
      break;
    }

    const signature = pageSignature(page, ["message_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        `coze: message pagination repeated page for cursor ${cursor || "initial"}`,
        { conversationId: String(conversationId), cursor, pagesFetched },
      );
    }
    seenPages.add(signature);

    let nextCursor = null;
    if (hasMore !== false && rawNextCursor !== "") {
      nextCursor = String(rawNextCursor);
      if (seenCursors.has(nextCursor)) {
        throw paginationError(
          "coze",
          "AI_CHAT_PAGINATION_STALLED",
          `coze: message pagination repeated cursor ${nextCursor}`,
          {
            conversationId: String(conversationId),
            cursor: nextCursor,
            pagesFetched,
          },
        );
      }
    } else if (hasMore === true) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        "coze: message pagination reported more data without a cursor",
        { conversationId: String(conversationId), cursor, pagesFetched },
      );
    } else if (hasMore == null) {
      throw paginationError(
        "coze",
        "AI_CHAT_PAGINATION_STALLED",
        "coze: non-empty message page had no continuation cursor",
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
      _toMs(a.created_at || a.create_time) -
      _toMs(b.created_at || b.create_time),
  );

  for (const m of msgs) {
    yield {
      vendor: "coze",
      originalId: String(m.message_id || m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.role || m.sender),
      content: _buildContent(m),
      createdAt: _toMs(m.created_at || m.create_time),
      parentMessageId: m.parent_id ? String(m.parent_id) : undefined,
      modelName: undefined,
      extra: {
        toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined,
        botId: m.bot_id,
        workflowRunId: m.workflow_run_id,
      },
    };
  }
}

function _extractList(data, stream) {
  return extractVendorArray(
    data,
    [
      ["data", "list"],
      ["data", "conversations"],
      ["data", "messages"],
      ["data", "message_list"],
      ["data"],
    ],
    {
      vendor: "coze",
      stream,
      businessStatus: { code: [0] },
    },
  );
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER") return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot") return "assistant";
  if (r === "system" || r === "SYSTEM") return "system";
  if (r === "tool" || r === "TOOL") return "tool";
  return r ? String(r).toLowerCase() : "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || m.text || "" };
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    content.attachments = m.attachments
      .map((a) => ({
        type:
          a.type === "image" || /image/i.test(a.mime_type || "")
            ? "image"
            : "file",
        filename: a.name,
        url: a.url,
        mimeType: a.mime_type,
        size: a.size,
      }))
      .filter((a) => a.url || a.filename);
  }
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
  name: "coze",
  displayName: "扣子",
  androidPackage: "com.coze.space",
  loginUrl: "https://www.coze.cn/",
  cookieDomains: ["www.coze.cn", ".coze.cn"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, _extractList, BASE },
};
