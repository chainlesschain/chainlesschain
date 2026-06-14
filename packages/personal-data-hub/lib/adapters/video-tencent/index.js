/**
 * §13+ — 腾讯视频 (Tencent Video, com.tencent.qqlive) adapter. §12.1 Phase 13+
 * ROI ⭐⭐ "观看历史". Thin wrapper over _video-base.
 *
 * Tencent Video exposes the user's watch history + 追剧/收藏 via v.qq.com APIs;
 * this adapter supplies the endpoints + field mapping, the base handles snapshot
 * + cookie-api orchestration + normalize. Endpoints best-effort + overridable
 * (not field-verified — FAMILY-23 playbook).
 */

"use strict";

const { createVideoAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_video-base");

const NAME = "video-tencent";
const VERSION = "0.1.0";

const WATCH_URL = "https://pbaccess.video.qq.com/trpc.v...history.HistoryServer/GetHistory";
const FAVOURITE_URL = "https://pbaccess.video.qq.com/trpc.v...favorite.FavoriteServer/GetFavorite";

const TYPE_MAP = {
  1: "tv",
  2: "movie",
  3: "variety",
  4: "anime",
  10: "documentary",
  movie: "movie",
  tv: "tv",
  variety: "variety",
  anime: "anime",
};

function mapCategory(it) {
  const raw = it.cTypeId != null ? it.cTypeId : it.typeId != null ? it.typeId : it.category;
  const key = String(raw == null ? "" : raw).toLowerCase();
  return TYPE_MAP[key] || TYPE_MAP[raw] || it.categoryName || null;
}

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.videoList)) return d.videoList;
  }
  return [];
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  const videoId = it.cid || it.vid || it.lid || it.id;
  if (!videoId) return null;
  return {
    videoId: String(videoId),
    title: it.cTitle || it.title || it.videoTitle || it.name || "(未知视频)",
    category: mapCategory(it),
    episode: it.episode || it.vTitle || (it.episodeNum ? `第${it.episodeNum}集` : null),
    channel: it.channelName || null,
    durationSec: Number.isFinite(it.duration) ? it.duration : Number.isFinite(it.totalTime) ? it.totalTime : null,
    url: it.url || (it.cid ? `https://v.qq.com/x/cover/${it.cid}.html` : null),
    occurredAt: parseTime(it.viewTime || it.updateTime || it.markTime || it.time),
  };
}

const TencentVideoAdapter = createVideoAdapter({
  NAME,
  VERSION,
  platform: "tencent-video",
  watchUrl: WATCH_URL,
  favouriteUrl: FAVOURITE_URL,
  extractItems,
  mapItem,
});

module.exports = { TencentVideoAdapter, extractItems, mapItem, TYPE_MAP, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
