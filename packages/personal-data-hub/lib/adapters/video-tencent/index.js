/**
 * §13+ — 腾讯视频 (Tencent Video, com.tencent.qqlive) adapter. §12.1 Phase 13+
 * ROI ⭐⭐ "观看历史". Thin wrapper over _video-base.
 *
 * No field-verified Tencent Video history endpoint is currently shipped.
 * Snapshot import is the default product path. Integrators may explicitly
 * provide both endpoints and a transport through the constructor seam.
 */

"use strict";

const {
  createVideoAdapter,
  parseTime,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../_video-base");
const { extractRecognizedArray } = require("../../source-page");

const NAME = "video-tencent";
const VERSION = "0.1.0";

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
  const raw =
    it.cTypeId != null
      ? it.cTypeId
      : it.typeId != null
        ? it.typeId
        : it.category;
  const key = String(raw == null ? "" : raw).toLowerCase();
  return TYPE_MAP[key] || TYPE_MAP[raw] || it.categoryName || null;
}

function extractItems(resp, stream = "video") {
  return extractRecognizedArray(
    resp,
    [
      ["list"],
      ["data"],
      ["data", "list"],
      ["data", "records"],
      ["data", "videoList"],
    ],
    { source: NAME, stream },
  );
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  const videoId = it.cid || it.vid || it.lid || it.id;
  if (!videoId) return null;
  return {
    videoId: String(videoId),
    title: it.cTitle || it.title || it.videoTitle || it.name || "(未知视频)",
    category: mapCategory(it),
    episode:
      it.episode ||
      it.vTitle ||
      (it.episodeNum ? `第${it.episodeNum}集` : null),
    channel: it.channelName || null,
    durationSec: Number.isFinite(it.duration)
      ? it.duration
      : Number.isFinite(it.totalTime)
        ? it.totalTime
        : null,
    url: it.url || (it.cid ? `https://v.qq.com/x/cover/${it.cid}.html` : null),
    occurredAt: parseTime(
      it.viewTime || it.updateTime || it.markTime || it.time,
    ),
  };
}

const TencentVideoAdapter = createVideoAdapter({
  NAME,
  VERSION,
  platform: "tencent-video",
  customCookieApiOnly: true,
  extractItems,
  mapItem,
});

module.exports = {
  TencentVideoAdapter,
  extractItems,
  mapItem,
  TYPE_MAP,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
