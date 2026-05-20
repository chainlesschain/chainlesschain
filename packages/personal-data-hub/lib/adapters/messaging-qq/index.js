/**
 * Phase 13.5 — QQ adapter.
 *
 * Per sjqz/parsers/qq.py QQParser. QQ DBs (msg.db / messages.db) are
 * SQLCipher-encrypted with a per-installation key — Phase 13.5b will
 * port the QQ key extractor; v0.5 accepts a `keyProvider` like WeChat.
 *
 * Tables:
 *   - mr_friend            friend contacts
 *   - mr_troop             groups
 *   - mr_buddy_groupbuddy  group members
 *   - msgcsr_friend_*      friend messages (per-buddy table sharding)
 *   - msgcsr_troop_*       group messages
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "messaging-qq";
const VERSION = "0.5.0";

class QQAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.qq) {
      throw new Error("QQAdapter: opts.account.qq required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._keyProvider = opts.keyProvider || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:qq-messages", "decrypt:sqlcipher"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "qq:friends (uin / nickname / remark)",
        "qq:groups (troop_uin / name)",
        "qq:messages (peer / content / time / type)",
      ],
      sensitivity: "high",
      legalGate: true,
    };
  }

  async authenticate() {
    if (!this._dbPath || !fs.existsSync(this._dbPath)) {
      return { ok: false, reason: "DB_NOT_PULLED" };
    }
    if (!this._keyProvider || typeof this._keyProvider.getKey !== "function") {
      return { ok: false, reason: "NO_KEY_PROVIDER" };
    }
    return { ok: true, account: this.account.qq };
  }

  async healthCheck() {
    const r = await this.authenticate();
    return r.ok ? { ok: true, lastChecked: Date.now() } : r;
  }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    if (!this._keyProvider) return;
    const key = await this._keyProvider.getKey();
    if (!key) return;

    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      db.pragma(`key = '${key}'`);
      // Friends
      const friends = trySelect(db, "SELECT * FROM mr_friend LIMIT 5000") || [];
      for (const row of friends) {
        yield { adapter: NAME, originalId: `friend-${row.uin}`, capturedAt: Date.now(), payload: { row, kind: "contact" } };
      }
      // Groups
      const groups = trySelect(db, "SELECT * FROM mr_troop LIMIT 1000") || [];
      for (const row of groups) {
        yield { adapter: NAME, originalId: `group-${row.troop_uin}`, capturedAt: Date.now(), payload: { row, kind: "group" } };
      }
      // Messages — QQ shards by buddy. Iterate any msgcsr_friend_* table.
      const tables = trySelect(db, "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'msgcsr_friend_%' OR name LIKE 'msgcsr_troop_%')") || [];
      for (const t of tables) {
        const msgs = trySelect(db, `SELECT * FROM ${t.name} ORDER BY time DESC LIMIT 1000`) || [];
        for (const row of msgs) {
          yield {
            adapter: NAME,
            originalId: `msg-${row.msgid || row._id}`,
            capturedAt: parseTime(row.time),
            payload: { row, kind: "message", table: t.name },
          };
        }
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.time) || now;
    const source = { adapter: NAME, adapterVersion: VERSION, originalId: raw.originalId, capturedAt: occurredAt, capturedBy: "sqlite" };
    if (kind === "contact") {
      return {
        events: [], places: [], items: [], topics: [],
        persons: [{
          id: `person-qq-${row.uin}`,
          type: "person", subtype: "contact",
          names: [row.remark, row.nickname, String(row.uin)].filter((x) => typeof x === "string" && x.length > 0),
          identifiers: { qqId: String(row.uin) },
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, qq: row.uin },
        }],
      };
    }
    if (kind === "group") {
      return {
        events: [], places: [], items: [], persons: [],
        topics: [{
          id: `topic-qq-group-${row.troop_uin}`,
          type: "topic", name: row.troop_name || String(row.troop_uin),
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, troopUin: row.troop_uin },
        }],
      };
    }
    // message
    const isGroup = (raw.payload.table || "").startsWith("msgcsr_troop_");
    return {
      events: [{
        id: newId(), type: "event", subtype: "message",
        occurredAt, actor: "person-self",
        content: { title: (row.msg || "").slice(0, 80) || "(空)", text: row.msg || "" },
        ingestedAt: now, source,
        extra: { peer: row.frienduin || row.troopuin, isGroup, msgType: row.msgtype },
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
    return Date.parse(v) || null;
  }
  return null;
}
module.exports = { QQAdapter, NAME, VERSION };
