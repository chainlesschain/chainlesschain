/**
 * Heuristic natural-language → query intent parser.
 *
 * Mirrors §8.3 step 1 ("Query Parser") of the architecture doc. The full
 * production design uses an LLM tool-call to extract intent reliably; this
 * Phase 3 prototype uses pure-string heuristics covering the high-value
 * 80% of common questions:
 *
 *   "上个月在淘宝总共花了多少钱？"
 *     → { timeWindow: { since: T-1m-start, until: T-1m-end },
 *         filters: { subtype: "payment"|"order", adapter: "taobao" },
 *         intent: "sum-amount" }
 *
 *   "去年我妈生日那周买了啥送哪儿？"
 *     → { timeWindow: { since: prev-year-may-X, until: ... },
 *         filters: { subtype: "order" }, intent: "list" }
 *
 *   "我最近 30 天的消费"
 *     → { timeWindow: { since: now-30d, until: now }, ... }
 *
 * Output shape is deliberately conservative — when in doubt we return
 * undefined for a field and let the LLM see the raw question. The engine
 * then does a broader vault scan + lets the LLM filter via prose.
 */

"use strict";

const DAY_MS = 86_400_000;

// ─── Date helpers ────────────────────────────────────────────────────────

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function startOfMonth(year, month0) {
  return new Date(year, month0, 1, 0, 0, 0, 0).getTime();
}

function endOfMonth(year, month0) {
  // First moment of next month minus 1 ms.
  return new Date(year, month0 + 1, 1, 0, 0, 0, 0).getTime() - 1;
}

// ─── Time-window detection ──────────────────────────────────────────────

/**
 * Returns { since, until } in ms or null if no recognized time window.
 *
 * Recognized patterns (Chinese-leaning; Phase 3 prototype):
 *   今天 / today
 *   昨天 / yesterday
 *   本周 / 这周 / 这个礼拜 / this week
 *   上周 / 上个礼拜 / last week
 *   本月 / 这个月 / 这月 / this month
 *   上个月 / 上月 / last month
 *   今年 / this year
 *   去年 / last year
 *   最近 N 天 / past N days
 *   最近 N 周 / past N weeks
 *   最近 N 个月 / past N months
 *   <year> 年 <month> 月
 */
function parseTimeWindow(text, now = Date.now()) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  const nowD = new Date(now);
  const year = nowD.getFullYear();
  const month = nowD.getMonth();

  // 今天 / today
  if (/\b(today|今天)\b/.test(t) || /今天/.test(text)) {
    const start = startOfDay(now);
    return { since: start, until: start + DAY_MS - 1 };
  }
  // 昨天 / yesterday
  if (/\b(yesterday|昨天)\b/.test(t) || /昨天/.test(text)) {
    const start = startOfDay(now) - DAY_MS;
    return { since: start, until: start + DAY_MS - 1 };
  }
  // 上个月 / 上月 / last month
  if (/(上个月|上月|上一月)/.test(text) || /\blast\s+month\b/.test(t)) {
    const prevMonth0 = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    return { since: startOfMonth(prevYear, prevMonth0), until: endOfMonth(prevYear, prevMonth0) };
  }
  // 本月 / 这个月 / 这月 / this month
  if (/(本月|这个月|这月)/.test(text) || /\bthis\s+month\b/.test(t)) {
    return { since: startOfMonth(year, month), until: endOfMonth(year, month) };
  }
  // 去年 / last year
  if (/去年/.test(text) || /\blast\s+year\b/.test(t)) {
    return { since: startOfMonth(year - 1, 0), until: endOfMonth(year - 1, 11) };
  }
  // 今年 / this year
  if (/今年/.test(text) || /\bthis\s+year\b/.test(t)) {
    return { since: startOfMonth(year, 0), until: endOfMonth(year, 11) };
  }
  // 上周 / 上个礼拜 / last week (7-day window ending yesterday)
  if (/(上周|上个礼拜|上一周)/.test(text) || /\blast\s+week\b/.test(t)) {
    const end = startOfDay(now) - 1;
    const start = startOfDay(now - 7 * DAY_MS);
    return { since: start, until: end };
  }
  // 本周 / 这周 / 这个礼拜 / this week (7-day window ending now)
  if (/(本周|这周|这个礼拜|这一周)/.test(text) || /\bthis\s+week\b/.test(t)) {
    const start = startOfDay(now - 6 * DAY_MS);
    return { since: start, until: now };
  }
  // 最近 N 天 / past N days
  let m;
  m = text.match(/最近\s*(\d+)\s*天/) || t.match(/past\s+(\d+)\s+days?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) {
      return { since: now - n * DAY_MS, until: now };
    }
  }
  m = text.match(/最近\s*(\d+)\s*周/) || t.match(/past\s+(\d+)\s+weeks?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return { since: now - n * 7 * DAY_MS, until: now };
  }
  m = text.match(/最近\s*(\d+)\s*个?月/) || t.match(/past\s+(\d+)\s+months?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) {
      const target = new Date(now);
      target.setMonth(target.getMonth() - n);
      return { since: target.getTime(), until: now };
    }
  }
  // <YYYY> 年 <M> 月
  m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    if (Number.isFinite(y) && mo >= 0 && mo <= 11) {
      return { since: startOfMonth(y, mo), until: endOfMonth(y, mo) };
    }
  }

  return null;
}

// ─── Filter detection (subtypes + adapters) ──────────────────────────────

const SUBTYPE_KEYWORDS = [
  // (subtype, keyword regexes)
  { subtype: "order", patterns: [/(订单|下单|买了|购买|下了几单|下了多少单|order)/i] },
  { subtype: "payment", patterns: [/(支付|付款|花了|花费|消费|开销|payment|spent|spend)/i] },
  { subtype: "transfer", patterns: [/(转账|转给|转钱|transfer)/i] },
  { subtype: "income", patterns: [/(收入|工资|进账|收到|income)/i] },
  { subtype: "message", patterns: [/(聊天|消息|聊了|对话|message|chat)/i] },
  { subtype: "post", patterns: [/(朋友圈|发了|动态|moment|post)/i] },
  { subtype: "visit", patterns: [/(去过|到过|visited|去了|来到)/i] },
  { subtype: "trip", patterns: [/(出差|旅行|去旅游|trip)/i] },
  { subtype: "browse", patterns: [/(浏览|看了|阅读|browse|read)/i] },
  { subtype: "ai-message", patterns: [/(问ai|问 ai|deepseek|kimi|通义|智谱|混元|千帆|扣子)/i] },
  { subtype: "ai-image-generation", patterns: [/(生图|画图|生成图|dreamina|midjourney)/i] },
];

const ADAPTER_KEYWORDS = [
  { adapter: "alipay-bill", patterns: [/支付宝|alipay/i] },
  { adapter: "wechat", patterns: [/微信|wechat/i] },
  { adapter: "email-imap", patterns: [/邮箱|邮件|email|imap/i] },
  // Shopping
  { adapter: "taobao", patterns: [/淘宝|天猫|taobao|tmall/i] },
  { adapter: "jd", patterns: [/京东|jingdong|\bjd\b/i] },
  { adapter: "pinduoduo", patterns: [/拼多多|pdd/i] },
  { adapter: "meituan", patterns: [/美团|meituan/i] },
  { adapter: "dianping", patterns: [/大众点评|dianping/i] },
  // Travel
  { adapter: "amap", patterns: [/高德/i] },
  { adapter: "baidu-map", patterns: [/百度地图|baidu\s*map/i] },
  { adapter: "12306", patterns: [/12306|火车票|高铁/i] },
  { adapter: "ctrip", patterns: [/携程|ctrip/i] },
  // AI chat
  { adapter: "ai-chat-history", patterns: [/(deepseek|kimi|通义|智谱|混元|千帆|扣子|chatgpt|claude)/i] },
];

function parseFilters(text) {
  if (typeof text !== "string") return {};
  const out = {};
  for (const row of SUBTYPE_KEYWORDS) {
    if (row.patterns.some((re) => re.test(text))) {
      out.subtype = row.subtype;
      break; // first match wins
    }
  }
  for (const row of ADAPTER_KEYWORDS) {
    if (row.patterns.some((re) => re.test(text))) {
      out.adapter = row.adapter;
      break;
    }
  }
  return out;
}

// ─── Intent detection (sum / count / list / latest / ...) ────────────────

function parseIntent(text) {
  if (typeof text !== "string") return "list";
  if (/(总共|共多少|加起来|sum|total|合计)/.test(text)) {
    // Distinguish amount vs count by presence of currency words.
    if (/(花|花了|花费|消费|开销|spent|金额|多少钱|amount)/.test(text)) return "sum-amount";
    return "count";
  }
  if (/(多少次|几次|几条|几单|how\s+many)/i.test(text)) return "count";
  if (/(最近|最新|latest|recent)/i.test(text)) return "latest";
  return "list";
}

// ─── Full parser ─────────────────────────────────────────────────────────

/**
 * Parse a natural-language question into a query intent.
 *
 * @param {string} question
 * @param {object} [opts]
 * @param {number} [opts.now]   inject "now" for deterministic tests
 * @returns {{
 *   raw: string,
 *   timeWindow: {since: number, until: number} | null,
 *   filters: { subtype?: string, adapter?: string },
 *   intent: "list"|"count"|"sum-amount"|"latest",
 * }}
 */
function parseQuery(question, opts = {}) {
  const raw = typeof question === "string" ? question : "";
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  return {
    raw,
    timeWindow: parseTimeWindow(raw, now),
    filters: parseFilters(raw),
    intent: parseIntent(raw),
  };
}

module.exports = {
  parseQuery,
  parseTimeWindow,
  parseFilters,
  parseIntent,
  // exposed for tests
  SUBTYPE_KEYWORDS,
  ADAPTER_KEYWORDS,
};
