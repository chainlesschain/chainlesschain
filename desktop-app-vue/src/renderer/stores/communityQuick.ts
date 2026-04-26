/**
 * Community Quick Store
 * Thin wrapper over `community:get-list` IPC for the V6 shell quick panel.
 * Read-only "joined / browsable communities" surface — full CRUD,
 * channels, members, proposals live in the V5 useCommunityStore
 * (`community.ts`) and are not re-exposed here.
 *
 * Note: community:get-list is graceful (returns [] when manager not
 * initialised or on error), so error tracking is purely defensive.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface CommunitySummary {
  id: string;
  name?: string;
  description?: string;
  memberCount?: number;
  visibility?: "public" | "private" | string;
  isJoined?: boolean;
  createdAt?: string | number;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

const RECENT_LIMIT = 5;

export const useCommunityQuickStore = defineStore("communityQuick", () => {
  const communities = ref<CommunitySummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const recent = computed(() => communities.value.slice(0, RECENT_LIMIT));
  const joinedCount = computed(
    () => communities.value.filter((c) => c.isJoined).length,
  );

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const list = (await api()?.invoke("community:get-list", {
        limit: 50,
      })) as CommunitySummary[] | null | undefined;
      communities.value = Array.isArray(list) ? list : [];
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
    communities,
    loading,
    error,
    hasLoaded,
    recent,
    joinedCount,
    loadAll,
    clearError,
  };
});
