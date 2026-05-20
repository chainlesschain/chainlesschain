/**
 * Phase 13.2 — Weibo (微博) adapter.
 *
 * Source: Weibo Android app SQLite DBs (per sjqz/parsers/social.py
 * WeiboParser). Three tables of v0 interest:
 *   - post / status     posts the user published
 *   - search_history    queries
 *   - message / direct  private messages
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-weibo";
const VERSION = "0.5.0";

class WeiboAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("WeiboAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:weibo-posts", "parse:weibo-search"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "weibo:posts (text / created_at / reposts_count / comments_count)",
        "weibo:search_history",
        "weibo:messages",
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
      const posts = trySelect(db, "SELECT * FROM post ORDER BY created_at DESC LIMIT 5000")
        || trySelect(db, "SELECT * FROM status ORDER BY created_at DESC LIMIT 5000") || [];
      for (const row of posts) {
        yield {
          adapter: NAME,
          originalId: `post-${row.id || row.mid || row.idstr}`,
          capturedAt: parseTime(row.created_at || row.time),
          payload: { row, kind: "post" },
        };
      }

      const searches = trySelect(db, "SELECT * FROM search_history ORDER BY time DESC LIMIT 5000") || [];
      for (const row of searches) {
        yield {
          adapter: NAME,
          originalId: `search-${row.id || row._id}`,
          capturedAt: parseTime(row.time || row.create_at),
          payload: { row, kind: "search" },
        };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.row) {
      throw new Error("WeiboAdapter.normalize: row missing");
    }
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.created_at || row.time) || now;
    const source = {
      adapter: NAME, adapterVersion: VERSION,
      originalId: raw.originalId, capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === "search") {
      return {
        events: [{
          id: newId(),
          type: "event",
          subtype: "interaction",
          occurredAt,
          actor: "person-self",
          content: {
            title: `搜索: ${row.keyword || row.query || ""}`,
            text: row.keyword || row.query || "",
          },
          ingestedAt: now,
          source,
          extra: { query: row.keyword || row.query, fromAdapter: NAME },
        }],
        persons: [], places: [], items: [], topics: [],
      };
    }

    // Post
    return {
      events: [{
        id: newId(),
        type: "event",
        subtype: "post",
        occurredAt,
        actor: "person-self",
        content: {
          title: (row.text || "").slice(0, 80) || "(空)",
          text: row.text || "",
        },
        ingestedAt: now,
        source,
        extra: {
          weiboMid: row.mid || row.id || row.idstr || null,
          repostsCount: row.reposts_count || row.repost || 0,
          commentsCount: row.comments_count || row.comments || 0,
          likesCount: row.attitudes_count || row.likes || 0,
          source: row.source || null, // 客户端
          location: row.location || row.geo || null,
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

module.exports = { WeiboAdapter, NAME, VERSION };
