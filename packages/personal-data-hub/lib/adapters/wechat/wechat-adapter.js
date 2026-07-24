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
const { createAccountScope } = require("../../account-scope");
const { WeChatDBReader } = require("./db-reader");
const {
  normalizeMessage,
  normalizeContact,
  NAME,
  VERSION,
} = require("./normalize");

class WechatAdapter {
  constructor(opts = {}) {
    if (!opts || typeof opts !== "object") {
      throw new Error("WechatAdapter: opts required");
    }
    if (!opts.account || typeof opts.account !== "object") {
      throw new Error("WechatAdapter: opts.account required");
    }
    if (!opts.account.uin) {
      throw new Error(
        "WechatAdapter: opts.account.uin required (WeChat user identifier)",
      );
    }
    this.account = opts.account;
    // dbPath: local path to the (already-pulled) decrypted-source
    // EnMicroMsg.db. Test seam.
    this._dbPath = opts.dbPath || opts.inputPath || null;
    // keyProvider: { getKey(): Promise<string> }. v0.5 default is
    // a synthetic provider for tests; production wires this to either
    // KeyExtractor (legacy) or Frida bridge (Phase 12.6).
    this._keyProvider = opts.keyProvider || null;
    // DI seam for tests — swap the DB reader
    this._dbReaderFactory =
      typeof opts.dbReaderFactory === "function" ? opts.dbReaderFactory : null;

    this.name = NAME;
    this.watermarkStrategy = "explicit";
    this.defaultScope = createAccountScope(NAME, this.account.uin);
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

  async authenticate(ctx = {}) {
    // No server auth; sanity check the on-disk state.
    const dbPath = this._resolveDbPath(ctx);
    if (!dbPath || !fs.existsSync(dbPath)) {
      return {
        ok: false,
        reason: "DB_NOT_PULLED",
        error: `DB path missing: ${dbPath}`,
      };
    }
    if (!this._keyProvider || typeof this._keyProvider.getKey !== "function") {
      return {
        ok: false,
        reason: "NO_KEY_PROVIDER",
        error: "keyProvider required",
      };
    }
    // Readiness probe — DB + key provider present means "configured". Do NOT
    // invoke the (possibly frida-backed, expensive/side-effectful) key
    // provider during a readiness check; the real sync exercises it.
    if (ctx && ctx.readinessOnly) {
      return { ok: true, mode: "configured" };
    }
    try {
      const key = await this._keyProvider.getKey();
      if (!key)
        return {
          ok: false,
          reason: "EMPTY_KEY",
          error: "keyProvider returned empty key",
        };
      return { ok: true, account: this.account.uin };
    } catch (err) {
      return {
        ok: false,
        reason: "KEY_PROVIDER_THREW",
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  async healthCheck(ctx = {}) {
    const r = await this.authenticate(ctx);
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
    const onProgress =
      typeof opts.onProgress === "function" ? opts.onProgress : null;
    const emit = (phase, payload = {}) => {
      if (!onProgress) return;
      try {
        onProgress({ phase, adapter: NAME, ...payload });
      } catch (_e) {}
    };

    const dbPath = this._resolveDbPath(opts);
    if (!dbPath || !fs.existsSync(dbPath)) {
      // No DB pulled yet — registry-safe idle no-op
      emit("idle", { reason: "no DB at " + dbPath });
      return;
    }
    const maxPerType = Number.isFinite(opts.maxPerType)
      ? opts.maxPerType
      : 10_000;
    const sinceMsgSvrId = parseWatermark(opts.sinceWatermark);

    emit("opening", { dbPath });
    const Reader =
      this._dbReaderFactory || ((readerOpts) => new WeChatDBReader(readerOpts));
    const reader = Reader({ dbPath, keyProvider: this._keyProvider });

    try {
      const openInfo = await reader.open();
      emit("opened", { profile: openInfo.profile, tables: openInfo.tables });

      if (!reader.isEnMicroMsg()) {
        emit("error", {
          phase: "verify",
          message: "not an EnMicroMsg.db (missing message/rcontact)",
        });
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
      for (const cr of chatrooms)
        chatroomByName[cr.chatroomname] = cr.displayname || cr.chatroomname;
      emit("chatrooms-loaded", { count: chatrooms.length });

      // Messages
      const messages = reader.fetchMessages({
        sinceMsgSvrId,
        limit: maxPerType,
      });
      emit("messages-loaded", { count: messages.length, since: sinceMsgSvrId });
      let count = 0;
      let maxSvr = String(sinceMsgSvrId);
      for (const m of messages) {
        count += 1;
        maxSvr = maxDecimalCursor(maxSvr, m.msgSvrId);
        emit("processing", {
          current: count,
          total: messages.length,
          msgSvrId: m.msgSvrId,
        });
        yield this._rowToRaw("message", m, {
          contactByUsername,
          chatroomByName,
        });
      }
      if (count > 0 && typeof opts.updateWatermark === "function") {
        opts.updateWatermark(maxSvr);
      }
      emit("done", { messagesYielded: count, newWatermark: maxSvr });
    } finally {
      try {
        reader.close();
      } catch (_e) {}
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

  _resolveDbPath(opts = {}) {
    return opts.inputPath || opts.dbPath || this._dbPath;
  }

  _rowToRaw(kind, row, ctxExtras = {}) {
    const originalId =
      kind === "message"
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
  const text = String(wm).trim();
  if (!/^\d+$/.test(text)) return 0;
  try {
    const cursor = BigInt(text);
    return cursor > 0n ? cursor.toString() : 0;
  } catch (_err) {
    return 0;
  }
}

function maxDecimalCursor(current, candidate) {
  const a = parseWatermark(current);
  const b = parseWatermark(candidate);
  if (b === 0) return String(a);
  if (a === 0) return String(b);
  return BigInt(b) > BigInt(a) ? String(b) : String(a);
}

module.exports = { WechatAdapter, NAME, VERSION };
