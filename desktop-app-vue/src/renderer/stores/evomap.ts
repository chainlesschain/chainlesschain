/**
 * EvoMap Store - Pinia 状态管理
 * 管理 EvoMap GEP 协议状态：节点注册、资产发现、发布、导入等
 *
 * @module evomap-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 节点状态
 */
export interface EvoMapNodeStatus {
  nodeId: string | null;
  credits: number;
  reputation: number;
  registered: boolean;
  lastHeartbeat: string | null;
  heartbeatInterval: number;
  initialized: boolean;
}

/**
 * EvoMap 资产
 */
export interface EvoMapAsset {
  asset_id: string;
  type: string;
  status: string;
  direction: string;
  content: string;
  summary: string;
  local_source_id?: string;
  local_source_type?: string;
  gdi_score?: number;
  fetch_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * 同步日志条目
 */
export interface SyncLogEntry {
  id: string;
  action: string;
  asset_id?: string;
  status: string;
  details?: string;
  created_at: string;
}

/**
 * 任务/悬赏
 */
export interface EvoMapTask {
  id: string;
  title: string;
  description: string;
  reward: number;
  status: string;
  created_at: string;
}

/**
 * EvoMap 配置
 */
export interface EvoMapConfig {
  enabled: boolean;
  hubUrl: string;
  autoPublish: boolean;
  autoFetch: boolean;
  publishThresholds: {
    minInstinctConfidence: number;
    minWorkflowSuccessRate: number;
    minDecisionSuccessRate: number;
  };
  privacyFilter: {
    excludePatterns: string[];
    anonymize: boolean;
    requireReview: boolean;
  };
  heartbeatEnabled: boolean;
  fetchLimit: number;
  workerEnabled: boolean;
  workerDomains: string[];
}

/**
 * EvoMap Store 状态
 */
interface EvoMapState {
  nodeStatus: EvoMapNodeStatus;
  assets: EvoMapAsset[];
  trendingAssets: EvoMapAsset[];
  syncLog: SyncLogEntry[];
  tasks: EvoMapTask[];
  config: EvoMapConfig | null;
  searchResults: EvoMapAsset[];
  searchKeyword: string;
  searchType: string;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useEvoMapStore = defineStore('evomap', {
  state: (): EvoMapState => ({
    // ==========================================
    // 节点状态
    // ==========================================

    nodeStatus: {
      nodeId: null,
      credits: 0,
      reputation: 0,
      registered: false,
      lastHeartbeat: null,
      heartbeatInterval: 900000,
      initialized: false,
    },

    // ==========================================
    // 资产列表
    // ==========================================

    assets: [],

    trendingAssets: [],

    // ==========================================
    // 同步日志
    // ==========================================

    syncLog: [],

    // ==========================================
    // 任务/悬赏
    // ==========================================

    tasks: [],

    // ==========================================
    // 配置
    // ==========================================

    config: null,

    // ==========================================
    // 搜索
    // ==========================================

    searchResults: [],

    searchKeyword: '',

    searchType: '',

    // ==========================================
    // 状态
    // ==========================================

    loading: false,

    error: null,
  }),

  getters: {
    /**
     * 是否已注册
     */
    isRegistered(): boolean {
      return this.nodeStatus.registered;
    },

    /**
     * 信用余额
     */
    creditBalance(): number {
      return this.nodeStatus.credits;
    },

    /**
     * 已发布资产数量
     */
    publishedCount(): number {
      return this.assets.filter((a) => a.direction === 'published').length;
    },

    /**
     * 已获取资产数量
     */
    fetchedCount(): number {
      return this.assets.filter((a) => a.direction === 'fetched').length;
    },

    /**
     * 已导入资产数量
     */
    importedCount(): number {
      return this.assets.filter((a) => a.status === 'imported').length;
    },
  },

  actions: {
    // ==================== 节点管理 ====================

    /**
     * 注册到 EvoMap Hub
     */
    async register() {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('evomap:register');
        if (result.success) {
          await this.getStatus();
        } else {
          this.error = result.error;
        }
        return result;
      } catch (error: any) {
        this.error = error.message;
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取节点状态
     */
    async getStatus() {
      try {
        const result = await (window as any).electronAPI.invoke('evomap:get-status');
        if (result.success && result.data) {
          this.nodeStatus = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * 刷新信用
     */
    async refreshCredits() {
      try {
        const result = await (window as any).electronAPI.invoke('evomap:refresh-credits');
        if (result.success && result.data) {
          this.nodeStatus.credits = result.data.credits;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 资产发现 ====================

    /**
     * 搜索资产
     */
    async searchAssets(signals?: string[], type?: string, sort?: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:search-assets',
          signals,
          type,
          sort,
        );
        if (result.success && result.data) {
          this.searchResults = result.data.assets || result.data || [];
        } else {
          this.error = result.error;
        }
        return result;
      } catch (error: any) {
        this.error = error.message;
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取趋势资产
     */
    async fetchTrending() {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('evomap:get-trending');
        if (result.success && result.data) {
          this.trendingAssets = result.data.assets || result.data || [];
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取相关资产
     */
    async fetchRelevant(signals: string[], type?: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:fetch-relevant',
          signals,
          type,
        );
        if (result.success && result.data) {
          this.searchResults = result.data.assets || [];
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 发布 ====================

    /**
     * 发布 Instinct
     */
    async publishInstinct(instinctId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:publish-instinct',
          instinctId,
        );
        if (result.success) {
          await this.getLocalAssets();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 发布 Decision
     */
    async publishDecision(decisionId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:publish-decision',
          decisionId,
        );
        if (result.success) {
          await this.getLocalAssets();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 自动发布符合条件的资产
     */
    async autoPublish() {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('evomap:auto-publish');
        if (result.success) {
          await this.getLocalAssets();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 审批发布
     */
    async approvePublish(reviewId: string) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:approve-publish',
          reviewId,
        );
        if (result.success) {
          await this.getLocalAssets();
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 导入 ====================

    /**
     * 导入为 Skill
     */
    async importAsSkill(assetId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:import-as-skill',
          assetId,
        );
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 导入为 Instinct
     */
    async importAsInstinct(assetId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:import-as-instinct',
          assetId,
        );
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取本地资产列表
     */
    async getLocalAssets(filters?: { direction?: string; type?: string; status?: string; limit?: number }) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:get-local-assets',
          filters,
        );
        if (result.success && result.data) {
          this.assets = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 任务/悬赏 ====================

    /**
     * 列出可用任务
     */
    async listTasks(reputation?: number, limit?: number) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'evomap:list-tasks',
          reputation,
          limit,
        );
        if (result.success && result.data) {
          this.tasks = result.data.tasks || result.data || [];
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * 认领任务
     */
    async claimTask(taskId: string) {
      try {
        return await (window as any).electronAPI.invoke('evomap:claim-task', taskId);
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 配置 ====================

    /**
     * 获取配置
     */
    async getConfig() {
      try {
        const result = await (window as any).electronAPI.invoke('evomap:get-config');
        if (result.success && result.data) {
          this.config = result.data.evomap;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * 更新配置
     */
    async updateConfig(newConfig: Partial<EvoMapConfig>) {
      try {
        const merged = { ...(this.config || {}), ...newConfig };
        const result = await (window as any).electronAPI.invoke(
          'evomap:update-config',
          merged,
        );
        if (result.success) {
          this.config = merged as EvoMapConfig;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * 获取同步日志
     */
    async getSyncLog(limit = 50) {
      try {
        const result = await (window as any).electronAPI.invoke('evomap:get-sync-log', limit);
        if (result.success && result.data) {
          this.syncLog = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * 重置状态
     */
    reset() {
      this.assets = [];
      this.trendingAssets = [];
      this.syncLog = [];
      this.tasks = [];
      this.searchResults = [];
      this.searchKeyword = '';
      this.searchType = '';
      this.loading = false;
      this.error = null;
    },
  },
});
