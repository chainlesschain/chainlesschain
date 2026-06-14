/**
 * §13+ — 西瓜视频 (Xigua / Ixigua, com.ss.android.article.video) adapter.
 * §12.1 Phase 13+ ROI ⭐⭐ "观看历史". Thin wrapper over _video-base.
 *
 * 西瓜视频 (ByteDance) exposes the user's watch history + favourites via
 * ixigua.com APIs; this adapter supplies the endpoints + field mapping, the base
 * handles snapshot + cookie-api orchestration + normalize (MEDIA / LIKE event +
 * MEDIA item). Endpoints best-effort + overridable (some need a ByteDance signed
 * token via opts.signProvider — not field-verified, FAMILY-23 playbook).
 */

"use strict";

const { createVideoAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_video-base");

const NAME = "video-xigua";
const VERSION = "0.1.0";

const WATCH_URL = "https://api.ixigua.com/api/history/list";
const FAVOURITE_URL = "https://api.ixigua.com/api/favorite/list";

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.list)) return resp.list;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.history)) return d.history;
    if (Array.isArray(d.favorites)) return d.favorites;
  }
  return [];
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  // ByteDance items nest the video under article/item_info on some endpoints.
  const v = it.article || it.item_info || it.video || it;
  const videoId = v.group_id || v.groupId || v.item_id || v.gid || v.vid || v.id || it.group_id || it.id;
  if (!videoId) return null;
  return {
    videoId: String(videoId),
    title: v.title || v.video_title || v.name || it.title || "(未知视频)",
    category: v.category || v.category_name || v.channel || null,
    episode: null,
    channel: v.user_name || v.author_name || v.source || null,
    durationSec: Number.isFinite(v.video_duration)
      ? v.video_duration
      : Number.isFinite(v.duration)
        ? v.duration
        : null,
    url: v.share_url || v.url || (videoId ? `https://www.ixigua.com/${videoId}` : null),
    occurredAt: parseTime(it.behot_time || it.action_time || it.create_time || v.behot_time || v.publish_time),
  };
}

const XiguaVideoAdapter = createVideoAdapter({
  NAME,
  VERSION,
  platform: "xigua",
  watchUrl: WATCH_URL,
  favouriteUrl: FAVOURITE_URL,
  extractItems,
  mapItem,
});

module.exports = { XiguaVideoAdapter, extractItems, mapItem, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
