/**
 * Phase 13.4 — Xiaohongshu (小红书) adapter.
 *
 * Per sjqz/parsers/lifestyle.py XiaohongshuParser. Tables:
 *   - note / browse_history  viewed notes
 *   - liked_note / favourite collected notes
 *   - search_history         queries
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-xiaohongshu";
const VERSION = "0.5.0";

class XiaohongshuAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("XiaohongshuAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:xhs-history"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: ["xhs:viewed_notes / liked / favourites / search_history"],
      sensitivity: "medium",
      legalGate: false,
    };
  }

  async authenticate() { return { ok: true, account: this.account.uid }; }
  async healthCheck() { return { ok: true, lastChecked: Date.now() }; }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      const histories = trySelect(db, "SELECT * FROM browse_history ORDER BY view_time DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM note ORDER BY view_time DESC LIMIT 5000") || [];
      for (const row of histories) {
        yield { adapter: NAME, originalId: `history-${row.id || row.note_id}`, capturedAt: parseTime(row.view_time), payload: { row, kind: "history" } };
      }
      const likes = trySelect(db, "SELECT * FROM liked_note ORDER BY like_time DESC LIMIT 5000") || [];
      for (const row of likes) {
        yield { adapter: NAME, originalId: `like-${row.id || row.note_id}`, capturedAt: parseTime(row.like_time), payload: { row, kind: "like" } };
      }
      const favs = trySelect(db, "SELECT * FROM favourite ORDER BY save_time DESC LIMIT 5000") || [];
      for (const row of favs) {
        yield { adapter: NAME, originalId: `fav-${row.id || row.note_id}`, capturedAt: parseTime(row.save_time), payload: { row, kind: "favourite" } };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.view_time || row.like_time || row.save_time) || now;
    const source = { adapter: NAME, adapterVersion: VERSION, originalId: raw.originalId, capturedAt: occurredAt, capturedBy: "sqlite" };
    const subtypeMap = { history: "browse", like: "like", favourite: "like" };
    return {
      events: [{
        id: newId(), type: "event",
        subtype: subtypeMap[kind] || "browse",
        occurredAt, actor: "person-self",
        content: { title: row.title || row.note_title || "(no title)" },
        ingestedAt: now, source,
        extra: { noteId: row.note_id || null, author: row.author || row.nickname || null, kind },
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
module.exports = { XiaohongshuAdapter, NAME, VERSION };
