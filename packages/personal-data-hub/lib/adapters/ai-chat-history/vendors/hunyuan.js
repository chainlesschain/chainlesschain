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
const MSG_LIST_PATH = (id) => `/api/user/conv/${encodeURIComponent(id)}/message/list`;
const USER_INFO_PATH = "/api/user/info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) throw new Error("hunyuan: ctx.httpClient required");
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, { session: ctx.session });
    if (data && (data.ret === 0 || data.code === 0) && (data.data || data.user)) {
      const u = data.data || data.user;
      return { ok: true, userId: u.userId || u.uin || u.uid };
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

  let cursor = null;
  let safety = 0;
  while (safety < 200) {
    safety++;
    const body = { count: pageSize, ...(cursor ? { cursor } : {}) };
    const data = await client.postJson(BASE + CONV_LIST_PATH, body, { session: ctx.session });
    const items = _extractList(data);
    if (items.length === 0) return;

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(c.updateTime || c.update_time || c.createTime);
      if (sinceTs && updatedAt <= sinceTs) {
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
    cursor = (data && data.data && data.data.cursor) || (items[items.length - 1] && items[items.length - 1].cursor);
    if (!cursor || items.length < pageSize) return;
  }
}

async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const url = BASE + MSG_LIST_PATH(conversationId);
  const data = await client.postJson(url, { convId: String(conversationId), count: 200 }, { session: ctx.session });
  const msgs = _extractList(data);

  msgs.sort((a, b) => _toMs(a.createTime || a.create_time) - _toMs(b.createTime || b.create_time));

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
      extra: m.linkedArticles ? { linkedArticles: m.linkedArticles } : undefined,
    };
  }
}

function _extractList(data) {
  if (!data) return [];
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.convs)) return data.data.convs;
  if (data.data && Array.isArray(data.data.messages)) return data.data.messages;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.list)) return data.list;
  return [];
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER" || r === "human") return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot" || r === "ai") return "assistant";
  if (r === "system" || r === "SYSTEM") return "system";
  return r ? String(r).toLowerCase() : "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || m.text || "" };
  const attachments = [];
  if (Array.isArray(m.files)) {
    for (const f of m.files) {
      attachments.push({
        type: (f.type === "image" || /image/i.test(f.mimeType || "")) ? "image" : "file",
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
