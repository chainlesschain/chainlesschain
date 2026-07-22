/**
 * Session hooks - 会话级钩子触发工具
 *
 * 用于 agent-repl 的三件套会话级钩子：
 * - SessionStart
 * - UserPromptSubmit
 * - AssistantResponse
 * - SessionEnd
 * - Notification
 */

import { HookEvents, executeHooks } from "./hook-manager.js";

// 会话钩子白名单
export const SESSION_HOOK_EVENTS = Object.freeze([
  HookEvents.SessionStart,
  HookEvents.UserPromptSubmit,
  HookEvents.AssistantResponse,
  HookEvents.SessionEnd,
  HookEvents.Notification,
]);

// 依赖注入点（用于测试）
export const _deps = {
  executeHooks,
  logFailure: (_db, event, error) => {
    console.error(`[session-hooks] Failed to fire ${event}:`, error);
  },
};

/**
 * 通用会话钩子触发函数
 * @param {object} db - 数据库实例
 * @param {string} event - 钩子事件名
 * @param {object} [context={}] - 钩子上下文
 * @returns {Promise<Array>} 钩子执行结果数组
 */
export async function fireSessionHook(db, event, context = {}) {
  // 白名单验证
  if (!SESSION_HOOK_EVENTS.includes(event)) {
    throw new Error(`"${event}" is not a session hook event`);
  }

  // 如果没有数据库，空操作
  if (!db) {
    return [];
  }

  try {
    // 注入时间戳
    const ctxWithTimestamp = {
      timestamp: new Date().toISOString(),
      ...context,
    };

    // 执行钩子
    const results = await _deps.executeHooks(db, event, ctxWithTimestamp);
    return Array.isArray(results) ? results : [];
  } catch (error) {
    _deps.logFailure(db, event, error);
    return [];
  }
}

/**
 * 触发用户提交提示词钩子
 * @param {object} db - 数据库实例
 * @param {string} prompt - 用户提示词
 * @param {object} [context={}] - 上下文
 * @returns {Promise<{prompt: string, abort: boolean, reason?: string, results: Array}>}
 */
export async function fireUserPromptSubmit(db, prompt, context = {}) {
  const results = await fireSessionHook(db, HookEvents.UserPromptSubmit, {
    prompt,
    ...context,
  });

  let rewrittenPrompt = prompt;
  let abort = false;
  let abortReason;

  // 处理钩子返回的指令
  for (const result of results) {
    if (!result.success) continue;
    try {
      const output = result.stdout ? JSON.parse(result.stdout) : {};
      if (output.rewrittenPrompt) {
        rewrittenPrompt = output.rewrittenPrompt;
      }
      if (output.abort) {
        abort = true;
        abortReason = output.reason || "aborted by hook";
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    prompt: rewrittenPrompt,
    abort,
    reason: abortReason,
    results,
  };
}

/**
 * 触发助手响应钩子（已存在，重写增强）
 * @param {object} db - 数据库实例
 * @param {string} response - 助手响应
 * @param {object} [context={}] - 上下文
 * @returns {Promise<{response: string, suppress: boolean, reason?: string, results: Array}>}
 */
export async function fireAssistantResponse(db, response, context = {}) {
  const results = await fireSessionHook(db, HookEvents.AssistantResponse, {
    response,
    ...context,
  });

  let rewrittenResponse = response;
  let suppress = false;
  let suppressReason;

  for (const result of results) {
    if (!result.success) continue;
    try {
      const output = result.stdout ? JSON.parse(result.stdout) : {};
      if (output.rewrittenResponse) {
        rewrittenResponse = output.rewrittenResponse;
      }
      if (output.suppress) {
        suppress = true;
        suppressReason = output.reason || "suppressed by hook";
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    response: rewrittenResponse,
    suppress,
    reason: suppressReason,
    results,
  };
}

/**
 * 触发会话开始钩子
 * @param {object} db - 数据库实例
 * @param {object} [context={}] - 上下文
 * @returns {Promise<Array>}
 */
export async function fireSessionStart(db, context = {}) {
  return fireSessionHook(db, HookEvents.SessionStart, context);
}

/**
 * 触发会话结束钩子
 * @param {object} db - 数据库实例
 * @param {object} [context={}] - 上下文
 * @returns {Promise<Array>}
 */
export async function fireSessionEnd(db, context = {}) {
  return fireSessionHook(db, HookEvents.SessionEnd, context);
}

// Historical callers use "Stop" for the terminal lifecycle event; retain the
// alias while the canonical hook event remains SessionEnd.
export const fireSessionStop = fireSessionEnd;

/**
 * 获取钩子数据库实例
 * @returns {null} 暂未实现
 */
export function getHookDb() {
  return null;
}

/**
 * 触发设置钩子
 * @param {object} db - 数据库实例
 * @param {object} context - 上下文
 * @returns {Promise<{abort: boolean}>}
 */
export async function fireSetup(db, context) {
  return { abort: false };
}

/** Fire Notification hooks. Notifications are best-effort and may return a
 * suppress/message directive without ever breaking the host session. */
export async function fireNotification(db, message, context = {}) {
  const results = await fireSessionHook(db, HookEvents.Notification, {
    message,
    ...context,
  });
  for (const result of results) {
    if (!result?.success) continue;
    const raw = result.stdout ?? result.output ?? result.result;
    let directive = raw && typeof raw === "object" ? raw : null;
    if (!directive && typeof raw === "string") {
      try {
        directive = JSON.parse(raw.trim());
      } catch {
        directive = null;
      }
    }
    if (directive && typeof directive === "object") {
      return { directive, results };
    }
  }
  return { directive: null, results };
}

// Session Hooks V2 governance overlay. Kept in this module so the command and
// the library expose one stable surface to the CLI and its consumers.
export const SHOK_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DISABLED: "disabled",
  RETIRED: "retired",
});
export const SHOK_INVOCATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _sp = new Map(),
  _si = new Map();
let _maxActive = 12,
  _maxPending = 25,
  _idleMs = 30 * 24 * 60 * 60 * 1000,
  _stuckMs = 30000;
const clone = (x) => ({ ...x, metadata: { ...(x.metadata || {}) } });
const pos = (n, name) => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${name} must be positive integer`);
  return v;
};
const profile = (id) => {
  const p = _sp.get(id);
  if (!p) throw new Error(`shok profile ${id} not found`);
  return p;
};
const invocation = (id) => {
  const i = _si.get(id);
  if (!i) throw new Error(`shok invocation ${id} not found`);
  return i;
};
const transition = (map, from, to, label) => {
  if (!map[from]?.includes(to))
    throw new Error(`invalid ${label} transition ${from} → ${to}`);
};
const PT = {
  pending: ["active", "retired"],
  active: ["disabled", "retired"],
  disabled: ["active", "retired"],
  retired: [],
};
const IT = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
export const setMaxActiveShokProfilesPerOwnerV2 = (n) => {
  _maxActive = pos(n, "maxActiveShokProfilesPerOwner");
};
export const getMaxActiveShokProfilesPerOwnerV2 = () => _maxActive;
export const setMaxPendingShokInvocationsPerProfileV2 = (n) => {
  _maxPending = pos(n, "maxPendingShokInvocationsPerProfile");
};
export const getMaxPendingShokInvocationsPerProfileV2 = () => _maxPending;
export const setShokProfileIdleMsV2 = (n) => {
  _idleMs = pos(n, "shokProfileIdleMs");
};
export const getShokProfileIdleMsV2 = () => _idleMs;
export const setShokInvocationStuckMsV2 = (n) => {
  _stuckMs = pos(n, "shokInvocationStuckMs");
};
export const getShokInvocationStuckMsV2 = () => _stuckMs;
export function _resetStateSessionHooksV2() {
  _sp.clear();
  _si.clear();
  _maxActive = 12;
  _maxPending = 25;
  _idleMs = 30 * 24 * 60 * 60 * 1000;
  _stuckMs = 30000;
}
export function registerShokProfileV2({
  id,
  owner,
  event = "preTurn",
  metadata = {},
} = {}) {
  if (!id || !owner) throw new Error("shok profile id and owner required");
  if (_sp.has(id)) throw new Error(`shok profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    event,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...metadata },
  };
  _sp.set(id, p);
  return clone(p);
}
export function activateShokProfileV2(id) {
  const p = profile(id);
  transition(PT, p.status, "active", "shok profile");
  const active = [..._sp.values()].filter(
    (x) => x.owner === p.owner && x.status === "active",
  ).length;
  if (p.status !== "disabled" && active >= _maxActive)
    throw new Error(`max active shok profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = "active";
  p.updatedAt = now;
  p.lastTouchedAt = now;
  p.activatedAt ||= now;
  return clone(p);
}
export function disableShokProfileV2(id) {
  const p = profile(id);
  transition(PT, p.status, "disabled", "shok profile");
  p.status = "disabled";
  p.updatedAt = Date.now();
  return clone(p);
}
export function retireShokProfileV2(id) {
  const p = profile(id);
  transition(PT, p.status, "retired", "shok profile");
  const now = Date.now();
  p.status = "retired";
  p.updatedAt = now;
  p.retiredAt ||= now;
  return clone(p);
}
export function touchShokProfileV2(id) {
  const p = profile(id);
  if (p.status === "retired")
    throw new Error(`cannot touch terminal shok profile ${id}`);
  p.lastTouchedAt = p.updatedAt = Date.now();
  return clone(p);
}
export const getShokProfileV2 = (id) =>
  _sp.has(id) ? clone(_sp.get(id)) : null;
export const listShokProfilesV2 = () => [..._sp.values()].map(clone);
export function createShokInvocationV2({
  id,
  profileId,
  payload = "",
  metadata = {},
} = {}) {
  if (!id || !profileId)
    throw new Error("shok invocation id and profileId required");
  if (_si.has(id) || !_sp.has(profileId))
    throw new Error("invalid shok invocation");
  const pending = [..._si.values()].filter(
    (x) =>
      x.profileId === profileId && ["queued", "running"].includes(x.status),
  ).length;
  if (pending >= _maxPending)
    throw new Error(
      `max pending shok invocations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const i = {
    id,
    profileId,
    payload,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _si.set(id, i);
  return clone(i);
}
function setInvocation(id, to, extra = {}) {
  const i = invocation(id);
  transition(IT, i.status, to, "shok invocation");
  const now = Date.now();
  Object.assign(i, extra, { status: to, updatedAt: now });
  if (to === "running") i.startedAt ||= now;
  if (["completed", "failed", "cancelled"].includes(to)) i.settledAt ||= now;
  return clone(i);
}
export const runningShokInvocationV2 = (id) => setInvocation(id, "running");
export const completeShokInvocationV2 = (id) => setInvocation(id, "completed");
export const failShokInvocationV2 = (id, reason) =>
  setInvocation(
    id,
    "failed",
    reason
      ? { metadata: { ...invocation(id).metadata, failReason: String(reason) } }
      : {},
  );
export const cancelShokInvocationV2 = (id, reason) =>
  setInvocation(
    id,
    "cancelled",
    reason
      ? {
          metadata: {
            ...invocation(id).metadata,
            cancelReason: String(reason),
          },
        }
      : {},
  );
export const getShokInvocationV2 = (id) =>
  _si.has(id) ? clone(_si.get(id)) : null;
export const listShokInvocationsV2 = () => [..._si.values()].map(clone);
export function autoDisableIdleShokProfilesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _sp.values())
    if (p.status === "active" && now - p.lastTouchedAt >= _idleMs) {
      p.status = "disabled";
      p.updatedAt = now;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckShokInvocationsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const i of _si.values())
    if (i.status === "running" && now - i.startedAt >= _stuckMs) {
      i.status = "failed";
      i.updatedAt = i.settledAt = now;
      i.metadata.failReason = "auto-fail-stuck";
      flipped.push(i.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionHooksGovStatsV2() {
  const profilesByStatus = Object.fromEntries(
    Object.values(SHOK_PROFILE_MATURITY_V2).map((x) => [x, 0]),
  );
  const invocationsByStatus = Object.fromEntries(
    Object.values(SHOK_INVOCATION_LIFECYCLE_V2).map((x) => [x, 0]),
  );
  for (const p of _sp.values()) profilesByStatus[p.status]++;
  for (const i of _si.values()) invocationsByStatus[i.status]++;
  return {
    totalShokProfilesV2: _sp.size,
    totalShokInvocationsV2: _si.size,
    maxActiveShokProfilesPerOwner: _maxActive,
    maxPendingShokInvocationsPerProfile: _maxPending,
    shokProfileIdleMs: _idleMs,
    shokInvocationStuckMs: _stuckMs,
    profilesByStatus,
    invocationsByStatus,
  };
}
