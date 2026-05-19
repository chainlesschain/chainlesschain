/**
 * AlipayBillAdapter — Phase 6 of the Personal Data Hub.
 *
 * **Not a server-pull adapter** — Alipay has no public API. Users export
 * a CSV bill from the Alipay app (我的 → 账单 → 开具交易流水证明 → 发到
 * 邮箱), then drop the resulting `alipay_record_*.zip` into our UI.
 *
 * The adapter's `sync()` therefore takes an explicit `csvPath` (or
 * `zipPath` + password) opt rather than auto-fetching. Registry calls
 * with no opt → no-op (returns immediately). UI drives sync per-file.
 *
 * Watermark: Alipay CSVs are full-month exports; no incremental
 * server-side state. We dedupe via `source.originalId = txId` so re-
 * importing the same CSV produces 0 new events. Watermark is only
 * informational ("last imported file hash + row count").
 */

"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

const { EVENT_SUBTYPES, PERSON_SUBTYPES, CAPTURED_BY } = require("../../constants");
const { newId } = require("../../ids");
const { parseAlipayCsvBuffer } = require("./csv-parser");
const { extractCsvFromZip } = require("./zip-decryptor");
const {
  classifyCounterparty,
  counterpartyToPersonId,
} = require("./counterparty");

const NAME = "alipay-bill";
const VERSION = "0.1.0"; // Phase 6 — initial CSV-import adapter

/**
 * Map Alipay's `类型` string → UnifiedSchema Event.subtype.
 * Per design doc §4.4.
 */
function mapAlipayTypeToSubtype(alipayType, direction) {
  const t = String(alipayType || "");
  if (t.includes("转账")) return "transfer";
  if (t.includes("退款")) return "refund";
  if (t.includes("理财") || t.includes("余额宝")) return "investment";
  if (t.includes("红包")) return "redenvelope";
  if (t.includes("缴费")) return "utility";
  if (t.includes("交易关闭") || t.includes("交易失败")) return "cancelled";
  return direction === "收入" ? "income" : "payment";
}

class AlipayBillAdapter {
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("AlipayBillAdapter: opts required");
    }
    const account = opts.account;
    if (!account || typeof account !== "object") {
      throw new Error("AlipayBillAdapter: opts.account required");
    }
    if (typeof account.email !== "string" || account.email.length === 0) {
      throw new Error("AlipayBillAdapter: account.email required (Alipay account identifier)");
    }
    this.account = account;
    // ZIP password (= 身份证后 6 位 by default). Optional — if the user's
    // export is unencrypted (rare) or they extract manually first, pass
    // csvPath at sync() time.
    this._zipPassword = typeof opts.zipPassword === "string" ? opts.zipPassword : null;
    // Test seams
    this._csvParser = typeof opts.csvParser === "function" ? opts.csvParser : parseAlipayCsvBuffer;
    this._zipExtractor = typeof opts.zipExtractor === "function" ? opts.zipExtractor : extractCsvFromZip;

    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["import:csv-zip", "parse:transactions"];
    this.rateLimits = {};
    this.dataDisclosure = {
      fields: [
        "alipay:txId, createdAt, paidAt, counterparty, itemName, amount, direction, status, note",
      ],
      sensitivity: "high",
      legalGate: false,
    };
  }

  async authenticate(_ctx = {}) {
    // No server auth — adapter is always "ok" once configured.
    return { ok: true, account: this.account.email, provider: "alipay-bill" };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  /**
   * `sync()` here is driven by an explicit file path. When called with
   * no zipPath/csvPath the adapter emits 0 events (waiting for user
   * action). Registry's syncAll() will hit this case for periodic
   * checks — same as Phase 5 EmailAdapter handles authcode-not-set.
   *
   * @param {object} opts
   * @param {string} [opts.zipPath]       full path to alipay_record_*.zip
   * @param {string} [opts.csvPath]       full path to a pre-extracted .csv
   * @param {string} [opts.zipPassword]   overrides constructor zipPassword
   * @param {Function} [opts.onProgress]
   */
  async *sync(opts = {}) {
    const zipPath = typeof opts.zipPath === "string" ? opts.zipPath : null;
    const csvPath = typeof opts.csvPath === "string" ? opts.csvPath : null;
    if (!zipPath && !csvPath) {
      // Idle — no file to import this run
      return;
    }

    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const emit = (phase, payload = {}) => {
      if (!onProgress) return;
      try { onProgress({ phase, adapter: NAME, ...payload }); } catch (_e) {}
    };

    emit("opening", { zipPath, csvPath });

    let csvBuffer;
    let sourceFile;
    if (zipPath) {
      const password = typeof opts.zipPassword === "string" ? opts.zipPassword : this._zipPassword;
      const out = await this._zipExtractor(zipPath, { password });
      csvBuffer = out.buffer;
      sourceFile = `${zipPath}::${out.filename}`;
    } else {
      csvBuffer = fs.readFileSync(csvPath);
      sourceFile = csvPath;
    }
    const fileSha256 = crypto.createHash("sha256").update(csvBuffer).digest("hex");
    emit("parsing", { sourceFile, fileSha256, bytes: csvBuffer.length });

    const parsed = this._csvParser(csvBuffer);
    emit("parsed", {
      sourceFile,
      encoding: parsed.encoding,
      rows: parsed.rows.length,
      header: parsed.header,
    });

    let yielded = 0;
    for (const row of parsed.rows) {
      emit("row", { current: yielded + 1, total: parsed.rows.length, txId: row.txId });
      yield this._rowToRawEvent(row, {
        sourceFile,
        fileSha256,
        accountEmail: this.account.email,
        importedAt: Date.now(),
        billPeriod: parsed.header,
      });
      yielded += 1;
    }

    emit("done", { yielded, sourceFile });
  }

  /**
   * normalize(raw) → NormalizedBatch (Event + Persons + Items).
   * Per design doc §5.4.
   */
  normalize(raw) {
    if (!raw || typeof raw !== "object" || !raw.payload) {
      throw new Error("AlipayBillAdapter.normalize: missing raw or raw.payload");
    }
    const row = raw.payload.row;
    if (!row || typeof row !== "object") {
      throw new Error("AlipayBillAdapter.normalize: payload.row missing");
    }

    // Parse the amount and timestamps
    const amount = parseFloat(row.amount);
    const occurredAt = parseAlipayDateTime(row.paidAt) || parseAlipayDateTime(row.createdAt) || raw.capturedAt || Date.now();

    // Counterparty → Person (with stable id for dedup)
    const counterpartyId = counterpartyToPersonId(row.counterparty);
    const counterpartyKind = classifyCounterparty(row.counterparty);
    const direction = row.direction === "收入" ? "in" : "out";

    const subtype = mapAlipayTypeToSubtype(row.alipayType, row.direction);
    const eventId = newId();

    // Skip closed / failed transactions — they polluted vault with
    // "transaction never happened" rows. Mark as cancelled instead.
    const isCancelled = subtype === "cancelled" || /关闭|失败/.test(row.status || "");

    const event = {
      id: eventId,
      type: "event",
      subtype: isCancelled ? "cancelled" : subtype,
      occurredAt,
      actor: direction === "out" ? "person-self" : counterpartyId,
      participants: [counterpartyId, "person-self"].filter(Boolean),
      content: {
        title: row.itemName || row.alipayType || row.counterparty,
        ...(row.note ? { text: row.note } : {}),
        amount: {
          value: Number.isFinite(amount) ? amount : 0,
          currency: "CNY",
          direction,
        },
      },
      source: {
        adapter: NAME,
        adapterVersion: VERSION,
        originalId: row.txId,
        capturedAt: raw.capturedAt || occurredAt,
        capturedBy: CAPTURED_BY ? (CAPTURED_BY.EXPORT || "export") : "export",
      },
      extra: {
        alipayType: row.alipayType,
        sourceChannel: row.sourceChannel || undefined,
        merchantOrderNumber: row.merchantOrderNumber || undefined,
        txStatus: row.status,
        serviceFee: parseFloat(row.serviceFee || "0") || 0,
        refundedAmount: parseFloat(row.refundedAmount || "0") || 0,
        fundStatus: row.fundStatus || undefined,
        accountEmail: raw.payload.accountEmail,
        fileSha256: raw.payload.fileSha256,
        billPeriod: raw.payload.billPeriod || undefined,
        counterpartyKind,
        ...(counterpartyKind === "unknown" ? { needsResolve: true } : {}),
      },
    };

    const persons = [{
      id: counterpartyId,
      type: "person",
      subtype: counterpartyKind === "contact"
        ? (PERSON_SUBTYPES ? (PERSON_SUBTYPES.CONTACT || "contact") : "contact")
        : (PERSON_SUBTYPES ? (PERSON_SUBTYPES.MERCHANT || "merchant") : "merchant"),
      names: [row.counterparty || "(unknown)"],
      identifiers: {},
      extra: {
        ...(counterpartyKind === "unknown" ? { needsResolve: true } : {}),
        firstSeenAt: occurredAt,
      },
    }];

    // Item (only when an itemName is present and not just an alipayType)
    const items = [];
    if (row.itemName && row.itemName !== row.alipayType) {
      items.push({
        id: newId(),
        type: "item",
        subtype: "product",
        name: row.itemName,
        price: { value: amount, currency: "CNY" },
        merchant: counterpartyId,
        extra: {
          sourceEventId: eventId,
        },
      });
    }

    return { events: [event], persons, places: [], items, topics: [] };
  }

  _rowToRawEvent(row, ctx) {
    return {
      adapter: NAME,
      originalId: row.txId,
      capturedAt: parseAlipayDateTime(row.paidAt) || parseAlipayDateTime(row.createdAt) || ctx.importedAt,
      payload: {
        row,
        accountEmail: ctx.accountEmail,
        sourceFile: ctx.sourceFile,
        fileSha256: ctx.fileSha256,
        importedAt: ctx.importedAt,
        billPeriod: ctx.billPeriod,
      },
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * Parse "2024-04-01 09:23:13" → ms epoch (local time). Alipay timestamps
 * are local-time strings (no timezone marker). Returns null on parse
 * failure.
 */
function parseAlipayDateTime(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  // Replace space with T so Date can parse it
  const iso = s.replace(" ", "T");
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

module.exports = {
  AlipayBillAdapter,
  mapAlipayTypeToSubtype,
  parseAlipayDateTime,
  NAME,
  VERSION,
};
