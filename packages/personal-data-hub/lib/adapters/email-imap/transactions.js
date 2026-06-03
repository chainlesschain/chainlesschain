/**
 * Phase 5.5 — line-item transaction parser for Chinese bank-statement
 * PDF text. Decrypted statements typically follow one of a few row
 * formats; we go regex-first with a generic fallback.
 *
 * Output shape (per item):
 *   {
 *     occurredAtMs:  number,            // ms epoch of the transaction date
 *     description:   string,            // merchant + memo, trimmed
 *     amount:        { value, currency, direction },
 *     balance?:      { value, currency }, // running balance when present
 *     raw:           string,            // the original line for audit
 *     index:         number,            // line index within the body
 *   }
 *
 * Recognized formats (sample row patterns):
 *
 *   招商银行 / 中国银行 / 民生银行 (column-aligned with whitespace):
 *     `2026-04-15  星巴克 上海中山公园店           ¥-39.00     1,234.56`
 *
 *   工商银行 / 建设银行 (slash dates + 借/贷 prefix):
 *     `2026/04/15 借 39.00  星巴克 上海中山公园店  CNY 1,234.56`
 *
 *   交通银行 / 浦发银行 (Chinese date + tab/space):
 *     `2026年04月15日  星巴克 上海中山公园店  支出 39.00  余额 1234.56`
 *
 * Strategy:
 *   - One pass per line. Skip header / footer / legalese lines via
 *     a denylist.
 *   - Direction inferred from: explicit 借/贷 / 支出/收入 / + / - / 退款 keywords.
 *   - Amount currency defaults to CNY (Chinese statements rarely
 *     mix currencies); foreign-currency cards emit USD/EUR rows
 *     which we detect via prefix.
 *   - Returns an empty array when the text doesn't look like a
 *     statement (e.g. marketing PDF). Callers should not assume
 *     a non-empty list.
 */

"use strict";

// Lines that look like statement chrome / legalese — skip outright.
const SKIP_PATTERNS = [
  /^[\s\d]*$/, // pure whitespace / numbers (page-number footers)
  /^\s*第\s*\d+\s*页/, // 第 1 页 of 3
  /^\s*page\s+\d+/i,
  /声明|免责|提示|温馨提示|温馨提醒|请勿回复|本邮件由系统/,
  /账单周期|账单日|还款日|信用额度|可用额度/,
  /^\s*[-=]{3,}\s*$/,
];

// Direction keywords: ordered so "支出/借/-" wins over plain numbers.
const DIRECTION_OUT = /(支出|借方|借|消费|扣款|paid|debit|charged?)/i;
const DIRECTION_IN = /(收入|贷方|贷|退款|返还|到账|入账|credit|refund|received)/i;

// ── Row patterns (each returns a SHARED capture-group layout via .exec()):
//   m.groups = { date, dateY, dateM, dateD, sign?, currency?, amount, balance?, desc }
// To keep regex sane we use a 2-pass approach: a "date-prefix" regex
// rooted at line start, then a follow-up amount/balance regex on the rest.

const DATE_PATTERNS = [
  // 2026-04-15  /  2026/04/15  /  2026.04.15
  /^\s*(?<dateY>\d{4})[-/.](?<dateM>\d{1,2})[-/.](?<dateD>\d{1,2})\s+/,
  // 2026年04月15日
  /^\s*(?<dateY>\d{4})年(?<dateM>\d{1,2})月(?<dateD>\d{1,2})日?\s+/,
  // 04-15 (year-less, fall back to current year) — rare but BOC uses it
  /^\s*(?<dateM>\d{1,2})[-/.](?<dateD>\d{1,2})\s+/,
];

// Amount: a signed (optional) currency-marked number. Negative or "-"
// prefix means OUT. Currency optional; defaults to CNY.
const AMOUNT_RE = /(?<sign>[+\-])?\s*(?:(?<cur>¥|RMB|CNY|USD|EUR|\$|€)\s*)?(?<amt>[\d][\d,]*(?:\.\d{1,4})?)\b/;

/**
 * Parse a bank-statement text body into transactions.
 *
 * @param {string} text         decrypted PDF text (or any plain-text body)
 * @param {object} [opts]
 * @param {number} [opts.maxRows=500]  cap to keep DoS-shaped statements bounded
 * @param {number} [opts.nowMs=Date.now()] reference for year-less dates
 * @returns {Array<object>}
 */
function extractTransactions(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  const maxRows = Number.isFinite(opts.maxRows) && opts.maxRows > 0 ? opts.maxRows : 500;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const now = new Date(nowMs);

  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length && out.length < maxRows; i++) {
    const line = lines[i];
    if (!line || line.length < 6) continue;
    if (SKIP_PATTERNS.some((re) => re.test(line))) continue;

    // ── 1. find date prefix ──
    let dateMatch = null;
    let dateConsumed = 0;
    for (const re of DATE_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        dateMatch = m;
        dateConsumed = m[0].length;
        break;
      }
    }
    if (!dateMatch) continue;

    const y = +(dateMatch.groups.dateY || now.getFullYear());
    const mo = +dateMatch.groups.dateM;
    const d = +dateMatch.groups.dateD;
    if (!validYMD(y, mo, d)) continue;
    const occurredAtMs = new Date(y, mo - 1, d).getTime();

    // ── 2. rest of line — find amount(s) ──
    const rest = line.slice(dateConsumed);

    // 借/贷 / 支出/收入 modifier may appear before the amount; capture
    // its position so we can scope direction detection narrowly.
    const directionWindow = rest;
    let direction;
    if (DIRECTION_OUT.test(directionWindow)) direction = "out";
    else if (DIRECTION_IN.test(directionWindow)) direction = "in";

    const amountMatches = collectAmounts(rest);
    if (amountMatches.length === 0) continue;

    // Heuristic: when 2+ numbers appear, the LAST is usually the
    // running balance, the one BEFORE it is the transaction amount.
    // Single number → that's the amount, no balance.
    let amount, balance;
    if (amountMatches.length >= 2) {
      amount = amountMatches[amountMatches.length - 2];
      balance = amountMatches[amountMatches.length - 1];
    } else {
      amount = amountMatches[0];
    }

    // sign / direction reconciliation: if amount.value had a "-" sign,
    // force direction=out; "+" → in. Otherwise keep keyword-detected
    // direction (default undefined → caller may treat as "out" for
    // bills).
    if (amount.sign === "-") direction = "out";
    else if (amount.sign === "+") direction = "in";

    // ── 3. description = rest minus the amount tokens ──
    const description = cleanDescription(rest, amountMatches);
    if (description.length === 0) continue;

    const row = {
      occurredAtMs,
      description,
      amount: {
        value: amount.value,
        currency: amount.currency,
        ...(direction ? { direction } : {}),
      },
      ...(balance ? { balance: { value: balance.value, currency: balance.currency } } : {}),
      raw: line.trim(),
      index: i,
    };
    out.push(row);
  }

  return out;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function validYMD(y, m, d) {
  return y >= 1970 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function collectAmounts(text) {
  const out = [];
  const re = new RegExp(AMOUNT_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const groups = m.groups || {};
    const numericStr = (groups.amt || "").replace(/,/g, "");
    const value = Number(numericStr);
    if (!Number.isFinite(value) || value <= 0) continue;
    // Skip pure-int matches that look like year/month numbers (e.g. "2026")
    // when they are bare and < 100000 with no currency hint AND have 4
    // digits exactly. False-positive guard for date-only rows.
    if (!groups.cur && !groups.sign && /^\d{4}$/.test(numericStr) && value >= 1900 && value <= 2099) continue;
    out.push({
      value,
      currency: normalizeCurrency(groups.cur),
      sign: groups.sign,
      raw: m[0],
      index: m.index,
      length: m[0].length,
    });
  }
  return out;
}

function normalizeCurrency(marker) {
  if (!marker) return "CNY";
  const m = marker.toUpperCase();
  if (m === "¥" || m === "元" || m === "RMB" || m === "CNY") return "CNY";
  if (m === "$" || m === "USD") return "USD";
  if (m === "€" || m === "EUR") return "EUR";
  return "CNY";
}

/**
 * Build the description by cutting amount tokens out of the line and
 * collapsing whitespace. Also strips leading direction keywords (借/贷)
 * — those belong in `amount.direction`, not the human-readable label.
 */
function cleanDescription(text, amountMatches) {
  // Sort matches by descending start index so deletions don't shift
  // earlier indices.
  const sorted = amountMatches.slice().sort((a, b) => b.index - a.index);
  let s = text;
  for (const m of sorted) {
    s = s.slice(0, m.index) + " " + s.slice(m.index + m.length);
  }
  // Strip direction keywords + standalone punctuation
  s = s
    .replace(/(支出|收入|借方|贷方|借|贷|debit|credit|paid|charged?|refunded?)/gi, " ")
    .replace(/(余额|balance)\s*[:：]?/gi, " ")
    .replace(/[¥$€]\s*/g, " ")
    .replace(/[,，;；|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

module.exports = {
  extractTransactions,
};
