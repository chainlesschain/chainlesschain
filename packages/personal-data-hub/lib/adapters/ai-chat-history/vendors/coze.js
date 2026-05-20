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
const MSG_LIST_PATH = (id) => `/api/conversation/${encodeURIComponent(id)}/message`;
const USER_INFO_PATH = "/api/user/info";

const DEFAULT_PAGE_SIZE = 30;

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

async function *listConversations(ctx, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
  const sinceTs = opts.since && opts.since.lastUpdatedAt ? Number(opts.since.lastUpdatedAt) : 0;

  let cursor = "0";
  let safety = 0;
  while (safety < 200) {
    safety++;
    const url = new URL(BASE + CONV_LIST_PATH);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("cursor", cursor);
    const data = await client.getJson(url.toString(), {
      session: ctx.session,
      matchDomain: "www.coze.cn",
    });
    const items = _extractList(data);
    if (items.length === 0) return;

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(c.last_updated_time || c.updated_at || c.created_at);
      if (sinceTs && updatedAt <= sinceTs) {
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
    cursor = (data && data.data && data.data.next_cursor) || "";
    if (!cursor || items.length < pageSize) return;
  }
}

async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const url = new URL(BASE + MSG_LIST_PATH(conversationId));
  url.searchParams.set("limit", "200");
  const data = await client.getJson(url.toString(), {
    session: ctx.session,
    matchDomain: "www.coze.cn",
  });
  const msgs = _extractList(data);

  msgs.sort((a, b) => _toMs(a.created_at || a.create_time) - _toMs(b.created_at || b.create_time));

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

function _extractList(data) {
  if (!data) return [];
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.conversations)) return data.data.conversations;
  if (data.data && Array.isArray(data.data.messages)) return data.data.messages;
  if (data.data && Array.isArray(data.data.message_list)) return data.data.message_list;
  if (Array.isArray(data.data)) return data.data;
  return [];
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
        type: (a.type === "image" || /image/i.test(a.mime_type || "")) ? "image" : "file",
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
