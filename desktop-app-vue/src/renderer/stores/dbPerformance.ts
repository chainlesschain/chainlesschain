/**
 * Database Performance Store — V6 thin store for the DB performance dashboard
 * (stats / slow queries / index suggestions + maintenance actions).
 *
 * V5→V6 port of pages/DatabasePerformancePage.vue. Wraps the `db-performance:*`
 * IPC surface (registered in main/database/database-performance-ipc.js) through
 * the generic `window.electronAPI.invoke` bridge — same pattern as
 * stores/memoryBank.ts. Every IPC reply is `{ success, data?, error? }`.
 */

import { defineStore } from "pinia";
import { logger } from "@/utils/logger";
import type { DbStats } from "../shell/helpers/dbPerformanceHelpers";

// ===== IPC accessor (window.electronAPI.invoke) =====

interface ElectronInvokeAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function getInvoke(): ElectronInvokeAPI["invoke"] | null {
  const api = (window as unknown as { electronAPI?: ElectronInvokeAPI })
    .electronAPI;
  return typeof api?.invoke === "function" ? api.invoke.bind(api) : null;
}

interface IpcReply<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

// ===== Types =====

export interface SlowQuery {
  sql?: string;
  duration?: number;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface IndexSuggestion {
  table?: string;
  column?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

interface DbPerformanceState {
  stats: DbStats;
  slowQueries: SlowQuery[];
  indexSuggestions: IndexSuggestion[];
  loading: boolean;
  lastError: string | null;
}

const EMPTY_STATS: DbStats = {
  totalQueries: 0,
  avgQueryTime: 0,
  slowQueries: 0,
  cache: {
    size: 0,
    maxSize: 0,
    hitRate: "0%",
    hits: 0,
    misses: 0,
    evictions: 0,
  },
};

export const useDbPerformanceStore = defineStore("dbPerformance", {
  state: (): DbPerformanceState => ({
    stats: { ...EMPTY_STATS },
    slowQueries: [],
    indexSuggestions: [],
    loading: false,
    lastError: null,
  }),

  actions: {
    async loadStats(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke(
          "db-performance:get-stats",
        )) as IpcReply<DbStats>;
        if (r?.success && r.data) {
          this.stats = r.data;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.error("[dbPerformance] loadStats failed:", err);
      }
    },

    async loadSlowQueries(limit = 20): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke(
          "db-performance:get-slow-queries",
          limit,
        )) as IpcReply<SlowQuery[]>;
        if (r?.success && Array.isArray(r.data)) {
          this.slowQueries = r.data;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.error("[dbPerformance] loadSlowQueries failed:", err);
      }
    },

    async loadIndexSuggestions(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const r = (await invoke(
          "db-performance:get-index-suggestions",
        )) as IpcReply<IndexSuggestion[]>;
        if (r?.success && Array.isArray(r.data)) {
          this.indexSuggestions = r.data;
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.error("[dbPerformance] loadIndexSuggestions failed:", err);
      }
    },

    /**
     * Fan-out refresh — one failed channel must not block the others, so we use
     * allSettled (mirrors the memoryBank store).
     */
    async refreshAll(): Promise<void> {
      this.loading = true;
      this.lastError = null;
      try {
        await Promise.allSettled([
          this.loadStats(),
          this.loadSlowQueries(),
          this.loadIndexSuggestions(),
        ]);
      } finally {
        this.loading = false;
      }
    },

    async resetStats(): Promise<ActionResult> {
      return this._mutate("db-performance:reset-stats");
    },

    async clearCache(): Promise<ActionResult> {
      return this._mutate("db-performance:clear-cache");
    },

    async optimize(): Promise<ActionResult> {
      return this._mutate("db-performance:optimize");
    },

    async applyIndexSuggestion(
      suggestion: IndexSuggestion,
    ): Promise<ActionResult> {
      return this._mutate("db-performance:apply-index-suggestion", suggestion);
    },

    async applyAllIndexSuggestions(): Promise<ActionResult> {
      return this._mutate("db-performance:apply-all-index-suggestions");
    },

    /** Shared mutation runner: invoke → normalize → never throw. */
    async _mutate(channel: string, ...args: unknown[]): Promise<ActionResult> {
      const invoke = getInvoke();
      if (!invoke) {
        return { success: false, error: "IPC 不可用" };
      }
      try {
        const r = (await invoke(channel, ...args)) as IpcReply<unknown>;
        if (r?.success) {
          return { success: true };
        }
        return { success: false, error: r?.error ?? "操作失败" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[dbPerformance] ${channel} failed:`, err);
        return { success: false, error: msg };
      }
    },
  },
});
