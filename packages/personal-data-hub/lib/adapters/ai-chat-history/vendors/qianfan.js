/**
 * 百度千帆 / 文心一言 (Baidu Qianfan / Yiyan) vendor adapter — Phase 10.2.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.6
 *   - login    https://yiyan.baidu.com/  (个人) or https://qianfan.cloud.baidu.com/
 *   - convs    POST /aichat/conversation/list
 *   - msgs     POST /aichat/conversation/getMessages
 *   - cookies  BAIDUID + BDUSS
 *   - 风控 strong — Baidu full-stack anti-bot.
 */

"use strict";

const BASE = "https://yiyan.baidu.com";
const CONV_LIST_PATH = "/aichat/conversation/list";
const MSG_LIST_PATH = "/aichat/conversation/getMessages";
const USER_INFO_PATH = "/aichat/user/info";
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
    throw new Error("qianfan: ctx.httpClient required");
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
    if (
      data &&
      (data.code === 0 || data.errno === 0) &&
      (data.data || data.user)
    ) {
      const u = data.data || data.user;
      return { ok: true, userId: u.uk || u.userId || u.uid };
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

  let pageNo = 1;
  let pagesFetched = 0;
  let itemsFetched = 0;
  const seenPages = new Set();
  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_LIMIT",
        `qianfan: conversation pagination exceeded ${maxPages} pages`,
        { maxPages, page: pageNo },
      );
    }

    const body = { pageNo, pageSize };
    const data = await client.postJson(BASE + CONV_LIST_PATH, body, {
      session: ctx.session,
    });
    pagesFetched++;
    const list = _extractList(data, "conversations");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    if (list.length === 0) {
      if (hasMore === true || _hasRemainingTotal(meta, data, itemsFetched)) {
        throw paginationError(
          "qianfan",
          "AI_CHAT_PAGINATION_STALLED",
          "qianfan: conversation pagination ended before the reported boundary",
          { page: pageNo, pagesFetched },
        );
      }
      return;
    }

    const signature = pageSignature(list, ["sessionId", "session_id", "id"]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_STALLED",
        `qianfan: conversation pagination repeated page ${pageNo}`,
        { page: pageNo, pagesFetched },
      );
    }
    seenPages.add(signature);
    itemsFetched += list.length;

    let stopped = false;
    for (const c of list) {
      const updatedAt = _toMs(c.updateTime || c.update_time);
      if (sinceTs && updatedAt > 0 && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "qianfan",
        originalId: String(c.sessionId || c.session_id || c.id),
        title: c.sessionName || c.title || undefined,
        modelName: c.model || c.modelName || undefined,
        createdAt: _toMs(c.createTime || c.create_time),
        updatedAt,
        messageCount: c.messageCount || undefined,
        archived: Boolean(c.archived),
      };
    }
    if (stopped) return;
    if (hasMore === false && _hasRemainingTotal(meta, data, itemsFetched)) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_STALLED",
        "qianfan: conversation pagination stopped before the reported total",
        { page: pageNo, pagesFetched, itemsFetched },
      );
    }
    if (hasMore === false) return;
    if (hasMore !== true && _reachedTotal(meta, data, itemsFetched)) return;
    pageNo++;
  }
}

async function* listMessages(ctx, conversationId, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize)
    ? opts.pageSize
    : DEFAULT_MESSAGE_PAGE_SIZE;
  const maxPages = resolveMaxPages(opts);
  const msgs = [];
  let pageNo = 1;
  let pagesFetched = 0;
  const seenPages = new Set();

  while (true) {
    if (pagesFetched >= maxPages) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_LIMIT",
        `qianfan: message pagination exceeded ${maxPages} pages`,
        { conversationId: String(conversationId), maxPages, page: pageNo },
      );
    }

    const body = { sessionId: String(conversationId), pageNo, pageSize };
    const data = await client.postJson(BASE + MSG_LIST_PATH, body, {
      session: ctx.session,
    });
    pagesFetched++;
    const currentPage = _extractList(data, "messages");
    const meta = (data && data.data) || {};
    const hasMore = hasMoreState(meta);
    if (currentPage.length === 0) {
      if (hasMore === true || _hasRemainingTotal(meta, data, msgs.length)) {
        throw paginationError(
          "qianfan",
          "AI_CHAT_PAGINATION_STALLED",
          "qianfan: message pagination ended before the reported boundary",
          {
            conversationId: String(conversationId),
            page: pageNo,
            pagesFetched,
          },
        );
      }
      break;
    }

    const signature = pageSignature(currentPage, [
      "messageId",
      "message_id",
      "id",
    ]);
    if (seenPages.has(signature)) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_STALLED",
        `qianfan: message pagination repeated page ${pageNo}`,
        { conversationId: String(conversationId), page: pageNo, pagesFetched },
      );
    }
    seenPages.add(signature);
    msgs.push(...currentPage);

    if (hasMore === false && _hasRemainingTotal(meta, data, msgs.length)) {
      throw paginationError(
        "qianfan",
        "AI_CHAT_PAGINATION_STALLED",
        "qianfan: message pagination stopped before the reported total",
        { conversationId: String(conversationId), page: pageNo, pagesFetched },
      );
    }
    if (hasMore === false) break;
    if (hasMore !== true && _reachedTotal(meta, data, msgs.length)) break;
    pageNo++;
  }

  msgs.sort(
    (a, b) =>
      _toMs(a.createTime || a.create_time) -
      _toMs(b.createTime || b.create_time),
  );

  for (const m of msgs) {
    yield {
      vendor: "qianfan",
      originalId: String(m.messageId || m.message_id || m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(
        m.role || m.type || (m.fromUser ? "user" : "assistant"),
      ),
      content: _buildContent(m),
      createdAt: _toMs(m.createTime || m.create_time),
      parentMessageId: m.parentMessageId
        ? String(m.parentMessageId)
        : undefined,
      modelName: m.model || undefined,
      extra: m.references ? { references: m.references } : undefined,
    };
  }
}

function _reachedTotal(meta, data, fetched) {
  const total = _reportedTotal(meta, data);
  return Number.isFinite(total) && fetched >= total;
}

function _hasRemainingTotal(meta, data, fetched) {
  const total = _reportedTotal(meta, data);
  return Number.isFinite(total) && fetched < total;
}

function _reportedTotal(meta, data) {
  const rawTotal =
    meta.total ?? meta.total_count ?? meta.totalCount ?? (data && data.total);
  if (rawTotal == null || rawTotal === "") return Number.NaN;
  const total = Number(rawTotal);
  return Number.isFinite(total) && total >= 0 ? total : Number.NaN;
}

function _extractList(data, stream) {
  return extractVendorArray(
    data,
    [
      ["data", "list"],
      ["data", "sessions"],
      ["data", "messages"],
      ["data"],
      ["list"],
    ],
    {
      vendor: "qianfan",
      stream,
      businessStatus: { code: [0], errno: [0] },
    },
  );
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER" || r === 1) return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot" || r === 2)
    return "assistant";
  if (r === "system" || r === "SYSTEM" || r === 0) return "system";
  return r ? String(r).toLowerCase() : "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || m.text || "" };
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    content.attachments = m.attachments
      .map((a) => ({
        type:
          a.type === "image" || /image/i.test(a.mimeType || "")
            ? "image"
            : "file",
        filename: a.name,
        url: a.url,
        mimeType: a.mimeType,
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
  name: "qianfan",
  displayName: "百度千帆",
  androidPackage: "com.baidu.qianfan.llmkitchat",
  loginUrl: "https://yiyan.baidu.com/",
  cookieDomains: ["yiyan.baidu.com", ".baidu.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, _extractList, BASE },
};
