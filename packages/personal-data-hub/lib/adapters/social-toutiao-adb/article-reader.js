/**
 * Toutiao on-device article reader — recovers the user's feed/read articles
 * from the app's local `news_article.db` (table `article`), a plaintext SQLite
 * DB. No signing/encryption needed.
 *
 * Why this exists (real-device 2026-06-18, user's exported plaintext DB):
 *   - `article` rows are the local feed cache (48 rows on the test export). The
 *     title is NOT a column — it lives in the `share_info` JSON blob
 *     ({title, share_url, ...}); `ext_json` is a heavier fallback. `behot_time`
 *     is when the item surfaced; `read_timestamp>0` ⇒ actually opened;
 *     `is_user_digg`/`is_user_repin` ⇒ engagement.
 *   - Modest signal (feed-shown ≈ weak interest; digg/read ≈ strong), but
 *     titled + plaintext, so it's a usable "articles I browsed" stream.
 *
 * Emits BROWSE events under source.adapter `social-toutiao` (the canonical
 * adapter name, so byApp aggregation attributes correctly). Stable originalId
 * (`social-toutiao:article:<group_id>`) → re-ingest UPDATES, not duplicates.
 *
 * Authorization: only on your own device/account.
 */
"use strict";

const { newId } = require("../../ids");
const {
  _internals: { loadDatabaseClass },
} = require("../social-bilibili-adb/chromium-cookies-reader");

const ARTICLE_TABLE = "article";
const READER_VERSION = "toutiao-article-0.1";
const TITLE_SUFFIX = /\s*-\s*今日头条\s*$/;

/** seconds-or-ms epoch → ms (heuristic: > 1e12 ⇒ already ms). */
function toEpochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function safeParse(s) {
  if (typeof s !== "string" || s.length < 2) return null;
  try {
    return JSON.parse(s);
  } catch (_e) {
    return null;
  }
}

/** Title lives in share_info.title (or ext_json.title); strip the brand suffix. */
function extractTitle(row) {
  const si = safeParse(row.share_info);
  let title = si && (si.title || si.share_title);
  if (!title) {
    const ej = safeParse(row.ext_json);
    title = ej && (ej.title || ej.share_title || (ej.article && ej.article.title));
  }
  if (typeof title !== "string" || !title.trim()) return null;
  return title.replace(TITLE_SUFFIX, "").trim();
}

function extractUrl(row) {
  const si = safeParse(row.share_info);
  const u = (si && si.share_url) || row.share_url || null;
  if (typeof u !== "string" || !u) return null;
  // Drop the noisy share/tracking query so the same article dedups by url too.
  return u.split("?")[0];
}

function extractCategory(row) {
  const u = row.share_url || "";
  const m = /[?&]category_new=([^&]+)/.exec(u);
  if (!m) return null;
  // A malformed percent-sequence in a stored share_url must not throw.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Read article rows + parse them into structured records (pure once a Database
 * class is injected). Newest-first.
 *
 * @returns {{articles: Array<{groupId,title,url,category,behotTime,readTimestamp,digg,repin}>}}
 */
function readToutiaoArticles(dbPath, opts = {}) {
  const Database = opts._databaseClass || loadDatabaseClass();
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5000;
  const db = new Database(dbPath, { readonly: true });
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(ARTICLE_TABLE);
    if (!exists) return { articles: [] };

    const cols = new Set(
      db.prepare(`PRAGMA table_info("${ARTICLE_TABLE}")`).all().map((c) => c.name),
    );
    const hasBehot = cols.has("behot_time");
    const rows = db
      .prepare(
        `SELECT * FROM "${ARTICLE_TABLE}"${hasBehot ? " ORDER BY behot_time DESC" : ""} LIMIT ${limit}`,
      )
      .all();

    const articles = [];
    for (const r of rows) {
      const groupId =
        r.group_id != null ? String(r.group_id) : r.item_id != null ? String(r.item_id) : null;
      if (!groupId) continue;
      const title = extractTitle(r);
      if (!title) continue; // untitled cache rows carry no signal
      articles.push({
        groupId,
        title,
        url: extractUrl(r),
        category: extractCategory(r),
        behotTime: hasBehot ? toEpochMs(r.behot_time) : null,
        readTimestamp: cols.has("read_timestamp") ? toEpochMs(r.read_timestamp) : null,
        digg: cols.has("is_user_digg") ? !!r.is_user_digg : false,
        repin: cols.has("is_user_repin") ? !!r.is_user_repin : false,
      });
    }
    return { articles };
  } finally {
    try {
      db.close();
    } catch (_e) {
      /* best-effort */
    }
  }
}

/**
 * Map article records → BROWSE events tagged with the toutiao source.
 * @returns {{events: object[]}}
 */
function buildArticleEvents(articles, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const events = [];
  for (const a of articles || []) {
    if (!a || !a.groupId || !a.title) continue;
    const occurredAt =
      (Number.isFinite(a.readTimestamp) && a.readTimestamp) ||
      (Number.isFinite(a.behotTime) && a.behotTime) ||
      now;
    events.push({
      id: newId(),
      type: "event",
      subtype: "browse",
      occurredAt,
      actor: "person-self",
      content: { title: a.title, text: a.title },
      ingestedAt: now,
      source: {
        adapter: "social-toutiao",
        adapterVersion: READER_VERSION,
        originalId: `social-toutiao:article:${a.groupId}`,
        capturedAt: occurredAt,
        capturedBy: "sqlite",
      },
      extra: {
        platform: "toutiao",
        kind: "article",
        groupId: a.groupId,
        url: a.url || null,
        category: a.category || null,
        digg: a.digg,
        repin: a.repin,
        read: Number.isFinite(a.readTimestamp) && a.readTimestamp > 0,
      },
    });
  }
  return { events };
}

/**
 * Read news_article.db and write the article BROWSE events into the vault.
 * @param {object} vault LocalVault (must expose putBatch)
 * @param {string} dbPath path to news_article.db
 */
function articlesToVault(vault, dbPath, opts = {}) {
  if (!vault || typeof vault.putBatch !== "function") {
    throw new TypeError("articlesToVault: vault with putBatch required");
  }
  if (typeof dbPath !== "string" || !dbPath) {
    throw new TypeError("articlesToVault: dbPath required");
  }
  const { articles } = readToutiaoArticles(dbPath, opts);
  const built = buildArticleEvents(articles, opts);
  const res = built.events.length
    ? vault.putBatch({ events: built.events })
    : { events: 0 };
  return {
    ingested: res.events || 0,
    articles: articles.length,
    digg: articles.filter((a) => a.digg).length,
    read: articles.filter((a) => Number.isFinite(a.readTimestamp) && a.readTimestamp > 0).length,
  };
}

module.exports = {
  ARTICLE_TABLE,
  readToutiaoArticles,
  buildArticleEvents,
  articlesToVault,
  _internals: { toEpochMs, extractTitle, extractUrl, extractCategory },
};
