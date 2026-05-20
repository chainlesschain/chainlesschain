/**
 * Phase 13.7 — WhatsApp adapter.
 *
 * Per sjqz/parsers/whatsapp.py WhatsAppParser. WhatsApp Android stores
 * messages in `msgstore.db` (encrypted with crypt14/crypt15 layered on
 * SQLite). v0.5 accepts:
 *   1. Decrypted msgstore.db at `dbPath` (user used WhatsApp Crypt
 *      Decrypter or similar tool first), or
 *   2. Encrypted .crypt14 with `keyProvider` (Phase 13.7b adds the
 *      actual crypt14 → SQLite decoder; for now we error gracefully).
 *
 * Tables of interest:
 *   - jid                contacts + chats (jid = WhatsApp ID)
 *   - chat               chat metadata
 *   - message            messages
 *   - call_log           call records
 */

"use strict";

const fs = require("node:fs");
const { newId } = require("../../ids");

const NAME = "messaging-whatsapp";
const VERSION = "0.5.0";

class WhatsAppAdapter {
  constructor(opts = {}) {
    if (!opts.account || !opts.account.phone) {
      throw new Error("WhatsAppAdapter: opts.account.phone required");
    }
    this.account = opts.account;
    this._dbPath = opts.dbPath || null;
    this._keyProvider = opts.keyProvider || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:sqlite", "parse:whatsapp-messages"];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "whatsapp:jid (contacts + chats)",
        "whatsapp:messages (text / media / time)",
        "whatsapp:call_log",
      ],
      sensitivity: "high",
      legalGate: true,
    };
  }

  async authenticate() {
    if (!this._dbPath || !fs.existsSync(this._dbPath)) {
      return { ok: false, reason: "DB_NOT_PULLED" };
    }
    return { ok: true, account: this.account.phone };
  }

  async healthCheck() {
    const r = await this.authenticate();
    return r.ok ? { ok: true, lastChecked: Date.now() } : r;
  }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) return;
    const Driver = this._dbDriverFactory
      ? this._dbDriverFactory()
      : require("better-sqlite3-multiple-ciphers");
    const db = new Driver(dbPath, { readonly: true });
    try {
      const jids = trySelect(db, "SELECT * FROM jid LIMIT 5000") || [];
      for (const row of jids) {
        yield { adapter: NAME, originalId: `jid-${row._id}`, capturedAt: Date.now(), payload: { row, kind: "contact" } };
      }
      const chats = trySelect(db, "SELECT * FROM chat LIMIT 1000") || [];
      for (const row of chats) {
        yield { adapter: NAME, originalId: `chat-${row._id}`, capturedAt: Date.now(), payload: { row, kind: "chat" } };
      }
      const messages = trySelect(db, "SELECT * FROM message ORDER BY timestamp DESC LIMIT 10000")
        || trySelect(db, "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10000") || [];
      for (const row of messages) {
        yield { adapter: NAME, originalId: `msg-${row._id}`, capturedAt: parseTime(row.timestamp || row.received_timestamp), payload: { row, kind: "message" } };
      }
      const calls = trySelect(db, "SELECT * FROM call_log ORDER BY timestamp DESC LIMIT 5000") || [];
      for (const row of calls) {
        yield { adapter: NAME, originalId: `call-${row._id}`, capturedAt: parseTime(row.timestamp), payload: { row, kind: "call" } };
      }
    } finally {
      try { db.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    const { kind, row } = raw.payload;
    const now = Date.now();
    const occurredAt = parseTime(row.timestamp || row.received_timestamp) || now;
    const source = { adapter: NAME, adapterVersion: VERSION, originalId: raw.originalId, capturedAt: occurredAt, capturedBy: "sqlite" };

    if (kind === "contact") {
      // WhatsApp jids are "<phone>@s.whatsapp.net" or "<phone>@g.us" (group)
      const isGroup = typeof row.raw_string === "string" && row.raw_string.includes("@g.us");
      if (isGroup) {
        return {
          events: [], places: [], items: [], persons: [],
          topics: [{
            id: `topic-whatsapp-${row.raw_string}`,
            type: "topic", name: row.display_name || row.raw_string,
            ingestedAt: now, source,
            extra: { fromAdapter: NAME, jid: row.raw_string },
          }],
        };
      }
      const phone = (row.user || "").replace(/[^0-9]/g, "");
      return {
        events: [], places: [], items: [], topics: [],
        persons: [{
          id: `person-whatsapp-${row.user || row._id}`,
          type: "person", subtype: "contact",
          names: [row.display_name, row.user].filter((x) => typeof x === "string" && x.length > 0),
          identifiers: phone ? { phone: [phone] } : {},
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, jid: row.raw_string },
        }],
      };
    }

    if (kind === "chat") {
      return {
        events: [], places: [], items: [], persons: [],
        topics: [{
          id: `topic-whatsapp-chat-${row._id}`,
          type: "topic", name: row.subject || row.display_name || String(row._id),
          ingestedAt: now, source,
          extra: { fromAdapter: NAME },
        }],
      };
    }

    if (kind === "call") {
      return {
        events: [{
          id: newId(), type: "event", subtype: "call",
          occurredAt, actor: row.from_me ? "person-self" : (row.jid_row_id ? `person-whatsapp-${row.jid_row_id}` : "person-self"),
          content: { title: `WhatsApp call (${row.video_call ? "video" : "voice"})` },
          ingestedAt: now, source,
          extra: {
            duration: row.duration || null,
            isVideo: !!row.video_call,
            fromMe: !!row.from_me,
            callResult: row.call_result || null,
          },
        }],
        persons: [], places: [], items: [], topics: [],
      };
    }

    // message
    return {
      events: [{
        id: newId(), type: "event", subtype: "message",
        occurredAt,
        actor: row.from_me === 1 ? "person-self" : (row.key_remote_jid ? `person-whatsapp-${row.key_remote_jid}` : "person-self"),
        content: { title: (row.text_data || row.data || "").slice(0, 80) || "(空)", text: row.text_data || row.data || "" },
        ingestedAt: now, source,
        extra: {
          jid: row.key_remote_jid || row.from_jid_row_id || null,
          isOutgoing: row.from_me === 1,
          mediaType: row.media_wa_type || null,
          status: row.status || null,
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

module.exports = { WhatsAppAdapter, NAME, VERSION };
