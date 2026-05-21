/**
 * Phase 13.8(+) — Toutiao 今日头条 adapter (v0.1 scaffold).
 *
 * Source: 今日头条 Android app stores user history in SQLite (encrypted in
 * newer versions, plaintext in older 7.x builds). Schema is reverse-engineered
 * from the open-source sjqz parsers project and is pinned at scaffold quality
 * only — Phase 13.10 will fixture-pin real field names after Xiaomi 24115RA8EC
 * real-device E2E.
 *
 * Conjectured tables (待 fixture pin in Phase 13.10):
 *   - read_history          read articles
 *   - collection_article    user-collected (saved) articles
 *   - search_history        user search queries
 *
 * Each row → Event with subtype "browse" (read_history) / "like" (collection)
 * / "post" (search_history reframed as a self-authored "search" event).
 *
 * Mirrors social-bilibili adapter contract; differs only in table list +
 * default sensitivity (toutiao reading patterns may include political /
 * health topics so sensitivity is bumped to "high").
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-toutiao";
const VERSION = "0.1.0";

class ToutiaoAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("ToutiaoAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "parse:toutiao-read-history",
      "parse:toutiao-collection",
      "parse:toutiao-search",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "toutiao:read_history (item_id / title / read_time / category)",
        "toutiao:collection_article (item_id / title / save_time)",
        "toutiao:search_history (keyword / search_time)",
      ],
      // Bumped vs bilibili: news reading reveals political / medical interest.
      sensitivity: "high",
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
      const reads =
        trySelect(db, "SELECT * FROM read_history ORDER BY read_time DESC LIMIT 5000") || [];
      for (const row of reads) {
        yield {
          adapter: NAME,
          originalId: `read-${row.id || row._id || row.item_id}`,
          capturedAt: parseTime(row.read_time || row.time || row.create_time),
          payload: { row, kind: "read" },
        };
      }

      const collections =
        trySelect(
          db,
          "SELECT * FROM collection_article ORDER BY save_time DESC LIMIT 5000",
        ) || [];
      for (const row of collections) {
        yield {
          adapter: NAME,
          originalId: `collect-${row.id || row.item_id}`,
          capturedAt: parseTime(row.save_time || row.time),
          payload: { row, kind: "collection" },
        };
      }

      const searches =
        trySelect(
          db,
          "SELECT * FROM search_history ORDER BY search_time DESC LIMIT 5000",
        ) || [];
      for (const row of searches) {
        yield {
          adapter: NAME,
          originalId: `search-${row.id || row.keyword + ":" + row.search_time}`,
          capturedAt: parseTime(row.search_time || row.time),
          payload: { row, kind: "search" },
        };
      }
    } finally {
      try {
        db.close();
      } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload || !raw.payload.row) {
      throw new Error("ToutiaoAdapter.normalize: row missing");
    }
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt =
      parseTime(row.read_time || row.save_time || row.search_time || row.time) || now;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === "collection") {
      return {
        events: [
          {
            id: newId(),
            type: "event",
            subtype: "like",
            occurredAt,
            actor: "person-self",
            content: { title: row.title || row.article_title || "(no title)" },
            ingestedAt: now,
            source,
            extra: {
              itemId: row.item_id || null,
              category: row.category || null,
              author: row.author || null,
              source: row.source || null,
            },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }
    if (kind === "search") {
      return {
        events: [
          {
            id: newId(),
            type: "event",
            subtype: "post",
            occurredAt,
            actor: "person-self",
            content: { title: row.keyword || row.query || "(empty query)" },
            ingestedAt: now,
            source,
            extra: { kind: "search", keyword: row.keyword || row.query || null },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }
    // read → browse event
    return {
      events: [
        {
          id: newId(),
          type: "event",
          subtype: "browse",
          occurredAt,
          actor: "person-self",
          content: { title: row.title || row.article_title || "(no title)" },
          ingestedAt: now,
          source,
          extra: {
            itemId: row.item_id || null,
            category: row.category || null,
            author: row.author || null,
            readDuration: row.read_duration || row.duration || null,
          },
        },
      ],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

function trySelect(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (_e) {
    return null;
  }
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

module.exports = { ToutiaoAdapter, NAME, VERSION };
