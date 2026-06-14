/**
 * §13+ — 爱奇艺 (iQiyi, com.qiyi.video) adapter. §12.1 Phase 13+ ROI ⭐⭐
 * "观看历史". Thin wrapper over _video-base.
 *
 * iQiyi exposes the user's watch history + favourites (追剧) via iqiyi.com APIs;
 * this adapter supplies the endpoints + field mapping, the base handles snapshot
 * + cookie-api orchestration + normalize (MEDIA / LIKE event + MEDIA item).
 * Endpoints best-effort + overridable (not field-verified — FAMILY-23 playbook).
 */

"use strict";

const { createVideoAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_video-base");

const NAME = "video-iqiyi";
const VERSION = "0.1.0";

const WATCH_URL = "https://l.rcd.iqiyi.com/apis/rcd/myRC";
const FAVOURITE_URL = "https://collect.if.iqiyi.com/japi/collect/list";

// iQiyi channel/category code → label (best-effort).
const CHANNEL_MAP = {
  1: "movie",
  2: "tv",
  3: "variety",
  4: "anime",
  6: "documentary",
};

function mapCategory(it) {
  const c = it.channelId != null ? it.channelId : it.chnId;
  if (c != null && CHANNEL_MAP[c]) return CHANNEL_MAP[c];
  return it.channelName || it.categoryName || it.category || null;
}

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.list)) return resp.list;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.rc)) return d.rc;
  }
  return [];
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  const videoId = it.tvId || it.tvid || it.albumId || it.qipuId || it.id;
  if (!videoId) return null;
  return {
    videoId: String(videoId),
    title: it.albumName || it.videoName || it.title || it.name || "(未知视频)",
    category: mapCategory(it),
    episode: it.videoName && it.albumName && it.videoName !== it.albumName ? it.videoName : it.order ? `第${it.order}集` : null,
    channel: it.channelName || null,
    durationSec: Number.isFinite(it.videoDuration) ? it.videoDuration : Number.isFinite(it.duration) ? it.duration : null,
    url: it.pageUrl || it.url || (it.tvId ? `https://www.iqiyi.com/v_${it.tvId}.html` : null),
    occurredAt: parseTime(it.addtime || it.playTime || it.updateTime || it.timestamp),
  };
}

const IqiyiVideoAdapter = createVideoAdapter({
  NAME,
  VERSION,
  platform: "iqiyi",
  watchUrl: WATCH_URL,
  favouriteUrl: FAVOURITE_URL,
  extractItems,
  mapItem,
});

module.exports = { IqiyiVideoAdapter, extractItems, mapItem, CHANNEL_MAP, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
