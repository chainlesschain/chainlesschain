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
      // Safe month subtraction. Naive `setMonth(getMonth()-n)` overflows on a
      // month-end day into a shorter month (e.g. Mar 31 −1mo → "Feb 31" → Mar 3),
      // which silently DROPS the whole previous month from the window. Pin to
      // day 1 first, then clamp the day to the target month's length.
      const target = new Date(now);
      const day = target.getDate();
      target.setDate(1);
      target.setMonth(target.getMonth() - n);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
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
  // NOTE: bare 收到 ("receive") is deliberately NOT here — you 收到 messages /
  // packages / 红包 too, so it stole "收到多少消息" → income (income is checked
  // before message). 收到转账 still classifies as transfer (checked earlier).
  { subtype: "income", patterns: [/(收入|工资|进账|入账|income)/i] },
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

// App-scope adapter LISTS — an app name maps to ALL its message-bearing
// adapters (QQ collects to qq-pc + messaging-qq; 微信 to wechat-pc + wechat).
// Used by intent=rank to scope "谁发QQ最多" to QQ only. Kept separate from the
// single out.adapter above (sum-amount exact-match) because that one maps 微信
// → just "wechat" and would miss wechat-pc (the bulk). QQ excludes qzone (空间
// posts) and music-qq (music) — a "谁发X最多" question means messages.
const APP_ADAPTER_SCOPE = [
  { re: /微信|wechat|weixin/i, adapters: ["wechat-pc", "wechat"] },
  { re: /(?:qq|扣扣|企鹅)/i, adapters: ["qq-pc", "messaging-qq"] },
  { re: /抖音|douyin|tiktok/i, adapters: ["social-douyin"] },
  { re: /微博|weibo/i, adapters: ["social-weibo"] },
  { re: /头条|toutiao/i, adapters: ["social-toutiao"] },
  { re: /短信|sms/i, adapters: ["system-data-android"] },
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
  for (const row of APP_ADAPTER_SCOPE) {
    if (row.re.test(text)) {
      out.adapters = row.adapters;
      break;
    }
  }
  return out;
}

// ─── Intent detection (sum / count / list / latest / ...) ────────────────

// Amount/money words — BOTH the spend side (花/消费/开销/spent/金额) and the
// income side (收入/进账/到账/赚/挣). A question carrying one of these plus a
// "多少/how much" wants a SUM (sumEventAmount), not a row list.
const AMOUNT_HINT =
  /(花|花了|花费|消费|开销|spent|金额|多少钱|amount|收入|进账|到账|入账|赚|挣)/;
// Count quantifier: "多少X" or "几X" for a measure word. 钱 is deliberately
// EXCLUDED so "多少钱" routes to sum-amount, not count. Symmetric 多少/几 (the
// old pattern had 几条/几单 but not 多少条/多少单, and 多少部 but not 几部).
const COUNT_QUANTIFIER =
  /(多少|几)(次|条|单|个|家|人|张|部|篇|集|本|件|笔|顿|杯)|how\s+many|count\s+of/i;
const HOW_MUCH = /(多少钱|多少|how\s+much)/i;
// distinct-count — "我跟多少人聊过 / 认识多少人 / 和多少人有来往 / 多少人给我发过
// 消息": the DISTINCT number of people the user INTERACTED with — COUNT(DISTINCT
// actor) over events — NOT the persons-table total (which counts ALL ingested
// contacts, including ones bulk-imported but never messaged → grossly inflated).
// Requires an interaction verb so "通讯录里有多少人 / 我有多少个联系人" (where the
// contacts-table count IS the right answer) stay on intent=count/TOTALS.
const DISTINCT_PERSON = /多少(个|位)?人/;
const INTERACTION_FOR_DISTINCT =
  /(聊|联系|来往|往来|沟通|互动|认识|打过?电话|通过?电话|发过?(消息|信息)|打交道|交流)/;

function parseIntent(text) {
  if (typeof text !== "string") return "list";
  // distinct-count BEFORE 总共/count — "多少人 + interaction verb" is a more
  // specific signal than the generic 多少 quantifier ("总共跟多少人聊过" is still
  // a distinct count, not a record total).
  if (DISTINCT_PERSON.test(text) && INTERACTION_FOR_DISTINCT.test(text)) {
    return "distinct-count";
  }
  if (/(总共|共多少|加起来|sum|total|合计)/.test(text)) {
    // Distinguish amount vs count by presence of amount words (incl. income,
    // so "总共收入多少" is sum-amount, not count).
    if (AMOUNT_HINT.test(text)) return "sum-amount";
    return "count";
  }
  // Count: 多少X / 几X for a measure word ("多少条朋友圈" / "下了几单" /
  // "几个联系人"). Runs BEFORE the bare-sum rule so "消费了多少次" → count.
  if (COUNT_QUANTIFIER.test(text)) {
    return "count";
  }
  // Spend/income question without an explicit 总共/合计 — "(这个月)花了多少钱" /
  // "在淘宝花了多少" / "这个月收入多少" / "赚了多少". The amount word + a
  // "多少/how much" ⇒ a TOTAL. Without this these common phrasings fell through
  // to intent=list and the engine returned a row sample, not the authoritative
  // sumEventAmount total.
  if (AMOUNT_HINT.test(text) && HOW_MUCH.test(text)) {
    return "sum-amount";
  }
  // intent=rank — "谁给我发消息最多 / 我最常联系谁 / 谁打电话最多 / 群里谁发言最多":
  // a who(谁/哪位) + superlative(最多/最频繁/最常) + interaction-verb question.
  // Needs an authoritative GROUP BY actor top-N (vault.topActors) over the FULL
  // vault, NOT an ≤80-fact sample — otherwise the LLM refuses to rank ("样本不足").
  // Scoped to interaction VOLUME (messages/calls/contact), not amount ("谁花钱最多"
  // has no interaction verb → falls through). Runs BEFORE the latest/breadth gate
  // so "最近谁给我发最多" → rank. See pdh_analysis_engine_intent_routing.md.
  if (
    /(谁|哪位|哪个人)/.test(text) &&
    /(最多|最频繁|最常|最少)/.test(text) &&
    /(发|联系|打电话|来电|电话|聊|消息|私信|互动|来往|沟通|发言)/.test(text)
  ) {
    return "rank";
  }
  // intent=rank by TOPIC/group — "哪个群最活跃 / 哪个群聊得最多 / 我哪个群消息最多".
  // group(群/群聊/会话) + superlative → vault.topTopics GROUP BY topic (not actor).
  // Dimension is resolved by parseRankDimension. "群里在聊什么"(无 superlative)→ list.
  if (
    /(群|群聊|会话|讨论组|聊天群)/.test(text) &&
    /(最多|最活跃|最频繁|最常|活跃)/.test(text)
  ) {
    return "rank";
  }
  // "最近/最新" alone ⇒ newest few (intent=latest, 3-row cap). BUT when the
  // question also carries an aggregation ("谁…最多", "排名") or a topic/summary
  // signal ("最近聊什么", "什么话题", "都在讨论啥"), 3 rows can't answer it —
  // route those to intent=list (≤80 facts + FTS augmentation) instead. Without
  // this, "最近谁给我发消息最多" / "群里最近在聊什么" returned only 3 newest rows
  // and the LLM said "没有相关记录". See pdh_analysis_engine_intent_routing.md.
  const NEEDS_BREADTH =
    /(最多|最少|最频繁|最常|排名|排行|top|前\s*\d+|谁.{0,8}(最|多)|哪个.{0,8}最|哪些.{0,8}最|聊什么|聊些什么|聊啥|聊了啥|聊了什么|什么话题|啥话题|哪些话题|讨论什么|讨论啥|在聊|都聊|聊的(什么|啥)|什么内容|talking\s+about|topics?|ranking|most\s)/i;
  if (/(最近|最新|latest|recent)/i.test(text)) {
    if (NEEDS_BREADTH.test(text)) return "list";
    return "latest";
  }
  return "list";
}

// ─── Entity-focus detection (persons / items routing) ────────────────────
//
// 2026-05-27 — Bug: user asked "我有哪些联系人" / "我妈手机号" several times;
// vault held real contacts but the LLM kept replying "没数据" because the
// default _gatherFacts pulled 200 row-cap of events first and the persons
// slice got squeezed out of the small-model 20-fact budget. parseIntent
// already catches "几个 X" as count, but that doesn't tell the engine WHICH
// table the user means. parseEntityFocus is the missing signal: when the
// question is explicitly about contacts/apps, the engine prioritizes that
// table instead of competing with events.
//
// Returns null when no focus signal — engine falls back to the existing
// events-majority + persons/items remainder behavior.
//
// Memory: pdh_analysis_engine_intent_routing.md.

const PERSON_FOCUS_PATTERNS = [
  /(联系人|通讯录|电话簿|通信录|好友列表|朋友列表)/,
  /(手机号|电话号|号码是|的电话|的手机)/,
  /(谁是|是谁|是什么人)/,
  /\b(contact|contacts|phonebook|address\s*book|phone\s*number)\b/i,
];

const ITEM_FOCUS_PATTERNS = [
  /(装了|安装了|装过|下了什么|下载了什么|有哪些(app|应用|软件|游戏))/i,
  /(我的(app|应用|软件)|哪些(app|应用|软件|游戏))/i,
  /\b(installed\s+apps?|my\s+apps?|installed\s+packages?)\b/i,
];

function parseEntityFocus(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  if (PERSON_FOCUS_PATTERNS.some((re) => re.test(text))) return "persons";
  if (ITEM_FOCUS_PATTERNS.some((re) => re.test(text))) return "items";
  return null;
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

// ─── Person-name extraction (entityFocus=persons routing) ────────────────
//
// Specialized extractor for the persons branch in AnalysisEngine. Differs
// from extractEntityTerm in two ways:
//
//  1. Strips person-FOCUS framing words first (联系人/手机号/电话/etc.) —
//     they're question scaffolding, not the target name. extractEntityTerm
//     left "妈手机号" intact because it doesn't know that phrase is framing.
//
//  2. Allows single-character names from a relation-word whitelist
//     (妈/爸/姐/弟/...) — extractEntityTerm filtered every 1-char Chinese to
//     suppress verb false positives, but that also dropped "妈" / "爸" which
//     are the dominant contact-name shorthands on a personal phonebook.
//
// Multi-char candidates always win over single-char fallback so "张三的
// 手机号" returns "张三" not "三".

const PERSON_FRAMING_STOP_PATTERNS = [
  /(联系人|通讯录|电话簿|通信录|好友列表|朋友列表)/g,
  /(手机号|电话号|号码是|的电话|的手机|号码|电话)/g,
  /(谁是|是谁|是什么人|是哪位)/g,
  /\b(contact|contacts|phonebook|address\s*book|phone\s*number)\b/gi,
];

// Whitelisted single-character Chinese relation words. Single-char tokens
// outside this set are dropped to keep verb / particle false-positives from
// leaking through. Extend cautiously — every new char widens the LIKE
// surface area and could match unrelated rows.
const PERSON_RELATION_SINGLE_CHARS_RE =
  /^[妈爸姐妹哥弟爹娘爷奶姥舅姑叔伯婶嫂嫁公婆]$/;

function extractPersonNameCandidate(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let s = text;
  for (const re of PERSON_FRAMING_STOP_PATTERNS) {
    s = s.replace(re, " ");
  }
  for (const re of ENTITY_STOP_PATTERNS) {
    s = s.replace(re, " ");
  }
  const all = s.split(/\s+/).filter((t) => t.length >= 1 && t.length <= 10);
  if (all.length === 0) return null;
  const multi = all
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (multi.length > 0) return multi[0];
  const single = all.find((t) => t.length === 1 && PERSON_RELATION_SINGLE_CHARS_RE.test(t));
  return single || null;
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
/**
 * parseRankDimension — for intent=rank, which dimension to GROUP BY.
 *   "topic"  → group/conversation ("哪个群最活跃")  → vault.topTopics
 *   "actor"  → person (default; "谁给我发最多")      → vault.topActors
 * Only meaningful when intent === "rank"; callers ignore it otherwise.
 */
function parseRankDimension(text) {
  if (typeof text !== "string") return "actor";
  // A group/conversation question — but only when it's about the group ITSELF
  // ("哪个群…"), not a person within a group ("群里谁发言最多" → actor).
  if (/(群|群聊|会话|讨论组|聊天群)/.test(text) && !/(谁|哪位|哪个人)/.test(text)) {
    return "topic";
  }
  return "actor";
}

function parseQuery(question, opts = {}) {
  const raw = typeof question === "string" ? question : "";
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const intent = parseIntent(raw);
  return {
    raw,
    timeWindow: parseTimeWindow(raw, now),
    filters: parseFilters(raw),
    intent,
    rankDimension: intent === "rank" ? parseRankDimension(raw) : undefined,
    entityFocus: parseEntityFocus(raw),
  };
}

module.exports = {
  parseQuery,
  parseTimeWindow,
  parseFilters,
  parseIntent,
  parseRankDimension,
  parseEntityFocus,
  extractEntityTerm,
  extractPersonNameCandidate,
  // exposed for tests
  SUBTYPE_KEYWORDS,
  ADAPTER_KEYWORDS,
  PERSON_FOCUS_PATTERNS,
  ITEM_FOCUS_PATTERNS,
  ENTITY_STOP_PATTERNS,
  PERSON_FRAMING_STOP_PATTERNS,
  PERSON_RELATION_SINGLE_CHARS_RE,
};
