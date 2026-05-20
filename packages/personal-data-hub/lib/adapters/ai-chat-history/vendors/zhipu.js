/**
 * 智谱清言 (Zhipu Qingyan) vendor adapter — Phase 10.2 wiring.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.4
 *   - login  https://chatglm.cn/
 *   - convs  GET /chatglm/backend-api/v1/conversation/list
 *   - msgs   GET /chatglm/backend-api/v1/conversation/<id>
 *   - cookie chatglm_token (Bearer-style — re-projected from cookie when
 *            present; otherwise relies on cookie auth alone)
 *
 * GLM-4 messages have optional `tool_calls` for web-search injection; we
 * thread those into RawMessage.extra.toolCalls so schema-map preserves them
 * across the KG / RAG flow.
 *
 * Endpoint shapes are reverse-engineered + SUBJECT TO DRIFT.
 */

"use strict";

const BASE = "https://chatglm.cn";
const CONV_LIST_PATH = "/chatglm/backend-api/v1/conversation/list";
const CONV_DETAIL_PATH = "/chatglm/backend-api/v1/conversation/";
const USER_INFO_PATH = "/chatglm/backend-api/v1/user/info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error("zhipu: ctx.httpClient required");
  }
  return ctx.httpClient;
}

function _authHeader(session) {
  const token = session && session.get("chatglm_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, {
      session: ctx.session,
      headers: _authHeader(ctx.session),
    });
    if (data && data.status === 0 && data.result) {
      return { ok: true, userId: data.result.user_id || data.result.id };
    }
    if (data && (data.user_id || data.id)) {
      return { ok: true, userId: data.user_id || data.id };
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

  let page = 1;
  while (true) {
    const url = new URL(BASE + CONV_LIST_PATH);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));

    const data = await client.getJson(url.toString(), {
      session: ctx.session,
      headers: _authHeader(ctx.session),
    });
    const list = _extractList(data);
    if (list.length === 0) return;

    let stopped = false;
    for (const c of list) {
      const updatedAt = _toMs(c.update_time || c.updateTime || c.create_time);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "zhipu",
        originalId: String(c.conversation_id || c.id),
        title: c.title || c.summary || undefined,
        modelName: c.model || c.model_name || undefined,
        createdAt: _toMs(c.create_time || c.createTime),
        updatedAt,
        messageCount: c.message_count || undefined,
        archived: Boolean(c.archived),
        extra: { assistantId: c.assistant_id },
      };
    }
    if (stopped) return;
    if (list.length < pageSize) return;
    page++;
    if (page > 200) return;
  }
}

async function *listMessages(ctx, conversationId, _opts = {}) {
  const client = _ensureClient(ctx);
  const url = BASE + CONV_DETAIL_PATH + encodeURIComponent(conversationId);
  const data = await client.getJson(url, {
    session: ctx.session,
    headers: _authHeader(ctx.session),
  });

  // GLM detail returns { result: { messages: [...] } } or { messages: [...] }.
  let msgs = [];
  if (data && data.result && Array.isArray(data.result.messages)) msgs = data.result.messages;
  else if (data && Array.isArray(data.messages)) msgs = data.messages;
  else if (data && data.result && Array.isArray(data.result.history)) msgs = data.result.history;

  msgs.sort((a, b) => _toMs(a.create_time || a.timestamp) - _toMs(b.create_time || b.timestamp));

  for (const m of msgs) {
    yield {
      vendor: "zhipu",
      originalId: String(m.id || m.message_id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.role || m.sender),
      content: _buildContent(m),
      createdAt: _toMs(m.create_time || m.timestamp),
      parentMessageId: m.parent_id ? String(m.parent_id) : undefined,
      modelName: m.model || undefined,
      extra: {
        toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined,
        searchQuery: m.search_query,
      },
    };
  }
}

function _extractList(data) {
  if (!data) return [];
  if (Array.isArray(data.result)) return data.result;
  if (data.result && Array.isArray(data.result.list)) return data.result.list;
  if (data.result && Array.isArray(data.result.conversations)) return data.result.conversations;
  if (Array.isArray(data.conversations)) return data.conversations;
  if (Array.isArray(data.list)) return data.list;
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
        filename: a.name || a.file_name,
        url: a.url || a.download_url,
        size: a.size,
        mimeType: a.mime_type,
      }))
      .filter((a) => a.url || a.filename);
  }
  if (Array.isArray(m.images) && m.images.length > 0) {
    content.attachments = (content.attachments || []).concat(
      m.images.map((i) => ({ type: "image", url: i.url || i, mimeType: "image/png" })),
    );
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
  name: "zhipu",
  displayName: "智谱清言",
  androidPackage: "com.zhipuai.qingyan",
  loginUrl: "https://chatglm.cn/",
  cookieDomains: ["chatglm.cn", ".chatglm.cn"],
  rateLimits: { perMinute: 20, minIntervalMs: 2000 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, _authHeader, _extractList, BASE },
};
