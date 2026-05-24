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
  // Count intents: 几次/条/单/个 / 多少个/家/人/张/部 / how many / count of
  // 2026-05-21: extended "几个 X" / "多少个 X" — needed for "几个联系人"
  // and "几个 app" which prior pattern missed (returned "list" → LLM had no
  // hint to read authoritative TOTALS instead of the FACTS sample length).
  if (/(多少次|几次|几条|几单|几个|多少个|多少家|多少人|多少张|多少部|how\s+many|count\s+of)/i.test(text)) {
    return "count";
  }
  if (/(最近|最新|latest|recent)/i.test(text)) return "latest";
  return "list";
}

// ─── Entity-name extraction (FTS5 fulltext routing) ────────────────────
//
// Pull a probable entity-name candidate out of the raw question so
// `_gatherFacts` can augment intent=list results with `vault.searchEvents`
// (FTS5 + trigram CJK substring; LIKE fallback). Heuristic: strip every
// known stop-pattern (time / intent / subtype / adapter / list-trigger /
// pronoun / punct / digit) and pick the longest 2-10 char chunk that
// remains.
//
// Wrong extractions are SAFE: the engine treats this as an OPTIONAL
// augmentation — extracted-but-irrelevant terms just return 0 FTS rows
// (wasted budget, not lost facts). Single-character Chinese names like
// "妈" / "爸" are deliberately NOT picked up because single-char tokens
// false-positive heavily on residual verbs (说/看/买). That's a known
// limitation; first-pass acceptable.
//
// Stop-pattern order matters: multi-char compounds must run BEFORE
// shorter alternatives so "多少钱" doesn't decay to "多少" + leftover "钱".

const ENTITY_STOP_PATTERNS = [
  // Compounds — multi-char specific tokens first
  /(多少钱|多少次|多少个|多少家|多少人|多少张|多少部|加起来|共多少|总共)/g,
  /(几个|几次|几条|几单)/g,
  /(how\s+many|count\s+of)/gi,
  // Time
  /(今天|昨天|前天|明天|本周|这周|上周|这个礼拜|上个礼拜|这一周|上一周|本月|这月|上月|这个月|上个月|上一月|今年|去年|最近|最新)/g,
  /\d+\s*[天周月年个]/g,
  /\d{4}\s*年\s*\d{1,2}\s*月/g,
  /(today|yesterday|past|recent|latest)/gi,
  // Intent (remaining shorter forms after compounds)
  /(多少|合计)/g,
  /(sum|total|count|amount)/gi,
  // Subtype keywords — compound forms first
  /(下了几单|下了多少单|去旅游)/g,
  /(订单|下单|买了|购买|支付|付款|花了|花费|消费|开销|金额|转账|转给|转钱|收入|工资|进账|收到|聊天|消息|聊了|对话|朋友圈|动态|去过|到过|去了|来到|出差|旅行|浏览|看了|阅读|发了)/g,
  /(order|payment|transfer|income|message|chat|moment|post|visited|trip|browse|read|spent|spend)/gi,
  // Adapter keywords — compound forms first
  /(大众点评|百度地图|火车票)/g,
  /(支付宝|微信|邮箱|邮件|淘宝|天猫|京东|拼多多|美团|高德|高铁|携程)/g,
  /(alipay|wechat|email|imap|taobao|tmall|jingdong|jd|pdd|meituan|dianping|baidu\s*map|12306|ctrip)/gi,
  /(deepseek|kimi|通义|智谱|混元|千帆|扣子|chatgpt|claude)/gi,
  // List / search trigger
  /(查一下|找一找|帮我|给我|看下|看看|看一下)/g,
  /(列出|列表|查询|查找|查看|提到|发现)/g,
  /(list|show|find|search)/gi,
  // Pronouns / particles / prepositions (multi-char first, then single-char)
  /(我们|你们|他们|什么|哪个|哪些|怎么|为什么|是否)/g,
  /[的了吗啊呢在给到与和跟对从向是有我你他她它这那哪谁啥嘛]/g,
  // Punctuation + whitespace
  /[\s!?.,;:'"()，。！？；：、《》「」『』【】]+/g,
  // Numbers
  /\d+/g,
];

/**
 * Extract a probable entity-name candidate from raw question text.
 *
 * @param {string} text
 * @returns {string|null}  longest remaining 2-10 char chunk, or null
 */
function extractEntityTerm(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let s = text;
  for (const re of ENTITY_STOP_PATTERNS) {
    s = s.replace(re, " ");
  }
  const candidates = s.split(/\s+/).filter((t) => t.length >= 2 && t.length <= 10);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
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
  extractEntityTerm,
  // exposed for tests
  SUBTYPE_KEYWORDS,
  ADAPTER_KEYWORDS,
  ENTITY_STOP_PATTERNS,
};
