/**
 * Call History Store (V5→V6 page port, Phase 2 read + delete + clear)
 *
 * Wraps the call-history:* IPC channels exposed by
 * src/main/p2p/call-history-ipc.js, plus friend:list for DID→nickname display:
 *   - call-history:get-all   → { success, history }
 *   - call-history:delete    → { success }            (by call id)
 *   - call-history:clear-all → { success }
 *   - friend:list            → { success, friends[] }
 *
 * Drives the V6 CallHistoryPanel: list of audio/video/screen-share call
 * records with a type filter, refresh, per-record delete, clear-all, and a
 * detail drawer. "Call again" (re-initiating a call from a record) is deferred
 * to a later phase — it needs the call media composables, not just history IO.
 *
 * Field-shape note: call-history:* IPC wraps payloads in `{ success, ... }`
 * (unlike the community:* channels that return raw arrays), so every action
 * checks `res.success` before reading `res.history`.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export type CallType = "audio" | "video" | "screen";

export interface CallRecord {
  id: string;
  type?: CallType | string;
  peerId?: string;
  direction?: "incoming" | "outgoing" | "missed" | string;
  status?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  created_at?: number;
  [key: string]: unknown;
}

export interface FriendSummary {
  friend_did: string;
  display_name?: string;
  nickname?: string;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

function truncateDid(did: string): string {
  return did.length > 8 ? `${did.slice(0, 8)}…` : did;
}

export const useCallHistoryStore = defineStore("callHistory", () => {
  const records = ref<CallRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const filterType = ref<"all" | CallType | string>("all");
  const friendsMap = ref<Map<string, string>>(new Map());

  const deletingId = ref<string | null>(null);
  const clearing = ref(false);

  const selectedRecord = ref<CallRecord | null>(null);
  const detailsOpen = ref(false);

  const filteredHistory = computed<CallRecord[]>(() =>
    filterType.value === "all"
      ? records.value
      : records.value.filter((r) => r.type === filterType.value),
  );

  /** Resolve a peer DID to a friendly name (falls back to a truncated DID). */
  function peerName(peerId?: string | null): string {
    if (!peerId) return "未知";
    return friendsMap.value.get(peerId) ?? truncateDid(peerId);
  }

  /** Best-effort: load the friends list to map DID → display name. */
  async function loadFriends(): Promise<void> {
    try {
      const res = (await api()?.invoke("friend:list")) as
        | { success?: boolean; friends?: FriendSummary[] }
        | null
        | undefined;
      const map = new Map<string, string>();
      if (res?.success && Array.isArray(res.friends)) {
        for (const f of res.friends) {
          if (!f?.friend_did) continue;
          map.set(
            f.friend_did,
            f.display_name || f.nickname || truncateDid(f.friend_did),
          );
        }
      }
      friendsMap.value = map;
    } catch {
      // Names just fall back to truncated DIDs — never block the history load.
    }
  }

  async function loadHistory(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = (await api()?.invoke("call-history:get-all")) as
        | { success?: boolean; history?: CallRecord[]; error?: string }
        | null
        | undefined;
      if (res?.success) {
        records.value = Array.isArray(res.history) ? res.history : [];
      } else {
        error.value = res?.error || "加载通话记录失败";
      }
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Load friends (for names) + history together. */
  async function loadAll(): Promise<void> {
    await Promise.all([loadFriends(), loadHistory()]);
  }

  async function deleteRecord(id: string): Promise<boolean> {
    error.value = null;
    deletingId.value = id;
    try {
      const res = (await api()?.invoke("call-history:delete", id)) as
        | { success?: boolean; error?: string }
        | null
        | undefined;
      if (res?.success) {
        records.value = records.value.filter((r) => r.id !== id);
        if (selectedRecord.value?.id === id) {
          closeDetails();
        }
        return true;
      }
      error.value = res?.error || "删除失败";
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      deletingId.value = null;
    }
  }

  async function clearAll(): Promise<boolean> {
    error.value = null;
    clearing.value = true;
    try {
      const res = (await api()?.invoke("call-history:clear-all")) as
        | { success?: boolean; error?: string }
        | null
        | undefined;
      if (res?.success) {
        records.value = [];
        closeDetails();
        return true;
      }
      error.value = res?.error || "清空失败";
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      clearing.value = false;
    }
  }

  function setFilter(type: "all" | CallType | string): void {
    filterType.value = type;
  }

  function openDetails(record: CallRecord): void {
    selectedRecord.value = record;
    detailsOpen.value = true;
  }

  function closeDetails(): void {
    detailsOpen.value = false;
    selectedRecord.value = null;
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    records,
    loading,
    error,
    hasLoaded,
    filterType,
    friendsMap,
    deletingId,
    clearing,
    selectedRecord,
    detailsOpen,
    filteredHistory,
    peerName,
    loadFriends,
    loadHistory,
    loadAll,
    deleteRecord,
    clearAll,
    setFilter,
    openDetails,
    closeDetails,
    clearError,
  };
});
