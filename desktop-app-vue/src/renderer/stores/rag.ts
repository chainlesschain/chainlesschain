/**
 * RAG Store
 * Thin wrapper over the rag:* IPC channels (src/main/rag/rag-ipc.js).
 * Exposes the read/rebuild operations needed by the shell quick panel;
 * query/retrieve/rerank flows stay in the /knowledge/graph page.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export interface RagStats {
  totalDocuments?: number;
  totalChunks?: number;
  indexSize?: number;
  lastRebuiltAt?: number | null;
  [key: string]: unknown;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

interface ElectronApi {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useRagStore = defineStore("rag", () => {
  const stats = ref<RagStats | null>(null);
  const loading = ref(false);
  const rebuilding = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  async function loadStats(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = (await api()?.invoke<Envelope<RagStats>>(
        "rag:get-stats",
      )) ?? { success: false };
      if (result.success) {
        stats.value = result.data ?? {};
        hasLoaded.value = true;
      } else if (result.error) {
        error.value = result.error;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function rebuildIndex(): Promise<boolean> {
    rebuilding.value = true;
    error.value = null;
    try {
      const result = (await api()?.invoke<Envelope<unknown>>(
        "rag:rebuild-index",
      )) ?? { success: false };
      if (result.success) {
        await loadStats();
        return true;
      }
      error.value = result.error ?? "重建 RAG 索引失败";
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      rebuilding.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    stats,
    loading,
    rebuilding,
    error,
    hasLoaded,
    loadStats,
    rebuildIndex,
    clearError,
  };
});
