/**
 * Phase 13.6 — Telegram adapter.
 *
 * Per sjqz/parsers/telegram.py TelegramParser. Telegram Android stores
 * messages in a single `cache4.db` (unencrypted SQLite!). Easier than
 * WeChat — no key extraction needed.
 *
 * Tables of interest:
 *   - users          contacts + groups
 *   - chats          chat metadata
 *   - messages_v2    messages (multiple shards in newer versions)
 *   - dialogs        chat ordering
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "messaging-telegram";
// v0.7.0: validate the sync-time inputPath in healthCheck instead of checking
// only constructor state. This unblocks Registry.syncAdapter(..., { inputPath }).
const VERSION = "0.7.0";

class TelegramAdapter {
  constructor(opts = {}) {
    // 2026-05-25 — account.userId OPTIONAL (mirror Taobao/Ctrip dual-mode).
    // sqlite-mode adapter still requires user to provide a decrypted
    // cache4.db (Telegram cache db is unencrypted — easier than WeChat).
    // Earlier strict ctor blocked auto-register at boot → silent "no adapter
    // messaging-telegram" when Android collector ships extracted db.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || opts.inputPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "sync:snapshot", "parse:telegram-messages"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "telegram:users / chats / messages / dialogs",
      ],
      sensitivity: "high",
      legalGate: true,
    };
  }

  async authenticate(ctx = {}) {
    const dbPath = (ctx && (ctx.inputPath || ctx.dbPath)) || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return { ok: false, reason: "DB_NOT_PULLED", message: "needs ctx.inputPath / opts.dbPath pointing to extracted cache4.db" };
    }
    return { ok: true, account: this.account ? this.account.userId : null, mode: "snapshot-file" };
  }

  async healthCheck(opts = {}) {
    const r = await this.authenticate(opts);
    return r.ok ? { ok: true, lastChecked: Date.now() } : r;
  }

  async *sync(opts = {}) {
    const dbPath = opts.inputPath || opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      const users = trySelect(db, "SELECT * FROM users LIMIT 5000") || [];
      for (const row of users) {
        yield { adapter: NAME, originalId: `user-${row.uid}`, capturedAt: Date.now(), payload: { row, kind: "contact" } };
      }
      const chats = trySelect(db, "SELECT * FROM chats LIMIT 5000") || [];
      for (const row of chats) {
        yield { adapter: NAME, originalId: `chat-${row.uid}`, capturedAt: Date.now(), payload: { row, kind: "chat" } };
      }
      const messages = trySelect(db, "SELECT * FROM messages_v2 ORDER BY date DESC LIMIT 10000")
        || trySelect(db, "SELECT * FROM messages ORDER BY date DESC LIMIT 10000") || [];
      for (const row of messages) {
        yield { adapter: NAME, originalId: `msg-${row.mid || row.id}`, capturedAt: parseTime(row.date), payload: { row, kind: "message" } };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.date) || now;
    const source = { adapter: NAME, adapterVersion: VERSION, originalId: raw.originalId, capturedAt: occurredAt, capturedBy: "sqlite" };

    if (kind === "contact") {
      return {
        events: [], places: [], items: [], topics: [],
        persons: [{
          id: `person-telegram-${row.uid}`,
          type: "person", subtype: "contact",
          names: [row.name, row.username].filter((x) => typeof x === "string" && x.length > 0),
          identifiers: { telegramId: String(row.uid), ...(row.phone ? { phone: [String(row.phone)] } : {}) },
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, telegramUid: row.uid },
        }],
      };
    }
    if (kind === "chat") {
      return {
        events: [], places: [], items: [], persons: [],
        topics: [{
          id: `topic-telegram-${row.uid}`,
          type: "topic", name: row.name || String(row.uid),
          ingestedAt: now, source,
          extra: { fromAdapter: NAME },
        }],
      };
    }
    // message
    const isOutgoing = row.out === 1 || row.is_outgoing === 1;
    return {
      events: [{
        id: newId(), type: "event", subtype: "message",
        occurredAt,
        actor: isOutgoing ? "person-self" : (row.from_id ? `person-telegram-${row.from_id}` : "person-self"),
        content: { title: (row.message || "").slice(0, 80) || "(空)", text: row.message || "" },
        ingestedAt: now, source,
        extra: {
          peer: row.uid || null,
          isOutgoing,
          mediaType: row.media_type || null,
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
    return Date.parse(v) || null;
  }
  return null;
}
module.exports = { TelegramAdapter, NAME, VERSION };
