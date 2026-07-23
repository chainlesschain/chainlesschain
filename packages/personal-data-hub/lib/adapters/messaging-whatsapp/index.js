/**
 * Phase 13.7 — WhatsApp adapter.
 *
 * Per sjqz/parsers/whatsapp.py WhatsAppParser. WhatsApp Android stores
 * messages in `msgstore.db` (encrypted with crypt14/crypt15 layered on
 * SQLite). v0.7 accepts either a decrypted `msgstore.db`, or a `.crypt14` /
 * `.crypt15` backup together with the user's own key/keyProvider. Encrypted
 * input is authenticated, stream-decrypted and decompressed to a mode-0600
 * temporary DB, which is removed as soon as sync finishes.
 *
 * Tables of interest:
 *   - jid                contacts + chats (jid = WhatsApp ID)
 *   - chat               chat metadata
 *   - message            messages
 *   - call_log           call records
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { newId } = require("../../ids");
const {
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  isEncryptedWhatsAppBackup,
} = require("./backup-decryptor");
const { createWhatsAppBackupExtension } = require("./adb-extension");

const NAME = "messaging-whatsapp";
const VERSION = "0.7.0";

class WhatsAppAdapter {
  constructor(opts = {}) {
    // 2026-05-25 — account.phone OPTIONAL (mirror Taobao/Ctrip/Telegram).
    // Account is optional. The adapter accepts a local msgstore DB/backup or,
    // when the host wires bridgeProvider, pulls the encrypted public backup
    // over ADB and decrypts it with the user's own key.
    this.account = opts.account || null;
    this._dbPath = opts.dbPath || opts.inputPath || null;
    this._keyProvider = opts.keyProvider || opts.key || opts.keyPath || null;
    this._dbDriverFactory = opts.dbDriverFactory || null;
    this._bridgeProvider = opts.bridgeProvider || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "sync:snapshot",
      "sync:adb-public-backup",
      "decrypt:whatsapp-crypt14",
      "decrypt:whatsapp-crypt15",
      "parse:whatsapp-messages",
    ];
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

  async authenticate(ctx = {}) {
    const dbPath = (ctx && (ctx.inputPath || ctx.dbPath)) || this._dbPath;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return {
        ok: false,
        reason: this._bridgeProvider ? "ADB_PULL_REQUIRED" : "DB_NOT_PULLED",
        message: this._bridgeProvider
          ? "connect Android and sync with the user's crypt14/crypt15 key"
          : "needs ctx.inputPath / opts.dbPath pointing to msgstore.db(.crypt14/.crypt15)",
      };
    }
    if (isEncryptedWhatsAppBackup(dbPath)) {
      if (!(ctx.keyProvider || ctx.key || ctx.keyPath || this._keyProvider)) {
        return {
          ok: false,
          reason: "KEY_REQUIRED",
          message: "encrypted WhatsApp backup requires the user's key/keyPath/keyProvider",
        };
      }
      try {
        const header = inspectWhatsAppBackupFile(dbPath);
        return {
          ok: true,
          account: this.account ? this.account.phone : null,
          mode: header.format,
        };
      } catch (error) {
        return {
          ok: false,
          reason: error.code || "BAD_BACKUP",
          message: error.message,
        };
      }
    }
    return { ok: true, account: this.account ? this.account.phone : null, mode: "snapshot-file" };
  }

  async healthCheck() {
    const r = await this.authenticate();
    return r.ok ? { ok: true, lastChecked: Date.now() } : r;
  }

  async *sync(opts = {}) {
    let dbPath = opts.inputPath || opts.dbPath || this._dbPath;
    let sourceCleanup = null;
    if (!dbPath) {
      const bridge = resolveBridge(opts.bridgeProvider || this._bridgeProvider);
      if (!bridge || typeof bridge.invoke !== "function") return;
      const pulled = await bridge.invoke("whatsapp.backup", {
        serial: opts.serial,
        business: opts.business === true,
        remotePath: opts.remotePath,
        timeoutMs: opts.timeoutMs,
      });
      dbPath = pulled && pulled.localPath;
      sourceCleanup = pulled && typeof pulled.cleanup === "function" ? pulled.cleanup : null;
    }
    if (!dbPath || !fs.existsSync(dbPath)) {
      runCleanup(sourceCleanup);
      return;
    }
    let openPath = dbPath;
    let tempDir = null;
    if (isEncryptedWhatsAppBackup(dbPath)) {
      const keyProvider = opts.keyProvider || opts.key || opts.keyPath || this._keyProvider;
      if (!keyProvider) {
        runCleanup(sourceCleanup);
        const error = new Error("messaging-whatsapp: encrypted backup requires key/keyPath/keyProvider");
        error.code = "WHATSAPP_BACKUP_KEY_REQUIRED";
        throw error;
      }
      try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pdh-whatsapp-"));
      } catch (error) {
        runCleanup(sourceCleanup);
        throw error;
      }
      openPath = path.join(tempDir, "msgstore.db");
      try {
        await decryptWhatsAppBackupToFile({
          inputPath: dbPath,
          outputPath: openPath,
          keyProvider,
        });
      } catch (error) {
        removeTempDir(tempDir);
        runCleanup(sourceCleanup);
        throw error;
      }
    }
    let db;
    try {
      const Driver = this._dbDriverFactory
        ? this._dbDriverFactory()
        : require("better-sqlite3-multiple-ciphers");
      db = new Driver(openPath, { readonly: true });
      const jids = trySelect(db, "SELECT * FROM jid LIMIT 5000") || [];
      for (const row of jids) {
        yield { adapter: NAME, originalId: `jid-${row._id}`, capturedAt: Date.now(), payload: { row, kind: "contact" } };
      }
      const chats = trySelect(db, `
        SELECT chat.*, jid.raw_string AS chat_jid
        FROM chat
        LEFT JOIN jid ON jid._id = chat.jid_row_id
        LIMIT 1000
      `) || trySelect(db, "SELECT * FROM chat LIMIT 1000") || [];
      for (const row of chats) {
        yield { adapter: NAME, originalId: `chat-${row._id}`, capturedAt: Date.now(), payload: { row, kind: "chat" } };
      }
      const modernMessages = trySelect(db, `
        SELECT message.*, chat_jid.raw_string AS chat_jid,
               sender_jid.raw_string AS sender_jid
        FROM message
        LEFT JOIN chat ON chat._id = message.chat_row_id
        LEFT JOIN jid AS chat_jid ON chat_jid._id = chat.jid_row_id
        LEFT JOIN jid AS sender_jid ON sender_jid._id = message.sender_jid_row_id
        ORDER BY message.timestamp DESC
        LIMIT 10000
      `) || trySelect(db, "SELECT * FROM message ORDER BY timestamp DESC LIMIT 10000") || [];
      const related = loadModernMessageRelations(db);
      const modernRows = modernMessages.map((row) => attachMessageRelations(row, related));

      // Upgraded databases can retain pre-migration rows in `messages` while
      // newer rows are written to `message`. Read both and deduplicate by the
      // stable WhatsApp key_id instead of treating the old table as fallback.
      const legacyRows = trySelect(db, "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 10000") || [];
      const seenMessages = new Set(modernRows.map(messageFingerprint));
      for (const row of modernRows) {
        yield {
          adapter: NAME,
          originalId: `msg-${row._id}`,
          capturedAt: parseTime(row.timestamp || row.received_timestamp),
          payload: { row, kind: "message", schema: "modern" },
        };
      }
      for (const row of legacyRows) {
        if (seenMessages.has(messageFingerprint(row))) continue;
        const id = modernRows.some((modern) => modern._id === row._id)
          ? `msg-legacy-${row._id}`
          : `msg-${row._id}`;
        yield {
          adapter: NAME,
          originalId: id,
          capturedAt: parseTime(row.timestamp || row.received_timestamp),
          payload: { row, kind: "message", schema: "legacy" },
        };
      }
      const calls = trySelect(db, `
        SELECT call_log.*, jid.raw_string AS jid,
               group_jid.raw_string AS group_jid
        FROM call_log
        LEFT JOIN jid ON jid._id = call_log.jid_row_id
        LEFT JOIN jid AS group_jid ON group_jid._id = call_log.group_jid_row_id
        ORDER BY call_log.timestamp DESC
        LIMIT 5000
      `) || trySelect(db, "SELECT * FROM call_log ORDER BY timestamp DESC LIMIT 5000") || [];
      for (const row of calls) {
        yield { adapter: NAME, originalId: `call-${row._id}`, capturedAt: parseTime(row.timestamp), payload: { row, kind: "call" } };
      }
    } finally {
      try { if (db) db.close(); } catch (_e) {}
      removeTempDir(tempDir);
      runCleanup(sourceCleanup);
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
          id: `person-whatsapp-${row.raw_string || row.user || row._id}`,
          type: "person", subtype: "contact",
          names: [row.display_name, row.user].filter((x) => typeof x === "string" && x.length > 0),
          identifiers: phone ? { phone: [phone] } : {},
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, jid: row.raw_string },
        }],
      };
    }

    if (kind === "chat") {
      const chatJid = row.chat_jid || row.raw_string || null;
      return {
        events: [], places: [], items: [], persons: [],
        topics: [{
          id: `topic-whatsapp-chat-${row._id}`,
          type: "topic", name: row.subject || row.display_name || chatJid || String(row._id),
          ingestedAt: now, source,
          extra: { fromAdapter: NAME, jid: chatJid, archived: !!row.archived },
        }],
      };
    }

    if (kind === "call") {
      return {
        events: [{
          id: newId(), type: "event", subtype: "call",
          occurredAt, actor: row.from_me ? "person-self" : `person-whatsapp-${row.jid || row.jid_row_id || "unknown"}`,
          content: { title: `WhatsApp call (${row.video_call ? "video" : "voice"})` },
          ingestedAt: now, source,
          extra: {
            jid: row.jid || null,
            groupJid: row.group_jid || null,
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
    const isOutgoing = (row.from_me ?? row.key_from_me) === 1;
    const chatJid = row.chat_jid || row.key_remote_jid || null;
    const senderJid = row.sender_jid || row.remote_resource || null;
    const actorJid = senderJid || chatJid;
    const media = row._media || null;
    const location = row._location || legacyLocation(row);
    const mediaRefs = [media && media.file_path, media && media.direct_path, media && media.message_url]
      .filter((value) => typeof value === "string" && value.length > 0);
    const placeId = hasCoordinates(location) ? `place-whatsapp-${row._id}` : null;
    const topicId = row.chat_row_id != null ? `topic-whatsapp-chat-${row.chat_row_id}` : null;
    const text = row.text_data || row.data || mediaCaption(row) || "";
    return {
      events: [{
        id: newId(), type: "event", subtype: "message",
        occurredAt,
        actor: isOutgoing ? "person-self" : `person-whatsapp-${actorJid || "unknown"}`,
        ...(placeId ? { place: placeId } : {}),
        ...(topicId ? { topics: [topicId] } : {}),
        content: {
          title: text.slice(0, 80) || "(空)",
          text,
          ...(mediaRefs.length > 0 ? { mediaRefs } : {}),
        },
        ingestedAt: now, source,
        extra: {
          jid: chatJid,
          senderJid,
          chatRowId: row.chat_row_id ?? null,
          isOutgoing,
          messageType: row.message_type ?? row.media_wa_type ?? null,
          mediaType: (media && media.mime_type) || row.media_mime_type || row.media_wa_type || null,
          media,
          location,
          vcards: row._vcards || [],
          quotedMessage: row._quoted || null,
          status: row.status || null,
        },
      }],
      persons: [],
      places: placeId ? [{
        id: placeId,
        type: "place",
        name: location.place_name || location.place_address || "WhatsApp location",
        coordinates: { lat: Number(location.latitude), lng: Number(location.longitude) },
        ...(location.place_address ? { address: location.place_address } : {}),
        aliases: [],
        ingestedAt: now,
        source,
        extra: { fromAdapter: NAME, url: location.url || null },
      }] : [],
      items: [], topics: [],
    };
  }
}

function trySelect(db, sql) { try { return db.prepare(sql).all(); } catch (_e) { return null; } }
function resolveBridge(provider) {
  return typeof provider === "function" ? provider() : provider;
}
function removeTempDir(tempDir) {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
function runCleanup(cleanup) {
  try { if (cleanup) cleanup(); } catch (_error) {}
}
function loadModernMessageRelations(db) {
  const query = (table) => trySelect(db, `
    SELECT related.*
    FROM ${table} AS related
    INNER JOIN (
      SELECT _id FROM message ORDER BY timestamp DESC LIMIT 10000
    ) AS recent ON recent._id = related.message_row_id
  `) || [];
  return {
    media: indexOne(query("message_media")),
    location: indexOne(query("message_location")),
    vcards: indexMany(query("message_vcard")),
    quoted: indexOne(query("message_quoted")),
  };
}
function indexOne(rows) {
  return new Map(rows.map((row) => [row.message_row_id, row]));
}
function indexMany(rows) {
  const indexed = new Map();
  for (const row of rows) {
    const values = indexed.get(row.message_row_id) || [];
    values.push(row);
    indexed.set(row.message_row_id, values);
  }
  return indexed;
}
function attachMessageRelations(row, related) {
  return {
    ...row,
    _media: related.media.get(row._id) || null,
    _location: related.location.get(row._id) || null,
    _vcards: related.vcards.get(row._id) || [],
    _quoted: related.quoted.get(row._id) || null,
  };
}
function isPresent(value) {
  return value !== null && value !== undefined && value !== "";
}
function messageFingerprint(row) {
  if (isPresent(row.key_id)) return `key:${row.key_id}`;
  return [
    "row",
    row._id,
    row.timestamp || row.received_timestamp || "",
    row.from_me ?? row.key_from_me ?? "",
    row.text_data || row.data || "",
  ].join(":");
}
function legacyLocation(row) {
  return hasCoordinates(row) ? {
    latitude: row.latitude,
    longitude: row.longitude,
    place_name: null,
    place_address: null,
    url: null,
  } : null;
}
function hasCoordinates(location) {
  if (!location) return false;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}
function mediaCaption(row) {
  return row.media_caption || (row._media && row._media.media_name) || "";
}
function parseTime(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) { const n = parseInt(v, 10); return n > 1e12 ? n : n * 1000; }
    return Date.parse(v) || null;
  }
  return null;
}

module.exports = {
  WhatsAppAdapter,
  NAME,
  VERSION,
  decryptWhatsAppBackupToFile,
  inspectWhatsAppBackupFile,
  createWhatsAppBackupExtension,
};
