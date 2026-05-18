/**
 * P2P Messaging Quick Store
 * Thin wrapper over `p2p:get-node-info` / `p2p:get-peers` / `p2p:get-nat-info`
 * IPC for the V6 shell quick panel. Read-only "current node + peers + NAT"
 * surface only. Connect/disconnect/messaging flows live in /p2p-messaging
 * and are not re-exposed here.
 *
 * Note: get-* channels are graceful (return null/[] when manager not
 * initialized); only connect/disconnect-style channels throw.
 * @version 1.0.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface NodeInfo {
  peerId?: string;
  addresses?: string[];
  protocols?: string[];
  [key: string]: unknown;
}

export interface PeerInfo {
  peerId?: string;
  addresses?: string[];
  protocols?: string[];
  latency?: number;
  [key: string]: unknown;
}

export interface NatInfo {
  type?: string;
  reachable?: boolean;
  publicIp?: string;
  externalPort?: number;
  [key: string]: unknown;
}

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useP2PMessagingStore = defineStore("p2pMessaging", () => {
  const nodeInfo = ref<NodeInfo | null>(null);
  const peers = ref<PeerInfo[]>([]);
  const natInfo = ref<NatInfo | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const isOnline = computed(() => nodeInfo.value !== null);
  const peerCount = computed(() => peers.value.length);

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const [node, peerList, nat] = await Promise.all([
        api()?.invoke("p2p:get-node-info") as Promise<NodeInfo | null>,
        api()?.invoke("p2p:get-peers") as Promise<PeerInfo[] | null>,
        api()?.invoke("p2p:get-nat-info") as Promise<NatInfo | null>,
      ]);
      nodeInfo.value = node ?? null;
      peers.value = Array.isArray(peerList) ? peerList : [];
      natInfo.value = nat ?? null;
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
    nodeInfo,
    peers,
    natInfo,
    loading,
    error,
    hasLoaded,
    isOnline,
    peerCount,
    loadAll,
    clearError,
  };
});
