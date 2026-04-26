/**
 * AI Chat Quick Store
 * Thin wrapper over `llm:check-status` + `llm:get-config` IPC for the V6
 * shell quick panel. Read-only "current LLM availability + provider/model"
 * surface — full chat session, streaming, history, multi-provider switch
 * live in /ai/chat (AIChatPage) and the heavy useLlmStore (`llm.ts`).
 *
 * Note: llm:check-status is graceful (always returns {available, error});
 * llm:get-config throws on uninit, so caught and surfaced via error ref.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface LLMStatus {
  available: boolean;
  error?: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
}

export interface LLMConfigSummary {
  provider?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useAIChatStore = defineStore("aiChat", () => {
  const status = ref<LLMStatus | null>(null);
  const config = ref<LLMConfigSummary | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const isAvailable = computed(() => status.value?.available === true);
  const providerLabel = computed(() => {
    const p = config.value?.provider ?? status.value?.provider;
    const m = config.value?.model ?? status.value?.model;
    if (!p) return "未配置";
    return m ? `${p} (${m})` : p;
  });

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const s = (await api()?.invoke("llm:check-status")) as
        | LLMStatus
        | null
        | undefined;
      status.value = s ?? { available: false, error: "无返回" };
      try {
        const c = (await api()?.invoke("llm:get-config")) as
          | LLMConfigSummary
          | null
          | undefined;
        config.value = c ?? null;
      } catch {
        config.value = null;
      }
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    status,
    config,
    loading,
    error,
    hasLoaded,
    isAvailable,
    providerLabel,
    loadAll,
    clearError,
  };
});
