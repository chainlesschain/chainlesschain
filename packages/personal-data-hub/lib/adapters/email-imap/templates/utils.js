/**
 * Shared regex extraction helpers for the 6 Phase 5.4 template extractors.
 *
 * Design notes:
 *   - Regex-first. We aim to extract the high-value structured fields
 *     (金额 / 日期 / 卡尾 4 位 / 订单号 / 快递单号) without paying LLM
 *     tokens per email. Each helper returns ALL matches (an adapter can
 *     pick the most plausible one when context is needed) and degrades
 *     to [] / null for unrecognized input — never throws.
 *   - LLM enrichment lives in per-template files when callers pass a
 *     `llm` opt; this module stays free of LLM dependencies so it can
 *     be unit-tested without mocks.
 *   - Chinese-first patterns. ¥ and 元 are the primary currency
 *     markers; CNY / RMB and $/USD/EUR are also handled for emails
 *     from foreign vendors.
 *   - Numbers can have thousands separators (1,234.50) and Chinese
 *     decimals (1,234.50 元 / 1234元 / 1.5万 / 8千).
 */

"use strict";

// ─── Currency / amount ──────────────────────────────────────────────────

/**
 * Match plausible monetary amounts and tag direction when adjacent
 * "支出/支付/扣款" or "收入/退款/到账" markers surround them. Returns
 * [{ value, currency, raw, direction?, index }, ...] sorted by source
 * position. Always returns an array.
 *
 * Direction heuristics:
 *   - text within 12 chars BEFORE or AFTER amount containing
 *     "退款"/"返还"/"到账"/"收入"/"refund"/"credit" → "in"
 *   - similar window with "扣款"/"支付"/"支出"/"消费"/"应还"/"还款"/"debit"/"charge"
 *     → "out"
 *   - default: undefined (caller decides)
 *
 * @param {string} text
 * @returns {Array<{value:number,currency:string,raw:string,direction?:string,index:number}>}
 */
function extractAmounts(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const results = [];

  // Pattern A: ¥1,234.50 / RMB 1,234 / CNY 99.00 / USD $100 / $99.99 / 100元
  // Number group allows comma thousands + optional decimal. Currency can
  // come before OR after the number.
  const re = /(?:(?:[¥$€£]|RMB|CNY|USD|EUR|GBP|HKD)\s*([\d][\d,]*(?:\.\d{1,4})?)|([\d][\d,]*(?:\.\d{1,4})?)\s*(元|RMB|CNY|USD|EUR|HKD|港币|美元|欧元))/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const numericStr = (m[1] || m[2] || "").replace(/,/g, "");
    const value = Number(numericStr);
    if (!Number.isFinite(value) || value <= 0) continue;
    const currencyMarker = (m[0].match(/[¥$€£]|RMB|CNY|USD|EUR|GBP|HKD|元|港币|美元|欧元/i) || ["?"])[0];
    const currency = normalizeCurrency(currencyMarker);
    const direction = detectDirection(text, m.index, m[0].length);
    results.push({
      value,
      currency,
      raw: m[0],
      direction,
      index: m.index,
    });
  }

  return results;
}

function normalizeCurrency(marker) {
  const m = marker.toUpperCase();
  if (m === "¥" || m === "元" || m === "RMB" || m === "CNY") return "CNY";
  if (m === "$" || m === "USD" || m === "美元") return "USD";
  if (m === "€" || m === "EUR" || m === "欧元") return "EUR";
  if (m === "£" || m === "GBP") return "GBP";
  if (m === "HKD" || m === "港币") return "HKD";
  return "CNY"; // default — most Chinese emails
}

function detectDirection(text, idx, len) {
  const winStart = Math.max(0, idx - 24);
  const winEnd = Math.min(text.length, idx + len + 24);
  const window = text.slice(winStart, winEnd);
  if (/(退款|返还|到账|收入|入账|credit|refund|received)/i.test(window)) return "in";
  if (/(扣款|支付|支出|消费|应还|还款|账单|debit|charge|paid|due)/i.test(window)) return "out";
  return undefined;
}

// ─── Dates ──────────────────────────────────────────────────────────────

/**
 * Find date-like fragments. Recognizes:
 *   - 2026-05-19 / 2026/05/19 / 2026.05.19 / 2026年5月19日
 *   - 5/19/2026 / 19-05-2026 (Western)
 *   - 5月19日 (current year inferred from now)
 *
 * Returns array of { raw, date: Date, index }. Year defaults to current
 * year when only month+day is present (or last year if today's month is
 * earlier than parsed month, suggesting "Christmas card sent in January").
 * The default-year heuristic is intentionally conservative — callers
 * needing strict semantics should rely on full YYYY-MM-DD forms.
 *
 * @param {string} text
 * @param {number} [nowMs]
 * @returns {Array<{raw:string,date:Date,index:number,hasYear:boolean}>}
 */
function extractDates(text, nowMs = Date.now()) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const now = new Date(nowMs);
  const currentYear = now.getFullYear();

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年M月D日
  const reIso = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g;
  let m;
  while ((m = reIso.exec(text)) !== null) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (isValidYMD(y, mo, d)) {
      out.push({ raw: m[0], date: new Date(y, mo - 1, d), index: m.index, hasYear: true });
    }
  }

  // M月D日 (Chinese, year-less)
  const reMd = /(\d{1,2})月(\d{1,2})日?/g;
  while ((m = reMd.exec(text)) !== null) {
    if (out.some((o) => o.index === m.index)) continue; // already matched as YYYY-MM-DD
    const mo = +m[1], d = +m[2];
    if (isValidYMD(currentYear, mo, d)) {
      // Heuristic: if parsed month is far before now's month, assume
      // last year (e.g. a January-billed bill arriving in November).
      const monthsAhead = mo - (now.getMonth() + 1);
      const year = monthsAhead < -6 ? currentYear + 1 : (monthsAhead > 6 ? currentYear - 1 : currentYear);
      out.push({ raw: m[0], date: new Date(year, mo - 1, d), index: m.index, hasYear: false });
    }
  }

  // M/D/YYYY (Western shorthand)
  const reUs = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = reUs.exec(text)) !== null) {
    if (out.some((o) => o.index === m.index)) continue;
    const mo = +m[1], d = +m[2], y = +m[3];
    if (isValidYMD(y, mo, d)) {
      out.push({ raw: m[0], date: new Date(y, mo - 1, d), index: m.index, hasYear: true });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

function isValidYMD(y, m, d) {
  return y >= 1970 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

// ─── Account / card last-4 ──────────────────────────────────────────────

/**
 * Extract trailing 4-digit identifiers commonly used for card masking.
 * Recognizes:
 *   - 尾号 1234 / 卡号尾 1234 / **** 1234 / ending in 1234 / last 4 digits 1234
 * Returns array of {raw, last4, index}. Always 4 digits exactly.
 */
function extractAccountTails(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const patterns = [
    /(?:尾号|尾[四4]位|卡号尾|卡尾|账号尾)\s*[:：]?\s*(\d{4})\b/g,
    /\*{2,}\s*(\d{4})\b/g,
    /(?:ending in|last\s*4\s*digits|\bending\b)\s*(\d{4})\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ raw: m[0], last4: m[1], index: m.index });
    }
  }
  return out;
}

// ─── Order / tracking numbers ──────────────────────────────────────────

/**
 * Extract order-number candidates. Recognizes:
 *   订单号: 12345678 / 订单 12345678 / Order # 12345-67 / Order Number 12345
 *   订单编号: ABC1234567
 * Returns array of {raw, orderNumber, index}.
 */
function extractOrderNumbers(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const patterns = [
    /(?:订单(?:号|编号|号码)?|order(?:\s*number|\s*id|\s*#)?)\s*[:：]?\s*([A-Z0-9][-A-Z0-9]{4,30})\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ raw: m[0], orderNumber: m[1], index: m.index });
    }
  }
  return out;
}

/**
 * Tracking-number candidates. Recognizes Chinese express keywords +
 * generic "tracking number" markers. Sufficient for Phase 5.4; v2 may
 * add carrier-specific format validation (SF / YT / ZTO regex).
 */
function extractTrackingNumbers(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const re = /(?:快递单号|运单号|物流单号|物流号|tracking\s*(?:number|#)|track(?:ing)?\s*id)\s*[:：]?\s*([A-Z0-9][-A-Z0-9]{6,30})\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0], trackingNumber: m[1], index: m.index });
  }
  return out;
}

// ─── Verification codes (REDACTED in extra; only field captured is "yes") ──

/**
 * Find OTP / verification code strings. Returns just the count + position
 * — the code itself is NEVER returned to caller, since storing OTPs in
 * vault is a compliance red flag (architecture-doc §9.2). Caller uses
 * the count as a signal that this is a register email.
 */
function detectVerificationCodes(text) {
  if (typeof text !== "string" || text.length === 0) return { count: 0, hits: [] };
  const re = /(?:验证码|verification\s*code|otp|动态密码|安全码)\s*(?:为|是|:|：|is|为)?\s*\d{4,8}\b/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ raw: m[0].replace(/\d/g, "*"), index: m.index });
  }
  return { count: hits.length, hits };
}

// ─── Helpers shared by templates ────────────────────────────────────────

/**
 * Pick the most plausible amount given a list. Strategy:
 *   1. If any amount has a `direction`, prefer those over directionless
 *   2. Prefer larger amounts (statements tend to put the total prominently)
 *   3. Tie-break by earliest position
 */
function selectPrimaryAmount(amounts) {
  if (!Array.isArray(amounts) || amounts.length === 0) return null;
  const directed = amounts.filter((a) => a.direction);
  const pool = directed.length > 0 ? directed : amounts;
  return pool.slice().sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.index - b.index;
  })[0];
}

/**
 * Convert a Date to a ms epoch, falling back to null. Handy when
 * templates emit dates into Event extra (vault stores ms-ints).
 */
function dateToMs(date) {
  if (!(date instanceof Date)) return null;
  const t = date.getTime();
  return Number.isFinite(t) ? t : null;
}

module.exports = {
  extractAmounts,
  extractDates,
  extractAccountTails,
  extractOrderNumbers,
  extractTrackingNumbers,
  detectVerificationCodes,
  selectPrimaryAmount,
  dateToMs,
  // exposed for tests
  normalizeCurrency,
  detectDirection,
};
