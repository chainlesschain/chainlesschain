/**
 * travel template extractor — Phase 5.4.
 *
 * Fields:
 *   vehicleType         "flight" | "train" | "hotel" | "bus" | "car"
 *   from / to           free-text place names (e.g. "北京" / "PEK / 首都机场")
 *   departureMs / arrivalMs   ms epoch (parsed from explicit timestamps)
 *   confirmationNumber  PNR / 订单号 / e-ticket reference
 *   carrier             airline / hotel chain / railway
 *   totalCost           { value, currency }
 *   traveler            passenger name if present
 */

"use strict";

const {
  extractAmounts,
  extractDates,
  extractOrderNumbers,
  selectPrimaryAmount,
  dateToMs,
} = require("./utils");

const VEHICLE_KEYWORDS = [
  { type: "flight", patterns: [/(航班|航空|机票|登机|airport|flight)/i] },
  { type: "train",  patterns: [/(火车|高铁|动车|车次|铁路|train|railway)/i] },
  { type: "hotel",  patterns: [/(酒店|入住|退房|hotel|booking|reservation)/i] },
  { type: "bus",    patterns: [/(汽车|长途车|bus|coach)/i] },
  { type: "car",    patterns: [/(租车|car\s*rental|hertz|avis)/i] },
];

const ROUTE_KEYWORDS_FROM = /(出发地|始发站|从|departing\s*from|origin)\s*[:：]?\s*([^\n,，；; →-]{2,40})/i;
const ROUTE_KEYWORDS_TO = /(目的地|到达地|目的站|至|到|抵达|arriving\s*at|destination|to)\s*[:：]?\s*([^\n,，；; →-]{2,40})/i;
const SIMPLE_ROUTE = /([一-龥A-Z]{2,8})\s*[→–\-]\s*([一-龥A-Z]{2,8})/;
const CARRIER_FROM_DOMAIN = Object.freeze({
  "ctrip.com": "携程",
  "qunar.com": "去哪儿",
  "12306.cn": "12306",
  "fliggy.com": "飞猪",
  "elong.com": "艺龙",
  "tongcheng.com": "同程",
  "tuniu.com": "途牛",
  "lvmama.com": "驴妈妈",
});
const TRAVELER_KEYWORDS = /(乘客|乘车人|passenger|guest\s*name|入住人)\s*[:：]?\s*([^\n,，；;]{2,30})/i;

async function extractTravel(email, _opts = {}) {
  const warnings = [];
  const textParts = collectSearchableText(email);
  const combined = textParts.map((t) => t.body).join("\n");

  // ── vehicleType ──────────────────────────────────────────────────
  let vehicleType = null;
  for (const v of VEHICLE_KEYWORDS) {
    if (v.patterns.some((re) => re.test(combined))) {
      vehicleType = v.type;
      break;
    }
  }

  // ── from / to ────────────────────────────────────────────────────
  let from = null, to = null;
  const fromMatch = combined.match(ROUTE_KEYWORDS_FROM);
  if (fromMatch) from = fromMatch[2].trim();
  const toMatch = combined.match(ROUTE_KEYWORDS_TO);
  if (toMatch) to = toMatch[2].trim();
  if (!from || !to) {
    const simpleRoute = combined.match(SIMPLE_ROUTE);
    if (simpleRoute) {
      from = from || simpleRoute[1];
      to = to || simpleRoute[2];
    }
  }

  // ── departure / arrival dates ────────────────────────────────────
  const dates = extractDates(combined);
  let departureMs = null, arrivalMs = null;
  if (dates.length >= 1) departureMs = dateToMs(dates[0].date);
  if (dates.length >= 2) arrivalMs = dateToMs(dates[1].date);

  // ── confirmation / order number ──────────────────────────────────
  let confirmationNumber = null;
  const orderHits = extractOrderNumbers(combined);
  if (orderHits.length > 0) confirmationNumber = orderHits[0].orderNumber;

  // ── carrier (sender domain → friendly name) ──────────────────────
  let carrier = null;
  if (Array.isArray(email.from) && email.from[0]) {
    const addr = (email.from[0].address || "").toLowerCase();
    const at = addr.lastIndexOf("@");
    if (at >= 0) {
      const domain = addr.slice(at + 1);
      carrier = CARRIER_FROM_DOMAIN[domain] || CARRIER_FROM_DOMAIN[topLevelDomain(domain)] || email.from[0].name || null;
    } else {
      carrier = email.from[0].name || null;
    }
  }

  // ── totalCost ────────────────────────────────────────────────────
  const amounts = extractAmounts(combined);
  const primary = selectPrimaryAmount(amounts);
  const totalCost = primary ? { value: primary.value, currency: primary.currency } : null;

  // ── traveler ─────────────────────────────────────────────────────
  let traveler = null;
  const travelerMatch = combined.match(TRAVELER_KEYWORDS);
  if (travelerMatch) traveler = travelerMatch[2].trim();

  if (!vehicleType) warnings.push("vehicleType undetermined");
  if (!from || !to) warnings.push("route (from/to) incomplete");

  const fields = {
    ...(vehicleType ? { vehicleType } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(departureMs ? { departureMs } : {}),
    ...(arrivalMs ? { arrivalMs } : {}),
    ...(confirmationNumber ? { confirmationNumber } : {}),
    ...(carrier ? { carrier } : {}),
    ...(totalCost ? { totalCost } : {}),
    ...(traveler ? { traveler } : {}),
  };

  return {
    template: "travel",
    fields,
    confidence: confidenceFor(fields),
    warnings,
  };
}

function topLevelDomain(domain) {
  const parts = domain.split(".");
  if (parts.length > 2) return parts.slice(-2).join(".");
  return domain;
}

function collectSearchableText(email) {
  const parts = [];
  if (email.subject) parts.push({ label: "subject", body: email.subject });
  if (email.textBody) parts.push({ label: "textBody", body: email.textBody });
  if (email.htmlBody && !email.textBody) {
    parts.push({ label: "htmlBody", body: String(email.htmlBody).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") });
  }
  return parts;
}

function confidenceFor(fields) {
  const tracked = [
    "vehicleType", "from", "to", "departureMs",
    "confirmationNumber", "carrier", "totalCost", "traveler",
  ];
  const populated = tracked.filter((k) => fields[k] != null).length;
  return Math.round((populated / tracked.length) * 100) / 100;
}

module.exports = { extractTravel };
