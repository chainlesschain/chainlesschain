/**
 * LLM Performance Store — V6 thin store for the LLM cost/performance dashboard
 * (usage stats / budget / cache / cost breakdown / alerts + maintenance).
 *
 * V5→V6 port of pages/LLMPerformancePage.vue. Wraps the `llm:*` IPC surface
 * (main/llm/llm-ipc-token.js / -alert.js / -test-data.js) via the generic
 * `window.electronAPI.invoke` bridge.
 *
 * IMPORTANT shape asymmetry (matches the V5 page):
 *  - the `llm:get-*` LOADERS return their payload DIRECTLY (no {success,data}).
 *  - the action channels (clear-cache / export / clear-alert-history /
 *    dismiss-alert / generate-test-data) return {success, ...}.
 *
 * The {startDate,endDate} window is passed in by the caller (panel owns the
 * clock via dateRangeFromDays) so this store stays deterministic / testable.
 */

import { defineStore } from "pinia";
import { logger } from "@/utils/logger";
import type { DateRange } from "../shell/helpers/llmPerformanceHelpers";

interface ElectronInvokeAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function getInvoke(): ElectronInvokeAPI["invoke"] | null {
  const api = (window as unknown as { electronAPI?: ElectronInvokeAPI })
    .electronAPI;
  return typeof api?.invoke === "function" ? api.invoke.bind(api) : null;
}

// ===== Types =====

export interface LlmUsageStats {
  totalCalls?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  totalCostCny?: number;
  cachedCalls?: number;
  compressedCalls?: number;
  cacheHitRate?: number;
  avgResponseTime?: number;
  [key: string]: unknown;
}

export interface LlmBudget {
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  dailySpend?: number;
  weeklySpend?: number;
  monthlySpend?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  [key: string]: unknown;
}

export interface LlmCacheStats {
  totalEntries?: number;
  expiredEntries?: number;
  totalHits?: number;
  totalTokensSaved?: number;
  totalCostSaved?: number;
  avgHitsPerEntry?: number;
  hitRate?: number;
  [key: string]: unknown;
}

export interface BreakdownRow {
  name?: string;
  provider?: string;
  model?: string;
  cost?: number;
  calls?: number;
  tokens?: number;
  [key: string]: unknown;
}

export interface LlmCostBreakdown {
  byProvider: BreakdownRow[];
  byModel: BreakdownRow[];
}

export interface LlmAlert {
  id?: string;
  level?: string;
  message?: string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  clearedCount?: number;
}

interface LlmPerformanceState {
  stats: LlmUsageStats;
  costBreakdown: LlmCostBreakdown;
  cacheStats: LlmCacheStats;
  budget: LlmBudget;
  alertHistory: LlmAlert[];
  loading: boolean;
  lastError: string | null;
}

const EMPTY_STATS: LlmUsageStats = {
  totalCalls: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  totalCostCny: 0,
  cacheHitRate: 0,
  avgResponseTime: 0,
};

const EMPTY_BUDGET: LlmBudget = {
  dailyLimit: 0,
  weeklyLimit: 0,
  monthlyLimit: 0,
  dailySpend: 0,
  weeklySpend: 0,
  monthlySpend: 0,
  warningThreshold: 80,
  criticalThreshold: 95,
};

export const useLlmPerformanceStore = defineStore("llmPerformance", {
  state: (): LlmPerformanceState => ({
    stats: { ...EMPTY_STATS },
    costBreakdown: { byProvider: [], byModel: [] },
    cacheStats: {},
    budget: { ...EMPTY_BUDGET },
    alertHistory: [],
    loading: false,
    lastError: null,
  }),

  actions: {
    async loadStats(range: DateRange): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke("llm:get-usage-stats", range)) as
          | LlmUsageStats
          | null
          | undefined;
        if (r) {
          this.stats = r; // loaders return data directly
        }
      } catch (err) {
        this._recordError("loadStats", err);
      }
    },

    async loadCostBreakdown(range: DateRange): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke("llm:get-cost-breakdown", range)) as
          | LlmCostBreakdown
          | null
          | undefined;
        if (r) {
          this.costBreakdown = {
            byProvider: Array.isArray(r.byProvider) ? r.byProvider : [],
            byModel: Array.isArray(r.byModel) ? r.byModel : [],
          };
        }
      } catch (err) {
        this._recordError("loadCostBreakdown", err);
      }
    },

    async loadCacheStats(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke("llm:get-cache-stats")) as
          | LlmCacheStats
          | null
          | undefined;
        if (r) {
          this.cacheStats = r;
        }
      } catch (err) {
        this._recordError("loadCacheStats", err);
      }
    },

    async loadBudget(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke("llm:get-budget")) as
          | LlmBudget
          | null
          | undefined;
        if (r) {
          this.budget = r;
        }
      } catch (err) {
        this._recordError("loadBudget", err);
      }
    },

    async loadAlertHistory(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke("llm:get-alert-history")) as
          | LlmAlert[]
          | null
          | undefined;
        if (Array.isArray(r)) {
          this.alertHistory = r;
        }
      } catch (err) {
        this._recordError("loadAlertHistory", err);
      }
    },

    /** Fan-out refresh — one failed channel must not block the others. */
    async refreshAll(range: DateRange): Promise<void> {
      this.loading = true;
      this.lastError = null;
      try {
        await Promise.allSettled([
          this.loadStats(range),
          this.loadCostBreakdown(range),
          this.loadCacheStats(),
          this.loadBudget(),
          this.loadAlertHistory(),
        ]);
      } finally {
        this.loading = false;
      }
    },

    async clearCache(expiredOnly = true): Promise<ActionResult> {
      const res = await this._mutate("llm:clear-cache", { expiredOnly });
      if (res.success) {
        await this.loadCacheStats();
      }
      return res;
    },

    async exportCostReport(
      options: Record<string, unknown>,
    ): Promise<ActionResult> {
      return this._mutate("llm:export-cost-report", options);
    },

    async clearAlertHistory(): Promise<ActionResult> {
      const res = await this._mutate("llm:clear-alert-history");
      if (res.success) {
        await this.loadAlertHistory();
      }
      return res;
    },

    async dismissAlert(alertId: string): Promise<ActionResult> {
      const res = await this._mutate("llm:dismiss-alert", alertId);
      if (res.success) {
        await this.loadAlertHistory();
      }
      return res;
    },

    async generateTestData(
      options: Record<string, unknown>,
    ): Promise<ActionResult> {
      return this._mutate("llm:generate-test-data", options);
    },

    /** Shared mutation runner: invoke → normalize → never throw. */
    async _mutate(channel: string, ...args: unknown[]): Promise<ActionResult> {
      const invoke = getInvoke();
      if (!invoke) {
        return { success: false, error: "IPC 不可用" };
      }
      try {
        const r = (await invoke(channel, ...args)) as
          | { success?: boolean; error?: string; clearedCount?: number }
          | null
          | undefined;
        if (r?.success) {
          return { success: true, clearedCount: r.clearedCount };
        }
        return { success: false, error: r?.error ?? "操作失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[llmPerformance] ${channel} failed:`, err);
        return { success: false, error: msg };
      }
    },

    _recordError(label: string, err: unknown): void {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.error(`[llmPerformance] ${label} failed:`, err);
    },
  },
});
