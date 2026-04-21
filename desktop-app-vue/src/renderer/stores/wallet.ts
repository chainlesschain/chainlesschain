/**
 * Wallet Store
 * Thin wrapper over the wallet:* IPC channels exposed by
 * src/main/blockchain/wallet-ipc.js. Intentionally minimal — covers the
 * read/ownership surface used by the shell quick panel. Full send/sign
 * flows live in the /wallet page and are not re-exposed here.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface WalletSummary {
  id: string;
  address?: string;
  name?: string;
  chainId?: number;
  isDefault?: boolean;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useWalletStore = defineStore("wallet", () => {
  const wallets = ref<WalletSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const defaultWallet = computed(
    () => wallets.value.find((w) => w.isDefault) ?? wallets.value[0] ?? null,
  );

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const list = (await api()?.invoke("wallet:get-all")) as
        | WalletSummary[]
        | null
        | undefined;
      wallets.value = Array.isArray(list) ? list : [];
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function setDefault(walletId: string): Promise<void> {
    error.value = null;
    try {
      await api()?.invoke("wallet:set-default", { walletId });
      await loadAll();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    wallets,
    loading,
    error,
    hasLoaded,
    defaultWallet,
    loadAll,
    setDefault,
    clearError,
  };
});
