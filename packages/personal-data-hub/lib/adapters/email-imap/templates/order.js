/**
 * order template extractor — Phase 5.4.
 *
 * Pulls e-commerce order-confirmation / shipping-notice fields out of
 * Taobao / JD / Pinduoduo / Meituan / Amazon emails:
 *
 *   orderNumber       canonical order id
 *   merchantPlatform  "淘宝" / "京东" / "拼多多" / ... (from-domain mapped)
 *   totalAmount       { value, currency }
 *   itemCount         number of distinct items if hinted in body
 *   trackingNumber    express tracking id if shipping email
 *   recipient         shipping addressee (free-text — often a person name)
 *   shippingAddress   address line if "送达" or "shipping to:" markers present
 *   orderStatus       "placed" | "shipped" | "delivered" | "refunded"
 *                     based on subject keywords
 */

"use strict";

const {
  extractAmounts,
  extractOrderNumbers,
  extractTrackingNumbers,
  selectPrimaryAmount,
} = require("./utils");

const STATUS_KEYWORDS = [
  { status: "delivered", patterns: [/(已签收|签收成功|delivered|order\s*received)/i] },
  { status: "shipped",   patterns: [/(已发货|发货中|已出库|已发出|已寄出|shipped|out\s*for\s*delivery)/i] },
  { status: "refunded",  patterns: [/(已退款|退款成功|refunded)/i] },
  { status: "placed",    patterns: [/(订单确认|下单成功|order\s*confirmed|order\s*placed)/i] },
];

const RECIPIENT_KEYWORDS = /(收件人|送达至|送货至|consignee|deliver\s*to|ship\s*to)\s*[:：]?\s*([^\n,，；;]{1,40})/i;
const ITEM_COUNT_KEYWORDS = /(共\s*(\d+)\s*件商品|(\d+)\s*items?)/i;

const MERCHANT_DOMAIN_MAP = Object.freeze({
  "taobao.com": "淘宝",
  "tmall.com": "天猫",
  "jd.com": "京东",
  "pinduoduo.com": "拼多多",
  "vip.com": "唯品会",
  "suning.com": "苏宁",
  "dangdang.com": "当当",
  "yhd.com": "1号店",
  "mogujie.com": "蘑菇街",
  "meituan.com": "美团",
  "amazon.com": "Amazon",
  "amazon.cn": "Amazon CN",
  "ebay.com": "eBay",
  "shein.com": "SHEIN",
  "aliexpress.com": "AliExpress",
});

async function extractOrder(email, _opts = {}) {
  const warnings = [];
  const textParts = collectSearchableText(email);

  // ── orderNumber ──────────────────────────────────────────────────
  let orderNumber = null;
  for (const t of textParts) {
    const hits = extractOrderNumbers(t.body);
    if (hits.length > 0) {
      orderNumber = hits[0].orderNumber;
      break;
    }
  }
  if (!orderNumber) warnings.push("orderNumber not detected");

  // ── totalAmount ──────────────────────────────────────────────────
  const allAmounts = textParts.flatMap((t) => extractAmounts(t.body));
  const primary = selectPrimaryAmount(allAmounts);
  const totalAmount = primary ? { value: primary.value, currency: primary.currency } : null;

  // ── trackingNumber ────────────────────────────────────────────────
  let trackingNumber = null;
  for (const t of textParts) {
    const hits = extractTrackingNumbers(t.body);
    if (hits.length > 0) {
      trackingNumber = hits[0].trackingNumber;
      break;
    }
  }

  // ── orderStatus ──────────────────────────────────────────────────
  let orderStatus = null;
  const sources = [email.subject || ""].concat(textParts.map((t) => t.body));
  outer: for (const { status, patterns } of STATUS_KEYWORDS) {
    for (const re of patterns) {
      if (sources.some((s) => re.test(s))) {
        orderStatus = status;
        break outer;
      }
    }
  }

  // ── recipient + shippingAddress ──────────────────────────────────
  let recipient = null;
  let shippingAddress = null;
  for (const t of textParts) {
    const m = t.body.match(RECIPIENT_KEYWORDS);
    if (m) {
      recipient = m[2].trim();
      // Look for an address-shaped string on the next 40 chars
      const after = t.body.slice(m.index + m[0].length, m.index + m[0].length + 120);
      const addrMatch = after.match(/([^\n]{4,80}(?:省|市|区|县|路|号|street|ave|road)[^\n]{0,40})/);
      if (addrMatch) shippingAddress = addrMatch[1].trim();
      break;
    }
  }

  // ── itemCount ────────────────────────────────────────────────────
  let itemCount = null;
  for (const t of textParts) {
    const m = t.body.match(ITEM_COUNT_KEYWORDS);
    if (m) {
      itemCount = parseInt(m[2] || m[3], 10);
      if (Number.isFinite(itemCount)) break;
      itemCount = null;
    }
  }

  // ── merchantPlatform ─────────────────────────────────────────────
  const merchantPlatform = resolveMerchantPlatform(email);

  const fields = {
    ...(orderNumber ? { orderNumber } : {}),
    ...(totalAmount ? { totalAmount } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...(orderStatus ? { orderStatus } : {}),
    ...(recipient ? { recipient } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
    ...(itemCount != null ? { itemCount } : {}),
    ...(merchantPlatform ? { merchantPlatform } : {}),
  };

  return {
    template: "order",
    fields,
    confidence: confidenceFor(fields),
    warnings,
  };
}

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
    .replace(/\s+/g, " ");
}

function resolveMerchantPlatform(email) {
  if (!Array.isArray(email.from) || !email.from[0]) return null;
  const addr = (email.from[0].address || "").toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return email.from[0].name || null;
  const domain = addr.slice(at + 1);
  if (MERCHANT_DOMAIN_MAP[domain]) return MERCHANT_DOMAIN_MAP[domain];
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    if (MERCHANT_DOMAIN_MAP[parent]) return MERCHANT_DOMAIN_MAP[parent];
  }
  return email.from[0].name || domain;
}

function confidenceFor(fields) {
  const tracked = [
    "orderNumber", "totalAmount", "trackingNumber", "orderStatus",
    "recipient", "merchantPlatform",
  ];
  const populated = tracked.filter((k) => fields[k] != null).length;
  return Math.round((populated / tracked.length) * 100) / 100;
}

module.exports = { extractOrder };
