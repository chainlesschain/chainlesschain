"use strict";

/**
 * Factory for "honest best-effort" desktop IM adapters (钉钉 / 飞书) built on
 * the generic local-im-db-reader. Both platforms have proprietary, possibly
 * encrypted, version-volatile local SQLite — so the adapter:
 *   - opens a (decrypted-or-keyed) local DB
 *   - discovers message tables + resolves columns defensively
 *   - emits MESSAGE events with the FULL raw row preserved + a loud
 *     diagnostic (textResolved flag tells the UI when bodies are still
 *     opaque / need real-device tuning)
 *
 * Same shape as qq-pc. Mirrors its honest contract so the UI / guide can
 * treat all device-pull desktop IM sources uniformly.
 */

const fs = require("node:fs");
const { newId } = require("../ids");
const { ENTITY_TYPES, EVENT_SUBTYPES, CAPTURED_BY } = require("../constants");

const KIND_MESSAGE = "message";

/**
 * @param {object} cfg
 * @param {string} cfg.name              adapter name (e.g. "dingtalk-pc")
 * @param {string} cfg.platform          extra.platform tag (e.g. "dingtalk")
 * @param {string} [cfg.version]
 * @param {RegExp} [cfg.tablePattern]    message-table name matcher
 * @param {object} [cfg.colCandidates]   platform-specific column candidates
 * @param {string} cfg.needHint          readiness/DB_NOT_PULLED message
 */
function createLocalImPcAdapter(cfg) {
  const NAME = cfg.name;
  const VERSION = cfg.version || "0.1.0";
  const PLATFORM = cfg.platform;

  function stableOriginalId(id) {
    const safe =
      (typeof id === "string" && id.length > 0 && id) ||
      `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `${NAME}:message:${safe}`;
  }

  class LocalImPcAdapter {
    constructor(opts = {}) {
      this._dbPath = opts.dbPath || null;
      this._key = opts.key || null;
      this.name = NAME;
      this.version = VERSION;
      this.capabilities = ["sync:sqlite", "parse:local-im-message"];
      this.extractMode = "device-pull";
      this.rateLimits = {};
      this.dataDisclosure = {
        fields: [`${PLATFORM}:messages (time / sender / peer / best-effort text; raw row preserved)`],
        sensitivity: "high",
        legalGate: true,
      };
      this._deps = { fs, dbDriverFactory: opts.dbDriverFactory || null };
    }

    _autoDiscover() {
      if (this._discovered !== undefined) return this._discovered;
      try {
        // eslint-disable-next-line global-require
        const { discover } = require("./_pc-local-discovery");
        this._discovered = discover(NAME, this._deps.discoveryDeps || {});
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
          // best-effort plaintext DB → one-click ready; encrypted → needs key
          if (!disc.encrypted) return { ok: true, mode: "auto-discovered" };
          return {
            ok: false,
            reason: "DB_FOUND_NEEDS_KEY",
            message: `已找到本机 ${PLATFORM} 库（主库 ${disc.primaryDb}），可能需解密`,
            discovered: disc,
          };
        }
        return { ok: false, reason: "APP_NOT_INSTALLED", message: (disc && disc.note) || cfg.needHint };
      }
      const dbPath =
        (ctx && ctx.inputPath) || (ctx && ctx.dbPath) || this._dbPath || this._resolveDiscoveredDbPath();
      if (dbPath) {
        try {
          this._deps.fs.accessSync(dbPath, this._deps.fs.constants.R_OK);
        } catch (err) {
          return { ok: false, reason: "INPUT_PATH_UNREADABLE", message: `${NAME}: db not readable at ${dbPath}: ${err.message}` };
        }
        return { ok: true, mode: "sqlite" };
      }
      return { ok: false, reason: "APP_NOT_INSTALLED", message: `${NAME}.authenticate: 未检测到本机 ${PLATFORM} 库，也未提供 dbPath / inputPath` };
    }

    async healthCheck() {
      return { ok: true, lastChecked: Date.now() };
    }

    async *sync(opts = {}) {
      const dbPath = opts.dbPath || opts.inputPath || this._dbPath || this._resolveDiscoveredDbPath();
      if (!dbPath) throw new Error(`${NAME}.sync: 未找到本机 ${PLATFORM} 库且未提供 opts.dbPath / opts.inputPath`);
      if (!this._deps.fs.existsSync(dbPath)) return;

      // eslint-disable-next-line global-require
      const { readLocalImDb } = require("./_local-im-db-reader");
      const readOpts = {
        key: opts.key || this._key || null,
        tablePattern: cfg.tablePattern,
        colCandidates: cfg.colCandidates,
      };
      if (Number.isInteger(opts.limitMessages)) readOpts.limitMessages = opts.limitMessages;
      if (this._deps.dbDriverFactory) readOpts._databaseClass = this._deps.dbDriverFactory();

      const { messages, diagnostic } = readLocalImDb(dbPath, readOpts);
      if (typeof opts.onProgress === "function") {
        try { opts.onProgress({ phase: "local-im-read", adapter: NAME, ...diagnostic }); } catch (_e) { /* best-effort */ }
      }

      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
      const fallback = Date.now();
      let emitted = 0;
      for (const m of messages) {
        if (emitted >= limit) return;
        if (!m || typeof m !== "object") continue;
        yield {
          adapter: NAME,
          kind: KIND_MESSAGE,
          originalId: stableOriginalId(m.msgId),
          capturedAt: (typeof m.createdTimeMs === "number" && m.createdTimeMs > 0) ? m.createdTimeMs : fallback,
          payload: { kind: KIND_MESSAGE, ...m },
        };
        emitted += 1;
      }
    }

    normalize(raw) {
      if (!raw || !raw.payload) throw new Error(`${NAME}.normalize: payload missing`);
      const kind = raw.kind || raw.payload.kind;
      if (kind !== KIND_MESSAGE) throw new Error(`${NAME}.normalize: unknown kind ${kind}`);
      const p = raw.payload;
      const ingestedAt = Date.now();
      const occurredAt = (typeof p.createdTimeMs === "number" && p.createdTimeMs) || raw.capturedAt || ingestedAt;
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
          content: { title: text ? text.slice(0, 80) : "(待解析消息体)", text },
          ingestedAt,
          source,
          extra: {
            platform: PLATFORM,
            source: "pc",
            table: p.table || null,
            senderId: p.senderId || null,
            peerId: p.peerId || null,
            rawRow: p.rawRow || null,
            textResolved: typeof p.text === "string" && p.text.length > 0,
          },
        }],
        persons: [], places: [], items: [], topics: [],
      };
    }
  }

  return LocalImPcAdapter;
}

module.exports = { createLocalImPcAdapter };
