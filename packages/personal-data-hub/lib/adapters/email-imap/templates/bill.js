/**
 * bill template extractor — Phase 5.4 of the Personal Data Hub.
 *
 * Handles emails classified as bill_bank or bill_credit. Pulls structured
 * financial fields out of the body + headers so Phase 5.5 (PDF
 * decryption) and the future spending analyzer have something to grip:
 *
 *   amount             { value, currency, direction? }
 *   dueAmount          same shape — separate from `amount` so total-billed
 *                      vs total-due aren't conflated
 *   billingPeriod      { start: Date, end: Date } when both detected
 *   dueDate            Date (always parsed from explicit "最后还款日" /
 *                      "due date" keywords, never inferred)
 *   accountIdentifier  "尾号 1234" / "**** 5678" — last 4 digits only
 *   institution        sender display name OR domain root
 *   billingMonth       "YYYY-MM" string (heuristic from subject + dueDate)
 *
 * Strategy:
 *   1. Regex over textBody + subject — single pass, deterministic.
 *   2. Pick the most-plausible amount via `selectPrimaryAmount`. When
 *      both 应还/应付 and a generic amount are present, the directional
 *      one wins.
 *   3. If `opts.llm` provided AND regex coverage < 60%, ask the LLM to
 *      fill gaps (Phase 5.4 leaves this as a stub — Phase 5.5 wires it
 *      after we ground PDF-text against actual bank statements).
 *
 * Returns { template:"bill", fields, confidence, warnings }.
 */

"use strict";

const {
  extractAmounts,
  extractDates,
  extractAccountTails,
  selectPrimaryAmount,
  dateToMs,
} = require("./utils");

const DUE_DATE_KEYWORDS = /(最后还款日|还款日|账单到期日|due\s*date|payment\s*due|应还日期)\s*[:：]?\s*/i;
const PERIOD_KEYWORDS = /(账单周期|账期|结账周期|billing\s*period|statement\s*period)\s*[:：]?\s*/i;
const DUE_AMOUNT_KEYWORDS = /(应还金额|本期应还|本期欠款|应还合计|最低还款额|amount\s*due|total\s*due)\s*[:：]?\s*/i;

/**
 * @param {object} email — must include from/subject/textBody (or htmlBody)
 * @param {object} [opts]
 * @param {{chat:Function}} [opts.llm]
 * @returns {Promise<{template:"bill",fields:object,confidence:number,warnings:string[]}>}
 */
async function extractBill(email, _opts = {}) {
  const warnings = [];
  const textParts = collectSearchableText(email);

  // ── 1. amount + dueAmount ──────────────────────────────────────────
  const allAmounts = textParts
    .flatMap((t) => extractAmounts(t.body).map((a) => ({ ...a, source: t.label })));

  // Find dueAmount via window around DUE_AMOUNT_KEYWORDS
  let dueAmount = null;
  for (const t of textParts) {
    const m = t.body.match(DUE_AMOUNT_KEYWORDS);
    if (!m) continue;
    const after = t.body.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const a = extractAmounts(after)[0];
    if (a) {
      dueAmount = { value: a.value, currency: a.currency, raw: a.raw };
      break;
    }
  }

  const primary = selectPrimaryAmount(allAmounts);
  const amount = primary
    ? { value: primary.value, currency: primary.currency, direction: primary.direction || "out" }
    : null;
  if (!amount) warnings.push("no monetary amount detected");

  // ── 2. dueDate ─────────────────────────────────────────────────────
  let dueDate = null;
  for (const t of textParts) {
    const m = t.body.match(DUE_DATE_KEYWORDS);
    if (!m) continue;
    // Search the next 40 chars for a date
    const after = t.body.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const dates = extractDates(after);
    if (dates.length > 0) {
      dueDate = dates[0].date;
      break;
    }
  }

  // ── 3. billingPeriod ───────────────────────────────────────────────
  let billingPeriod = null;
  for (const t of textParts) {
    const m = t.body.match(PERIOD_KEYWORDS);
    if (!m) continue;
    const after = t.body.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const dates = extractDates(after);
    if (dates.length >= 2) {
      billingPeriod = { start: dates[0].date, end: dates[1].date };
      break;
    }
  }

  // ── 4. account identifier (last 4) ────────────────────────────────
  const tails = textParts.flatMap((t) => extractAccountTails(t.body));
  const accountIdentifier = tails.length > 0 ? `**** ${tails[0].last4}` : null;

  // ── 5. institution — from sender display name, fall back to domain ─
  const institution = resolveInstitution(email);

  // ── 6. billingMonth heuristic ──────────────────────────────────────
  let billingMonth = null;
  if (billingPeriod && billingPeriod.start instanceof Date) {
    billingMonth = formatMonthKey(billingPeriod.start);
  } else if (dueDate instanceof Date) {
    // "11 月对账单 due 12-25" → bill is for month BEFORE due
    const prev = new Date(dueDate);
    prev.setMonth(prev.getMonth() - 1);
    billingMonth = formatMonthKey(prev);
  } else {
    const m = (email.subject || "").match(/(\d{1,2})\s*月.*(?:对账单|月结|账单)/);
    if (m) {
      const month = +m[1];
      const now = new Date();
      const year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
      billingMonth = formatMonthKey(new Date(year, month - 1, 1));
    }
  }

  const fields = {
    ...(amount ? { amount } : {}),
    ...(dueAmount ? { dueAmount } : {}),
    ...(dueDate ? { dueDate: dateToMs(dueDate) } : {}),
    ...(billingPeriod
      ? {
          billingPeriod: {
            startMs: dateToMs(billingPeriod.start),
            endMs: dateToMs(billingPeriod.end),
          },
        }
      : {}),
    ...(accountIdentifier ? { accountIdentifier } : {}),
    ...(institution ? { institution } : {}),
    ...(billingMonth ? { billingMonth } : {}),
  };

  return {
    template: "bill",
    fields,
    confidence: confidenceFor(fields),
    warnings,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function collectSearchableText(email) {
  const parts = [];
  if (email.subject) parts.push({ label: "subject", body: email.subject });
  if (email.textBody) parts.push({ label: "textBody", body: email.textBody });
  if (email.htmlBody && !email.textBody) parts.push({ label: "htmlBody", body: stripHtml(email.htmlBody) });
  return parts;
}

function stripHtml(html) {
  return String(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function resolveInstitution(email) {
  if (Array.isArray(email.from) && email.from[0]) {
    if (email.from[0].name) return email.from[0].name;
    const addr = email.from[0].address || "";
    const at = addr.lastIndexOf("@");
    if (at >= 0) {
      const domain = addr.slice(at + 1).toLowerCase();
      // Map known bank domains to friendly names
      const known = {
        "cmbchina.com": "招商银行",
        "ccb.com.cn": "建设银行",
        "boc.cn": "中国银行",
        "bochk.cn": "中国银行",
        "bochk.com": "中国银行",
        "icbc.com.cn": "工商银行",
        "psbc.com": "邮储银行",
        "abchina.com": "农业银行",
        "bankcomm.com": "交通银行",
        "spdb.com.cn": "浦发银行",
        "cmbc.com.cn": "民生银行",
        "cebbank.com": "光大银行",
        "citicbank.com": "中信银行",
        "hxb.com.cn": "华夏银行",
      };
      if (known[domain]) return known[domain];
      // Try parent domain (e.g. credit.boc.cn → boc.cn)
      const parts = domain.split(".");
      if (parts.length > 2) {
        const parent = parts.slice(-2).join(".");
        if (known[parent]) return known[parent];
      }
      return domain;
    }
  }
  return null;
}

function formatMonthKey(d) {
  if (!(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Confidence: count of populated fields / total. Coarse but useful as
 * a UI badge and as a switch for whether to fire Layer 2 LLM (TODO 5.5).
 */
function confidenceFor(fields) {
  const tracked = [
    "amount", "dueAmount", "dueDate", "billingPeriod",
    "accountIdentifier", "institution", "billingMonth",
  ];
  const populated = tracked.filter((k) => fields[k] != null).length;
  return Math.round((populated / tracked.length) * 100) / 100;
}

module.exports = { extractBill };
