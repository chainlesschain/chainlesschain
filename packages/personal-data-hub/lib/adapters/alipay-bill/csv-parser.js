/**
 * Phase 6 — Alipay 账单 CSV 解析器
 *
 * 支付宝 "开具交易流水证明" 导出的 CSV 格式（GBK 默认，新版部分 UTF-8 BOM）：
 *
 *   行 1   `支付宝交易记录明细查询`
 *   行 2   `账号:[email@example.com / 13800001111]`
 *   行 3   `起始日期:[2024-04-01 00:00:00]    终止日期:[2024-05-01 00:00:00]`
 *   行 4   `-------------------交易记录明细列表-------------------`
 *   行 5   `交易号,商家订单号,交易创建时间,付款时间,...` ← header
 *   行 6+  数据行
 *   末尾   `-------------------交易记录明细列表结束-------------------`
 *   再    汇总文本（"导出时间"、"用户姓名" 等元数据）— 跳过
 *
 * 设计选择：
 *   1. 手写 parser（不引 csv-parse）。Alipay CSV 字段都用半角逗号，
 *      字段内不嵌逗号（商品名含逗号也会被 Alipay 转义为中文 ， 或省略），
 *      Naive split 已足够，单测覆盖 50+ 真实样本。
 *   2. 编码：先尝 UTF-8 decode 看是否含合理的中文 magic 字符串
 *      ("交易号" / "支付宝")；含 → UTF-8；否则降级 GBK（via iconv-lite）。
 *   3. 终止：碰到 "交易记录明细列表结束" 或下一个非数据行（不含逗号或
 *      首字段不是 yyyy 开头）。
 *
 * 返回 `{ header: {...meta}, rows: [...] }`：
 *   - header.account     `email@example.com` 或手机
 *   - header.startDate   ISO-ish string
 *   - header.endDate
 *   - rows               RawTransaction 数组（design doc §5.3 形状）
 */

"use strict";

/** @typedef {import('./types').RawTransaction} RawTransaction */

const FIELD_ORDER = [
  "txId",
  "merchantOrderNumber",
  "createdAt",
  "paidAt",
  "lastModifiedAt",
  "sourceChannel",
  "alipayType",
  "counterparty",
  "itemName",
  "amount",
  "direction",
  "status",
  "serviceFee",
  "refundedAmount",
  "note",
  "fundStatus",
];

const MAGIC_HEADER_ROW = "交易号"; // header line starts with this

/**
 * Decode a Buffer using UTF-8 first, falling back to GBK via iconv-lite.
 *
 * @param {Buffer} buf
 * @param {{ iconvImpl?: Function }} [opts]   inject for tests
 * @returns {{ text: string, encoding: string }}
 */
function decodeBuffer(buf, opts = {}) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error("decodeBuffer: Buffer required");
  }
  // Strip BOM if present (UTF-8 BOM = EF BB BF)
  let work = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    work = buf.slice(3);
  }
  const utf8 = work.toString("utf-8");
  // UTF-8 confidence check: does it contain expected Alipay header tokens?
  if (utf8.includes("交易号") || utf8.includes("支付宝交易记录")) {
    return { text: utf8, encoding: "utf-8" };
  }
  // Fall back to GBK
  const iconv = typeof opts.iconvImpl === "function" ? opts.iconvImpl : loadIconvLite();
  const decoded = iconv(work, "gbk");
  return { text: decoded, encoding: "gbk" };
}

let _iconvCache = null;
function loadIconvLite() {
  if (_iconvCache) return _iconvCache;
  try {
    // eslint-disable-next-line global-require
    const il = require("iconv-lite");
    _iconvCache = (buf, enc) => il.decode(buf, enc);
  } catch (err) {
    throw new Error(
      `iconv-lite not installed — Alipay CSV needs it for GBK decode. ${err && err.message ? err.message : err}`,
    );
  }
  return _iconvCache;
}

/**
 * Parse a decoded CSV text → { header, rows }.
 *
 * @param {string} text
 * @returns {{ header: object, rows: RawTransaction[] }}
 */
function parseAlipayCsv(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { header: {}, rows: [] };
  }
  const lines = text.split(/\r?\n/);
  const header = {};

  // ── Step 1: scan preamble for account + date range, then find header row idx
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Match account: 账号:[email@... / phone]
    const acctMatch = line.match(/账号\s*:?\s*\[?([^\]\s]+@[^\]\s]+|\d{11})\]?/);
    if (acctMatch) header.account = acctMatch[1];
    // Match date range: 起始日期:[2024-04-01 00:00:00] 终止日期:[2024-05-01 00:00:00]
    const startMatch = line.match(/起始日期\s*:?\s*\[?([\d-]+\s+[\d:]+)\]?/);
    if (startMatch) header.startDate = startMatch[1];
    const endMatch = line.match(/终止日期\s*:?\s*\[?([\d-]+\s+[\d:]+)\]?/);
    if (endMatch) header.endDate = endMatch[1];
    // Detect the column-header line
    if (line.startsWith(MAGIC_HEADER_ROW)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    // No "交易号" header line — file is malformed / empty / not an Alipay CSV
    return { header, rows: [], warning: "header row '交易号,...' not found" };
  }

  // ── Step 2: parse rows after headerIdx until terminator or non-data line
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes("交易记录明细列表结束") || line.includes("---")) break;
    // A data line should have ≥ 12 commas (16 fields). Otherwise it's
    // probably trailing metadata like "导出时间:..."
    const commas = (line.match(/,/g) || []).length;
    if (commas < 10) continue;

    const fields = splitCsvLine(line);
    if (fields.length < FIELD_ORDER.length) {
      // Lenient: pad with empty strings to match the schema
      while (fields.length < FIELD_ORDER.length) fields.push("");
    }
    const row = {};
    for (let j = 0; j < FIELD_ORDER.length; j += 1) {
      row[FIELD_ORDER[j]] = fields[j] != null ? fields[j].trim() : "";
    }
    // Skip empty-id rows
    if (!row.txId) continue;
    rows.push(row);
  }

  return { header, rows };
}

/**
 * Lightweight CSV-line split. Alipay rows don't quote fields, so a plain
 * `,` split is correct in practice. We still tolerate double-quoted
 * fields just in case (`"abc, def"`) for forward-compat.
 *
 * Exported for unit tests.
 */
function splitCsvLine(line) {
  if (!line.includes('"')) {
    return line.split(",");
  }
  // Quoted-field aware split
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Top-level: take a raw Buffer (the CSV file bytes, ZIP-decompressed by
 * zip-decryptor.js) and return parsed rows + metadata.
 *
 * @param {Buffer} buf
 * @param {{ iconvImpl?: Function }} [opts]
 * @returns {{ encoding: string, header: object, rows: RawTransaction[] }}
 */
function parseAlipayCsvBuffer(buf, opts = {}) {
  const { text, encoding } = decodeBuffer(buf, opts);
  const parsed = parseAlipayCsv(text);
  return { encoding, ...parsed };
}

module.exports = {
  parseAlipayCsv,
  parseAlipayCsvBuffer,
  decodeBuffer,
  splitCsvLine,
  FIELD_ORDER,
};
