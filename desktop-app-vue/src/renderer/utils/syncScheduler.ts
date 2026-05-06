/**
 * 同步调度器（renderer 端）— Phase 3b: provider-aware
 *
 * 取代之前直接调 sync.incremental 的硬编码：现在 runOnce() 遍历所有
 * enabled providers（顺序见 syncProviders/index.ts）串行跑各自的 runOnce。
 *
 * 持久化 (localStorage)：
 *   - cc.sync.autoSync               全局自动同步开关 (boolean)
 *   - cc.sync.intervalMin            自动同步间隔分钟数 (1..1440)
 *   - cc.sync.providers.<id>.enabled 单 provider 启用 (boolean，默认 false)
 *
 * Edge cases：
 *   - electronAPI 未挂 → 单个 provider 返回 success:false，整体不挂
 *   - tick 失败不弹 message（避免每分钟弹一次），仅 logger.warn
 *   - 没有任何 provider 启用：runOnce 返回 success:true + skipped:true
 */

import { logger } from "@/utils/logger";
import { PROVIDERS, getProvider } from "./syncProviders";
import type { SyncProviderResult } from "./syncProviders";

const STORAGE_KEYS = {
  enabled: "cc.sync.autoSync",
  intervalMin: "cc.sync.intervalMin",
  providerEnabledPrefix: "cc.sync.providers.",
} as const;

const DEFAULT_INTERVAL_MIN = 5;
const MIN_INTERVAL_MIN = 1;
const MAX_INTERVAL_MIN = 60 * 24;

export interface PerProviderResult {
  providerId: string;
  result: SyncProviderResult;
  durationMs: number;
}

export interface AggregateResult {
  success: boolean;
  /** True if no provider was enabled (informational, not an error). */
  skipped?: boolean;
  /** Number of providers that ran (after available()/enabled gate). */
  ran: number;
  /** Number of providers that succeeded. */
  succeeded: number;
  perProvider: PerProviderResult[];
  /** First error message for surface in toasts. */
  error?: string;
}

export interface SyncSchedulerState {
  enabled: boolean;
  intervalMin: number;
  running: boolean;
  lastTickAt: number | null;
  lastResult: AggregateResult | null;
}

let timerId: ReturnType<typeof setInterval> | null = null;
let lastTickAt: number | null = null;
let lastResult: AggregateResult | null = null;

// ── localStorage helpers ─────────────────────────────────────────

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage?.getItem(key);
    if (v === null || v === undefined) {
      return fallback;
    }
    return v === "true" || v === "1";
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage?.setItem(key, value ? "true" : "false");
  } catch {
    /* localStorage 不可用 → 忽略，状态在内存里也能撑过这个 session */
  }
}

function readInt(key: string, fallback: number): number {
  try {
    const v = window.localStorage?.getItem(key);
    if (v === null || v === undefined) {
      return fallback;
    }
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function clampInterval(min: number): number {
  if (!Number.isFinite(min)) {
    return DEFAULT_INTERVAL_MIN;
  }
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, min));
}

// ── public API ───────────────────────────────────────────────────

export function getEnabled(): boolean {
  return readBoolean(STORAGE_KEYS.enabled, false);
}

export function getIntervalMin(): number {
  return clampInterval(readInt(STORAGE_KEYS.intervalMin, DEFAULT_INTERVAL_MIN));
}

export function setIntervalMin(min: number): void {
  const clamped = clampInterval(min);
  try {
    window.localStorage?.setItem(STORAGE_KEYS.intervalMin, String(clamped));
  } catch {
    /* ignored */
  }
  if (timerId !== null) {
    // 重启以应用新间隔
    start(clamped);
  }
}

export function isProviderEnabled(providerId: string): boolean {
  return readBoolean(STORAGE_KEYS.providerEnabledPrefix + providerId, false);
}

export function setProviderEnabled(providerId: string, enabled: boolean): void {
  writeBoolean(STORAGE_KEYS.providerEnabledPrefix + providerId, enabled);
}

export function getEnabledProviderIds(): string[] {
  return PROVIDERS.filter((p) => isProviderEnabled(p.id)).map((p) => p.id);
}

export function getState(): SyncSchedulerState {
  return {
    enabled: getEnabled(),
    intervalMin: getIntervalMin(),
    running: timerId !== null,
    lastTickAt,
    lastResult,
  };
}

/**
 * 单个 provider 一次性手动触发（Settings 页"立即同步"按钮）。
 */
export async function runProviderOnce(
  providerId: string,
): Promise<SyncProviderResult> {
  const provider = getProvider(providerId);
  if (!provider) {
    return { success: false, error: "未知 provider: " + providerId };
  }
  try {
    const available = await provider.available();
    if (!available) {
      return { success: false, error: "provider 当前不可用" };
    }
    return await provider.runOnce();
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * 跑一遍所有 enabled providers（串行，跳过 unavailable）。
 *
 * @param force 若为 true，忽略 enabled flag，跑所有 available 的 provider
 *              （托盘"立即同步"用 force=false，仅同步用户启用的；如果用户
 *              没勾任何 provider，会得到 skipped 反馈）
 */
export async function runOnce(force = false): Promise<AggregateResult> {
  const eligible = [];
  for (const p of PROVIDERS) {
    if (!force && !isProviderEnabled(p.id)) {
      continue;
    }
    const ok = await p.available();
    if (!ok) {
      continue;
    }
    eligible.push(p);
  }

  if (eligible.length === 0) {
    const result: AggregateResult = {
      success: true,
      skipped: true,
      ran: 0,
      succeeded: 0,
      perProvider: [],
    };
    lastResult = result;
    lastTickAt = Date.now();
    return result;
  }

  const perProvider: PerProviderResult[] = [];
  for (const p of eligible) {
    const t0 = Date.now();
    let res: SyncProviderResult;
    try {
      res = await p.runOnce();
    } catch (err: any) {
      res = { success: false, error: err?.message || String(err) };
    }
    perProvider.push({
      providerId: p.id,
      result: res,
      durationMs: Date.now() - t0,
    });
  }

  const succeeded = perProvider.filter((x) => x.result.success).length;
  const firstError = perProvider.find((x) => !x.result.success)?.result.error;
  const result: AggregateResult = {
    success: succeeded === perProvider.length,
    ran: perProvider.length,
    succeeded,
    perProvider,
    error: firstError,
  };
  lastResult = result;
  lastTickAt = Date.now();
  return result;
}

export function start(intervalMin?: number): void {
  stop();
  const interval = clampInterval(
    typeof intervalMin === "number" ? intervalMin : getIntervalMin(),
  );
  writeBoolean(STORAGE_KEYS.enabled, true);
  try {
    window.localStorage?.setItem(STORAGE_KEYS.intervalMin, String(interval));
  } catch {
    /* ignored */
  }
  timerId = setInterval(
    () => {
      runOnce().then((res) => {
        if (!res.success) {
          logger.warn("[syncScheduler] tick 失败:", res.error);
        } else if (res.skipped) {
          logger.debug("[syncScheduler] tick skipped (no provider enabled)");
        }
      });
    },
    interval * 60 * 1000,
  );
  logger.info(`[syncScheduler] started, every ${interval} min`);
}

export function stop(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  writeBoolean(STORAGE_KEYS.enabled, false);
  logger.info("[syncScheduler] stopped");
}

export function bootstrapFromPersisted(): void {
  if (getEnabled()) {
    start(getIntervalMin());
  }
}

/** 测试钩子：清掉计时器 + 状态，不动 localStorage。 */
export function _resetForTest(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  lastTickAt = null;
  lastResult = null;
}
