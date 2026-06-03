/**
 * 通义千问 (Aliyun Tongyi) vendor adapter — Phase 10.2 wiring.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.3
 *   - login  https://tongyi.aliyun.com/
 *   - convs  POST /dialog/conversation/list
 *   - msgs   POST /dialog/conversation/messages
 *   - X-Csrf-Token header required (from XSRF-TOKEN cookie)
 *   - 阿里通用 anti-bot — conservative rateLimits.
 *
 * Endpoints + payload shapes are reverse-engineered and SUBJECT TO DRIFT.
 * Tests use the same fixture-fetch pattern as DeepSeek + Kimi so wire breakage
 * surfaces immediately when a real cookie is reconnected.
 */

"use strict";

const BASE = "https://tongyi.aliyun.com";
const CONV_LIST_PATH = "/dialog/conversation/list";
const MSG_LIST_PATH = "/dialog/conversation/messages";
const USER_INFO_PATH = "/api/user/info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error("tongyi: ctx.httpClient required");
  }
  return ctx.httpClient;
}

function _csrfHeader(session) {
  // Tongyi reads CSRF from a cookie + echoes it back as a header.
  const value = session && (session.get("XSRF-TOKEN") || session.get("_csrf"));
  return value ? { "X-Csrf-Token": value, "X-Xsrf-Token": value } : {};
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, {
      session: ctx.session,
      headers: _csrfHeader(ctx.session),
    });
    if (data && (data.success || data.code === 200) && (data.data || data.userId)) {
      const userId = (data.data && (data.data.userId || data.data.uid)) || data.userId;
      return { ok: true, userId };
    }
    return { ok: false, reason: "UNEXPECTED_RESPONSE_SHAPE" };
  } catch (err) {
    return { ok: false, reason: err.code || err.message };
  }
}

async function *listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
  const sinceTs = opts.since && opts.since.lastUpdatedAt ? Number(opts.since.lastUpdatedAt) : 0;

  let pageNum = 1;
  while (true) {
    const body = { pageNum, pageSize };
    const data = await client.postJson(BASE + CONV_LIST_PATH, body, {
      session: ctx.session,
      headers: _csrfHeader(ctx.session),
    });
    const items = _extractList(data);
    if (items.length === 0) return;

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(c.gmtModified || c.updatedAt || c.gmtCreate);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "tongyi",
        originalId: String(c.sessionId || c.id),
        title: c.summary || c.firstQuery || c.title || undefined,
        modelName: c.modelName || c.model || undefined,
        createdAt: _toMs(c.gmtCreate || c.createdAt),
        updatedAt,
        messageCount: c.messageCount || undefined,
        archived: Boolean(c.archived),
        extra: { agentName: c.agentName || c.botName },
      };
    }
    if (stopped) return;
    if (items.length < pageSize) return;
    pageNum++;
    if (pageNum > 200) return; // safety
  }
}

async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const body = { sessionId: String(conversationId), parentMsgId: "" };
  const data = await client.postJson(BASE + MSG_LIST_PATH, body, {
    session: ctx.session,
    headers: _csrfHeader(ctx.session),
  });
  const msgs = _extractList(data);

  // Tongyi returns messages mixed user/bot in their own order; we sort
  // ascending by createTime for stable chronological yield.
  msgs.sort((a, b) => _toMs(a.createTime || a.gmtCreate) - _toMs(b.createTime || b.gmtCreate));

  for (const m of msgs) {
    yield {
      vendor: "tongyi",
      originalId: String(m.msgId || m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.senderType || m.role || (m.contentType === "user" ? "user" : "assistant")),
      content: _buildContent(m),
      createdAt: _toMs(m.createTime || m.gmtCreate),
      parentMessageId: m.parentMsgId ? String(m.parentMsgId) : undefined,
      modelName: m.modelName || m.model || undefined,
      extra: m.feedback ? { feedback: m.feedback } : undefined,
    };
  }
}

function _extractList(data) {
  if (!data) return [];
  if (Array.isArray(data.data)) return data.data;
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.records)) return data.data.records;
  if (Array.isArray(data.list)) return data.list;
  return [];
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER" || r === 1) return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot" || r === 2) return "assistant";
  if (r === "system" || r === "SYSTEM" || r === 0) return "system";
  return r ? String(r).toLowerCase() : "assistant";
}

function _buildContent(m) {
  // Tongyi messages have content fanned across `contents[].content` for
  // multi-segment replies (image + text). Flatten to single text.
  const segments = Array.isArray(m.contents) ? m.contents : null;
  const text = segments
    ? segments.map((s) => s.content || "").filter(Boolean).join("\n")
    : (m.content || "");
  const content = { text };

  const files = []
    .concat(Array.isArray(m.fileList) ? m.fileList : [])
    .concat(Array.isArray(m.imageList) ? m.imageList : []);
  if (files.length > 0) {
    content.attachments = files
      .map((f) => ({
        type: (f.type === "image" || /image/i.test(f.fileType || "")) ? "image" : "file",
        filename: f.fileName || f.name,
        url: f.url || f.fileUrl,
        size: f.size,
        mimeType: f.fileType,
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
  name: "tongyi",
  displayName: "通义千问",
  androidPackage: "com.aliyun.tongyi",
  loginUrl: "https://tongyi.aliyun.com/",
  cookieDomains: ["tongyi.aliyun.com", ".aliyun.com"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 }, // Aliyun anti-bot — conservative

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, _csrfHeader, _extractList, BASE },
};
