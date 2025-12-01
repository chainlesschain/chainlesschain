/**
 * Sync Service
 *
 * Handles synchronization with desktop app and remote servers
 */

import axios from 'axios';
import type {KnowledgeItem, SyncConfig} from '../types';
import {storageService} from './storage';

interface SyncResult {
  success: boolean;
  synced: number;
  conflicts: number;
  errors: string[];
}

class SyncService {
  private config: SyncConfig = {
    enabled: false,
    autoSync: false,
  };

  /**
   * Set sync configuration
   */
  setConfig(config: SyncConfig): void {
    this.config = config;
    storageService.saveSyncConfig(config);
  }

  /**
   * Get sync configuration
   */
  async getConfig(): Promise<SyncConfig> {
    const saved = await storageService.getSyncConfig();
    if (saved) {
      this.config = saved;
    }
    return this.config;
  }

  /**
   * Sync with server
   */
  async sync(items: KnowledgeItem[]): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      synced: 0,
      conflicts: 0,
      errors: [],
    };

    if (!this.config.enabled || !this.config.serverUrl) {
      result.errors.push('Sync not configured');
      return result;
    }

    try {
      console.log('[Sync] Starting sync...');

      // Get items that need syncing
      const pendingItems = items.filter(
        item => item.syncStatus === 'pending' || item.syncStatus === 'local'
      );

      if (pendingItems.length === 0) {
        console.log('[Sync] No items to sync');
        result.success = true;
        return result;
      }

      // Upload pending items
      const uploadResult = await this.uploadItems(pendingItems);
      result.synced = uploadResult.synced;
      result.conflicts = uploadResult.conflicts;
      result.errors = uploadResult.errors;

      // Download new items from server
      const downloadResult = await this.downloadItems();

      if (downloadResult.success) {
        // Merge downloaded items with local items
        // This is a simplified version - you'll need proper conflict resolution
        console.log(`[Sync] Downloaded ${downloadResult.items.length} items`);
      }

      result.success = result.errors.length === 0;
      return result;
    } catch (error) {
      console.error('[Sync] Sync failed:', error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Upload items to server
   */
  private async uploadItems(
    items: KnowledgeItem[]
  ): Promise<{synced: number; conflicts: number; errors: string[]}> {
    const result = {synced: 0, conflicts: 0, errors: [] as string[]};

    try {
      const response = await axios.post(
        `${this.config.serverUrl}/api/sync/upload`,
        {items},
        {timeout: 30000}
      );

      if (response.data.success) {
        result.synced = response.data.synced || 0;
        result.conflicts = response.data.conflicts || 0;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        result.errors.push(`Upload failed: ${error.message}`);
      } else {
        result.errors.push('Upload failed: Unknown error');
      }
    }

    return result;
  }

  /**
   * Download items from server
   */
  private async downloadItems(): Promise<{
    success: boolean;
    items: KnowledgeItem[];
  }> {
    try {
      const lastSync = this.config.lastSyncAt
        ? this.config.lastSyncAt.toISOString()
        : null;

      const response = await axios.get(
        `${this.config.serverUrl}/api/sync/download`,
        {
          params: {since: lastSync},
          timeout: 30000,
        }
      );

      if (response.data.success) {
        return {
          success: true,
          items: response.data.items || [],
        };
      }

      return {success: false, items: []};
    } catch (error) {
      console.error('[Sync] Download failed:', error);
      return {success: false, items: []};
    }
  }

  /**
   * Test server connection
   */
  async testConnection(serverUrl: string): Promise<boolean> {
    try {
      const response = await axios.get(`${serverUrl}/api/ping`, {
        timeout: 5000,
      });

      return response.status === 200;
    } catch (error) {
      console.error('[Sync] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Enable auto sync
   */
  enableAutoSync(interval: number = 300000): void {
    // Auto-sync every 5 minutes by default
    this.config.autoSync = true;

    // TODO: Implement background sync using React Native background tasks
    console.log('[Sync] Auto sync enabled with interval:', interval);
  }

  /**
   * Disable auto sync
   */
  disableAutoSync(): void {
    this.config.autoSync = false;
    console.log('[Sync] Auto sync disabled');
  }
}

export const syncService = new SyncService();
