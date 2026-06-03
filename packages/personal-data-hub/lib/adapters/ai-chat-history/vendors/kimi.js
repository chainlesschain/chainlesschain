/**
 * Kimi (Moonshot) vendor adapter — Phase 10.2 wiring.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.2
 *   - login    https://kimi.moonshot.cn/
 *   - convs    GET  https://kimi.moonshot.cn/api/chat/list?offset=N&size=M
 *   - msgs     POST https://kimi.moonshot.cn/api/chat/{convId}/segment/scroll
 *              body {last:0|"<id>", limit:N}
 *   - userinfo GET  https://kimi.moonshot.cn/api/user
 *
 * Kimi pages messages via a `last` cursor (message id) rather than offset.
 * `last:0` returns the most recent N; subsequent calls pass the oldest id
 * from the previous page to walk backward. We collect all then sort by
 * `created_at` ascending before yielding.
 *
 * Response shape (subject to drift; capture fixtures before re-parsing):
 *
 *   /api/chat/list →
 *     { items: [{ id, name, created_at, updated_at, status, last_message,
 *       message_count, status }], total }
 *
 *   /api/chat/{id}/segment/scroll →
 *     { items: [{ id, role, content, created_at, group_id, files: [...] }],
 *       has_more, last_id }
 */

"use strict";

const BASE = "https://kimi.moonshot.cn";
const CONV_LIST_PATH = "/api/chat/list";
const USER_PATH = "/api/user";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) {
    throw new Error("kimi: ctx.httpClient required");
  }
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_PATH, { session: ctx.session });
    if (data && (data.id || data.user_id)) {
      return { ok: true, userId: data.id || data.user_id };
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

  let offset = 0;
  while (true) {
    const url = new URL(BASE + CONV_LIST_PATH);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("size", String(pageSize));

    const data = await client.getJson(url.toString(), { session: ctx.session });
    const items = data && Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) return;

    let stopped = false;
    for (const c of items) {
      const updatedAt = _toMs(c.updated_at || c.created_at);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "kimi",
        originalId: String(c.id),
        title: c.name || undefined,
        modelName: undefined, // kimi doesn't expose per-conv model on list
        createdAt: _toMs(c.created_at),
        updatedAt,
        messageCount: c.message_count || undefined,
        archived: c.status === "archived",
        extra: {
          lastMessage: c.last_message,
        },
      };
    }
    if (stopped) return;
    offset += items.length;
    if (typeof data.total === "number" && offset >= data.total) return;
  }
}

async function *listMessages(ctx, conversationId, opts = {}) {
  const client = _ensureClient(ctx);
  const pageSize = Number.isFinite(opts.pageSize) ? opts.pageSize : DEFAULT_PAGE_SIZE;
  const url = BASE + "/api/chat/" + encodeURIComponent(conversationId) + "/segment/scroll";

  const all = [];
  let last = "0"; // kimi convention: 0 = most recent
  let safety = 0;
  while (safety < 50) {
    safety++;
    const data = await client.postJson(url, { last, limit: pageSize }, { session: ctx.session });
    const items = data && Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;
    all.push(...items);
    if (!data.has_more) break;
    last = String(data.last_id || items[items.length - 1].id);
  }

  // Sort by created_at ascending for stable chronological yield.
  all.sort((a, b) => _toMs(a.created_at) - _toMs(b.created_at));
  for (const m of all) {
    yield {
      vendor: "kimi",
      originalId: String(m.id),
      conversationId: String(conversationId),
      role: _normalizeRole(m.role),
      content: _buildContent(m),
      createdAt: _toMs(m.created_at),
      parentMessageId: m.parent_id ? String(m.parent_id) : undefined,
      modelName: m.model || undefined,
      extra: m.group_id ? { groupId: m.group_id } : undefined,
    };
  }
}

function _normalizeRole(r) {
  if (r === "user" || r === "USER") return "user";
  if (r === "assistant" || r === "ASSISTANT" || r === "bot") return "assistant";
  if (r === "system" || r === "SYSTEM") return "system";
  return r || "assistant";
}

function _buildContent(m) {
  const content = { text: m.content || "" };
  if (Array.isArray(m.files) && m.files.length > 0) {
    content.attachments = m.files
      .map((f) => ({
        type: (f.type === "image" || /image/i.test(f.mime_type || "")) ? "image" : "file",
        filename: f.name,
        url: f.preview_url || f.url || f.download_url,
        size: f.size,
        mimeType: f.mime_type,
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
  name: "kimi",
  displayName: "Kimi",
  androidPackage: "com.moonshot.kimichat",
  loginUrl: "https://kimi.moonshot.cn/",
  cookieDomains: ["kimi.moonshot.cn", ".moonshot.cn"],
  rateLimits: { perMinute: 30, minIntervalMs: 1500 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _normalizeRole, _buildContent, BASE, CONV_LIST_PATH },
};
