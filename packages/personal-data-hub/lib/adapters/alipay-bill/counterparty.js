/**
 * Phase 6 — counterparty (交易对方) classifier.
 *
 * Design doc §5.5 simplified resolver — full Phase 8 EntityResolver
 * will replace this with the embedding+LLM pipeline. v0 strategy:
 *
 *   1. KNOWN_MERCHANTS membership / substring → "merchant"
 *   2. Heuristic suffix (公司 / 店 / 服务 / etc.) → "merchant"
 *   3. 2-4 字纯中文 → "contact" (likely a personal name)
 *   4. Default → "unknown"
 *
 * The "unknown" bucket lets Phase 8 EntityResolver pick these up later.
 * `needs_resolve: true` is stamped onto Person.extra so a future job can
 * find them via WHERE clause.
 */

"use strict";

/**
 * v1 well-known Chinese consumer merchant whitelist. Covers ~80% of
 * Alipay transaction counterparties for the typical urban user.
 * Maintained sorted-ish by category for human readability.
 */
const KNOWN_MERCHANTS = new Set([
  // ── E-commerce ───────────────────────────────────────────────────
  "淘宝", "天猫", "京东", "京东商城", "拼多多", "苏宁易购", "唯品会",
  "蘑菇街", "考拉海购", "网易严选", "得物", "小红书", "1号店",
  "Amazon", "亚马逊",
  // ── Food / delivery / dining ─────────────────────────────────────
  "美团", "美团外卖", "饿了么", "大众点评", "盒马", "肯德基", "麦当劳",
  "星巴克", "瑞幸咖啡", "蜜雪冰城", "海底捞", "Shake Shack",
  "Costa", "Tim Hortons", "汉堡王", "永和大王", "外婆家", "西贝",
  // ── Transport / travel ───────────────────────────────────────────
  "滴滴", "滴滴出行", "曹操出行", "T3 出行", "高德", "高德地图",
  "百度地图", "12306", "携程", "去哪儿", "同程", "飞猪", "途牛",
  "驴妈妈", "哈啰", "青桔", "美团单车", "摩拜",
  // ── Telco / utility ──────────────────────────────────────────────
  "国家电网", "中国移动", "中国联通", "中国电信", "中国铁通",
  "燃气公司", "水务局", "自来水公司", "燃气集团",
  "公积金", "社保",
  // ── Media / streaming ────────────────────────────────────────────
  "爱奇艺", "腾讯视频", "优酷", "B站", "哔哩哔哩", "芒果 TV",
  "网易云音乐", "QQ 音乐", "酷狗", "酷我音乐",
  // ── Finance / platforms ──────────────────────────────────────────
  "支付宝", "蚂蚁财富", "余额宝", "花呗", "借呗", "网商银行",
  "微信支付",
  // ── Health / pharmacy ────────────────────────────────────────────
  "京东健康", "阿里健康", "丁香医生", "平安好医生", "美年大健康",
  // ── Retail brick-and-mortar ──────────────────────────────────────
  "沃尔玛", "永辉超市", "华润万家", "家乐福", "大润发", "山姆会员店",
  "便利蜂", "全家", "罗森", "7-Eleven",
  // ── Apple / Google / SaaS ────────────────────────────────────────
  "App Store", "Apple", "iCloud", "Google Play",
  // ── Cosmetics / fashion ──────────────────────────────────────────
  "屈臣氏", "丝芙兰", "优衣库", "ZARA", "H&M", "Nike", "Adidas",
  // ── Education / digital ──────────────────────────────────────────
  "得到", "极客时间", "知乎", "在行", "腾讯课堂", "网易公开课",
  // ── Government ───────────────────────────────────────────────────
  "国家税务总局", "税务局", "国家电网", "公安局", "车管所", "民政局",
]);

// Regex for heuristic suffix matching (company / shop / service words)
const MERCHANT_SUFFIX_RE = /(公司|集团|有限|股份|店|超市|药房|药店|医院|诊所|学校|学院|大学|加油站|银行|证券|保险|基金|管理处|物业|餐厅|酒店|宾馆|快递|物流|科技)/;

// Person name heuristic: 2-4 Chinese chars, no other text mixed in
const PERSONAL_NAME_RE = /^[一-龥]{2,4}$/;

// Some Alipay counterparties have prefixes like "**先生(189****1234)" or
// "***公司 北京分公司" — strip the contact-info tail before classifying.
function normalizeCounterpartyName(name) {
  if (typeof name !== "string") return "";
  return name
    .replace(/\([^)]*\)/g, "") // () with content
    .replace(/（[^）]*）/g, "") // Chinese parens
    .replace(/\*+/g, "") // masked digits
    .trim();
}

/**
 * Classify a counterparty string as merchant / contact / unknown.
 *
 * @param {string} rawName
 * @returns {"merchant"|"contact"|"unknown"}
 */
function classifyCounterparty(rawName) {
  const name = normalizeCounterpartyName(rawName);
  if (name.length === 0) return "unknown";

  // 1. Exact / substring against known merchants
  for (const m of KNOWN_MERCHANTS) {
    if (name.includes(m)) return "merchant";
  }

  // 2. Suffix heuristic
  if (MERCHANT_SUFFIX_RE.test(name)) return "merchant";

  // 3. Personal-name heuristic
  if (PERSONAL_NAME_RE.test(name)) return "contact";

  return "unknown";
}

/**
 * Get a stable Person.id for a counterparty so repeat imports dedup
 * by name. Phase 8 EntityResolver may later merge multiple ids into
 * one — but for v0 same-name → same-id is the right default.
 */
function counterpartyToPersonId(rawName) {
  const name = normalizeCounterpartyName(rawName);
  // Keep ids URL-safe and stable. Hash via a simple normalize so accents
  // and whitespace variations collapse. v0 just uses the trimmed name
  // since Alipay counterparty strings are already canonical.
  return `person-alipay-${slugify(name)}`;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w一-鿿-]/g, "")
    .slice(0, 80);
}

module.exports = {
  KNOWN_MERCHANTS,
  classifyCounterparty,
  counterpartyToPersonId,
  normalizeCounterpartyName,
};
