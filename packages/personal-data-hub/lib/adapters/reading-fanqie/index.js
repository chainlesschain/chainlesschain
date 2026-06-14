/**
 * §12.1 Phase 13+ — 番茄免费小说 (Fanqie, com.dragon.read) adapter, "阅读历史".
 * Device-discovered gap (2026-06-15). Thin wrapper over _reading-base.
 *
 * BEST-EFFORT: fanqienovel.com endpoints are FABRICATED placeholders
 * (overridable, NOT field-verified — FAMILY-23 playbook); snapshot mode is the
 * reliable path. Low sensitivity (reading history).
 */

"use strict";

const { createReadingAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_reading-base");

const NAME = "reading-fanqie";
const VERSION = "0.1.0";

const READ_URL = "https://fanqienovel.com/api/reader/history";
const FAVOURITE_URL = "https://fanqienovel.com/api/bookshelf/list";

function extractItems(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  const d = resp.data;
  if (d && typeof d === "object") {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.books)) return d.books;
    if (Array.isArray(d.book_list)) return d.book_list;
  }
  return [];
}

function mapItem(it) {
  if (!it || typeof it !== "object") return null;
  const id = it.book_id || it.bookId || it.id || it.bookid;
  if (!id) return null;
  let progress = it.progress != null ? it.progress : it.read_progress;
  if (typeof progress === "string") progress = parseFloat(progress);
  return {
    bookId: String(id),
    title: it.book_name || it.bookName || it.title || it.name || "(未知书籍)",
    author: it.author || it.author_name || null,
    category: it.category || it.category_name || it.genre || null,
    chapter: it.last_chapter_title || it.chapter || it.last_chapter || null,
    progress: Number.isFinite(progress) ? progress : null,
    url: it.url || (id ? `https://fanqienovel.com/page/${id}` : null),
    occurredAt: parseTime(it.read_time || it.last_read_time || it.update_time || it.add_time),
  };
}

const FanqieReadingAdapter = createReadingAdapter({
  NAME,
  VERSION,
  platform: "fanqie",
  readUrl: READ_URL,
  favouriteUrl: FAVOURITE_URL,
  extractItems,
  mapItem,
});

module.exports = { FanqieReadingAdapter, extractItems, mapItem, NAME, VERSION, SNAPSHOT_SCHEMA_VERSION };
