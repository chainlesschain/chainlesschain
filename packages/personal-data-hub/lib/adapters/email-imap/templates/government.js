/**
 * government template extractor — Phase 5.4.
 *
 * Fields:
 *   agencyName       sender display or known *.gov.cn registrar
 *   documentType     tax_declaration / social_security / housing_fund /
 *                    real_estate / immigration / health_insurance / other
 *   period           "YYYY-MM" when keyword-tagged month found
 *   amount           { value, currency } if monetary content (e.g.
 *                    tax declaration confirmations include a paid amount)
 *   referenceNumber  receipt / 申报编号 / 文号
 */

"use strict";

const {
  extractAmounts,
  selectPrimaryAmount,
  extractOrderNumbers,
} = require("./utils");

const DOC_TYPE_KEYWORDS = [
  { type: "tax_declaration",  patterns: [/(完税|个税|纳税申报|增值税|enterprise\s*income\s*tax)/i] },
  { type: "social_security",  patterns: [/(社保|社会保险|医疗保险|工伤|生育|失业)/i] },
  { type: "housing_fund",     patterns: [/(住房公积金|公积金|housing\s*fund)/i] },
  { type: "real_estate",      patterns: [/(不动产登记|房产证|产权登记|real\s*estate\s*registration)/i] },
  { type: "immigration",      patterns: [/(出入境|护照|签证|户籍|户口|immigration)/i] },
  { type: "health_insurance", patterns: [/(医保|医疗保险卡)/i] },
];

const REF_NUMBER_KEYWORDS = /(申报编号|文号|receipt\s*number|reference\s*number|案卷号|流水号)\s*[:：]?\s*([A-Z0-9][-A-Z0-9]{4,30})/i;
const PERIOD_KEYWORDS = /(税期|缴费月份|缴款期间|属期|期间)\s*[:：]?\s*(\d{4})(?:[-/.年]|\s)\s*(\d{1,2})/i;

async function extractGovernment(email, _opts = {}) {
  const warnings = [];
  const combined = collectSearchableText(email);

  // ── documentType ─────────────────────────────────────────────────
  let documentType = null;
  for (const d of DOC_TYPE_KEYWORDS) {
    if (d.patterns.some((re) => re.test(combined))) {
      documentType = d.type;
      break;
    }
  }
  if (!documentType) documentType = "other";

  // ── agency ───────────────────────────────────────────────────────
  let agencyName = null;
  if (Array.isArray(email.from) && email.from[0]) {
    if (email.from[0].name) {
      agencyName = email.from[0].name;
    } else {
      const addr = (email.from[0].address || "").toLowerCase();
      const at = addr.lastIndexOf("@");
      if (at >= 0) agencyName = addr.slice(at + 1);
    }
  }

  // ── period (YYYY-MM) ─────────────────────────────────────────────
  let period = null;
  const periodMatch = combined.match(PERIOD_KEYWORDS);
  if (periodMatch) {
    const y = +periodMatch[2];
    const mo = +periodMatch[3];
    if (y >= 1970 && y <= 2099 && mo >= 1 && mo <= 12) {
      period = `${y}-${String(mo).padStart(2, "0")}`;
    }
  }

  // ── amount (e.g. tax paid / fee charged) ─────────────────────────
  const amounts = extractAmounts(combined);
  const primary = selectPrimaryAmount(amounts);
  const amount = primary ? { value: primary.value, currency: primary.currency } : null;

  // ── reference number ──────────────────────────────────────────────
  let referenceNumber = null;
  const refMatch = combined.match(REF_NUMBER_KEYWORDS);
  if (refMatch) {
    referenceNumber = refMatch[2];
  } else {
    const orderHits = extractOrderNumbers(combined);
    if (orderHits.length > 0) referenceNumber = orderHits[0].orderNumber;
  }

  if (documentType === "other") warnings.push("documentType could not be narrowed");

  const fields = {
    documentType,
    ...(agencyName ? { agencyName } : {}),
    ...(period ? { period } : {}),
    ...(amount ? { amount } : {}),
    ...(referenceNumber ? { referenceNumber } : {}),
  };

  return {
    template: "government",
    fields,
    confidence: confidenceFor(fields),
    warnings,
  };
}

function collectSearchableText(email) {
  const parts = [];
  if (email.subject) parts.push(email.subject);
  if (email.textBody) parts.push(email.textBody);
  else if (email.htmlBody) {
    parts.push(String(email.htmlBody).replace(/<[^>]+>/g, " "));
  }
  return parts.join("\n");
}

function confidenceFor(fields) {
  const tracked = ["documentType", "agencyName", "period", "amount", "referenceNumber"];
  const populated = tracked.filter((k) => fields[k] != null && fields[k] !== "other").length;
  return Math.round((populated / tracked.length) * 100) / 100;
}

module.exports = { extractGovernment };
