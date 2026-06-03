/**
 * Multimodal Store - Pinia 状态管理
 * 管理多模态协作：输入融合、文档解析、屏幕捕获、输出生成
 *
 * @module multimodal-store
 * @version 1.1.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

export interface MultimodalSession {
  id: string;
  inputs: MultimodalInput[];
  context: any;
  tokenBudget: { used: number; total: number };
  status: 'active' | 'completed';
  createdAt: string;
}

export interface MultimodalInput {
  id: string;
  modality: 'text' | 'document' | 'image' | 'screen';
  content: any;
  summary?: string;
  tokenCost: number;
  addedAt: string;
}

export interface MultimodalArtifact {
  id: string;
  sessionId: string;
  format: string;
  content: string;
  size: number;
  createdAt: string;
}

export interface MultimodalStats {
  totalSessions: number;
  totalInputs: number;
  avgTokensPerSession: number;
  modalityDistribution: Record<string, number>;
}

interface MultimodalState {
  currentSession: MultimodalSession | null;
  artifacts: MultimodalArtifact[];
  supportedModalities: string[];
  stats: MultimodalStats | null;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useMultimodalStore = defineStore('multimodal', {
  state: (): MultimodalState => ({
    currentSession: null,
    artifacts: [],
    supportedModalities: [],
    stats: null,
    loading: false,
    error: null,
  }),

  getters: {
    tokenBudgetUsed(): number {
      return this.currentSession?.tokenBudget?.used ?? 0;
    },

    tokenBudgetTotal(): number {
      return this.currentSession?.tokenBudget?.total ?? 0;
    },

    tokenBudgetPercent(): number {
      const total = this.tokenBudgetTotal;
      if (total === 0) return 0;
      return Math.round((this.tokenBudgetUsed / total) * 100);
    },
  },

  actions: {
    // ==================== 输入融合 ====================

    async fuseInput(inputs: any[]) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('mm:fuse-input', inputs);
        if (result.success && result.data) {
          this.currentSession = result.data;
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

    async parseDocument(file: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('mm:parse-document', file);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async buildContext(sessionId: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('mm:build-context', sessionId);
        if (result.success && result.data) {
          this.currentSession = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async getSession(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('mm:get-session', id);
        if (result.success && result.data) {
          this.currentSession = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 模态与捕获 ====================

    async getSupportedModalities() {
      try {
        const result = await (window as any).electronAPI.invoke('mm:get-supported-modalities');
        if (result.success && result.data) {
          this.supportedModalities = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async captureScreen(options?: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('mm:capture-screen', options);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 输出生成 ====================

    async generateOutput(sessionId: string, format: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke(
          'mm:generate-output',
          sessionId,
          format,
        );
        if (result.success && result.data) {
          this.artifacts.push(result.data);
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

    async getArtifacts(sessionId: string) {
      try {
        const result = await (window as any).electronAPI.invoke('mm:get-artifacts', sessionId);
        if (result.success && result.data) {
          this.artifacts = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 统计 ====================

    async getStats() {
      try {
        const result = await (window as any).electronAPI.invoke('mm:get-stats');
        if (result.success && result.data) {
          this.stats = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    reset() {
      this.currentSession = null;
      this.artifacts = [];
      this.supportedModalities = [];
      this.stats = null;
      this.loading = false;
      this.error = null;
    },
  },
});
