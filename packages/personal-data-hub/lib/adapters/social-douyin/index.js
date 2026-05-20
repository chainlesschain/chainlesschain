/**
 * Phase 13.3 — Douyin (抖音) adapter — short video platform.
 *
 * Source: Douyin Android app SQLite (per sjqz/parsers/douyin.py
 * DouyinParser). Tables of interest:
 *   - history / video_history    watched videos
 *   - favourite / user_favorite  liked / saved
 *   - search_history             queries
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-douyin";
const VERSION = "0.5.0";

class DouyinAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("DouyinAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:douyin-history"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "douyin:history (aweme_id / title / author / view_time / duration)",
        "douyin:favourite",
        "douyin:search_history",
      ],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate() {
    return { ok: true, account: this.account.uid };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      const histories = trySelect(db, "SELECT * FROM video_history ORDER BY view_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM history ORDER BY view_time DESC LIMIT 5000") || [];
      for (const row of histories) {
        yield { adapter: NAME, originalId: `history-${row.id || row.aweme_id}`, capturedAt: parseTime(row.view_time), payload: { row, kind: "history" } };
      }
      const favs = trySelect(db, "SELECT * FROM user_favorite ORDER BY create_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM favourite ORDER BY time DESC LIMIT 5000") || [];
      for (const row of favs) {
        yield { adapter: NAME, originalId: `fav-${row.id || row.aweme_id}`, capturedAt: parseTime(row.create_time || row.time), payload: { row, kind: "favourite" } };
      }
      const searches = trySelect(db, "SELECT * FROM search_history ORDER BY time DESC LIMIT 5000") || [];
      for (const row of searches) {
        yield { adapter: NAME, originalId: `search-${row.id || row._id}`, capturedAt: parseTime(row.time), payload: { row, kind: "search" } };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.view_time || row.create_time || row.time) || now;
    const source = { adapter: NAME, adapterVersion: VERSION, originalId: raw.originalId, capturedAt: occurredAt, capturedBy: "sqlite" };
    const subtypeMap = { history: "browse", favourite: "like", search: "interaction" };
    return {
      events: [{
        id: newId(), type: "event",
        subtype: subtypeMap[kind] || "browse",
        occurredAt, actor: "person-self",
        content: {
          title: row.title || row.desc || row.keyword || row.query || "(no title)",
          ...(row.desc && kind !== "search" ? { text: row.desc } : {}),
        },
        ingestedAt: now, source,
        extra: {
          awemeId: row.aweme_id || null,
          author: row.author || row.nickname || null,
          duration: row.duration || null,
          ...(kind === "search" ? { query: row.keyword || row.query } : {}),
        },
      }],
      persons: [], places: [], items: [], topics: [],
    };
  }
}

function trySelect(db, sql) { try { return db.prepare(sql).all(); } catch (_e) { return null; } }
function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) { const n = parseInt(v, 10); return n > 1e12 ? n : n * 1000; }
    const t = Date.parse(v); return Number.isFinite(t) ? t : null;
  }
  return null;
}
module.exports = { DouyinAdapter, NAME, VERSION };
