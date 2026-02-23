/**
 * IPFS Storage Store - Pinia State Management
 * Manages IPFS decentralized storage state: node status, pinned content,
 * storage stats, file uploads, and configuration.
 *
 * @module ipfs-storage-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

/**
 * IPFS node status
 */
export interface IPFSNodeStatus {
  running: boolean;
  mode: 'embedded' | 'external';
  peerId: string | null;
  peerCount: number;
}

/**
 * IPFS content record
 */
export interface IPFSContent {
  id: string;
  cid: string;
  filename?: string;
  size: number;
  pinned: boolean;
  encrypted: boolean;
  knowledgeId?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  totalPinned: number;
  totalSize: number;
  peerCount: number;
  quotaBytes: number;
  usagePercent: number;
  mode: string;
  nodeRunning: boolean;
  peerId: string | null;
}

/**
 * IPFS configuration
 */
export interface IPFSConfig {
  gatewayUrl: string;
  storageQuotaBytes: number;
  externalApiUrl: string;
  encryptionEnabled: boolean;
  mode: string;
}

/**
 * IPC response wrapper
 */
export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * IPFS Storage store state
 */
interface IPFSStorageState {
  // Node status
  nodeStatus: IPFSNodeStatus;

  // Pinned content list
  pinnedContent: IPFSContent[];
  pinnedTotal: number;

  // Storage statistics
  storageStats: StorageStats | null;

  // Configuration
  config: IPFSConfig | null;

  // UI state
  loading: boolean;
  error: string | null;
  uploadProgress: number;
}

// ==================== Store ====================

export const useIPFSStorageStore = defineStore('ipfs-storage', {
  state: (): IPFSStorageState => ({
    // ==========================================
    // Node Status
    // ==========================================

    nodeStatus: {
      running: false,
      mode: 'embedded',
      peerId: null,
      peerCount: 0,
    },

    // ==========================================
    // Pinned Content
    // ==========================================

    pinnedContent: [],
    pinnedTotal: 0,

    // ==========================================
    // Storage Stats
    // ==========================================

    storageStats: null,

    // ==========================================
    // Configuration
    // ==========================================

    config: null,

    // ==========================================
    // UI State
    // ==========================================

    loading: false,
    error: null,
    uploadProgress: 0,
  }),

  getters: {
    /**
     * Whether the IPFS node is running
     */
    isNodeRunning(): boolean {
      return this.nodeStatus.running;
    },

    /**
     * Current operating mode
     */
    currentMode(): string {
      return this.nodeStatus.mode;
    },

    /**
     * Number of connected peers
     */
    connectedPeers(): number {
      return this.nodeStatus.peerCount;
    },

    /**
     * Total pinned item count
     */
    pinnedCount(): number {
      return this.pinnedTotal;
    },

    /**
     * Encrypted items from pinned content
     */
    encryptedItems(): IPFSContent[] {
      return this.pinnedContent.filter((item) => item.encrypted);
    },

    /**
     * Storage usage percentage
     */
    usagePercent(): number {
      return this.storageStats?.usagePercent ?? 0;
    },

    /**
     * Formatted total storage used
     */
    formattedTotalSize(): string {
      return this.formatBytes(this.storageStats?.totalSize ?? 0);
    },

    /**
     * Formatted storage quota
     */
    formattedQuota(): string {
      return this.formatBytes(this.storageStats?.quotaBytes ?? 0);
    },
  },

  actions: {
    // ==========================================
    // Node Operations
    // ==========================================

    /**
     * Initialize IPFS manager and start node
     */
    async initializeIPFS(config?: Partial<IPFSConfig>): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:initialize',
          config || {}
        );

        if (result.success && result.data) {
          this.nodeStatus = result.data.nodeStatus || this.nodeStatus;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Initialize failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Start the IPFS node
     */
    async startNode(): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:start-node');

        if (result.success && result.data) {
          this.nodeStatus = result.data;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Start node failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Stop the IPFS node
     */
    async stopNode(): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:stop-node');

        if (result.success && result.data) {
          this.nodeStatus = result.data;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Stop node failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch the current node status
     */
    async fetchNodeStatus(): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:get-node-status'
        );

        if (result.success && result.data) {
          this.nodeStatus = result.data;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Fetch node status failed:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    // ==========================================
    // Content Operations
    // ==========================================

    /**
     * Add content to IPFS
     */
    async addContent(
      content: string,
      options?: { encrypt?: boolean; metadata?: Record<string, any>; filename?: string }
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;
      this.uploadProgress = 0;

      try {
        this.uploadProgress = 50;
        const result = await (window as any).electronAPI.invoke('ipfs:add-content', {
          content,
          options: options || {},
        });

        this.uploadProgress = 100;

        if (result.success) {
          // Refresh pinned content list
          await this.fetchPinnedContent();
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Add content failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
        setTimeout(() => {
          this.uploadProgress = 0;
        }, 1000);
      }
    },

    /**
     * Add a file from disk to IPFS
     */
    async addFile(
      filePath: string,
      options?: { encrypt?: boolean; metadata?: Record<string, any> }
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;
      this.uploadProgress = 0;

      try {
        this.uploadProgress = 30;
        const result = await (window as any).electronAPI.invoke('ipfs:add-file', {
          filePath,
          options: options || {},
        });

        this.uploadProgress = 100;

        if (result.success) {
          await this.fetchPinnedContent();
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Add file failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
        setTimeout(() => {
          this.uploadProgress = 0;
        }, 1000);
      }
    },

    /**
     * Get content from IPFS by CID
     */
    async getContent(
      cid: string,
      options?: Record<string, any>
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:get-content', {
          cid,
          options: options || {},
        });

        return result;
      } catch (error) {
        console.error('[IPFSStore] Get content failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Download content from IPFS to a local file
     */
    async getFile(cid: string, outputPath: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:get-file', {
          cid,
          outputPath,
        });

        return result;
      } catch (error) {
        console.error('[IPFSStore] Get file failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Pin Operations
    // ==========================================

    /**
     * Pin content by CID
     */
    async pinContent(cid: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:pin', cid);

        if (result.success) {
          // Update local state
          const item = this.pinnedContent.find((c) => c.cid === cid);
          if (item) {
            item.pinned = true;
          }
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Pin failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Unpin content by CID
     */
    async unpinContent(cid: string): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:unpin', cid);

        if (result.success) {
          // Remove from local pinned list
          this.pinnedContent = this.pinnedContent.filter((c) => c.cid !== cid);
          this.pinnedTotal = Math.max(0, this.pinnedTotal - 1);
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Unpin failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch the list of pinned content
     */
    async fetchPinnedContent(
      options?: { offset?: number; limit?: number; sortBy?: string }
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:list-pins',
          options || {}
        );

        if (result.success && result.data) {
          this.pinnedContent = (result.data.items || []).map((item: any) => ({
            id: item.id,
            cid: item.cid,
            filename: item.filename,
            size: item.size,
            pinned: item.pinned,
            encrypted: item.encrypted,
            knowledgeId: item.knowledge_id,
            createdAt: item.created_at,
            metadata: item.metadata,
          }));
          this.pinnedTotal = result.data.total || 0;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Fetch pinned content failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Storage & Stats Operations
    // ==========================================

    /**
     * Fetch storage statistics
     */
    async fetchStorageStats(): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:get-storage-stats'
        );

        if (result.success && result.data) {
          this.storageStats = result.data;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Fetch storage stats failed:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    /**
     * Run garbage collection
     */
    async garbageCollect(): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:garbage-collect'
        );

        if (result.success) {
          await this.fetchPinnedContent();
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Garbage collect failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Set storage quota
     */
    async setQuota(quotaBytes: number): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:set-quota',
          quotaBytes
        );

        if (result.success) {
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Set quota failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Mode & Configuration
    // ==========================================

    /**
     * Set operating mode (embedded or external)
     */
    async setMode(mode: 'embedded' | 'external'): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke('ipfs:set-mode', mode);

        if (result.success && result.data) {
          this.nodeStatus = result.data.nodeStatus || {
            ...this.nodeStatus,
            mode,
            running: false,
          };
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Set mode failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch the current IPFS configuration
     */
    async fetchConfig(): Promise<IPCResponse> {
      try {
        const result = await (window as any).electronAPI.invoke('ipfs:get-config');

        if (result.success && result.data) {
          this.config = result.data;
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Fetch config failed:', error);
        this.error = (error as Error).message;
        throw error;
      }
    },

    // ==========================================
    // Knowledge Attachment Operations
    // ==========================================

    /**
     * Add an IPFS-backed attachment to a knowledge item
     */
    async addKnowledgeAttachment(
      knowledgeId: string,
      content: string,
      metadata?: Record<string, any>
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:add-knowledge-attachment',
          { knowledgeId, content, metadata: metadata || {} }
        );

        if (result.success) {
          await this.fetchPinnedContent();
          await this.fetchStorageStats();
        }

        return result;
      } catch (error) {
        console.error('[IPFSStore] Add knowledge attachment failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Get an IPFS-backed attachment for a knowledge item
     */
    async getKnowledgeAttachment(
      knowledgeId: string,
      cid: string
    ): Promise<IPCResponse> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'ipfs:get-knowledge-attachment',
          { knowledgeId, cid }
        );

        return result;
      } catch (error) {
        console.error('[IPFSStore] Get knowledge attachment failed:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Format bytes to human-readable string
     */
    formatBytes(bytes: number): string {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const k = 1024;
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const value = bytes / Math.pow(k, i);
      return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    },

    /**
     * Clear error state
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * Reset all state to defaults
     */
    reset(): void {
      this.$reset();
    },
  },
});
