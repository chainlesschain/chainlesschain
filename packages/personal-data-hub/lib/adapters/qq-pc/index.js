"use strict";

/**
 * QQ NT **desktop (PC)** adapter — 本地直读样板 (ported from social-douyin /
 * wechat-pc). Reads 新版电脑 QQ 的 nt_msg.db (c2c_msg_table / group_msg_table)
 * straight into the vault as MESSAGE events.
 *
 * Distinct from the Android `messaging-qq` adapter (per-uin <uin>.db, plain
 * SQLite + XOR-IMEI content). QQ NT is SQLCipher-encrypted with numeric
 * obfuscated columns + protobuf message bodies — see nt-db-reader.js for the
 * honest v0.1 caveats. We preserve the full raw row in extra so nothing is
 * lost even when text extraction is partial.
 *
 * Modes:
 *   opts.dbPath / opts.inputPath — a (decrypted) nt_msg.db. opts.key (hex)
 *   lets the reader attempt SQLCipher directly; otherwise a plaintext DB is
 *   expected (decrypt first — the reliable path).
 */

const fs = require("node:fs");
const { newId } = require("../../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../../constants");

const NAME = "qq-pc";
const VERSION = "0.1.0";
const KIND_MESSAGE = "message";

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `qq-pc:message:${safe}`;
}

class QQPcAdapter {
  constructor(opts = {}) {
    this._dbPath = opts.dbPath || null;
    this._key = opts.key || null;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:sqlite",
      "decrypt:sqlcipher-qqnt",
      "parse:qq-nt-message",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "qq-pc:messages (time / type / sender / peer / best-effort text from nt_msg.db; raw row preserved)",
      ],
      sensitivity: "high",
      legalGate: true,
    };

    this._deps = {
      fs,
      dbDriverFactory: opts.dbDriverFactory || null,
    };
  }

  _autoDiscover() {
    if (this._discovered !== undefined) return this._discovered;
    try {
      // eslint-disable-next-line global-require
      const { discover } = require("../_pc-local-discovery");
      this._discovered = discover("qq-pc", this._deps.discoveryDeps || {});
    } catch (_e) {
      this._discovered = null;
    }
    return this._discovered;
  }

  _resolveDiscoveredDbPath() {
    const disc = this._autoDiscover();
    return disc && disc.installed && disc.primaryDb ? disc.primaryDb : null;
  }

  async authenticate(ctx = {}) {
    if (ctx && ctx.readinessOnly) {
      if (this._dbPath) return { ok: true, mode: "configured" };
      const disc = this._autoDiscover();
      if (disc && disc.installed) {
        return {
          ok: false,
          reason: "DB_FOUND_NEEDS_KEY",
          message: `已找到本机 QQ 库（${disc.accounts.length} 个账号，主库 ${disc.primaryDb}）`,
          discovered: disc,
        };
      }
      return {
        ok: false,
        reason: "APP_NOT_INSTALLED",
        message: (disc && disc.note) || "未检测到本机 QQ NT 数据（可能未安装或未登录）",
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
          message: `qq-pc: db not readable at ${dbPath}: ${err.message}`,
        };
      }
      return { ok: true, mode: "sqlite" };
    }
    const disc = this._autoDiscover();
    if (disc && disc.installed) {
      return {
        ok: false,
        reason: "DB_FOUND_NEEDS_KEY",
        message: `已找到本机 QQ 库（主库 ${disc.primaryDb}），需解密密钥`,
        discovered: disc,
      };
    }
    return {
      ok: false,
      reason: "APP_NOT_INSTALLED",
      message: "qq-pc.authenticate: 未检测到本机 QQ NT 库，也未提供 dbPath / inputPath",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath =
      opts.dbPath || opts.inputPath || this._dbPath || this._resolveDiscoveredDbPath();
    if (!dbPath) {
      throw new Error("qq-pc.sync: 未找到本机 QQ NT 库且未提供 opts.dbPath / opts.inputPath");
    }
    if (!this._deps.fs.existsSync(dbPath)) return;

    // eslint-disable-next-line global-require
    const { readQqNt } = require("./nt-db-reader");
    const readOpts = { key: opts.key || this._key || null };
    if (Number.isInteger(opts.limitMessages)) readOpts.limitMessages = opts.limitMessages;
    if (this._deps.dbDriverFactory) readOpts._databaseClass = this._deps.dbDriverFactory();

    const { messages, diagnostic } = readQqNt(dbPath, readOpts);
    if (typeof opts.onProgress === "function") {
      try {
        opts.onProgress({ phase: "qq-nt-read", adapter: NAME, ...diagnostic });
      } catch (_e) { /* progress best-effort */ }
    }

    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const fallbackCapturedAt = Date.now();
    let emitted = 0;
    for (const m of messages) {
      if (emitted >= limit) return;
      if (!m || typeof m !== "object") continue;
      const capturedAt =
        typeof m.createdTimeMs === "number" && m.createdTimeMs > 0
          ? m.createdTimeMs
          : fallbackCapturedAt;
      const idPart =
        m.msgId ||
        (m.peerUin && m.createdTimeMs ? `${m.peerUin}-${m.createdTimeMs}` : `msg-${emitted}`);
      yield {
        adapter: NAME,
        kind: KIND_MESSAGE,
        originalId: stableOriginalId(idPart),
        capturedAt,
        payload: { kind: KIND_MESSAGE, ...m },
      };
      emitted += 1;
    }
  }

  normalize(raw) {
    if (!raw || !raw.payload) {
      throw new Error("QQPcAdapter.normalize: payload missing");
    }
    const kind = raw.kind || raw.payload.kind;
    if (kind !== KIND_MESSAGE) {
      throw new Error(`QQPcAdapter.normalize: unknown kind ${kind}`);
    }
    const p = raw.payload;
    const ingestedAt = Date.now();
    const occurredAt =
      (typeof p.createdTimeMs === "number" && p.createdTimeMs) || raw.capturedAt || ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.SQLITE,
    };
    const text = typeof p.text === "string" ? p.text : "";
    return {
      events: [{
        id: newId(),
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.MESSAGE,
        occurredAt,
        actor: "person-self",
        content: {
          title: text ? text.slice(0, 80) : "(待解析消息体)",
          text,
        },
        ingestedAt,
        source,
        extra: {
          platform: "qq",
          source: "pc-nt",
          peerUin: p.peerUin || null,
          senderUin: p.senderUin || null,
          isGroup: !!p.isGroup,
          qqMsgType: typeof p.type === "number" ? p.type : null,
          // Full raw row preserved — protobuf bodies + unknown columns — so a
          // later decoder can backfill text without re-reading the DB.
          rawRow: p.rawRow || null,
          textResolved: typeof p.text === "string" && p.text.length > 0,
        },
      }],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

module.exports = {
  QQPcAdapter,
  NAME,
  VERSION,
};
