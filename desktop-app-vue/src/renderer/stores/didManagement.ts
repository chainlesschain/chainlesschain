/**
 * DID Management Store
 * Wraps the did:* IPC channels exposed by src/main/did/did-ipc.js.
 * Phase 2 of the V6 page port — covers list/setDefault/delete + DHT
 * publish-status read. Create + mnemonic + DHT publish/unpublish flows
 * land in Phase 3-5.
 * @version 1.1.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface IdentitySummary {
  did: string;
  displayName?: string;
  publicKey?: string;
  isDefault?: boolean;
  createdAt?: string | number;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useDIDManagementStore = defineStore("didManagement", () => {
  const identities = ref<IdentitySummary[]>([]);
  const currentDid = ref<string | null>(null);
  const publishStatus = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const defaultIdentity = computed(() => {
    if (currentDid.value) {
      return identities.value.find((i) => i.did === currentDid.value) ?? null;
    }
    return (
      identities.value.find((i) => i.isDefault) ?? identities.value[0] ?? null
    );
  });

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const list = (await api()?.invoke("did:get-all-identities")) as
        | IdentitySummary[]
        | null
        | undefined;
      identities.value = Array.isArray(list) ? list : [];
      try {
        const current = (await api()?.invoke("did:get-current-identity")) as
          | IdentitySummary
          | null
          | undefined;
        currentDid.value = current?.did ?? null;
      } catch {
        currentDid.value = null;
      }
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadPublishStatus(): Promise<void> {
    if (identities.value.length === 0) {
      publishStatus.value = {};
      return;
    }
    const entries = await Promise.all(
      identities.value.map(async (id) => {
        try {
          const published = (await api()?.invoke(
            "did:is-published-to-dht",
            id.did,
          )) as boolean | null | undefined;
          return [id.did, published === true] as const;
        } catch {
          return [id.did, false] as const;
        }
      }),
    );
    publishStatus.value = Object.fromEntries(entries);
  }

  async function setDefault(did: string): Promise<void> {
    error.value = null;
    try {
      await api()?.invoke("did:set-default-identity", did);
      await loadAll();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function deleteIdentity(did: string): Promise<boolean> {
    error.value = null;
    try {
      await api()?.invoke("did:delete-identity", did);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    identities,
    currentDid,
    publishStatus,
    loading,
    error,
    hasLoaded,
    defaultIdentity,
    loadAll,
    loadPublishStatus,
    setDefault,
    deleteIdentity,
    clearError,
  };
});
