import { defineStore } from "pinia";

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export interface ClusterNode {
  id: string;
  peer_id: string;
  endpoint: string;
  status: string;
  region: string | null;
  storage_capacity: number;
  storage_used: number;
  pin_count: number;
  last_heartbeat: string;
  joined_at: string;
  metadata: Record<string, any>;
  healthy?: boolean;
  timeSinceHeartbeat?: number;
}

export interface ClusterPin {
  id: string;
  cid: string;
  name: string | null;
  replication_factor: number;
  replication_min: number;
  current_replicas: number;
  pin_status: string;
  allocations: string[];
  metadata: Record<string, any>;
  priority: number;
  expire_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClusterStats {
  totalNodes: number;
  onlineNodes: number;
  totalPins: number;
  pinnedContent: number;
  totalStorage: number;
  usedStorage: number;
  replicationHealth: number;
}

export interface ClusterHealth {
  healthy: number;
  degraded: number;
  offline: number;
  totalNodes: number;
  underReplicatedPins: number;
  pinHealth?: {
    pinned: number;
    pinning: number;
    failed: number;
    total: number;
  };
}

export const useIPFSClusterStore = defineStore("ipfsCluster", {
  state: () => ({
    nodes: [] as ClusterNode[],
    pins: [] as ClusterPin[],
    stats: null as ClusterStats | null,
    health: null as ClusterHealth | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    onlineNodes: (state) => state.nodes.filter((n) => n.status === "online"),
    pinnedItems: (state) => state.pins.filter((p) => p.pin_status === "pinned"),
    storageUsedPercent: (state) => {
      if (!state.stats || !state.stats.totalStorage) return 0;
      return (state.stats.usedStorage / state.stats.totalStorage) * 100;
    },
  },

  actions: {
    async loadNodes(filter?: { status?: string; region?: string }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:list-nodes", filter);
        if (result.success) this.nodes = result.data || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async addNode(options: {
      peerId: string;
      endpoint: string;
      region?: string;
      storageCapacity?: number;
      metadata?: Record<string, any>;
    }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:add-node", options);
        if (result.success) {
          this.nodes.push(result.data);
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async removeNode(nodeId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:remove-node", nodeId);
        if (result.success) {
          this.nodes = this.nodes.filter((n) => n.id !== nodeId);
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async pinContent(options: {
      cid: string;
      name?: string;
      replicationFactor?: number;
      replicationMin?: number;
      priority?: number;
      metadata?: Record<string, any>;
      expireAt?: string;
    }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:pin-content", options);
        if (result.success) {
          this.pins.push(result.data);
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async unpinContent(pinId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:unpin-content", pinId);
        if (result.success) {
          const pin = this.pins.find((p) => p.id === pinId);
          if (pin) {
            pin.pin_status = "unpinned";
            pin.allocations = [];
            pin.current_replicas = 0;
          }
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async loadPins(filter?: { pin_status?: string; cid?: string }) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:list-pins", filter);
        if (result.success) this.pins = result.data || [];
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async rebalance() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke("ipfs-cluster:rebalance");
        if (result.success) {
          await this.loadNodes();
          await this.loadPins();
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async loadHealth() {
      try {
        const result = await invoke("ipfs-cluster:get-health");
        if (result.success) this.health = result.data;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      }
    },

    async loadStats() {
      try {
        const result = await invoke("ipfs-cluster:get-stats");
        if (result.success) this.stats = result.data;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      }
    },

    clearError() {
      this.error = null;
    },
  },
});
