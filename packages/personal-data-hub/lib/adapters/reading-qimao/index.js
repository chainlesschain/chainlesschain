/**
 * §12.1 Phase 13+ — 七猫免费小说 (Qimao, com.phoenix.read) adapter, "阅读历史".
 * Device-discovered gap (2026-06-15). Thin wrapper over _reading-base.
 *
 * Snapshot import is supported. Custom live collection requires caller-supplied
 * captured endpoints. Low sensitivity (reading history).
 */

"use strict";

const { createReadingAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_reading-base");

const NAME = "reading-qimao";
const VERSION = "0.2.0";

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.books)) return d.books;
    if (Array.isArray(d.shelf)) return d.shelf;
  }
  return [];
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.book_id || it.bookId || it.id;
  if (!id) return null;
  let progress = it.progress != null ? it.progress : it.read_proportion;
  if (typeof progress === "string") progress = parseFloat(progress);
  return {
    bookId: String(id),
    title: it.title || it.book_title || it.book_name || it.name || "(未知书籍)",
    author: it.author || it.author_name || null,
    category: it.category || it.classify || it.genre || null,
    chapter: it.chapter_name || it.last_chapter || it.chapter || null,
    progress: Number.isFinite(progress) ? progress : null,
    url: it.url || null,
    occurredAt: parseTime(it.read_time || it.last_read_time || it.update_time),
  };
}

const QimaoReadingAdapter = createReadingAdapter({
  NAME,
  VERSION,
  platform: "qimao",
  extractItems,
  mapItem,
});

module.exports = { QimaoReadingAdapter, extractItems, mapItem, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
