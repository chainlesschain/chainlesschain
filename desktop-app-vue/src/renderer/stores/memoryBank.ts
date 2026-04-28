/**
 * Memory Bank Store — V6 thin store for the Memory Bank dashboard
 * (AI learning patterns / preferences / sessions / behavior insights /
 *  storage stats / auto-summary).
 *
 * Distinct from `stores/memory.ts` which manages daily-notes & search.
 * This store wraps `memory:*` IPC for the V5→V6 dashboard port.
 */

import { defineStore } from "pinia";
import { logger } from "@/utils/logger";

// ===== IPC accessor (window.electronAPI.invoke) =====

interface ElectronInvokeAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function getInvoke(): ElectronInvokeAPI["invoke"] | null {
  const api = (window as unknown as { electronAPI?: ElectronInvokeAPI })
    .electronAPI;
  return typeof api?.invoke === "function" ? api.invoke.bind(api) : null;
}

// ===== Types =====

export interface PromptPattern {
  id?: string;
  category?: string;
  template?: string;
  use_count?: number;
  [key: string]: unknown;
}

export interface ErrorFixPattern {
  id?: string;
  error_classification?: string;
  fix_strategy?: string;
  success_count?: number;
  failure_count?: number;
  [key: string]: unknown;
}

export interface CodeSnippet {
  id?: string;
  name?: string;
  language?: string;
  description?: string;
  code?: string;
  [key: string]: unknown;
}

export interface WorkflowPattern {
  id?: string;
  name?: string;
  steps?: unknown[];
  execution_count?: number;
  [key: string]: unknown;
}

export interface UserPreference {
  category?: string;
  key?: string;
  value?: unknown;
  updated_at?: number | string;
  [key: string]: unknown;
}

export interface RecentSession {
  id?: string;
  title?: string;
  messageCount?: number;
  updated_at?: number | string;
  has_summary?: boolean | number;
  [key: string]: unknown;
}

export interface BehaviorRecommendation {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  lastBackup: number | string | null;
}

export interface MemoryBankState {
  // patterns
  promptPatterns: PromptPattern[];
  errorFixPatterns: ErrorFixPattern[];
  codeSnippets: CodeSnippet[];
  workflowPatterns: WorkflowPattern[];

  // preferences / sessions / behavior
  preferences: UserPreference[];
  recentSessions: RecentSession[];
  behaviorInsights: Record<string, unknown>;
  recommendations: BehaviorRecommendation[];

  // storage
  memoryPath: string;
  storageStats: StorageStats;

  // loading flags
  loading: boolean;
  hasLoaded: boolean;
}

// ===== Store =====

export const useMemoryBankStore = defineStore("memoryBank", {
  state: (): MemoryBankState => ({
    promptPatterns: [],
    errorFixPatterns: [],
    codeSnippets: [],
    workflowPatterns: [],
    preferences: [],
    recentSessions: [],
    behaviorInsights: {},
    recommendations: [],
    memoryPath: "",
    storageStats: { totalFiles: 0, totalSize: 0, lastBackup: null },
    loading: false,
    hasLoaded: false,
  }),

  getters: {
    totalPatterns(): number {
      return (
        this.promptPatterns.length +
        this.errorFixPatterns.length +
        this.codeSnippets.length +
        this.workflowPatterns.length
      );
    },
    totalPreferences(): number {
      return this.preferences.length;
    },
    totalSessions(): number {
      return this.recentSessions.length;
    },
    totalInsights(): number {
      return this.recommendations.length;
    },
  },

  actions: {
    async loadPatterns(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const result = (await invoke("memory:get-all-patterns")) as {
          promptPatterns?: PromptPattern[];
          errorFixPatterns?: ErrorFixPattern[];
          codeSnippets?: CodeSnippet[];
          workflowPatterns?: WorkflowPattern[];
        } | null;
        this.promptPatterns = result?.promptPatterns ?? [];
        this.errorFixPatterns = result?.errorFixPatterns ?? [];
        this.codeSnippets = result?.codeSnippets ?? [];
        this.workflowPatterns = result?.workflowPatterns ?? [];
      } catch (error) {
        logger.warn("[MemoryBank] loadPatterns 失败:", error as Error);
      }
    },

    async loadPreferences(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const result = (await invoke("memory:get-all-preferences")) as
          | UserPreference[]
          | null;
        this.preferences = Array.isArray(result) ? result : [];
      } catch (error) {
        logger.warn("[MemoryBank] loadPreferences 失败:", error as Error);
      }
    },

    async loadSessions(limit = 20): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const result = (await invoke("session:get-recent", limit)) as
          | RecentSession[]
          | null;
        this.recentSessions = Array.isArray(result) ? result : [];
      } catch (error) {
        logger.warn("[MemoryBank] loadSessions 失败:", error as Error);
      }
    },

    async loadBehaviorInsights(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const result = (await invoke("memory:get-behavior-insights")) as {
          insights?: Record<string, unknown>;
          recommendations?: BehaviorRecommendation[];
        } | null;
        this.behaviorInsights = result?.insights ?? {};
        this.recommendations = result?.recommendations ?? [];
      } catch (error) {
        logger.warn("[MemoryBank] loadBehaviorInsights 失败:", error as Error);
      }
    },

    async loadStorageStats(): Promise<void> {
      const invoke = getInvoke();
      if (!invoke) {
        return;
      }
      try {
        const result = (await invoke("memory:get-storage-stats")) as {
          memoryPath?: string;
          totalFiles?: number;
          totalSize?: number;
          lastBackup?: number | string | null;
        } | null;
        this.memoryPath = result?.memoryPath ?? "";
        this.storageStats = {
          totalFiles: result?.totalFiles ?? 0,
          totalSize: result?.totalSize ?? 0,
          lastBackup: result?.lastBackup ?? null,
        };
      } catch (error) {
        logger.warn("[MemoryBank] loadStorageStats 失败:", error as Error);
      }
    },

    async refreshAll(): Promise<void> {
      this.loading = true;
      try {
        await Promise.allSettled([
          this.loadPatterns(),
          this.loadPreferences(),
          this.loadSessions(),
          this.loadBehaviorInsights(),
          this.loadStorageStats(),
        ]);
        this.hasLoaded = true;
      } finally {
        this.loading = false;
      }
    },
  },
});
