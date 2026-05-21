/**
 * Phase 13.9(+) — Kuaishou 快手 adapter (v0.1 scaffold).
 *
 * Source: 快手 Android app stores user history in SQLite under
 * /data/data/com.smile.gifmaker/databases/. Schema is reverse-engineered
 * from sjqz parsers and pinned at scaffold quality only — Phase 13.10 will
 * fixture-pin real field names after Xiaomi 24115RA8EC E2E.
 *
 * Conjectured tables (待 fixture pin):
 *   - photo_history       watched short-videos (kuaishou calls them "photos")
 *   - user_collect        collected (saved) videos
 *   - search_record       user search queries
 *
 * Each row → Event with subtype "browse" (photo_history) /
 * "like" (user_collect) / "post" (search_record reframed as a self-authored
 * search event).
 *
 * Mirrors social-bilibili adapter contract; sensitivity stays "medium"
 * (short-video watch history mainly reveals entertainment preference).
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "social-kuaishou";
const VERSION = "0.1.0";

class KuaishouAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.uid) {
      throw new Error("KuaishouAdapter: opts.account.uid required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "parse:kuaishou-photo-history",
      "parse:kuaishou-user-collect",
      "parse:kuaishou-search",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "kuaishou:photo_history (photo_id / caption / view_time / duration / author_id)",
        "kuaishou:user_collect (photo_id / caption / collect_time)",
        "kuaishou:search_record (keyword / search_time)",
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
      const watched =
        trySelect(
          db,
          "SELECT * FROM photo_history ORDER BY view_time DESC LIMIT 5000",
        ) || [];
      for (const row of watched) {
        yield {
          adapter: NAME,
          originalId: `photo-${row.id || row._id || row.photo_id}`,
          capturedAt: parseTime(row.view_time || row.time || row.create_time),
          payload: { row, kind: "watch" },
        };
      }

      const collected =
        trySelect(
          db,
          "SELECT * FROM user_collect ORDER BY collect_time DESC LIMIT 5000",
        ) || [];
      for (const row of collected) {
        yield {
          adapter: NAME,
          originalId: `collect-${row.id || row.photo_id}`,
          capturedAt: parseTime(row.collect_time || row.time),
          payload: { row, kind: "collect" },
        };
      }

      const searches =
        trySelect(
          db,
          "SELECT * FROM search_record ORDER BY search_time DESC LIMIT 5000",
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
      throw new Error("KuaishouAdapter.normalize: row missing");
    }
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt =
      parseTime(row.view_time || row.collect_time || row.search_time || row.time) ||
      now;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: occurredAt,
      capturedBy: "sqlite",
    };

    if (kind === "collect") {
      return {
        events: [
          {
            id: newId(),
            type: "event",
            subtype: "like",
            occurredAt,
            actor: "person-self",
            content: { title: row.caption || row.title || "(no caption)" },
            ingestedAt: now,
            source,
            extra: {
              photoId: row.photo_id || null,
              authorId: row.author_id || null,
              authorName: row.author_name || null,
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
    // watch → browse event
    return {
      events: [
        {
          id: newId(),
          type: "event",
          subtype: "browse",
          occurredAt,
          actor: "person-self",
          content: { title: row.caption || row.title || "(no caption)" },
          ingestedAt: now,
          source,
          extra: {
            photoId: row.photo_id || null,
            duration: row.duration || row.play_duration || null,
            authorId: row.author_id || null,
            authorName: row.author_name || null,
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

module.exports = { KuaishouAdapter, NAME, VERSION };
