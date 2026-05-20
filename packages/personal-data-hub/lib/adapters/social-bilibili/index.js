/**
 * Phase 13.1 — Bilibili (B站) adapter.
 *
 * Source: B站 Android app stores user data in SQLite (per sjqz/parsers/
 * social.py BilibiliParser). Phase 7.5 AndroidExtractor pulls the DB
 * to a local cache; this adapter parses it.
 *
 * Tables (sjqz reference):
 *   - history          watched videos
 *   - bili_favourite   favorited videos / playlists
 *   - bili_user        user profile
 *   - bili_message     私信
 *
 * Each row → Event with subtype "browse" (history) / "like" (favorites)
 * / "message" (DMs) per UnifiedSchema enum.
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-bilibili";
const VERSION = "0.5.0";

class BilibiliAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("BilibiliAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:bilibili-history", "parse:bilibili-favourite"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "bilibili:history (avid / bvid / title / view_at / duration)",
        "bilibili:favourite (folder / video / save_time)",
        "bilibili:message (peer / content / time)",
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
      const history = trySelect(db, "SELECT * FROM history ORDER BY view_at DESC LIMIT 5000") || [];
      for (const row of history) {
        yield {
          adapter: NAME,
          originalId: `history-${row.id || row._id || row.kid || row.bvid || row.avid}`,
          capturedAt: parseTime(row.view_at || row.create_at || row.time),
          payload: { row, kind: "history" },
        };
      }

      const favs = trySelect(db, "SELECT * FROM bili_favourite ORDER BY save_time DESC LIMIT 5000") || [];
      for (const row of favs) {
        yield {
          adapter: NAME,
          originalId: `fav-${row.id || row.fav_id || row.bvid}`,
          capturedAt: parseTime(row.save_time || row.time),
          payload: { row, kind: "favourite" },
        };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.row) {
      throw new Error("BilibiliAdapter.normalize: row missing");
    }
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.view_at || row.save_time || row.create_at || row.time) || now;
    const source = {
      adapter: NAME, adapterVersion: VERSION,
      originalId: raw.originalId, capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === "favourite") {
      return {
        events: [{
          id: newId(),
          type: "event",
          subtype: "like",
          occurredAt,
          actor: "person-self",
          content: {
            title: row.title || row.video_title || "(no title)",
          },
          ingestedAt: now,
          source,
          extra: {
            bvid: row.bvid || null,
            avid: row.avid || null,
            folder: row.folder_name || null,
            uploader: row.uploader || row.up_name || null,
          },
        }],
        persons: [], places: [], items: [], topics: [],
      };
    }
    // history → browse event
    return {
      events: [{
        id: newId(),
        type: "event",
        subtype: "browse",
        occurredAt,
        actor: "person-self",
        content: {
          title: row.title || row.video_title || "(no title)",
        },
        ingestedAt: now,
        source,
        extra: {
          bvid: row.bvid || null,
          avid: row.avid || null,
          duration: row.duration || row.progress || null,
          uploader: row.uploader || row.up_name || null,
          part: row.part_name || null,
        },
      }],
      persons: [], places: [], items: [], topics: [],
    };
  }
}

function trySelect(db, sql) {
  try { return db.prepare(sql).all(); } catch (_e) { return null; }
}

function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

module.exports = { BilibiliAdapter, NAME, VERSION };
