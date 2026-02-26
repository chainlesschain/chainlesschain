/**
 * Deployment Pipeline Store - Pinia 状态管理
 * 管理开发流水线：创建、启动、暂停、门控审批、指标监控
 *
 * @module deployment-store
 * @version 1.1.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

export interface PipelineStage {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'gate_pending';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  output?: any;
  error?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  template?: string;
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled';
  stages: PipelineStage[];
  config: any;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  stages: { name: string; type: string }[];
}

export interface PipelineMetrics {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  failuresByStage: Record<string, number>;
}

export interface PipelineArtifact {
  id: string;
  pipelineId: string;
  stageId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

interface DeploymentState {
  currentPipeline: Pipeline | null;
  pipelines: Pipeline[];
  templates: PipelineTemplate[];
  metrics: PipelineMetrics | null;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useDeploymentStore = defineStore('deployment', {
  state: (): DeploymentState => ({
    currentPipeline: null,
    pipelines: [],
    templates: [],
    metrics: null,
    loading: false,
    error: null,
  }),

  getters: {
    activePipelines(): Pipeline[] {
      return this.pipelines.filter((p) => p.status === 'running' || p.status === 'paused');
    },

    pendingGates(): { pipeline: Pipeline; stage: PipelineStage }[] {
      const gates: { pipeline: Pipeline; stage: PipelineStage }[] = [];
      for (const p of this.pipelines) {
        for (const s of p.stages) {
          if (s.status === 'gate_pending') {
            gates.push({ pipeline: p, stage: s });
          }
        }
      }
      return gates;
    },

    pipelineById(): (id: string) => Pipeline | undefined {
      return (id: string) => this.pipelines.find((p) => p.id === id);
    },
  },

  actions: {
    // ==================== 流水线管理 ====================

    async createPipeline(config: any) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:create', config);
        if (result.success) {
          await this.getAllPipelines();
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

    async startPipeline(id: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:start', id);
        if (result.success) {
          await this.getStatus(id);
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

    async pausePipeline(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:pause', id);
        if (result.success) {
          await this.getStatus(id);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async resumePipeline(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:resume', id);
        if (result.success) {
          await this.getStatus(id);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async cancelPipeline(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:cancel', id);
        if (result.success) {
          await this.getStatus(id);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getStatus(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:get-status', id);
        if (result.success && result.data) {
          this.currentPipeline = result.data;
          const idx = this.pipelines.findIndex((p) => p.id === id);
          if (idx !== -1) {
            this.pipelines[idx] = result.data;
          }
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getAllPipelines() {
      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:get-all');
        if (result.success && result.data) {
          this.pipelines = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        this.loading = false;
      }
    },

    // ==================== 门控审批 ====================

    async approveGate(id: string, stageId: string) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'dev-pipeline:approve-gate',
          id,
          stageId,
        );
        if (result.success) {
          await this.getStatus(id);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async rejectGate(id: string, stageId: string, reason: string) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'dev-pipeline:reject-gate',
          id,
          stageId,
          reason,
        );
        if (result.success) {
          await this.getStatus(id);
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 详情与指标 ====================

    async getArtifacts(id: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:get-artifacts', id);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getStageDetail(id: string, stageId: string) {
      try {
        const result = await (window as any).electronAPI.invoke(
          'dev-pipeline:get-stage-detail',
          id,
          stageId,
        );
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async getMetrics(id?: string) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:get-metrics', id);
        if (result.success && result.data) {
          this.metrics = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 模板与配置 ====================

    async getTemplates() {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:get-templates');
        if (result.success && result.data) {
          this.templates = result.data;
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    async configure(config: any) {
      try {
        const result = await (window as any).electronAPI.invoke('dev-pipeline:configure', config);
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    // ==================== 事件监听 ====================

    initEventListeners() {
      const api = (window as any).electronAPI;
      if (api && api.on) {
        api.on('dev-pipeline:stage-updated', (_event: any, data: any) => {
          if (this.currentPipeline && this.currentPipeline.id === data.pipelineId) {
            const stage = this.currentPipeline.stages.find((s) => s.id === data.stageId);
            if (stage) {
              Object.assign(stage, data);
            }
          }
        });
        api.on('dev-pipeline:gate-pending', (_event: any, data: any) => {
          if (this.currentPipeline && this.currentPipeline.id === data.pipelineId) {
            const stage = this.currentPipeline.stages.find((s) => s.id === data.stageId);
            if (stage) {
              stage.status = 'gate_pending';
            }
          }
        });
      }
    },

    reset() {
      this.currentPipeline = null;
      this.pipelines = [];
      this.templates = [];
      this.metrics = null;
      this.loading = false;
      this.error = null;
    },
  },
});
