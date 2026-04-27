/**
 * Community Quick Store
 * Wraps the community:* / channel:* / governance:* / moderation:* IPC
 * channels exposed by src/main/social/community-ipc.js. Phase 2 of the
 * V6 page port — covers list + join/leave/delete with per-action loading
 * flags. Create wizard / details drawer / channel messaging / governance
 * / moderation flows land in Phase 3-6.
 *
 * V5 page (`pages/CommunityPage.vue`) keeps using its own
 * `useCommunityStore` from `community.ts`; this store is V6-only.
 * @version 1.1.0
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

  const joiningId = ref<string | null>(null);
  const leavingId = ref<string | null>(null);
  const deletingId = ref<string | null>(null);

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

  async function joinCommunity(id: string): Promise<boolean> {
    error.value = null;
    joiningId.value = id;
    try {
      await api()?.invoke("community:join", id);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      joiningId.value = null;
    }
  }

  async function leaveCommunity(id: string): Promise<boolean> {
    error.value = null;
    leavingId.value = id;
    try {
      await api()?.invoke("community:leave", id);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      leavingId.value = null;
    }
  }

  async function deleteCommunity(id: string): Promise<boolean> {
    error.value = null;
    deletingId.value = id;
    try {
      await api()?.invoke("community:delete", id);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      deletingId.value = null;
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
    joiningId,
    leavingId,
    deletingId,
    recent,
    joinedCount,
    loadAll,
    joinCommunity,
    leaveCommunity,
    deleteCommunity,
    clearError,
  };
});
