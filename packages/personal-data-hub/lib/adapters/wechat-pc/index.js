"use strict";

/**
 * WeChat **desktop (PC)** adapter — 本地直读样板 (ported from social-douyin's
 * im.db direct-read). Reads PC WeChat's local SQLite DBs straight into the
 * vault:
 *
 *   - MSG0.db..MSGN.db   → table MSG      → 私信/群消息 (message events)
 *   - MicroMsg.db        → table Contact  → 联系人 (contact persons)
 *
 * Distinct from the Android `wechat` adapter (EnMicroMsg.db / frida key /
 * message+rcontact schema). PC WeChat has its own schema + a 32-byte raw
 * SQLCipher key. See pc-db-reader.js for the open/decrypt details.
 *
 * Modes (sync opts):
 *   1. opts.dbPath / opts.inputPath  — a PC WeChat DB file. If opts.key
 *      (64-hex) is supplied, the reader decrypts via SQLCipher; otherwise it
 *      expects an already-decrypted plaintext DB (the reliable, recommended
 *      path — decrypt once with PyWxDump/手动, then point here).
 *   2. (snapshot mode reserved for a future Android-side PC-bridge; not v0.)
 *
 * The reader extracts whatever of {MSG, Contact} a given file has, so call
 * sync once per file (MSG*.db for messages, MicroMsg.db for contacts).
 *
 * Person ids use the SAME `person-wechat-<wxid>` + `wechatId` identifier as
 * the Android wechat adapter, so EntityResolver merges PC + Android contacts.
 */

const fs = require("node:fs");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const NAME = "wechat-pc";
const VERSION = "0.1.0";

const KIND_MESSAGE = "message";
const KIND_CONTACT = "contact";

function stableOriginalId(kind, id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `wechat-pc:${kind}:${safe}`;
}

function wxidToPersonId(wxid) {
  return wxid ? `person-wechat-${wxid}` : null;
}

class WeChatPcAdapter {
  constructor(opts = {}) {
    this._dbPath = opts.dbPath || null;
    this._key = opts.key || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "decrypt:sqlcipher-pc",
      "parse:wechat-pc-message",
      "parse:wechat-pc-contact",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "wechat-pc:messages (StrTalker / StrContent / CreateTime / IsSender from MSG*.db)",
        "wechat-pc:contacts (UserName / NickName / Remark from MicroMsg.db)",
      ],
      sensitivity: "high",
      legalGate: true, // chat history — first-use 法律 gate (mirrors wechat)
    };

    this._deps = {
      fs,
      // DI seam: tests inject a fake SQLite driver class via dbDriverFactory.
      dbDriverFactory: opts.dbDriverFactory || null,
    };
  }

  async authenticate(ctx = {}) {
    // Cheap readiness probe — never opens / decrypts a DB.
    if (ctx && ctx.readinessOnly) {
      if (this._dbPath) return { ok: true, mode: "configured" };
      return {
        ok: false,
        reason: "DB_NOT_PULLED",
        message:
          "wechat-pc: 需提供 PC 微信本地数据库路径（MSG*.db / MicroMsg.db），加密库需先解密或提供 key",
      };
    }
    const dbPath = (ctx && ctx.inputPath) || (ctx && ctx.dbPath) || this._dbPath;
    if (dbPath) {
      try {
        this._deps.fs.accessSync(dbPath, this._deps.fs.constants.R_OK);
      } catch (err) {
        return {
          ok: false,
          reason: "INPUT_PATH_UNREADABLE",
          message: `wechat-pc: db not readable at ${dbPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "sqlite" };
    }
    return {
      ok: false,
      reason: "DB_NOT_PULLED",
      message: "wechat-pc.authenticate: needs opts.dbPath / inputPath (MSG*.db or MicroMsg.db)",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath = opts.dbPath || opts.inputPath || this._dbPath;
    if (!dbPath) {
      throw new Error(
        "wechat-pc.sync: needs opts.dbPath / opts.inputPath pointing to a PC WeChat DB (MSG*.db or MicroMsg.db)",
      );
    }
    if (!this._deps.fs.existsSync(dbPath)) return;

    // eslint-disable-next-line global-require
    const { readPcWeChat } = require("./pc-db-reader");
    const readOpts = { key: opts.key || this._key || null };
    if (Number.isInteger(opts.limitMessages)) readOpts.limitMessages = opts.limitMessages;
    if (Number.isInteger(opts.limitContacts)) readOpts.limitContacts = opts.limitContacts;
    if (this._deps.dbDriverFactory) readOpts._databaseClass = this._deps.dbDriverFactory();

    const { messages, contacts, diagnostic } = readPcWeChat(dbPath, readOpts);
    if (typeof opts.onProgress === "function") {
      try {
        opts.onProgress({ phase: "pc-db-read", adapter: NAME, ...diagnostic });
      } catch (_e) { /* progress best-effort */ }
    }

    const include = opts.include || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const fallbackCapturedAt = Date.now();
    let emitted = 0;

    if (include[KIND_MESSAGE] !== false) {
      for (const m of messages) {
        if (emitted >= limit) return;
        if (!m || typeof m !== "object") continue;
        const capturedAt =
          typeof m.createdTimeMs === "number" && m.createdTimeMs > 0
            ? m.createdTimeMs
            : fallbackCapturedAt;
        // Composite id: msgSvrId is globally unique; fallback to talker+time.
        const idPart =
          m.msgSvrId ||
          (m.talker && m.createdTimeMs ? `${m.talker}-${m.createdTimeMs}` : `msg-${emitted}`);
        yield {
          adapter: NAME,
          kind: KIND_MESSAGE,
          originalId: stableOriginalId(KIND_MESSAGE, idPart),
          capturedAt,
          payload: { kind: KIND_MESSAGE, ...m },
        };
        emitted += 1;
      }
    }

    if (include[KIND_CONTACT] !== false) {
      for (const c of contacts) {
        if (emitted >= limit) return;
        if (!c || typeof c !== "object" || !c.wxid) continue;
        yield {
          adapter: NAME,
          kind: KIND_CONTACT,
          originalId: stableOriginalId(KIND_CONTACT, c.wxid),
          capturedAt: fallbackCapturedAt,
          payload: { kind: KIND_CONTACT, ...c },
        };
        emitted += 1;
      }
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("WeChatPcAdapter.normalize: payload missing");
    }
    const kind = raw.kind || raw.payload.kind;
    const ingestedAt = Date.now();
    if (kind === KIND_MESSAGE) return normalizeMessage(raw.payload, raw, ingestedAt);
    if (kind === KIND_CONTACT) return normalizeContact(raw.payload, raw, ingestedAt);
    throw new Error(`WeChatPcAdapter.normalize: unknown kind ${kind}`);
  }
}

function buildSource(raw, occurredAt) {
  return {
    adapter: NAME,
    adapterVersion: VERSION,
    originalId: raw.originalId,
    capturedAt: raw.capturedAt || occurredAt,
    capturedBy: CAPTURED_BY.SQLITE,
  };
}

function normalizeMessage(p, raw, ingestedAt) {
  const occurredAt =
    (typeof p.createdTimeMs === "number" && p.createdTimeMs) || raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const text = typeof p.text === "string" ? p.text : "";
  const isSend = Number(p.isSend) === 1;
  const isGroup = !!p.isGroup;
  // actor: outbound = self; inbound 1-on-1 = talker; group = sender prefix.
  const selfId = "person-wechat-self";
  let actor;
  if (isGroup) {
    actor = p.senderWxid ? wxidToPersonId(p.senderWxid) : selfId;
  } else {
    actor = isSend ? selfId : (p.talker ? wxidToPersonId(p.talker) : selfId);
  }

  const persons = [];
  if (!isGroup && p.talker && !p.talker.endsWith("@chatroom")) {
    persons.push({
      id: wxidToPersonId(p.talker),
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.CONTACT,
      names: [p.talker],
      ingestedAt,
      source,
      identifiers: { wechatId: p.talker },
      extra: { platform: "wechat", source: "pc", wxid: p.talker },
    });
  }
  if (isGroup && p.senderWxid) {
    persons.push({
      id: wxidToPersonId(p.senderWxid),
      type: ENTITY_TYPES.PERSON,
      subtype: PERSON_SUBTYPES.CONTACT,
      names: [p.senderWxid],
      ingestedAt,
      source,
      identifiers: { wechatId: p.senderWxid },
      extra: { platform: "wechat", source: "pc", wxid: p.senderWxid },
    });
  }

  const topics = [];
  if (isGroup && p.talker) {
    topics.push({
      id: `topic-wechat-group-${p.talker}`,
      type: ENTITY_TYPES.TOPIC,
      name: p.talker.replace("@chatroom", ""),
      ingestedAt,
      source,
      extra: { platform: "wechat", source: "pc", wxid: p.talker },
    });
  }

  return {
    events: [{
      id: newId(),
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.MESSAGE,
      occurredAt,
      actor: actor || selfId,
      content: {
        title: text ? text.slice(0, 80) : "(非文本消息)",
        text,
      },
      ingestedAt,
      source,
      extra: {
        platform: "wechat",
        source: "pc",
        talker: p.talker || null,
        isSend,
        isGroup,
        wechatType: typeof p.type === "number" ? p.type : null,
        senderWxid: p.senderWxid || null,
        contentBlob: typeof p.contentBlob === "string" ? p.contentBlob : null,
        ...(topics.length ? { topicId: topics[0].id } : {}),
      },
    }],
    persons,
    places: [],
    items: [],
    topics,
  };
}

function normalizeContact(p, raw, ingestedAt) {
  const wxid = p.wxid ? String(p.wxid) : null;
  const occurredAt = raw.capturedAt || ingestedAt;
  const source = buildSource(raw, occurredAt);
  const names = [p.remark, p.nickname, p.alias, wxid].filter(
    (n) => typeof n === "string" && n.length > 0,
  );
  const subtype =
    wxid && wxid.startsWith("gh_") ? PERSON_SUBTYPES.MERCHANT : PERSON_SUBTYPES.CONTACT;
  return {
    events: [],
    persons: [{
      id: wxidToPersonId(wxid) || `person-wechat-${newId()}`,
      type: ENTITY_TYPES.PERSON,
      subtype,
      names: names.length ? names : ["(unnamed)"],
      ingestedAt,
      source,
      identifiers: wxid ? { wechatId: wxid } : {},
      extra: {
        platform: "wechat",
        source: "pc",
        wxid,
        alias: p.alias || null,
        wechatType: typeof p.type === "number" ? p.type : null,
      },
    }],
    places: [],
    items: [],
    topics: [],
  };
}

module.exports = {
  WeChatPcAdapter,
  NAME,
  VERSION,
  wxidToPersonId,
};
