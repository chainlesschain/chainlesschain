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
      // DI seam: tests inject a fake WeChat 4.x collector; default lazy-loads
      // the forensics-bridge sidecar invoker.
      v4Collector: opts.v4Collector || null,
      // DI seam for discovery (see _autoDiscover).
      discoveryDeps: opts.discoveryDeps || undefined,
    };
  }

  // Auto-discover PC WeChat's local DB on the host (3.x + 4.x layouts) so the
  // UI never needs a manually typed path. Lazy-required + cached per instance.
  _autoDiscover() {
    if (this._discovered !== undefined) return this._discovered;
    try {
      // eslint-disable-next-line global-require
      const { discover } = require("../_pc-local-discovery");
      this._discovered = discover("wechat-pc", this._deps.discoveryDeps || {});
    } catch (_e) {
      this._discovered = null;
    }
    return this._discovered;
  }

  async authenticate(ctx = {}) {
    // Cheap readiness probe — never opens / decrypts a DB.
    if (ctx && ctx.readinessOnly) {
      if (this._dbPath) return { ok: true, mode: "configured" };
      const disc = this._autoDiscover();
      if (disc && disc.installed) {
        return {
          ok: false,
          reason: "DB_FOUND_NEEDS_KEY",
          message: `已找到本机微信库（${disc.layout || ""} ${disc.accounts.length} 个账号，主库 ${disc.primaryDb}）`,
          discovered: disc,
        };
      }
      return {
        ok: false,
        reason: "APP_NOT_INSTALLED",
        message: (disc && disc.note) || "未检测到本机微信数据（可能未安装或未登录）",
      };
    }
    const dbPath =
      (ctx && ctx.inputPath) ||
      (ctx && ctx.dbPath) ||
      this._dbPath ||
      this._resolveDiscoveredDbPath();
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
    const disc = this._autoDiscover();
    if (disc && disc.installed) {
      return {
        ok: false,
        reason: "DB_FOUND_NEEDS_KEY",
        message: `已找到本机微信库（主库 ${disc.primaryDb}），需解密密钥`,
        discovered: disc,
      };
    }
    return {
      ok: false,
      reason: "APP_NOT_INSTALLED",
      message: "wechat-pc.authenticate: 未检测到本机微信库，也未提供 dbPath / inputPath",
    };
  }

  // Resolve the auto-discovered primary message DB path (null if none).
  _resolveDiscoveredDbPath() {
    const disc = this._autoDiscover();
    return disc && disc.installed && disc.primaryDb ? disc.primaryDb : null;
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    // WeChat 4.x path: encrypted SQLCipher-4 DBs whose key lives in Weixin.exe
    // memory. Route through the Python sidecar (memory key + decrypt + parse)
    // and yield the decrypted messages. Triggered when the user gives no
    // explicit plaintext path AND discovery sees the 4.x layout, or opts.mode.
    const disc = this._autoDiscover();
    const noExplicitPath = !opts.dbPath && !opts.inputPath && !this._dbPath;
    const useV4 =
      opts.mode === "v4" ||
      (noExplicitPath && disc && disc.installed && disc.layout === "4.x");
    if (useV4) {
      yield* this._syncV4(opts, disc);
      return;
    }

    // One-click: when no explicit path is given, fall back to the
    // auto-discovered primary message DB on this host (3.x plaintext/keyed).
    const dbPath =
      opts.dbPath || opts.inputPath || this._dbPath || this._resolveDiscoveredDbPath();
    if (!dbPath) {
      throw new Error(
        "wechat-pc.sync: 未找到本机微信库且未提供 opts.dbPath / opts.inputPath",
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

  // WeChat 4.x: invoke the sidecar collector, then re-shape each decrypted
  // message into the SAME payload the 3.x normalizeMessage() understands, so
  // both layouts share one normalization path.
  async *_syncV4(opts = {}, disc) {
    let collect = this._deps.v4Collector;
    if (!collect) {
      // eslint-disable-next-line global-require
      collect = require("./v4-sidecar").collectWeChatV4;
    }
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : undefined;
    const result = await collect({
      limit,
      key: opts.key || this._key || undefined,
      pythonExe: opts.pythonExe,
      bridgeDir: opts.bridgeDir,
      timeoutMs: opts.timeoutMs,
      onProgress:
        typeof opts.onProgress === "function"
          ? (m) => {
              try { opts.onProgress({ phase: "wechat-v4", adapter: NAME, ...m }); } catch (_e) { /* best-effort */ }
            }
          : undefined,
      _supervisorFactory: opts._supervisorFactory,
    });
    if (typeof opts.onProgress === "function") {
      try {
        opts.onProgress({
          phase: "wechat-v4-done",
          adapter: NAME,
          account: result && result.account,
          messageCount: result && result.messageCount,
          dbs: result && result.dbs,
        });
      } catch (_e) { /* best-effort */ }
    }
    const selfWxid =
      (result && result.account) ||
      (disc && disc.accounts && disc.accounts[0] && disc.accounts[0].id) ||
      null;
    const fallbackCapturedAt = Date.now();
    const messages = (result && Array.isArray(result.messages)) ? result.messages : [];
    let emitted = 0;
    const max = limit || Infinity;
    for (const m of messages) {
      if (emitted >= max) return;
      if (!m || typeof m !== "object") continue;
      const conv = typeof m.conversation === "string" ? m.conversation : null;
      const isGroup = !!conv && conv.endsWith("@chatroom");
      const createdTimeMs =
        typeof m.createTime === "number" && m.createTime > 0 ? m.createTime * 1000 : null;
      // Map → 3.x payload shape consumed by normalizeMessage().
      const payload = {
        kind: KIND_MESSAGE,
        msgSvrId: m.originalId || null,
        talker: conv,
        isSend: selfWxid && m.sender && m.sender === selfWxid ? 1 : 0,
        type: typeof m.type === "number" ? m.type : null,
        createdTimeMs,
        text: typeof m.text === "string" ? m.text : "",
        senderWxid: isGroup ? (m.sender || null) : null,
        isGroup,
        contentBlob: typeof m.text === "string" ? m.text : null,
      };
      const idPart =
        m.originalId ||
        (conv && createdTimeMs ? `${conv}-${createdTimeMs}` : `v4-${emitted}`);
      yield {
        adapter: NAME,
        kind: KIND_MESSAGE,
        originalId: m.originalId || stableOriginalId(KIND_MESSAGE, idPart),
        capturedAt: createdTimeMs || fallbackCapturedAt,
        payload,
      };
      emitted += 1;
    }

    // Contacts (from contact.db) → Person entities. Not bound by the message
    // `limit` (that caps messages, not the address book). Opt out via
    // opts.include.contact === false.
    const include = opts.include || {};
    if (include[KIND_CONTACT] !== false) {
      const contacts = (result && Array.isArray(result.contacts)) ? result.contacts : [];
      for (const c of contacts) {
        if (!c || typeof c !== "object" || !c.wxid) continue;
        if (typeof c.wxid === "string" && c.wxid.endsWith("@chatroom")) continue;
        yield {
          adapter: NAME,
          kind: KIND_CONTACT,
          originalId: stableOriginalId(KIND_CONTACT, c.wxid),
          capturedAt: fallbackCapturedAt,
          payload: {
            kind: KIND_CONTACT,
            wxid: c.wxid,
            alias: c.alias || null,
            nickname: c.nickname || null,
            remark: c.remark || null,
            type: typeof c.type === "number" ? c.type : null,
          },
        };
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
