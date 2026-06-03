/**
 * Dreamina / 即梦 (ByteDance AI image / video) vendor adapter — Phase 10.2.
 *
 * Reference: docs/design/Adapter_AIChat_History.md §6.8
 *   - login   https://jimeng.jianying.com/  (国内即梦)
 *   - convs   POST /api/workspace/list   ("workspace" = creative project)
 *   - msgs    POST /api/workspace/<id>/items   (every item = prompt + generated images/videos)
 *   - 特别 — schema downstream:
 *       * message.subtype = "ai-image-generation" (set by schema-map.js
 *         when content.generatedImages is non-empty).
 *       * content.generatedImages = [{url, prompt, model, params}].
 *
 * Item shape mapping: a Dreamina "item" is one prompt + N output images.
 * We emit:
 *   - 1 user-role RawMessage carrying the prompt text
 *   - 1 assistant-role RawMessage carrying generatedImages[].
 *
 * Image CDN URLs are SIGNED and expire — schema-map records URL as-is, the
 * UI must download thumbnails on first display + cache locally.
 */

"use strict";

const BASE = "https://jimeng.jianying.com";
const WORKSPACE_LIST_PATH = "/api/workspace/list";
const WORKSPACE_ITEMS_PATH = (id) => `/api/workspace/${encodeURIComponent(id)}/items`;
const USER_INFO_PATH = "/api/user/info";

const DEFAULT_PAGE_SIZE = 30;

function _ensureClient(ctx) {
  if (!ctx || !ctx.httpClient) throw new Error("dreamina: ctx.httpClient required");
  return ctx.httpClient;
}

async function validateCookie(ctx) {
  const client = _ensureClient(ctx);
  try {
    const data = await client.getJson(BASE + USER_INFO_PATH, { session: ctx.session });
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

  let page = 1;
  while (true) {
    const body = { page, page_size: pageSize };
    const data = await client.postJson(BASE + WORKSPACE_LIST_PATH, body, { session: ctx.session });
    const list = _extractList(data);
    if (list.length === 0) return;

    let stopped = false;
    for (const w of list) {
      const updatedAt = _toMs(w.update_time || w.updated_at || w.create_time);
      if (sinceTs && updatedAt <= sinceTs) {
        stopped = true;
        break;
      }
      yield {
        vendor: "dreamina",
        originalId: String(w.workspace_id || w.id),
        title: w.name || w.title || "(无标题作品集)",
        modelName: w.default_model || undefined,
        createdAt: _toMs(w.create_time),
        updatedAt,
        messageCount: w.item_count || undefined,
        archived: Boolean(w.archived),
        extra: { kind: "creative-workspace" },
      };
    }
    if (stopped) return;
    if (list.length < pageSize) return;
    page++;
    if (page > 200) return;
  }
}

async function *listMessages(ctx, workspaceId, _opts = {}) {
  const client = _ensureClient(ctx);
  const url = BASE + WORKSPACE_ITEMS_PATH(workspaceId);
  const data = await client.postJson(url, { workspace_id: String(workspaceId), page_size: 200 }, { session: ctx.session });
  const items = _extractList(data);

  items.sort((a, b) => _toMs(a.create_time) - _toMs(b.create_time));

  for (const item of items) {
    // Yield user prompt message
    const promptText = item.prompt || item.prompt_text || "";
    if (promptText) {
      yield {
        vendor: "dreamina",
        originalId: String(item.id) + ":prompt",
        conversationId: String(workspaceId),
        role: "user",
        content: { text: promptText },
        createdAt: _toMs(item.create_time),
        modelName: item.model,
        extra: { itemId: item.id },
      };
    }
    // Yield assistant message with generated images
    const generatedImages = (Array.isArray(item.outputs) ? item.outputs : [])
      .map((o) => ({
        url: o.url || o.image_url,
        prompt: promptText,
        model: item.model,
        params: o.params || item.params,
      }))
      .filter((g) => g.url);
    if (generatedImages.length > 0) {
      yield {
        vendor: "dreamina",
        originalId: String(item.id) + ":output",
        conversationId: String(workspaceId),
        role: "assistant",
        content: {
          text: undefined,
          generatedImages,
        },
        createdAt: _toMs(item.complete_time || item.create_time),
        parentMessageId: String(item.id) + ":prompt",
        modelName: item.model,
        extra: { itemId: item.id, status: item.status },
      };
    }
  }
}

function _extractList(data) {
  if (!data) return [];
  if (data.data && Array.isArray(data.data.workspaces)) return data.data.workspaces;
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.data && Array.isArray(data.data.items)) return data.data.items;
  if (Array.isArray(data.data)) return data.data;
  return [];
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
  name: "dreamina",
  displayName: "Dreamina",
  androidPackage: "com.bytedance.dreamina",
  loginUrl: "https://jimeng.jianying.com/",
  cookieDomains: ["jimeng.jianying.com", ".jianying.com"],
  rateLimits: { perMinute: 15, minIntervalMs: 2500 },

  validateCookie,
  listConversations,
  listMessages,
};

module.exports = {
  SPEC,
  _internal: { _toMs, _extractList, BASE },
};
