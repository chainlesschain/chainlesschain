"use strict";
/*
 * Generic salvage → vault ingest (multi-app, correct source attribution).
 *
 * The leaf-page salvager recovers raw {rowid, cols} tuples from a /proc/mem
 * dump of ANY app. This maps them into MESSAGE events and writes them straight
 * to the vault with the CORRECT per-app `source.adapter` — so 抖音 data shows as
 * social-douyin, 头条 as social-toutiao, 微信 as wechat, etc., instead of all
 * being mis-attributed to one adapter.
 *
 * Why direct vault.putBatch (not registry.syncAdapter): the registry path runs
 * an adapter's normalize(), which hard-stamps that adapter's name as the source.
 * For salvaged cross-app data we need to stamp the source per the app the dump
 * came from. Building events here + putBatch keeps attribution correct and is
 * engine-agnostic. Events are tagged `extra.capturedBy = "mem-salvage"` for
 * provenance + `extra.salvaged = true`.
 *
 * Authorization: only on data you are entitled to (your own device/account).
 * Docs: docs/internal/pdh-db-decryption-runbook.md (Method B).
 */
const { newId } = require("../ids");
const { salvageFile } = require("./leaf-salvage");
const {
  mapMsgRecords,
  inferMsgColumns,
} = require("../adapters/social-douyin-adb/salvage-mapper");

const SALVAGE_VERSION = "salvage-0.1";

// appKey → { sourceAdapter (vault source.adapter, = the app's canonical adapter
// name so byApp aggregation attributes correctly), platform }. Unknown apps
// fall back to a "salvage:<app>" source so they're still distinct + traceable.
const APP_SALVAGE = Object.freeze({
  douyin: { sourceAdapter: "social-douyin", platform: "douyin" },
  toutiao: { sourceAdapter: "social-toutiao", platform: "toutiao" },
  kuaishou: { sourceAdapter: "social-kuaishou", platform: "kuaishou" },
  xiaohongshu: { sourceAdapter: "social-xiaohongshu", platform: "xiaohongshu" },
  weibo: { sourceAdapter: "social-weibo", platform: "weibo" },
  wechat: { sourceAdapter: "wechat", platform: "wechat" },
  qq: { sourceAdapter: "qq", platform: "qq" },
});

function resolveApp(app) {
  const key = String(app || "douyin").toLowerCase();
  return APP_SALVAGE[key] || { sourceAdapter: `salvage:${key}`, platform: key };
}

// Stable, content-derived hash → dedup key. Same message salvaged again
// (re-scan) collides on ON CONFLICT(source_adapter, source_original_id) and
// updates rather than duplicating. Tiny FNV-1a over the salient fields.
function _stableKey(parts) {
  const s = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Map salvaged records → MESSAGE events tagged with the per-app source.
 * @param {Array<{rowid,cols}>} records
 * @param {{ app?: string, columns?: string[], now?: number }} [opts]
 * @returns {{ events: object[], mapped: number, columns: string[], sourceAdapter: string }}
 */
function buildSalvageEvents(records, opts = {}) {
  const cfg = resolveApp(opts.app);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const columns = Array.isArray(opts.columns) && opts.columns.length
    ? opts.columns
    : inferMsgColumns(records || []);
  const messages = mapMsgRecords(records || [], columns);
  const events = [];
  for (const m of messages) {
    const text = typeof m.text === "string" ? m.text : "";
    const occurredAt = Number.isFinite(m.createdTimeMs) && m.createdTimeMs > 0
      ? m.createdTimeMs
      : now;
    const key = _stableKey([
      cfg.platform,
      String(m.conversationId || m.senderUid || ""),
      String(occurredAt),
      text.slice(0, 64),
    ]);
    events.push({
      id: newId(),
      type: "event",
      subtype: "message",
      occurredAt,
      actor: "person-self",
      content: {
        title: text ? text.slice(0, 80) : "(非文本消息)",
        text,
      },
      ingestedAt: now,
      source: {
        adapter: cfg.sourceAdapter,
        adapterVersion: SALVAGE_VERSION,
        originalId: `salvage:${cfg.platform}:${key}`,
        capturedAt: occurredAt,
        // schema enum: export|api|sqlite|accessibility|ocr|manual. Salvaged
        // pages ARE SQLite rows; mem-salvage provenance lives in extra.salvaged.
        capturedBy: "sqlite",
      },
      extra: {
        platform: cfg.platform,
        channel: "im",
        salvaged: true,
        senderUid: m.senderUid || null,
        conversationId: m.conversationId || null,
        contentBlob: typeof m.contentBlob === "string" ? m.contentBlob : null,
      },
    });
  }
  return { events, mapped: messages.length, columns, sourceAdapter: cfg.sourceAdapter };
}

/**
 * Salvage a memory dump and write the recovered messages straight into the
 * vault with the correct per-app source. Returns counts.
 *
 * @param {object} vault  LocalVault (must expose putBatch)
 * @param {string} dumpPath
 * @param {{ app?: string, columns?: string[], unaligned?: boolean, pageSize?: number, minCols?: number, now?: number }} [opts]
 * @returns {{ ingested: number, salvaged: number, app: string, sourceAdapter: string, leafPages: number }}
 */
function salvageDumpToVault(vault, dumpPath, opts = {}) {
  if (!vault || typeof vault.putBatch !== "function") {
    throw new TypeError("salvageDumpToVault: vault with putBatch required");
  }
  if (typeof dumpPath !== "string" || !dumpPath) {
    throw new TypeError("salvageDumpToVault: dumpPath required");
  }
  const { records, pages } = salvageFile(dumpPath, {
    pageSize: opts.pageSize,
    minCols: opts.minCols,
    unaligned: opts.unaligned,
    stride: opts.stride,
  });
  const built = buildSalvageEvents(records, opts);
  const res = built.events.length
    ? vault.putBatch({ events: built.events })
    : { events: 0 };
  return {
    ingested: res.events || 0,
    salvaged: records.length,
    mapped: built.mapped,
    app: String(opts.app || "douyin").toLowerCase(),
    sourceAdapter: built.sourceAdapter,
    leafPages: pages,
  };
}

module.exports = {
  APP_SALVAGE,
  resolveApp,
  buildSalvageEvents,
  salvageDumpToVault,
};
