/**
 * Skill Metrics Store
 * Tracks skill performance metrics and provides chart data.
 * @version 1.1.0
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface SkillMetric {
  skillId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  lastExecutedAt: number | null;
}

interface PipelineMetric {
  pipelineId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastExecutedAt: number | null;
}

interface TimeSeriesPoint {
  timestamp: number;
  executions: number;
  successes: number;
  failures: number;
  avgDuration: number;
  successRate: number;
  totalTokens: number;
}

export const useSkillMetricsStore = defineStore('skill-metrics', () => {
  // State
  const skillMetrics = ref<SkillMetric[]>([]);
  const pipelineMetrics = ref<PipelineMetric[]>([]);
  const topSkills = ref<SkillMetric[]>([]);
  const timeSeriesData = ref<TimeSeriesPoint[]>([]);
  const timeRange = ref<'hour' | 'day' | 'week'>('day');
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const sortedBySuccessRate = computed(() =>
    [...skillMetrics.value].sort((a, b) => b.successRate - a.successRate)
  );

  const sortedByUsage = computed(() =>
    [...skillMetrics.value].sort((a, b) => b.totalExecutions - a.totalExecutions)
  );

  const sortedByCost = computed(() =>
    [...skillMetrics.value].sort((a, b) => b.totalCost - a.totalCost)
  );

  // Actions
  async function loadSkillMetrics(skillId?: string) {
    loading.value = true;
    error.value = null;
    try {
      const result = await window.electronAPI?.invoke('skills:get-metrics', {
        skillId: skillId || '',
        timeRange: null,
      });
      if (result?.success) {
        if (skillId) {
          const idx = skillMetrics.value.findIndex(m => m.skillId === skillId);
          if (idx >= 0) skillMetrics.value[idx] = result.data;
          else skillMetrics.value.push(result.data);
        }
      }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function loadPipelineMetrics(pipelineId?: string) {
    try {
      const result = await window.electronAPI?.invoke('skills:get-pipeline-metrics', pipelineId || null);
      if (result?.success) {
        pipelineMetrics.value = Array.isArray(result.data) ? result.data : [result.data];
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function loadTopSkills(limit = 10, metric: string = 'executions') {
    try {
      const result = await window.electronAPI?.invoke('skills:get-top-skills', { limit, metric });
      if (result?.success) {
        topSkills.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  async function loadTimeSeries(skillId?: string, interval?: string) {
    try {
      const result = await window.electronAPI?.invoke('skills:get-time-series', {
        skillId: skillId || null,
        interval: interval || timeRange.value,
      });
      if (result?.success) {
        timeSeriesData.value = result.data;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  }

  return {
    skillMetrics,
    pipelineMetrics,
    topSkills,
    timeSeriesData,
    timeRange,
    loading,
    error,
    sortedBySuccessRate,
    sortedByUsage,
    sortedByCost,
    loadSkillMetrics,
    loadPipelineMetrics,
    loadTopSkills,
    loadTimeSeries,
  };
});
