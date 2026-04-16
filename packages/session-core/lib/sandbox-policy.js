/**
 * Sandbox Policy — 92_Deep_Agents_Deploy 借鉴落地方案 Phase 4
 *
 * 把 sandbox 的"作用域"和"生命周期"从各执行器抽出，统一为 schema:
 *
 *   {
 *     scope: "thread" | "assistant",
 *     ttlMs: number|null,           // sandbox 创建后可存活的最长时间
 *     idleTtlMs: number|null,       // 连续 idle 多久后回收
 *     maxRunMs: number|null,        // 单次 run 的最长执行时间
 *     maxFileBytes: number|null,    // 工作区累积写入字节上限
 *     maxProcessCount: number|null, // 同时运行子进程上限
 *     cleanupOnExit: boolean,       // session/run 结束时清理
 *     reuseAcrossRuns: boolean      // 同一 agent 的多次 run 是否复用 sandbox
 *   }
 *
 * 语义:
 *   - thread:    短任务，default ttl=15min, run 结束后清理
 *   - assistant: 长 workspace，default ttl=24h, 多次 run 复用，idle 超时回收
 *
 * 该模块是纯 spec/纯函数，不持有 sandbox 实例。
 * 真正创建/销毁 sandbox 由 desktop `agent-sandbox-v2` 或 cli runtime 完成，
 * 它们在挂载 bundle 时通过 mergeSandboxPolicy 拿到 effective policy。
 */

const SCOPES = Object.freeze({
  THREAD: "thread",
  ASSISTANT: "assistant",
});

const VALID_SCOPES = new Set(Object.values(SCOPES));

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// scope-specific defaults; merged into user policy via mergeSandboxPolicy.
const SCOPE_DEFAULTS = Object.freeze({
  [SCOPES.THREAD]: Object.freeze({
    scope: SCOPES.THREAD,
    ttlMs: 15 * MS_PER_MINUTE,
    idleTtlMs: 5 * MS_PER_MINUTE,
    maxRunMs: 5 * MS_PER_MINUTE,
    maxFileBytes: 50 * 1024 * 1024, // 50 MiB
    maxProcessCount: 4,
    cleanupOnExit: true,
    reuseAcrossRuns: false,
  }),
  [SCOPES.ASSISTANT]: Object.freeze({
    scope: SCOPES.ASSISTANT,
    ttlMs: 24 * MS_PER_HOUR,
    idleTtlMs: 60 * MS_PER_MINUTE,
    maxRunMs: 30 * MS_PER_MINUTE,
    maxFileBytes: 500 * 1024 * 1024, // 500 MiB
    maxProcessCount: 8,
    cleanupOnExit: false,
    reuseAcrossRuns: true,
  }),
});

const DEFAULT_SANDBOX_POLICY = SCOPE_DEFAULTS[SCOPES.THREAD];

function isPositiveIntegerOrNull(v) {
  if (v === null || v === undefined) return true;
  return Number.isInteger(v) && v >= 0;
}

/**
 * validateSandboxPolicy(policy) → string[]
 * 返回 errors 列表; 空数组表示通过.
 */
function validateSandboxPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object") {
    return ["sandbox policy must be an object"];
  }
  if (policy.scope !== undefined && !VALID_SCOPES.has(policy.scope)) {
    errors.push(
      `sandbox.scope must be one of ${Array.from(VALID_SCOPES).join(", ")}`,
    );
  }
  for (const k of [
    "ttlMs",
    "idleTtlMs",
    "maxRunMs",
    "maxFileBytes",
    "maxProcessCount",
  ]) {
    if (k in policy && !isPositiveIntegerOrNull(policy[k])) {
      errors.push(`sandbox.${k} must be a non-negative integer or null`);
    }
  }
  for (const k of ["cleanupOnExit", "reuseAcrossRuns"]) {
    if (k in policy && typeof policy[k] !== "boolean") {
      errors.push(`sandbox.${k} must be a boolean`);
    }
  }
  return errors;
}

/**
 * mergeSandboxPolicy(base, override) → policy
 *
 * 优先级: override > scope defaults > thread defaults.
 * - 若 override.scope 提供，按 SCOPE_DEFAULTS 重置 base 的 scope 默认
 * - undefined 字段不覆盖（null 是显式清除 → 覆盖）
 */
function mergeSandboxPolicy(base = {}, override = {}) {
  const scope =
    override.scope || base.scope || DEFAULT_SANDBOX_POLICY.scope;
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`invalid sandbox scope "${scope}"`);
  }
  const scopeBase = SCOPE_DEFAULTS[scope];
  // base may itself omit fields, so layer scopeBase first, then base, then override
  const merged = { ...scopeBase };
  for (const src of [base, override]) {
    if (!src || typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      if (src[k] !== undefined) merged[k] = src[k];
    }
  }
  merged.scope = scope;
  return merged;
}

/**
 * isSandboxExpired(policy, createdAt, now)
 * 基于 ttlMs 判断是否超出生命周期
 */
function isSandboxExpired(policy, createdAt, now = Date.now()) {
  if (!policy || policy.ttlMs === null || policy.ttlMs === undefined) {
    return false;
  }
  return now - Number(createdAt) >= Number(policy.ttlMs);
}

/**
 * isSandboxIdleExpired(policy, lastUsedAt, now)
 * 基于 idleTtlMs 判断 idle 是否超时
 */
function isSandboxIdleExpired(policy, lastUsedAt, now = Date.now()) {
  if (!policy || policy.idleTtlMs === null || policy.idleTtlMs === undefined) {
    return false;
  }
  return now - Number(lastUsedAt) >= Number(policy.idleTtlMs);
}

/**
 * shouldReuseSandbox(policy, sandboxState, now)
 *   sandboxState: { createdAt, lastUsedAt }
 * 返回 true 表示可以挂回当前 sandbox，false 表示需要销毁重建.
 */
function shouldReuseSandbox(policy, sandboxState, now = Date.now()) {
  if (!policy || !policy.reuseAcrossRuns) return false;
  if (!sandboxState) return false;
  if (isSandboxExpired(policy, sandboxState.createdAt, now)) return false;
  if (isSandboxIdleExpired(policy, sandboxState.lastUsedAt, now)) return false;
  return true;
}

/**
 * resolveBundleSandboxPolicy(bundle) → policy
 *
 * 按以下顺序解析 effective sandbox policy:
 *   1. bundle.sandboxPolicy (policies/sandbox.json)
 *   2. bundle.manifest.sandbox (字符串 scope name)
 *   3. thread defaults
 *
 * 不抛错 — 把 manifest 中的非法 scope 当成 thread.
 */
function resolveBundleSandboxPolicy(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return { ...DEFAULT_SANDBOX_POLICY };
  }
  const manifestScope = bundle.manifest?.sandbox;
  const base =
    manifestScope && VALID_SCOPES.has(manifestScope)
      ? { scope: manifestScope }
      : {};
  return mergeSandboxPolicy(base, bundle.sandboxPolicy || {});
}

module.exports = {
  SCOPES,
  VALID_SCOPES,
  SCOPE_DEFAULTS,
  DEFAULT_SANDBOX_POLICY,
  validateSandboxPolicy,
  mergeSandboxPolicy,
  isSandboxExpired,
  isSandboxIdleExpired,
  shouldReuseSandbox,
  resolveBundleSandboxPolicy,
};
