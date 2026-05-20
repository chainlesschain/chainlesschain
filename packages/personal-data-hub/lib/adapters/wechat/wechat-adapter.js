/**
 * Phase 12 v0.5 — WechatAdapter (frida-INDEPENDENT slice).
 *
 * Per `Adapter_WeChat_SQLCipher.md` §17.2 buildable-now scope. This is
 * the 60% of Phase 12 that can land without rooted device + Frida:
 * everything from "DB file is decrypted at this path on disk" forward.
 *
 * Flow:
 *   1. UI / CLI workflow drives the on-device pull via AndroidExtractor
 *      (Phase 7.5) — copies EnMicroMsg.db to a local cache.
 *   2. keyProvider returns the key (legacy: KeyExtractor MD5(IMEI+UIN)
 *      computes it; Phase 12.6 hot path: Frida hook fetches it).
 *   3. WechatAdapter.sync() opens the DB via WeChatDBReader, iterates
 *      message + contact tables, yields raw events.
 *   4. normalize() turns each row into UnifiedSchema entities.
 *
 * Watermark: max msgSvrId per scope. Adapter sync({sinceWatermark}) is
 * a high-water filter rather than per-talker — Phase 12.6 adds the
 * per-talker variant.
 */

"use strict";

const fs = require("node:fs");

const { CAPTURED_BY } = require("../../constants");
const { WeChatDBReader } = require("./db-reader");
const { normalizeMessage, normalizeContact, NAME, VERSION } = require("./normalize");

class WechatAdapter {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("WechatAdapter: opts required");
    }
    if (!opts.account || typeof opts.account !== "object") {
      throw new Error("WechatAdapter: opts.account required");
    }
    if (!opts.account.uin) {
      throw new Error("WechatAdapter: opts.account.uin required (WeChat user identifier)");
    }
    this.account = opts.account;
    // dbPath: local path to the (already-pulled) decrypted-source
    // EnMicroMsg.db. Test seam.
    this._dbPath = opts.dbPath || null;
    // keyProvider: { getKey(): Promise<string> }. v0.5 default is
    // a synthetic provider for tests; production wires this to either
    // KeyExtractor (legacy) or Frida bridge (Phase 12.6).
    this._keyProvider = opts.keyProvider || null;
    // DI seam for tests — swap the DB reader
    this._dbReaderFactory = typeof opts.dbReaderFactory === "function"
      ? opts.dbReaderFactory
      : null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "auth:keystore",
      "decrypt:sqlcipher-v1",
      "parse:wechat-message",
    ];
    this.extractMode = "device-pull"; // Phase 7.5 contract field
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "wechat:messages (text + group + 1-on-1 chats from EnMicroMsg.db)",
        "wechat:contacts (rcontact: nickname / alias / 备注名)",
        "wechat:chatrooms (group display names + member lists)",
      ],
      sensitivity: "high",
      legalGate: true, // first-use 法律 gate per design doc OQ-7
    };
  }

  async authenticate() {
    // No server auth; sanity check the on-disk state.
    if (!this._dbPath || !fs.existsSync(this._dbPath)) {
      return { ok: false, reason: "DB_NOT_PULLED", error: `DB path missing: ${this._dbPath}` };
    }
    if (!this._keyProvider || typeof this._keyProvider.getKey !== "function") {
      return { ok: false, reason: "NO_KEY_PROVIDER", error: "keyProvider required" };
    }
    try {
      const key = await this._keyProvider.getKey();
      if (!key) return { ok: false, reason: "EMPTY_KEY", error: "keyProvider returned empty key" };
      return { ok: true, account: this.account.uin };
    } catch (err) {
      return { ok: false, reason: "KEY_PROVIDER_THREW", error: err && err.message ? err.message : String(err) };
    }
  }

  async healthCheck() {
    const r = await this.authenticate();
    if (r.ok) return { ok: true, lastChecked: Date.now() };
    return { ok: false, reason: r.reason, error: r.error };
  }

  /**
   * Iterate WeChat data → RawEvent stream. Each row becomes one raw
   * event with `payload.kind = "message"` or `"contact"`.
   *
   * @param {object} opts
   * @param {string|number} [opts.sinceWatermark]  max msgSvrId watermark
   * @param {number} [opts.maxPerType=10_000]
   * @param {Function} [opts.onProgress]
   */
  async *sync(opts = {}) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const emit = (phase, payload = {}) => {
      if (!onProgress) return;
      try { onProgress({ phase, adapter: NAME, ...payload }); } catch (_e) {}
    };

    if (!this._dbPath || !fs.existsSync(this._dbPath)) {
      // No DB pulled yet — registry-safe idle no-op
      emit("idle", { reason: "no DB at " + this._dbPath });
      return;
    }
    const maxPerType = Number.isFinite(opts.maxPerType) ? opts.maxPerType : 10_000;
    const sinceMsgSvrId = parseWatermark(opts.sinceWatermark);

    emit("opening", { dbPath: this._dbPath });
    const Reader = this._dbReaderFactory || ((readerOpts) => new WeChatDBReader(readerOpts));
    const reader = Reader({ dbPath: this._dbPath, keyProvider: this._keyProvider });

    try {
      const openInfo = await reader.open();
      emit("opened", { profile: openInfo.profile, tables: openInfo.tables });

      if (!reader.isEnMicroMsg()) {
        emit("error", { phase: "verify", message: "not an EnMicroMsg.db (missing message/rcontact)" });
        return;
      }

      // Contacts first — gives normalize() context for message senders
      const contacts = reader.fetchContacts({ limit: 10_000 });
      emit("contacts-loaded", { count: contacts.length });
      const contactByUsername = {};
      for (const c of contacts) contactByUsername[c.username] = c;
      for (const c of contacts) {
        yield this._rowToRaw("contact", c, { contactByUsername });
      }

      // Chatrooms — produce Topics
      const chatrooms = reader.fetchChatrooms({ limit: 5000 });
      const chatroomByName = {};
      for (const cr of chatrooms) chatroomByName[cr.chatroomname] = cr.displayname || cr.chatroomname;
      emit("chatrooms-loaded", { count: chatrooms.length });

      // Messages
      const messages = reader.fetchMessages({ sinceMsgSvrId, limit: maxPerType });
      emit("messages-loaded", { count: messages.length, since: sinceMsgSvrId });
      let count = 0;
      let maxSvr = sinceMsgSvrId;
      for (const m of messages) {
        count += 1;
        if (Number(m.msgSvrId) > maxSvr) maxSvr = Number(m.msgSvrId);
        emit("processing", { current: count, total: messages.length, msgSvrId: m.msgSvrId });
        yield this._rowToRaw("message", m, { contactByUsername, chatroomByName });
      }
      emit("done", { messagesYielded: count, newWatermark: maxSvr });
    } finally {
      try { reader.close(); } catch (_e) {}
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("WechatAdapter.normalize: raw.payload missing");
    }
    const ctx = {
      accountUin: this.account.uin,
      contactByUsername: raw.payload.contactByUsername || {},
      chatroomByName: raw.payload.chatroomByName || {},
    };
    if (raw.payload.kind === "contact") {
      return normalizeContact(raw.payload.row, ctx);
    }
    return normalizeMessage(raw.payload.row, ctx);
  }

  _rowToRaw(kind, row, ctxExtras = {}) {
    const originalId = kind === "message"
      ? String(row.msgSvrId || row.msgId)
      : `contact-${row.username}`;
    return {
      adapter: NAME,
      originalId,
      capturedAt: Date.now(),
      payload: {
        kind,
        row,
        ...ctxExtras,
      },
    };
  }
}

function parseWatermark(wm) {
  if (wm == null) return 0;
  const n = parseInt(String(wm), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { WechatAdapter, NAME, VERSION };
