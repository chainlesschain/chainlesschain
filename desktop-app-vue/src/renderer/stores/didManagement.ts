/**
 * DID Management Store
 * Thin wrapper over the did:* IPC channels exposed by
 * src/main/did/did-ipc.js. Intentionally minimal — covers the
 * read/ownership surface used by the shell quick panel. Full
 * create / sign / mnemonic flows live in /did and are not re-exposed here.
 * @version 1.0.0
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

  async function setDefault(did: string): Promise<void> {
    error.value = null;
    try {
      await api()?.invoke("did:set-default-identity", did);
      await loadAll();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    identities,
    currentDid,
    loading,
    error,
    hasLoaded,
    defaultIdentity,
    loadAll,
    setDefault,
    clearError,
  };
});
