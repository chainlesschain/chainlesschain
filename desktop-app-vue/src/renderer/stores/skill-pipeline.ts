/**
 * Skill Pipeline Store
 * Manages pipeline definitions, execution state, and templates.
 * @version 1.1.0
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface PipelineStep {
  name: string;
  type: 'skill' | 'condition' | 'parallel' | 'transform' | 'loop';
  skillId?: string;
  inputMapping?: Record<string, any>;
  outputVariable?: string;
  config?: Record<string, any>;
  retries?: number;
  expression?: string;
  branches?: PipelineStep[];
  trueBranch?: PipelineStep[];
  falseBranch?: PipelineStep[];
  body?: PipelineStep[];
  items?: any;
  itemVariable?: string;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  steps: PipelineStep[];
  variables: Record<string, any>;
  isTemplate: boolean;
  stepCount: number;
  executionCount: number;
  lastExecutedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ExecutionStatus {
  executionId: string;
  pipelineId: string;
  state: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  totalSteps: number;
  stepResults: any[];
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  duration: number;
}

export const useSkillPipelineStore = defineStore('skill-pipeline', () => {
  // State
  const pipelines = ref<Pipeline[]>([]);
  const currentPipeline = ref<Pipeline | null>(null);
  const executionStatus = ref<ExecutionStatus | null>(null);
  const templates = ref<Pipeline[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activePipelines = computed(() =>
    pipelines.value.filter(p => !p.isTemplate)
  );

  const completedPipelines = computed(() =>
    pipelines.value.filter(p => p.executionCount > 0)
  );

  const pipelinesByCategory = computed(() => {
    const groups: Record<string, Pipeline[]> = {};
    for (const p of pipelines.value) {
      const cat = p.category || 'custom';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    return groups;
  });

  // Actions
  async function loadPipelines() {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('pipeline:list');
      if (result?.success) {
        pipelines.value = result.data;
      } else {
        error.value = result?.error || 'Failed to load pipelines';
      }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function createPipeline(definition: Partial<Pipeline>) {
    try {
      const result = await window.electronAPI?.invoke('pipeline:create', definition);
      if (result?.success) {
        await loadPipelines();
        return result.data.id;
      }
      throw new Error(result?.error || 'Failed to create pipeline');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    }
  }

  async function executePipeline(pipelineId: string, context: Record<string, any> = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('pipeline:execute', { pipelineId, context });
      if (result?.success) {
        executionStatus.value = result.data;
        await loadPipelines();
        return result.data;
      }
      throw new Error(result?.error || 'Failed to execute pipeline');
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function pausePipeline(executionId: string) {
    try {
      await window.electronAPI?.invoke('pipeline:pause', executionId);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function cancelPipeline(executionId: string) {
    try {
      await window.electronAPI?.invoke('pipeline:cancel', executionId);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function loadTemplates() {
    try {
      const result = await window.electronAPI?.invoke('pipeline:get-templates');
      if (result?.success) {
        templates.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function getPipelineStatus(executionId: string) {
    try {
      const result = await window.electronAPI?.invoke('pipeline:get-status', executionId);
      if (result?.success) {
        executionStatus.value = result.data;
        return result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
    return null;
  }

  async function deletePipeline(pipelineId: string) {
    try {
      const result = await window.electronAPI?.invoke('pipeline:delete', pipelineId);
      if (result?.success) {
        await loadPipelines();
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  return {
    pipelines,
    currentPipeline,
    executionStatus,
    templates,
    loading,
    error,
    activePipelines,
    completedPipelines,
    pipelinesByCategory,
    loadPipelines,
    createPipeline,
    executePipeline,
    pausePipeline,
    cancelPipeline,
    loadTemplates,
    getPipelineStatus,
    deletePipeline,
  };
});
