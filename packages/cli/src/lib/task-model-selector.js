/**
 * Task-based intelligent model selector for CLI
 *
 * Detects task type from user messages and recommends the best model
 * for each LLM provider. Enables automatic model switching based on
 * what the user is trying to accomplish.
 */

/**
 * Task types supported by the selector
 */
export const TaskType = {
  CHAT: "chat",
  CODE: "code",
  REASONING: "reasoning",
  FAST: "fast",
  TRANSLATE: "translate",
  CREATIVE: "creative",
};

/**
 * Task type → recommended model per provider
 * Each provider maps to the best model for that task type.
 */
const TASK_MODEL_MAP = {
  [TaskType.CHAT]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o-mini",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-plus",
    gemini: "gemini-2.0-flash",
    kimi: "moonshot-v1-auto",
    minimax: "MiniMax-Text-01",
    mistral: "mistral-medium-latest",
    ollama: "qwen2.5:7b",
  },
  [TaskType.CODE]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-coder",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    kimi: "moonshot-v1-auto",
    minimax: "MiniMax-Text-01",
    mistral: "mistral-large-latest",
    ollama: "qwen2.5-coder:14b",
  },
  [TaskType.REASONING]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "o1",
    anthropic: "claude-opus-4-6",
    deepseek: "deepseek-reasoner",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    kimi: "moonshot-v1-128k",
    minimax: "MiniMax-Text-01",
    mistral: "mistral-large-latest",
    ollama: "qwen2.5:14b",
  },
  [TaskType.FAST]: {
    volcengine: "doubao-seed-1-6-lite-251015",
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-4-5-20251001",
    deepseek: "deepseek-chat",
    dashscope: "qwen-turbo",
    gemini: "gemini-2.0-flash",
    kimi: "moonshot-v1-8k",
    minimax: "abab6.5s-chat",
    mistral: "mistral-small-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.TRANSLATE]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-plus",
    gemini: "gemini-2.0-flash",
    kimi: "moonshot-v1-auto",
    minimax: "MiniMax-Text-01",
    mistral: "mistral-large-latest",
    ollama: "qwen2:7b",
  },
  [TaskType.CREATIVE]: {
    volcengine: "doubao-seed-1-6-251015",
    openai: "gpt-4o",
    anthropic: "claude-opus-4-6",
    deepseek: "deepseek-chat",
    dashscope: "qwen-max",
    gemini: "gemini-2.0-pro",
    kimi: "moonshot-v1-128k",
    minimax: "MiniMax-Text-01",
    mistral: "mistral-large-latest",
    ollama: "qwen2:7b",
  },
};

/**
 * Task type display names (Chinese + English)
 */
const TASK_NAMES = {
  [TaskType.CHAT]: "日常对话",
  [TaskType.CODE]: "代码任务",
  [TaskType.REASONING]: "复杂推理",
  [TaskType.FAST]: "快速响应",
  [TaskType.TRANSLATE]: "翻译任务",
  [TaskType.CREATIVE]: "创意写作",
};

/**
 * Keyword patterns for detecting task type from user message.
 * Each pattern is [regex, taskType, priority].
 * Higher priority wins when multiple patterns match.
 */
const TASK_PATTERNS = [
  // Code patterns (priority 10) — English with word boundaries
  [
    /\b(code|coding|program|function|class|bug|debug|refactor|implement)\b/i,
    TaskType.CODE,
    10,
  ],
  [
    /\b(javascript|typescript|python|java|rust|go|c\+\+|sql|html|css|react|vue|node|npm|git|api|endpoint|database)\b/i,
    TaskType.CODE,
    10,
  ],
  [/```[\s\S]*```/, TaskType.CODE, 10],
  // Code patterns — Chinese (no \b, Chinese chars are not word-boundary compatible)
  [
    /(代码|编程|函数|调试|重构|实现|写[一个]*[代码函数方法])/,
    TaskType.CODE,
    10,
  ],

  // Reasoning patterns (priority 8)
  [
    /\b(analyze|reason|explain why|prove|compare|evaluate)\b/i,
    TaskType.REASONING,
    8,
  ],
  [/\b(step.by.step|think.*through)\b/i, TaskType.REASONING, 8],
  [
    /(分析|推理|解释为什么|证明|比较|评估|深度思考|逻辑|逐步|一步一步)/,
    TaskType.REASONING,
    8,
  ],

  // Translation patterns (priority 9)
  [/\b(translate|translation|translate.*to)\b/i, TaskType.TRANSLATE, 9],
  [/(翻译|转换.*语言|英译中|中译英)/, TaskType.TRANSLATE, 9],

  // Creative patterns (priority 7)
  [
    /\b(write|create|compose|story|poem|essay|blog|article)\b/i,
    TaskType.CREATIVE,
    7,
  ],
  [/(写[一篇]*.*[故事诗歌文章博客]|创作|小说|剧本)/, TaskType.CREATIVE, 7],

  // Fast patterns (priority 5)
  [/\b(quick|brief|short)\b/i, TaskType.FAST, 5],
  [/(简短|快速|简单回答|一句话)/, TaskType.FAST, 5],
];

/**
 * Detect the task type from a user message using keyword matching.
 *
 * @param {string} message - User's input message
 * @returns {{ taskType: string, confidence: number, name: string }}
 */
export function detectTaskType(message) {
  if (!message || typeof message !== "string") {
    return {
      taskType: TaskType.CHAT,
      confidence: 0,
      name: TASK_NAMES[TaskType.CHAT],
    };
  }

  let bestMatch = null;
  let bestPriority = -1;
  let matchCount = 0;

  for (const [pattern, taskType, priority] of TASK_PATTERNS) {
    if (pattern.test(message)) {
      matchCount++;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestMatch = taskType;
      }
    }
  }

  if (!bestMatch) {
    return {
      taskType: TaskType.CHAT,
      confidence: 0,
      name: TASK_NAMES[TaskType.CHAT],
    };
  }

  // Confidence based on match count and priority
  const confidence = Math.min(1, matchCount * 0.3 + bestPriority * 0.07);

  return {
    taskType: bestMatch,
    confidence,
    name: TASK_NAMES[bestMatch],
  };
}

/**
 * Select the best model for a given provider and task type.
 *
 * @param {string} provider - LLM provider name
 * @param {string} taskType - Task type from TaskType enum
 * @returns {string|null} Model ID, or null if no recommendation
 */
export function selectModelForTask(provider, taskType) {
  const taskMap = TASK_MODEL_MAP[taskType];
  if (!taskMap) return null;
  return taskMap[provider] || null;
}

/**
 * Get a human-readable task name.
 *
 * @param {string} taskType - Task type
 * @returns {string}
 */
export function getTaskName(taskType) {
  return TASK_NAMES[taskType] || taskType;
}

/**
 * Get all supported task types.
 *
 * @returns {Object} TaskType enum
 */
export function getTaskTypes() {
  return { ...TaskType };
}

// ===== V2 Surface: Task Model Selector governance overlay (CLI v0.141.0) =====
export const TMS_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", STALE: "stale", DECOMMISSIONED: "decommissioned",
});
export const TMS_SELECTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", SCORING: "scoring", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled",
});
const _tmsPTrans = new Map([
  [TMS_PROFILE_MATURITY_V2.PENDING, new Set([TMS_PROFILE_MATURITY_V2.ACTIVE, TMS_PROFILE_MATURITY_V2.DECOMMISSIONED])],
  [TMS_PROFILE_MATURITY_V2.ACTIVE, new Set([TMS_PROFILE_MATURITY_V2.STALE, TMS_PROFILE_MATURITY_V2.DECOMMISSIONED])],
  [TMS_PROFILE_MATURITY_V2.STALE, new Set([TMS_PROFILE_MATURITY_V2.ACTIVE, TMS_PROFILE_MATURITY_V2.DECOMMISSIONED])],
  [TMS_PROFILE_MATURITY_V2.DECOMMISSIONED, new Set()],
]);
const _tmsPTerminal = new Set([TMS_PROFILE_MATURITY_V2.DECOMMISSIONED]);
const _tmsSTrans = new Map([
  [TMS_SELECTION_LIFECYCLE_V2.QUEUED, new Set([TMS_SELECTION_LIFECYCLE_V2.SCORING, TMS_SELECTION_LIFECYCLE_V2.CANCELLED])],
  [TMS_SELECTION_LIFECYCLE_V2.SCORING, new Set([TMS_SELECTION_LIFECYCLE_V2.COMPLETED, TMS_SELECTION_LIFECYCLE_V2.FAILED, TMS_SELECTION_LIFECYCLE_V2.CANCELLED])],
  [TMS_SELECTION_LIFECYCLE_V2.COMPLETED, new Set()],
  [TMS_SELECTION_LIFECYCLE_V2.FAILED, new Set()],
  [TMS_SELECTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _tmsPsV2 = new Map();
const _tmsSsV2 = new Map();
let _tmsMaxActivePerOwner = 8, _tmsMaxPendingSelPerProfile = 16, _tmsIdleMs = 14 * 24 * 60 * 60 * 1000, _tmsStuckMs = 2 * 60 * 1000;
function _tmsPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _tmsCheckP(from, to) { const a = _tmsPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid tms profile transition ${from} → ${to}`); }
function _tmsCheckS(from, to) { const a = _tmsSTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid tms selection transition ${from} → ${to}`); }
export function setMaxActiveTmsProfilesPerOwnerV2(n) { _tmsMaxActivePerOwner = _tmsPos(n, "maxActiveTmsProfilesPerOwner"); }
export function getMaxActiveTmsProfilesPerOwnerV2() { return _tmsMaxActivePerOwner; }
export function setMaxPendingTmsSelectionsPerProfileV2(n) { _tmsMaxPendingSelPerProfile = _tmsPos(n, "maxPendingTmsSelectionsPerProfile"); }
export function getMaxPendingTmsSelectionsPerProfileV2() { return _tmsMaxPendingSelPerProfile; }
export function setTmsProfileIdleMsV2(n) { _tmsIdleMs = _tmsPos(n, "tmsProfileIdleMs"); }
export function getTmsProfileIdleMsV2() { return _tmsIdleMs; }
export function setTmsSelectionStuckMsV2(n) { _tmsStuckMs = _tmsPos(n, "tmsSelectionStuckMs"); }
export function getTmsSelectionStuckMsV2() { return _tmsStuckMs; }
export function _resetStateTaskModelSelectorV2() { _tmsPsV2.clear(); _tmsSsV2.clear(); _tmsMaxActivePerOwner = 8; _tmsMaxPendingSelPerProfile = 16; _tmsIdleMs = 14 * 24 * 60 * 60 * 1000; _tmsStuckMs = 2 * 60 * 1000; }
export function registerTmsProfileV2({ id, owner, strategy, metadata } = {}) {
  if (!id) throw new Error("tms profile id required"); if (!owner) throw new Error("tms profile owner required");
  if (_tmsPsV2.has(id)) throw new Error(`tms profile ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, strategy: strategy || "default", status: TMS_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, decommissionedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _tmsPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
function _tmsCountActive(owner) { let n = 0; for (const p of _tmsPsV2.values()) if (p.owner === owner && p.status === TMS_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }
export function activateTmsProfileV2(id) {
  const p = _tmsPsV2.get(id); if (!p) throw new Error(`tms profile ${id} not found`);
  _tmsCheckP(p.status, TMS_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === TMS_PROFILE_MATURITY_V2.STALE;
  if (!recovery && _tmsCountActive(p.owner) >= _tmsMaxActivePerOwner) throw new Error(`max active tms profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = TMS_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleTmsProfileV2(id) { const p = _tmsPsV2.get(id); if (!p) throw new Error(`tms profile ${id} not found`); _tmsCheckP(p.status, TMS_PROFILE_MATURITY_V2.STALE); p.status = TMS_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function decommissionTmsProfileV2(id) { const p = _tmsPsV2.get(id); if (!p) throw new Error(`tms profile ${id} not found`); _tmsCheckP(p.status, TMS_PROFILE_MATURITY_V2.DECOMMISSIONED); const now = Date.now(); p.status = TMS_PROFILE_MATURITY_V2.DECOMMISSIONED; p.updatedAt = now; if (!p.decommissionedAt) p.decommissionedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchTmsProfileV2(id) { const p = _tmsPsV2.get(id); if (!p) throw new Error(`tms profile ${id} not found`); if (_tmsPTerminal.has(p.status)) throw new Error(`cannot touch terminal tms profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getTmsProfileV2(id) { const p = _tmsPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listTmsProfilesV2() { return [..._tmsPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
function _tmsCountPending(profileId) { let n = 0; for (const s of _tmsSsV2.values()) if (s.profileId === profileId && (s.status === TMS_SELECTION_LIFECYCLE_V2.QUEUED || s.status === TMS_SELECTION_LIFECYCLE_V2.SCORING)) n++; return n; }
export function createTmsSelectionV2({ id, profileId, task, metadata } = {}) {
  if (!id) throw new Error("tms selection id required"); if (!profileId) throw new Error("tms selection profileId required");
  if (_tmsSsV2.has(id)) throw new Error(`tms selection ${id} already exists`);
  if (!_tmsPsV2.has(profileId)) throw new Error(`tms profile ${profileId} not found`);
  if (_tmsCountPending(profileId) >= _tmsMaxPendingSelPerProfile) throw new Error(`max pending tms selections for profile ${profileId} reached`);
  const now = Date.now();
  const s = { id, profileId, task: task || "", status: TMS_SELECTION_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _tmsSsV2.set(id, s); return { ...s, metadata: { ...s.metadata } };
}
export function scoreTmsSelectionV2(id) { const s = _tmsSsV2.get(id); if (!s) throw new Error(`tms selection ${id} not found`); _tmsCheckS(s.status, TMS_SELECTION_LIFECYCLE_V2.SCORING); const now = Date.now(); s.status = TMS_SELECTION_LIFECYCLE_V2.SCORING; s.updatedAt = now; if (!s.startedAt) s.startedAt = now; return { ...s, metadata: { ...s.metadata } }; }
export function completeTmsSelectionV2(id) { const s = _tmsSsV2.get(id); if (!s) throw new Error(`tms selection ${id} not found`); _tmsCheckS(s.status, TMS_SELECTION_LIFECYCLE_V2.COMPLETED); const now = Date.now(); s.status = TMS_SELECTION_LIFECYCLE_V2.COMPLETED; s.updatedAt = now; if (!s.settledAt) s.settledAt = now; return { ...s, metadata: { ...s.metadata } }; }
export function failTmsSelectionV2(id, reason) { const s = _tmsSsV2.get(id); if (!s) throw new Error(`tms selection ${id} not found`); _tmsCheckS(s.status, TMS_SELECTION_LIFECYCLE_V2.FAILED); const now = Date.now(); s.status = TMS_SELECTION_LIFECYCLE_V2.FAILED; s.updatedAt = now; if (!s.settledAt) s.settledAt = now; if (reason) s.metadata.failReason = String(reason); return { ...s, metadata: { ...s.metadata } }; }
export function cancelTmsSelectionV2(id, reason) { const s = _tmsSsV2.get(id); if (!s) throw new Error(`tms selection ${id} not found`); _tmsCheckS(s.status, TMS_SELECTION_LIFECYCLE_V2.CANCELLED); const now = Date.now(); s.status = TMS_SELECTION_LIFECYCLE_V2.CANCELLED; s.updatedAt = now; if (!s.settledAt) s.settledAt = now; if (reason) s.metadata.cancelReason = String(reason); return { ...s, metadata: { ...s.metadata } }; }
export function getTmsSelectionV2(id) { const s = _tmsSsV2.get(id); if (!s) return null; return { ...s, metadata: { ...s.metadata } }; }
export function listTmsSelectionsV2() { return [..._tmsSsV2.values()].map((s) => ({ ...s, metadata: { ...s.metadata } })); }
export function autoStaleIdleTmsProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _tmsPsV2.values()) if (p.status === TMS_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _tmsIdleMs) { p.status = TMS_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckTmsSelectionsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const s of _tmsSsV2.values()) if (s.status === TMS_SELECTION_LIFECYCLE_V2.SCORING && s.startedAt != null && (t - s.startedAt) >= _tmsStuckMs) { s.status = TMS_SELECTION_LIFECYCLE_V2.FAILED; s.updatedAt = t; if (!s.settledAt) s.settledAt = t; s.metadata.failReason = "auto-fail-stuck"; flipped.push(s.id); } return { flipped, count: flipped.length }; }
export function getTaskModelSelectorGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(TMS_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _tmsPsV2.values()) profilesByStatus[p.status]++;
  const selectionsByStatus = {}; for (const v of Object.values(TMS_SELECTION_LIFECYCLE_V2)) selectionsByStatus[v] = 0; for (const s of _tmsSsV2.values()) selectionsByStatus[s.status]++;
  return { totalTmsProfilesV2: _tmsPsV2.size, totalTmsSelectionsV2: _tmsSsV2.size, maxActiveTmsProfilesPerOwner: _tmsMaxActivePerOwner, maxPendingTmsSelectionsPerProfile: _tmsMaxPendingSelPerProfile, tmsProfileIdleMs: _tmsIdleMs, tmsSelectionStuckMs: _tmsStuckMs, profilesByStatus, selectionsByStatus };
}
