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
const path = require("node:path");
const { newId } = require("../../ids");
const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { mergeQqEntityConflict } = require("../../qq-quality-merge");
const {
  C2C_MESSAGE_TABLE,
  GROUP_MESSAGE_TABLE,
  canonicalQqNtOriginalId,
  createQqAccountScope,
  createQqPathScope,
} = require("../../qq-source-identity");
const {
  advanceCursor,
  beginScan,
  completeStream,
  parseCursor,
  serializeCursor,
} = require("../../qq-nt/scan-cursor");

const NAME = "qq-pc";
const VERSION = "0.2.0";
const KIND_MESSAGE = "message";
const DEFAULT_CURSOR_PAGE_SIZE = 1000;

function stableOriginalId(id) {
  const safe =
    (typeof id === "string" && id.length > 0 && id) ||
    (typeof id === "number" && Number.isFinite(id) && String(id)) ||
    `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `qq-pc:message:${safe}`;
}

function observationProducer(raw) {
  const declared =
    raw?.producer ||
    raw?.payload?.observationProducer ||
    raw?.payload?.producer;
  if (typeof declared === "string" && declared.length > 0) return declared;
  if (/^qq-pc:(?:c2c|group):/u.test(raw?.originalId || "")) {
    return "qq-pc/sidecar";
  }
  return "qq-pc/direct";
}

function usesExplicitCursor(opts) {
  return (
    typeof opts?.updateWatermark === "function" ||
    opts?.sinceWatermark !== undefined
  );
}

function compareDecimalIds(left, right) {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue.length !== rightValue.length) {
    return leftValue.length - rightValue.length;
  }
  return leftValue.localeCompare(rightValue);
}

function cursorPageError(message) {
  const error = new Error(`qq-pc: ${message}`);
  error.code = "QQNT_CURSOR_PAGE_INVALID";
  return error;
}

function validatePageBoundaries(page, cursor) {
  for (const stream of ["c2c", "group"]) {
    if (!Object.prototype.hasOwnProperty.call(page.upperBounds, stream)) {
      throw cursorPageError(`cursor page omitted the ${stream} upper boundary`);
    }
    const currentUpper = page.upperBounds[stream];
    if (
      currentUpper !== null &&
      (typeof currentUpper !== "string" ||
        !/^(?:0|[1-9][0-9]*)$/u.test(currentUpper))
    ) {
      throw cursorPageError(
        `${stream} upper boundary must be an exact decimal string or null`,
      );
    }
    if (
      cursor.scan !== null &&
      !cursor.scan.done[stream] &&
      (currentUpper === null ||
        compareDecimalIds(currentUpper, cursor.scan.upper[stream]) < 0)
    ) {
      throw cursorPageError(
        `${stream} source boundary regressed below the frozen scan`,
      );
    }
  }
}

function directRawFromMessage(message, index, fallbackCapturedAt) {
  const capturedAt =
    typeof message.createdTimeMs === "number" && message.createdTimeMs > 0
      ? message.createdTimeMs
      : fallbackCapturedAt;
  const idPart =
    message.msgId ||
    (message.peerUin && message.createdTimeMs
      ? `${message.peerUin}-${message.createdTimeMs}`
      : `msg-${index}`);
  const originalId = stableOriginalId(idPart);
  const payload = {
    kind: KIND_MESSAGE,
    ...message,
    observationProducer: "qq-pc/direct",
  };
  return {
    adapter: NAME,
    kind: KIND_MESSAGE,
    originalId,
    canonicalOriginalId: canonicalQqNtOriginalId(payload),
    producer: "qq-pc/direct",
    capturedAt,
    payload,
  };
}

function sidecarRawFromMessage(message, index, fallbackCapturedAt) {
  const isGroup = message.kind === "group";
  const createdTimeMs =
    typeof message.createTime === "number" && message.createTime > 0
      ? message.createTime * 1000
      : null;
  const payload = {
    kind: KIND_MESSAGE,
    tableName:
      message.tableName || (isGroup ? GROUP_MESSAGE_TABLE : C2C_MESSAGE_TABLE),
    text: typeof message.text === "string" ? message.text : "",
    messageId: message.messageId != null ? String(message.messageId) : null,
    sequence: message.sequence != null ? String(message.sequence) : null,
    peerUin: message.peer != null ? String(message.peer) : null,
    peerUid: message.peerUid != null ? String(message.peerUid) : null,
    peerName: message.conversationName || null,
    senderUid: message.senderUid != null ? String(message.senderUid) : null,
    senderUin: message.senderUin != null ? String(message.senderUin) : null,
    senderName: message.senderName || null,
    isGroup,
    type: typeof message.type === "number" ? message.type : null,
    subtype: typeof message.subtype === "number" ? message.subtype : null,
    senderType:
      typeof message.senderType === "number" ? message.senderType : null,
    readState: typeof message.readState === "number" ? message.readState : null,
    createdTimeMs,
    observationProducer: "qq-pc/sidecar",
  };
  const originalId =
    message.originalId ||
    stableOriginalId(`${message.peer}-${createdTimeMs}-${index}`);
  return {
    adapter: NAME,
    kind: KIND_MESSAGE,
    originalId,
    canonicalOriginalId: canonicalQqNtOriginalId(payload),
    producer: "qq-pc/sidecar",
    capturedAt: createdTimeMs || fallbackCapturedAt,
    payload,
  };
}

class QQPcAdapter {
  constructor(opts = {}) {
    this._dbPath = opts.dbPath || null;
    this._key = opts.key || null;
    // QQ NT passphrase (16-char ASCII from qq-win-db-key). When present, sync
    // routes through the Python sidecar (decrypt + protobuf parse).
    this._passphrase = opts.passphrase || null;
    this.account = opts.account || null;
    this._qqUin = opts.qqUin || opts.qq || this.account?.qq || null;

    this.name = NAME;
    this.version = VERSION;
    this.scopeNamespace = "qq";
    this.capabilities = [
      "sync:sqlite",
      "decrypt:sqlcipher-qqnt",
      "parse:qq-nt-message",
    ];
    this.extractMode = "device-pull";
    this.rateLimits = {};
    this.watermarkStrategy = "explicit";
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
      // DI seam: tests inject a fake QQ sidecar collector; default lazy-loads
      // the forensics-bridge invoker.
      qqCollector: opts.qqCollector || null,
      discoveryDeps: opts.discoveryDeps || undefined,
    };
  }

  _autoDiscover() {
    if (this._discovered !== undefined) return this._discovered;
    try {
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
        message:
          (disc && disc.note) ||
          "未检测到本机 QQ NT 数据（可能未安装或未登录）",
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
      message:
        "qq-pc.authenticate: 未检测到本机 QQ NT 库，也未提供 dbPath / inputPath",
    };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  resolveDefaultScope(options = {}) {
    const accountScope = createQqAccountScope(
      options.qqUin || options.qq || options.account?.qq || this._qqUin || null,
    );
    if (accountScope) return accountScope;
    const dbPath = options.dbPath || options.inputPath || this._dbPath || null;
    return dbPath ? createQqPathScope(path.resolve(dbPath)) : null;
  }

  resolveInputScope(options = {}) {
    return this.resolveDefaultScope(options);
  }

  async *sync(opts = {}) {
    // Sidecar path: with a QQ NT passphrase (from qq-win-db-key), decrypt +
    // parse the encrypted nt_msg.db in Python and yield readable messages.
    const passphrase = opts.passphrase || this._passphrase || null;
    if (passphrase || opts.mode === "sidecar") {
      yield* this._syncViaSidecar(opts, passphrase);
      return;
    }

    const dbPath =
      opts.dbPath ||
      opts.inputPath ||
      this._dbPath ||
      this._resolveDiscoveredDbPath();
    if (!dbPath) {
      throw new Error(
        "qq-pc.sync: 未找到本机 QQ NT 库且未提供 opts.dbPath / opts.inputPath（或提供 opts.passphrase 走 sidecar 解密）",
      );
    }
    if (!this._deps.fs.existsSync(dbPath)) return;

    const { readQqNt, readQqNtCursorPage } = require("./nt-db-reader");
    const readOpts = { key: opts.key || this._key || null };
    if (Number.isSafeInteger(opts.limitMessages) && opts.limitMessages > 0) {
      readOpts.limitMessages = opts.limitMessages;
    } else if (Number.isSafeInteger(opts.limit) && opts.limit > 0) {
      readOpts.limitMessages = opts.limit;
    }
    if (this._deps.dbDriverFactory)
      readOpts._databaseClass = this._deps.dbDriverFactory();
    if (usesExplicitCursor(opts)) {
      yield* this._syncCursorPage(
        opts,
        (page) =>
          readQqNtCursorPage(dbPath, {
            ...readOpts,
            ...page,
          }),
        directRawFromMessage,
      );
      return;
    }

    const { messages, diagnostic } = readQqNt(dbPath, readOpts);
    if (typeof opts.onProgress === "function") {
      try {
        opts.onProgress({ phase: "qq-nt-read", adapter: NAME, ...diagnostic });
      } catch (_e) {
        /* progress best-effort */
      }
    }

    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const fallbackCapturedAt = Date.now();
    let emitted = 0;
    for (const m of messages) {
      if (emitted >= limit) return;
      if (!m || typeof m !== "object") continue;
      yield directRawFromMessage(m, emitted, fallbackCapturedAt);
      emitted += 1;
    }
  }

  // Sidecar path: forensics-bridge qq_nt.collect decrypts nt_msg.db (with the
  // qq-win-db-key passphrase) + parses c2c/group protobuf bodies → readable
  // messages, which we map into the same payload normalizeMessage consumes.
  async *_syncViaSidecar(opts = {}, passphrase) {
    let collect = this._deps.qqCollector;
    if (!collect) {
      collect = require("./qqnt-sidecar").collectQqNt;
    }
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : undefined;
    const collectOptions = {
      passphrase,
      key: opts.key || this._key || undefined,
      dbPath:
        opts.dbPath ||
        opts.inputPath ||
        this._dbPath ||
        this._resolveDiscoveredDbPath() ||
        undefined,
      limit,
      pythonExe: opts.pythonExe,
      bridgeDir: opts.bridgeDir,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onProgress:
        typeof opts.onProgress === "function"
          ? (m) => {
              try {
                opts.onProgress({ phase: "qq-nt", adapter: NAME, ...m });
              } catch (_e) {
                /* best-effort */
              }
            }
          : undefined,
      _supervisorFactory: opts._supervisorFactory,
    };
    if (usesExplicitCursor(opts)) {
      yield* this._syncCursorPage(
        opts,
        async (page) => {
          const result = await collect({
            ...collectOptions,
            limit: page.limit,
            page: {
              after: page.after,
              ...(page.upper ? { upper: page.upper } : {}),
            },
          });
          const messages = { c2c: [], group: [] };
          for (const message of Array.isArray(result?.messages)
            ? result.messages
            : []) {
            const stream =
              message.kind === "group" ||
              message.tableName === GROUP_MESSAGE_TABLE
                ? "group"
                : "c2c";
            messages[stream].push(message);
          }
          return {
            upperBounds: result?.upperBounds,
            hasMore: result?.hasMore,
            messages,
          };
        },
        sidecarRawFromMessage,
      );
      return;
    }

    const result = await collect(collectOptions);
    const messages =
      result && Array.isArray(result.messages) ? result.messages : [];
    const fallbackCapturedAt = Date.now();
    let emitted = 0;
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      yield sidecarRawFromMessage(m, emitted, fallbackCapturedAt);
      emitted += 1;
    }
  }

  async *_syncCursorPage(opts, fetchPage, rawFromMessage) {
    let cursor = parseCursor(opts.sinceWatermark).cursor;
    const limit =
      Number.isSafeInteger(opts.limit) && opts.limit > 0
        ? Math.min(opts.limit, 10_000)
        : DEFAULT_CURSOR_PAGE_SIZE;
    const page = await fetchPage({
      after: { ...cursor.after },
      ...(cursor.scan ? { upper: { ...cursor.scan.upper } } : {}),
      limit,
    });
    if (
      !page ||
      !page.upperBounds ||
      !page.messages ||
      !Array.isArray(page.messages.c2c) ||
      !Array.isArray(page.messages.group) ||
      !page.hasMore ||
      typeof page.hasMore.c2c !== "boolean" ||
      typeof page.hasMore.group !== "boolean"
    ) {
      throw cursorPageError(
        "cursor page source returned an incomplete boundary",
      );
    }
    validatePageBoundaries(page, cursor);
    if (cursor.scan === null) {
      cursor = beginScan(cursor, page.upperBounds);
    }

    const messages = {
      c2c: [...page.messages.c2c].sort((left, right) =>
        compareDecimalIds(left.messageId, right.messageId),
      ),
      group: [...page.messages.group].sort((left, right) =>
        compareDecimalIds(left.messageId, right.messageId),
      ),
    };
    const indexes = { c2c: 0, group: 0 };
    const fallbackCapturedAt = Date.now();
    let emitted = 0;

    while (cursor.scan !== null && emitted < limit) {
      const stream = cursor.next;
      const message = messages[stream][indexes[stream]];
      if (message) {
        if (
          typeof message.messageId !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(message.messageId)
        ) {
          throw cursorPageError(
            `${stream} cursor page returned an invalid exact messageId`,
          );
        }
        indexes[stream] += 1;
        cursor = advanceCursor(cursor, stream, message.messageId);
        if (typeof opts.updateWatermark === "function") {
          opts.updateWatermark(serializeCursor(cursor));
        }
        yield rawFromMessage(message, emitted, fallbackCapturedAt);
        emitted += 1;
        continue;
      }
      if (page.hasMore[stream]) break;
      cursor = completeStream(cursor, stream);
    }

    if (typeof opts.updateWatermark === "function") {
      opts.updateWatermark(serializeCursor(cursor));
    }
  }

  buildResolvedIngestOptions({ rawBatch, scope }) {
    const sourceAliases = [];
    const rawObservations = [];
    const seenAliases = new Set();

    for (const raw of Array.isArray(rawBatch) ? rawBatch : []) {
      if (
        !raw ||
        typeof raw.originalId !== "string" ||
        raw.originalId.length === 0
      ) {
        continue;
      }
      const canonicalOriginalId =
        canonicalQqNtOriginalId(raw.payload) ||
        (typeof raw.canonicalOriginalId === "string" &&
        raw.canonicalOriginalId.length > 0
          ? raw.canonicalOriginalId
          : raw.originalId);
      if (canonicalOriginalId !== raw.originalId) {
        const aliasKey = JSON.stringify([raw.originalId, canonicalOriginalId]);
        if (!seenAliases.has(aliasKey)) {
          seenAliases.add(aliasKey);
          sourceAliases.push({
            entityType: ENTITY_TYPES.EVENT,
            alias: {
              adapter: NAME,
              scope,
              originalId: raw.originalId,
            },
            canonical: {
              adapter: NAME,
              scope,
              originalId: canonicalOriginalId,
            },
          });
        }
      }
      rawObservations.push({
        adapter: NAME,
        scope,
        canonicalOriginalId,
        producer: observationProducer(raw),
        producerOriginalId: raw.originalId,
        capturedAt: raw.capturedAt,
        payload: raw.payload,
      });
    }

    return {
      conflictResolver: mergeQqEntityConflict,
      sourceAliases,
      rawObservations,
    };
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
      (typeof p.createdTimeMs === "number" && p.createdTimeMs) ||
      raw.capturedAt ||
      ingestedAt;
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId:
        canonicalQqNtOriginalId(p) ||
        (typeof raw.canonicalOriginalId === "string" &&
        raw.canonicalOriginalId.length > 0
          ? raw.canonicalOriginalId
          : raw.originalId),
      capturedAt: raw.capturedAt || occurredAt,
      capturedBy: CAPTURED_BY.SQLITE,
    };
    const text = typeof p.text === "string" ? p.text : "";
    return {
      events: [
        {
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
            messageId: p.messageId != null ? String(p.messageId) : null,
            sequence: p.sequence != null ? String(p.sequence) : null,
            peerUin: p.peerUin || null,
            peerUid: p.peerUid != null ? String(p.peerUid) : null,
            ...(p.peerName ? { peerName: p.peerName } : {}),
            senderUid: p.senderUid != null ? String(p.senderUid) : null,
            senderUin: p.senderUin || null,
            ...(p.senderName ? { senderName: p.senderName } : {}),
            isGroup: !!p.isGroup,
            senderType: typeof p.senderType === "number" ? p.senderType : null,
            qqMsgType: typeof p.type === "number" ? p.type : null,
            subtype: typeof p.subtype === "number" ? p.subtype : null,
            readState: typeof p.readState === "number" ? p.readState : null,
            // Full raw row preserved — protobuf bodies + unknown columns — so a
            // later decoder can backfill text without re-reading the DB.
            rawRow: p.rawRow || null,
            textResolved: typeof p.text === "string" && p.text.length > 0,
            observationProducer: observationProducer(raw),
          },
        },
      ],
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
