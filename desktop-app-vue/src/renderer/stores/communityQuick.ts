/**
 * Community Quick Store
 * Wraps the community:* / channel:* / governance:* / moderation:* IPC
 * channels exposed by src/main/social/community-ipc.js. Phase 4 of the
 * V6 page port — adds details drawer + member promote/demote/ban + read-
 * only channel list. Channel messaging lands in Phase 5; governance and
 * moderation in Phase 6.
 *
 * V5 page (`pages/CommunityPage.vue`) keeps using its own
 * `useCommunityStore` from `community.ts`; this store is V6-only.
 *
 * Field shape note: community:get-list returns sqlite snake_case rows
 * (id, name, description, icon_url, rules_md, creator_did, member_limit,
 * member_count, status, created_at, updated_at) joined with the caller's
 * community_members row, surfacing `my_role` ('owner' | 'admin' | 'member').
 * The list is already filtered to the caller's joined communities, so the
 * panel uses my_role presence rather than a synthetic isJoined flag, and
 * "browse / search" for un-joined communities is a separate Phase 4 flow
 * via community:search.
 * @version 1.2.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface CommunitySummary {
  id: string;
  name?: string;
  description?: string;
  icon_url?: string;
  rules_md?: string;
  creator_did?: string;
  member_count?: number;
  member_limit?: number;
  status?: "active" | "archived" | "banned" | string;
  my_role?: "owner" | "admin" | "member" | string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface CreateCommunityInput {
  name: string;
  description?: string;
  iconUrl?: string;
  rulesMd?: string;
  memberLimit?: number;
}

export interface CommunityMember {
  id: string;
  community_id: string;
  member_did: string;
  role: "owner" | "admin" | "moderator" | "member" | string;
  nickname?: string;
  status?: "active" | "banned" | "left" | string;
  joined_at?: number;
  contact_nickname?: string;
  [key: string]: unknown;
}

export interface CommunityChannel {
  id: string;
  community_id: string;
  name: string;
  description?: string;
  type?: "announcement" | "discussion" | "readonly" | "subscription" | string;
  sort_order?: number;
  created_at?: number;
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

  const createOpen = ref(false);
  const creating = ref(false);
  const createError = ref<string | null>(null);

  const viewingCommunityId = ref<string | null>(null);
  const viewingCommunity = ref<CommunitySummary | null>(null);
  const viewingMembers = ref<CommunityMember[]>([]);
  const viewingChannels = ref<CommunityChannel[]>([]);
  const detailsLoading = ref(false);
  const detailsError = ref<string | null>(null);
  const promotingDid = ref<string | null>(null);
  const demotingDid = ref<string | null>(null);
  const banningDid = ref<string | null>(null);

  const recent = computed(() => communities.value.slice(0, RECENT_LIMIT));
  // community:get-list is already pre-filtered to the caller's joined
  // communities (INNER JOIN community_members), so length === joinedCount.
  const joinedCount = computed(() => communities.value.length);

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

  // ---- Phase 3: create community wizard -----------------------------------

  function openCreateForm(): void {
    createOpen.value = true;
    createError.value = null;
  }

  function closeCreateForm(): void {
    if (creating.value) {
      return;
    }
    createOpen.value = false;
    createError.value = null;
  }

  async function createCommunity(
    input: CreateCommunityInput,
  ): Promise<CommunitySummary | null> {
    if (!input.name || !input.name.trim()) {
      createError.value = "请输入社区名称";
      return null;
    }
    if (input.name.trim().length > 100) {
      createError.value = "社区名称不能超过 100 个字符";
      return null;
    }

    creating.value = true;
    createError.value = null;
    try {
      const result = (await api()?.invoke("community:create", {
        name: input.name.trim(),
        description: input.description?.trim() || "",
        iconUrl: input.iconUrl?.trim() || "",
        rulesMd: input.rulesMd?.trim() || "",
        memberLimit:
          typeof input.memberLimit === "number" && input.memberLimit > 0
            ? Math.floor(input.memberLimit)
            : 1000,
      })) as CommunitySummary | null | undefined;
      await loadAll();
      createOpen.value = false;
      return result ?? null;
    } catch (e) {
      createError.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      creating.value = false;
    }
  }

  function clearCreateError(): void {
    createError.value = null;
  }

  // ---- Phase 4: details drawer + members + channels -----------------------

  async function loadMembers(id: string): Promise<void> {
    try {
      const list = (await api()?.invoke("community:get-members", id, {
        limit: 100,
      })) as CommunityMember[] | null | undefined;
      viewingMembers.value = Array.isArray(list) ? list : [];
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      viewingMembers.value = [];
    }
  }

  async function loadChannels(id: string): Promise<void> {
    try {
      const list = (await api()?.invoke("channel:get-list", id)) as
        | CommunityChannel[]
        | null
        | undefined;
      viewingChannels.value = Array.isArray(list) ? list : [];
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      viewingChannels.value = [];
    }
  }

  async function openDetails(id: string): Promise<void> {
    viewingCommunityId.value = id;
    viewingCommunity.value = null;
    viewingMembers.value = [];
    viewingChannels.value = [];
    detailsError.value = null;
    detailsLoading.value = true;
    try {
      const detail = (await api()?.invoke("community:get-by-id", id)) as
        | CommunitySummary
        | null
        | undefined;
      viewingCommunity.value = detail ?? null;
      await Promise.all([loadMembers(id), loadChannels(id)]);
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      detailsLoading.value = false;
    }
  }

  function closeDetails(): void {
    viewingCommunityId.value = null;
    viewingCommunity.value = null;
    viewingMembers.value = [];
    viewingChannels.value = [];
    detailsError.value = null;
  }

  async function promoteMember(
    communityId: string,
    memberDid: string,
    newRole: "admin" | "moderator",
  ): Promise<boolean> {
    detailsError.value = null;
    promotingDid.value = memberDid;
    try {
      await api()?.invoke("community:promote", communityId, memberDid, newRole);
      await loadMembers(communityId);
      return true;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      promotingDid.value = null;
    }
  }

  async function demoteMember(
    communityId: string,
    memberDid: string,
  ): Promise<boolean> {
    detailsError.value = null;
    demotingDid.value = memberDid;
    try {
      await api()?.invoke("community:demote", communityId, memberDid);
      await loadMembers(communityId);
      return true;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      demotingDid.value = null;
    }
  }

  async function banMember(
    communityId: string,
    memberDid: string,
  ): Promise<boolean> {
    detailsError.value = null;
    banningDid.value = memberDid;
    try {
      await api()?.invoke("community:ban", communityId, memberDid);
      await loadMembers(communityId);
      // banning may have affected member_count — refresh community detail
      const detail = (await api()?.invoke(
        "community:get-by-id",
        communityId,
      )) as CommunitySummary | null | undefined;
      if (detail) {
        viewingCommunity.value = detail;
      }
      return true;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      banningDid.value = null;
    }
  }

  function clearDetailsError(): void {
    detailsError.value = null;
  }

  return {
    communities,
    loading,
    error,
    hasLoaded,
    joiningId,
    leavingId,
    deletingId,
    createOpen,
    creating,
    createError,
    viewingCommunityId,
    viewingCommunity,
    viewingMembers,
    viewingChannels,
    detailsLoading,
    detailsError,
    promotingDid,
    demotingDid,
    banningDid,
    recent,
    joinedCount,
    loadAll,
    joinCommunity,
    leaveCommunity,
    deleteCommunity,
    clearError,
    openCreateForm,
    closeCreateForm,
    createCommunity,
    clearCreateError,
    openDetails,
    closeDetails,
    loadMembers,
    loadChannels,
    promoteMember,
    demoteMember,
    banMember,
    clearDetailsError,
  };
});
