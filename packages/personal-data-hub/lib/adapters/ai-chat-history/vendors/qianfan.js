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

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) throw new Error("qianfan: ctx.httpClient required");
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.postJson(BASE + USER_INFO_PATH, {}, { session: ctx.session });
    if (data && (data.code === 0 || data.errno === 0) && (data.data || data.user)) {
      const u = data.data || data.user;
      return { ok: true, userId: u.uk || u.userId || u.uid };
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

  let pageNo = 1;
  while (true) {
    const body = { pageNo, pageSize };
    const data = await client.postJson(BASE + CONV_LIST_PATH, body, { session: ctx.session });
    const list = _extractList(data);
    if (list.length === 0) return;

    let stopped = false;
    for (const c of list) {
      const updatedAt = _toMs(c.updateTime || c.update_time);
      if (sinceTs && updatedAt <= sinceTs) {
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
    if (list.length < pageSize) return;
    pageNo++;
    if (pageNo > 200) return;
  }
}

async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const body = { sessionId: String(conversationId), pageSize: 200 };
  const data = await client.postJson(BASE + MSG_LIST_PATH, body, { session: ctx.session });
  const msgs = _extractList(data);

  msgs.sort((a, b) => _toMs(a.createTime || a.create_time) - _toMs(b.createTime || b.create_time));

  for (const m of msgs) {
    yield {
      vendor: "qianfan",
      originalId: String(m.messageId || m.message_id || m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.role || m.type || (m.fromUser ? "user" : "assistant")),
      content: _buildContent(m),
      createdAt: _toMs(m.createTime || m.create_time),
      parentMessageId: m.parentMessageId ? String(m.parentMessageId) : undefined,
      modelName: m.model || undefined,
      extra: m.references ? { references: m.references } : undefined,
    };
  }
}

function _extractList(data) {
  if (!data) return [];
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.sessions)) return data.data.sessions;
  if (data.data && Array.isArray(data.data.messages)) return data.data.messages;
  if (Array.isArray(data.data)) return data.data;
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
  const content = { text: m.content || m.text || "" };
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    content.attachments = m.attachments
      .map((a) => ({
        type: (a.type === "image" || /image/i.test(a.mimeType || "")) ? "image" : "file",
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
