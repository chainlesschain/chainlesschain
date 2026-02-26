/**
 * NL Programming Store - Pinia 状态管理
 * 管理自然语言编程：翻译、验证、代码生成、项目约定
 *
 * @module nl-program-store
 * @version 1.1.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

export interface NLSpec {
  id: string;
  intent: string;
  entities: { name: string; type: string; description: string }[];
  acceptanceCriteria: string[];
  completeness: number;
  rawText: string;
  createdAt: string;
}

export interface NLHistoryEntry {
  id: string;
  input: string;
  spec: NLSpec;
  generatedCode?: string;
  status: 'translated' | 'validated' | 'generated' | 'applied';
  createdAt: string;
}

export interface ProjectConvention {
  naming: string;
  framework: string;
  testFramework: string;
  style: string;
  patterns: string[];
}

export interface NLStats {
  totalTranslations: number;
  successRate: number;
  avgCompleteness: number;
  topIntents: { intent: string; count: number }[];
}

interface NLProgramState {
  currentSpec: NLSpec | null;
  generatedCode: string | null;
  history: NLHistoryEntry[];
  conventions: ProjectConvention | null;
  stats: NLStats | null;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useNLProgramStore = defineStore('nlProgram', {
  state: (): NLProgramState => ({
    currentSpec: null,
    generatedCode: null,
    history: [],
    conventions: null,
    stats: null,
    loading: false,
    error: null,
  }),

  getters: {
    specCompleteness(): number {
      return this.currentSpec?.completeness ?? 0;
    },

    hasSpec(): boolean {
      return this.currentSpec !== null;
    },
  },

  actions: {
    // ==================== 翻译与验证 ====================

    async translate(nlText: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:translate', nlText);
        if (result.success && result.data) {
          this.currentSpec = result.data;
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

    async validate(spec: any) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:validate', spec);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    async refine(spec: any, feedback: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:refine', spec, feedback);
        if (result.success && result.data) {
          this.currentSpec = result.data;
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

    // ==================== 历史 ====================

    async getHistory() {
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:get-history');
        if (result.success && result.data) {
          this.history = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 代码生成 ====================

    async generate(spec: any) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:generate', spec);
        if (result.success && result.data) {
          this.generatedCode = result.data.code || result.data;
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

    // ==================== 项目约定 ====================

    async getConventions() {
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:get-conventions');
        if (result.success && result.data) {
          this.conventions = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async analyzeProject(path: string) {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:analyze-project', path);
        if (result.success && result.data) {
          this.conventions = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 统计 ====================

    async getStats() {
      try {
        const result = await (window as any).electronAPI.invoke('nl-prog:get-stats');
        if (result.success && result.data) {
          this.stats = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    reset() {
      this.currentSpec = null;
      this.generatedCode = null;
      this.history = [];
      this.conventions = null;
      this.stats = null;
      this.loading = false;
      this.error = null;
    },
  },
});
