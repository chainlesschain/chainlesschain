/**
 * Local Storage Service
 *
 * Handles encrypted local storage for knowledge items
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import type {KnowledgeItem, User, SyncConfig} from '../types';

class StorageService {
  private readonly KEYS = {
    USER: 'user',
    KNOWLEDGE_ITEMS: 'knowledge_items',
    SYNC_CONFIG: 'sync_config',
    DEVICE_ID: 'device_id',
  };

  /**
   * Generate or get device ID
   */
  async getDeviceId(): Promise<string> {
    try {
      let deviceId = await AsyncStorage.getItem(this.KEYS.DEVICE_ID);

      if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await AsyncStorage.setItem(this.KEYS.DEVICE_ID, deviceId);
      }

      return deviceId;
    } catch (error) {
      console.error('[Storage] Get device ID failed:', error);
      throw error;
    }
  }

  /**
   * Save user data (encrypted)
   */
  async saveUser(user: User): Promise<void> {
    try {
      await EncryptedStorage.setItem(
        this.KEYS.USER,
        JSON.stringify(user)
      );
    } catch (error) {
      console.error('[Storage] Save user failed:', error);
      throw error;
    }
  }

  /**
   * Get user data
   */
  async getUser(): Promise<User | null> {
    try {
      const data = await EncryptedStorage.getItem(this.KEYS.USER);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[Storage] Get user failed:', error);
      return null;
    }
  }

  /**
   * Save knowledge items
   */
  async saveKnowledgeItems(items: KnowledgeItem[]): Promise<void> {
    try {
      // Convert dates to ISO strings for storage
      const serialized = items.map(item => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }));

      await EncryptedStorage.setItem(
        this.KEYS.KNOWLEDGE_ITEMS,
        JSON.stringify(serialized)
      );
    } catch (error) {
      console.error('[Storage] Save knowledge items failed:', error);
      throw error;
    }
  }

  /**
   * Get knowledge items
   */
  async getKnowledgeItems(): Promise<KnowledgeItem[]> {
    try {
      const data = await EncryptedStorage.getItem(this.KEYS.KNOWLEDGE_ITEMS);

      if (!data) {
        return [];
      }

      const items = JSON.parse(data);

      // Convert ISO strings back to dates
      return items.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      }));
    } catch (error) {
      console.error('[Storage] Get knowledge items failed:', error);
      return [];
    }
  }

  /**
   * Save sync config
   */
  async saveSyncConfig(config: SyncConfig): Promise<void> {
    try {
      await AsyncStorage.setItem(
        this.KEYS.SYNC_CONFIG,
        JSON.stringify(config)
      );
    } catch (error) {
      console.error('[Storage] Save sync config failed:', error);
      throw error;
    }
  }

  /**
   * Get sync config
   */
  async getSyncConfig(): Promise<SyncConfig | null> {
    try {
      const data = await AsyncStorage.getItem(this.KEYS.SYNC_CONFIG);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[Storage] Get sync config failed:', error);
      return null;
    }
  }

  /**
   * Clear all data (logout)
   */
  async clearAll(): Promise<void> {
    try {
      await EncryptedStorage.clear();
      await AsyncStorage.multiRemove([
        this.KEYS.SYNC_CONFIG,
        // Keep device ID
      ]);
    } catch (error) {
      console.error('[Storage] Clear all failed:', error);
      throw error;
    }
  }

  /**
   * Initialize sample data (for testing)
   */
  async initializeSampleData(deviceId: string): Promise<KnowledgeItem[]> {
    const sampleItems: KnowledgeItem[] = [
      {
        id: '1',
        title: '欢迎使用 ChainlessChain Mobile',
        content: `# 欢迎！

这是您的第一条笔记。

## 功能特点

- 📝 Markdown 编辑
- 🔒 SIMKey 安全认证
- 🤖 AI 智能助手
- 🔄 跨设备同步

开始使用吧！`,
        type: 'note',
        tags: ['欢迎', '入门'],
        createdAt: new Date(),
        updatedAt: new Date(),
        deviceId,
        syncStatus: 'local',
      },
    ];

    await this.saveKnowledgeItems(sampleItems);
    return sampleItems;
  }
}

export const storageService = new StorageService();
