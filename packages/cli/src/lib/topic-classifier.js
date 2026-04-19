/**
 * Topic Classifier — language-aware, multilingual.
 *
 * Pragmatic alternative to a neural classifier. Improves on boolean keyword
 * matching by:
 *   1. Detecting language via Unicode ranges (zh / ja / en / other) so
 *      CJK text is tokenized per-character instead of being stringified
 *      as one whitespace-less blob.
 *   2. Scoring with term frequency (TF) against per-language lexicons,
 *      then normalizing so scores are comparable across topics.
 *
 * Deep-learning-enhanced classification is deferred to the LLM manager
 * (Desktop main-process); this CLI classifier is offline and fully
 * deterministic, which is what `cc social analyze` needs.
 *
 * Languages: zh (Chinese), ja (Japanese), en (English), other.
 */

/* ── Unicode ranges ────────────────────────────────────────── */

// Han ideographs (CJK Unified + Extension-A). Shared by zh and ja.
const RE_HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
// Hiragana + Katakana (distinctive for Japanese).
const RE_KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
// Latin alphanumerics.
const RE_LATIN = /[A-Za-z]/;

/**
 * Detect the dominant language of a piece of text.
 *  - Any Hiragana/Katakana → ja (distinctive of Japanese)
 *  - Else Han ideographs present → zh
 *  - Else majority Latin letters → en
 *  - Otherwise 'other'
 */
export function detectLanguage(text) {
  if (!text || typeof text !== "string") return "other";
  const trimmed = text.trim();
  if (trimmed.length === 0) return "other";
  if (RE_KANA.test(trimmed)) return "ja";
  if (RE_HAN.test(trimmed)) return "zh";
  const latinCount = (trimmed.match(/[A-Za-z]/g) || []).length;
  const totalLetters = (trimmed.match(/[^\s\d\p{P}\p{S}]/gu) || []).length;
  if (totalLetters > 0 && latinCount / totalLetters >= 0.5) return "en";
  return "other";
}

/* ── Tokenization ──────────────────────────────────────────── */

/**
 * Tokenize a piece of text. The strategy depends on language:
 *  - en / other: split on non-alphanumerics, lowercase.
 *  - zh: each Han character becomes a token (ideograms carry meaning
 *    individually, and without a real segmenter this is more useful
 *    than "one giant token per whitespace-less blob").
 *  - ja: Kana + Han characters become tokens; Latin words split normally.
 */
export function tokenize(text, lang) {
  if (!text) return [];
  const resolved = lang || detectLanguage(text);
  const out = [];
  if (resolved === "en" || resolved === "other") {
    for (const word of text.toLowerCase().split(/[^a-z0-9_]+/u)) {
      if (word) out.push(word);
    }
    return out;
  }
  // For zh/ja we tokenize char-by-char for CJK and word-by-word for Latin.
  for (const ch of text) {
    if (RE_KANA.test(ch) || RE_HAN.test(ch)) {
      out.push(ch);
    }
  }
  for (const word of text.toLowerCase().split(/[^a-z0-9_]+/u)) {
    if (word) out.push(word);
  }
  return out;
}

/* ── Lexicons ──────────────────────────────────────────────── */

/**
 * Default lexicons. Shape:
 *   DEFAULT_TOPIC_LEXICONS[topic][lang] = Array<string | [string, number]>
 *
 * Keywords are matched as exact tokens (language-aware — English keywords
 * match tokenized English words; CN/JP keywords can be either single CJK
 * chars or multi-char phrases, which we match via substring inclusion).
 */
export const DEFAULT_TOPIC_LEXICONS = Object.freeze({
  tech: {
    en: [
      "tech",
      "technology",
      "software",
      "ai",
      "algorithm",
      "code",
      "developer",
      "programming",
      "cloud",
      "startup",
    ],
    zh: [
      "科技",
      "技术",
      "软件",
      "算法",
      "编程",
      "程序",
      "开发",
      "云计算",
      "人工智能",
      "互联网",
    ],
    ja: [
      "テクノロジー",
      "技術",
      "ソフトウェア",
      "プログラム",
      "開発",
      "人工知能",
      "クラウド",
      "システム",
    ],
  },
  sports: {
    en: [
      "sport",
      "sports",
      "game",
      "match",
      "football",
      "basketball",
      "soccer",
      "olympic",
      "tennis",
      "team",
    ],
    zh: [
      "体育",
      "运动",
      "比赛",
      "足球",
      "篮球",
      "奥运",
      "网球",
      "联赛",
      "冠军",
    ],
    ja: [
      "スポーツ",
      "試合",
      "サッカー",
      "野球",
      "バスケ",
      "オリンピック",
      "優勝",
    ],
  },
  health: {
    en: [
      "health",
      "medical",
      "doctor",
      "hospital",
      "disease",
      "vaccine",
      "patient",
      "therapy",
      "clinic",
      "surgery",
    ],
    zh: [
      "健康",
      "医疗",
      "医生",
      "医院",
      "疾病",
      "疫苗",
      "治疗",
      "诊所",
      "手术",
    ],
    ja: ["健康", "医療", "医師", "病院", "病気", "ワクチン", "治療"],
  },
  food: {
    en: [
      "food",
      "restaurant",
      "cuisine",
      "cooking",
      "chef",
      "recipe",
      "dish",
      "meal",
      "dessert",
    ],
    zh: ["美食", "餐厅", "料理", "烹饪", "厨师", "菜谱", "甜点", "小吃"],
    ja: ["料理", "レストラン", "グルメ", "料理人", "デザート", "食事"],
  },
  travel: {
    en: [
      "travel",
      "tourism",
      "hotel",
      "trip",
      "flight",
      "vacation",
      "tourist",
      "destination",
      "cruise",
    ],
    zh: ["旅行", "旅游", "酒店", "景点", "机票", "度假", "邮轮"],
    ja: ["旅行", "ホテル", "観光", "フライト", "休暇", "旅"],
  },
  politics: {
    en: [
      "politics",
      "government",
      "election",
      "policy",
      "president",
      "congress",
      "senate",
      "vote",
      "campaign",
    ],
    zh: ["政治", "政府", "选举", "政策", "总统", "议会", "投票", "竞选"],
    ja: ["政治", "政府", "選挙", "政策", "大統領", "国会", "投票"],
  },
  finance: {
    en: [
      "finance",
      "economy",
      "stock",
      "investment",
      "market",
      "bank",
      "trade",
      "currency",
      "crypto",
      "inflation",
    ],
    zh: [
      "金融",
      "经济",
      "股票",
      "投资",
      "市场",
      "银行",
      "贸易",
      "货币",
      "加密",
    ],
    ja: ["金融", "経済", "株式", "投資", "市場", "銀行", "取引", "通貨"],
  },
  entertainment: {
    en: [
      "entertainment",
      "movie",
      "film",
      "music",
      "celebrity",
      "concert",
      "series",
      "actor",
      "singer",
    ],
    zh: ["娱乐", "电影", "音乐", "明星", "演唱会", "电视剧", "演员", "歌手"],
    ja: ["映画", "音楽", "芸能", "コンサート", "ドラマ", "俳優", "歌手"],
  },
});

// User-registered lexicon overrides. Indexed by topic → lang → keywords[].
const _customLexicons = new Map();

/**
 * Register or override a topic lexicon. Pass `lexicon` as:
 *   { en: [...], zh: [...], ja: [...] }
 */
export function registerTopicLexicon(topic, lexicon) {
  if (!topic) throw new Error("topic is required");
  if (!lexicon || typeof lexicon !== "object") {
    throw new Error("lexicon object is required");
  }
  _customLexicons.set(topic, lexicon);
}

export function unregisterTopicLexicon(topic) {
  return _customLexicons.delete(topic);
}

export function listTopicLexicons() {
  const merged = { ...DEFAULT_TOPIC_LEXICONS };
  for (const [topic, lexicon] of _customLexicons.entries()) {
    merged[topic] = lexicon;
  }
  return merged;
}

/* ── Scoring ───────────────────────────────────────────────── */

function _keywordWeight(entry) {
  if (Array.isArray(entry)) return { keyword: entry[0], weight: entry[1] ?? 1 };
  return { keyword: entry, weight: 1 };
}

function _matchCount(text, tokens, keyword, lang) {
  // For Latin keywords, match as token equality (case-insensitive).
  // For CJK keywords, match as substring of the text (so multi-char phrases
  // like "加密货币" match even though tokenize() splits them into chars).
  if (/^[A-Za-z0-9_]+$/.test(keyword)) {
    const lower = keyword.toLowerCase();
    let count = 0;
    for (const t of tokens) if (t === lower) count += 1;
    return count;
  }
  // CJK multi-char or single-char phrase: substring count.
  if (!text) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const hit = text.indexOf(keyword, idx);
    if (hit === -1) break;
    count += 1;
    idx = hit + keyword.length;
  }
  return count;
}

/**
 * Classify `text` into one or more topics.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {Object} [opts.lexicons]  Override per-topic lexicons for this call.
 * @param {number} [opts.topK=3]    Return the top-K topics.
 * @param {string} [opts.lang]      Override detected language.
 * @param {number} [opts.minScore=0] Drop topics with score below this (pre-normalization).
 * @returns {{
 *   language: string,
 *   tokens: string[],
 *   topics: Array<{ topic: string, score: number, rawScore: number, hits: number }>
 * }}
 */
export function classifyTopic(text, opts = {}) {
  const {
    lexicons: overrideLexicons,
    topK = 3,
    lang: forceLang,
    minScore = 0,
  } = opts;

  const language = forceLang || detectLanguage(text);
  const tokens = tokenize(text, language);
  if (!text || tokens.length === 0) {
    return { language, tokens: [], topics: [] };
  }

  const lexiconSet = overrideLexicons || listTopicLexicons();
  const raw = [];
  for (const [topic, perLang] of Object.entries(lexiconSet)) {
    if (!perLang || typeof perLang !== "object") continue;
    const entries = perLang[language] || [];
    // Fall back to English keywords when the target language has none.
    const fallback = entries.length === 0 ? perLang.en || [] : [];
    let rawScore = 0;
    let hits = 0;
    for (const entry of [...entries, ...fallback]) {
      const { keyword, weight } = _keywordWeight(entry);
      const count = _matchCount(text, tokens, keyword, language);
      if (count > 0) {
        rawScore += count * weight;
        hits += count;
      }
    }
    if (rawScore > minScore) {
      raw.push({ topic, rawScore, hits });
    }
  }

  const total = raw.reduce((s, r) => s + r.rawScore, 0) || 1;
  const topics = raw
    .map((r) => ({
      topic: r.topic,
      score: r.rawScore / total,
      rawScore: r.rawScore,
      hits: r.hits,
    }))
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, topK);

  return { language, tokens, topics };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _customLexicons.clear();
}

// ===== V2 Surface: Topic Classifier governance overlay (CLI v0.140.0) =====
export const TOPIC_CLS_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const TOPIC_CLS_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _tcpTrans = new Map([
  [
    TOPIC_CLS_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE,
      TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TOPIC_CLS_PROFILE_MATURITY_V2.STALE,
      TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TOPIC_CLS_PROFILE_MATURITY_V2.STALE,
    new Set([
      TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE,
      TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _tcpTerminal = new Set([TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED]);
const _tcjTrans = new Map([
  [
    TOPIC_CLS_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING,
      TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      TOPIC_CLS_JOB_LIFECYCLE_V2.COMPLETED,
      TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED,
      TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TOPIC_CLS_JOB_LIFECYCLE_V2.COMPLETED, new Set()],
  [TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED, new Set()],
  [TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _tcpsV2 = new Map();
const _tcjsV2 = new Map();
let _tcpMaxActivePerOwner = 8;
let _tcpMaxPendingJobsPerProfile = 20;
let _tcpIdleMs = 14 * 24 * 60 * 60 * 1000;
let _tcjStuckMs = 5 * 60 * 1000;

function _tcpPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveTopicClsProfilesPerOwnerV2(n) {
  _tcpMaxActivePerOwner = _tcpPos(n, "maxActiveTopicClsProfilesPerOwner");
}
export function getMaxActiveTopicClsProfilesPerOwnerV2() {
  return _tcpMaxActivePerOwner;
}
export function setMaxPendingTopicClsJobsPerProfileV2(n) {
  _tcpMaxPendingJobsPerProfile = _tcpPos(n, "maxPendingTopicClsJobsPerProfile");
}
export function getMaxPendingTopicClsJobsPerProfileV2() {
  return _tcpMaxPendingJobsPerProfile;
}
export function setTopicClsProfileIdleMsV2(n) {
  _tcpIdleMs = _tcpPos(n, "topicClsProfileIdleMs");
}
export function getTopicClsProfileIdleMsV2() {
  return _tcpIdleMs;
}
export function setTopicClsJobStuckMsV2(n) {
  _tcjStuckMs = _tcpPos(n, "topicClsJobStuckMs");
}
export function getTopicClsJobStuckMsV2() {
  return _tcjStuckMs;
}

export function _resetStateTopicClsV2() {
  _tcpsV2.clear();
  _tcjsV2.clear();
  _tcpMaxActivePerOwner = 8;
  _tcpMaxPendingJobsPerProfile = 20;
  _tcpIdleMs = 14 * 24 * 60 * 60 * 1000;
  _tcjStuckMs = 5 * 60 * 1000;
}

export function registerTopicClsProfileV2({ id, owner, model, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_tcpsV2.has(id))
    throw new Error(`topic cls profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    model: model || "default",
    status: TOPIC_CLS_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _tcpsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _tcpCheckP(from, to) {
  const a = _tcpTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid topic cls profile transition ${from} → ${to}`);
}
function _tcpCountActive(owner) {
  let n = 0;
  for (const p of _tcpsV2.values())
    if (p.owner === owner && p.status === TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateTopicClsProfileV2(id) {
  const p = _tcpsV2.get(id);
  if (!p) throw new Error(`topic cls profile ${id} not found`);
  _tcpCheckP(p.status, TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === TOPIC_CLS_PROFILE_MATURITY_V2.STALE;
  if (!recovery) {
    const c = _tcpCountActive(p.owner);
    if (c >= _tcpMaxActivePerOwner)
      throw new Error(
        `max active topic cls profiles per owner (${_tcpMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleTopicClsProfileV2(id) {
  const p = _tcpsV2.get(id);
  if (!p) throw new Error(`topic cls profile ${id} not found`);
  _tcpCheckP(p.status, TOPIC_CLS_PROFILE_MATURITY_V2.STALE);
  p.status = TOPIC_CLS_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveTopicClsProfileV2(id) {
  const p = _tcpsV2.get(id);
  if (!p) throw new Error(`topic cls profile ${id} not found`);
  _tcpCheckP(p.status, TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TOPIC_CLS_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchTopicClsProfileV2(id) {
  const p = _tcpsV2.get(id);
  if (!p) throw new Error(`topic cls profile ${id} not found`);
  if (_tcpTerminal.has(p.status))
    throw new Error(`cannot touch terminal topic cls profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getTopicClsProfileV2(id) {
  const p = _tcpsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listTopicClsProfilesV2() {
  return [..._tcpsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _tcjCountPending(profileId) {
  let n = 0;
  for (const j of _tcjsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TOPIC_CLS_JOB_LIFECYCLE_V2.QUEUED ||
        j.status === TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createTopicClsJobV2({ id, profileId, text, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_tcjsV2.has(id)) throw new Error(`topic cls job ${id} already exists`);
  if (!_tcpsV2.has(profileId))
    throw new Error(`topic cls profile ${profileId} not found`);
  const pending = _tcjCountPending(profileId);
  if (pending >= _tcpMaxPendingJobsPerProfile)
    throw new Error(
      `max pending topic cls jobs per profile (${_tcpMaxPendingJobsPerProfile}) reached for ${profileId}`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    text: text || "",
    status: TOPIC_CLS_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tcjsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
function _tcjCheckJ(from, to) {
  const a = _tcjTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid topic cls job transition ${from} → ${to}`);
}
export function startTopicClsJobV2(id) {
  const j = _tcjsV2.get(id);
  if (!j) throw new Error(`topic cls job ${id} not found`);
  _tcjCheckJ(j.status, TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeTopicClsJobV2(id) {
  const j = _tcjsV2.get(id);
  if (!j) throw new Error(`topic cls job ${id} not found`);
  _tcjCheckJ(j.status, TOPIC_CLS_JOB_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = TOPIC_CLS_JOB_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failTopicClsJobV2(id, reason) {
  const j = _tcjsV2.get(id);
  if (!j) throw new Error(`topic cls job ${id} not found`);
  _tcjCheckJ(j.status, TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelTopicClsJobV2(id, reason) {
  const j = _tcjsV2.get(id);
  if (!j) throw new Error(`topic cls job ${id} not found`);
  _tcjCheckJ(j.status, TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TOPIC_CLS_JOB_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getTopicClsJobV2(id) {
  const j = _tcjsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listTopicClsJobsV2() {
  return [..._tcjsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}

export function autoStaleIdleTopicClsProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _tcpsV2.values())
    if (
      p.status === TOPIC_CLS_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _tcpIdleMs
    ) {
      p.status = TOPIC_CLS_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTopicClsJobsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _tcjsV2.values())
    if (
      j.status === TOPIC_CLS_JOB_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _tcjStuckMs
    ) {
      j.status = TOPIC_CLS_JOB_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}

export function getTopicClassifierGovStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(TOPIC_CLS_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _tcpsV2.values()) profilesByStatus[p.status]++;
  const jobsByStatus = {};
  for (const s of Object.values(TOPIC_CLS_JOB_LIFECYCLE_V2))
    jobsByStatus[s] = 0;
  for (const j of _tcjsV2.values()) jobsByStatus[j.status]++;
  return {
    totalTopicClsProfilesV2: _tcpsV2.size,
    totalTopicClsJobsV2: _tcjsV2.size,
    maxActiveTopicClsProfilesPerOwner: _tcpMaxActivePerOwner,
    maxPendingTopicClsJobsPerProfile: _tcpMaxPendingJobsPerProfile,
    topicClsProfileIdleMs: _tcpIdleMs,
    topicClsJobStuckMs: _tcjStuckMs,
    profilesByStatus,
    jobsByStatus,
  };
}
