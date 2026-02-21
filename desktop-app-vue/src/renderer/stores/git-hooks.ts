/**
 * Git Hooks Store
 * Manages git hook configuration, execution results, and history.
 * @version 1.1.0
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface GitHookConfig {
  preCommitEnabled: boolean;
  impactAnalysisEnabled: boolean;
  autoFixEnabled: boolean;
  maxAutoFixRetries: number;
  preCommitSkills: string[];
  impactSkills: string[];
  autoFixSkills: string[];
}

interface PreCommitResult {
  passed: boolean;
  issues: Array<{
    source: string;
    severity: string;
    message?: string;
    file?: string;
    line?: number;
  }>;
  autoFixes: any[];
  duration: number;
  steps: any[];
}

interface ImpactResult {
  affectedFiles: string[];
  suggestedTests: string[];
  riskScore: number;
  duration: number;
}

interface AutoFixResult {
  fixed: string[];
  remaining: string[];
  patchFiles: string[];
  duration: number;
}

interface HistoryEntry {
  type: string;
  timestamp: number;
  result: any;
}

export const useGitHooksStore = defineStore('git-hooks', () => {
  // State
  const config = ref<GitHookConfig | null>(null);
  const history = ref<HistoryEntry[]>([]);
  const stats = ref<Record<string, any>>({});
  const preCommitResults = ref<PreCommitResult | null>(null);
  const impactResults = ref<ImpactResult | null>(null);
  const autoFixResults = ref<AutoFixResult | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const isPreCommitEnabled = computed(() => config.value?.preCommitEnabled ?? false);
  const lastResult = computed(() => history.value[history.value.length - 1] || null);

  // Actions
  async function runPreCommit(files: string[], options: Record<string, any> = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('git-hooks:run-pre-commit', { files, options });
      if (result?.success) {
        preCommitResults.value = result.data;
        return result.data;
      }
      throw new Error(result?.error || 'Pre-commit failed');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function runImpactAnalysis(files: string[]) {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('git-hooks:run-impact', { files });
      if (result?.success) {
        impactResults.value = result.data;
        return result.data;
      }
      throw new Error(result?.error || 'Impact analysis failed');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function runAutoFix(failures: string[], options: Record<string, any> = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('git-hooks:run-auto-fix', { failures, options });
      if (result?.success) {
        autoFixResults.value = result.data;
        return result.data;
      }
      throw new Error(result?.error || 'Auto-fix failed');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function loadConfig() {
    try {
      const result = await window.electronAPI?.invoke('git-hooks:get-config');
      if (result?.success) {
        config.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function updateConfig(updates: Partial<GitHookConfig>) {
    try {
      const result = await window.electronAPI?.invoke('git-hooks:set-config', updates);
      if (result?.success) {
        config.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function loadHistory(limit = 20) {
    try {
      const result = await window.electronAPI?.invoke('git-hooks:get-history', limit);
      if (result?.success) {
        history.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function loadStats() {
    try {
      const result = await window.electronAPI?.invoke('git-hooks:get-stats');
      if (result?.success) {
        stats.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  return {
    config,
    history,
    stats,
    preCommitResults,
    impactResults,
    autoFixResults,
    loading,
    error,
    isPreCommitEnabled,
    lastResult,
    runPreCommit,
    runImpactAnalysis,
    runAutoFix,
    loadConfig,
    updateConfig,
    loadHistory,
    loadStats,
  };
});
