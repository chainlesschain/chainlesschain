import { defineStore } from "pinia";

const electronAPI =
  (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error("IPC not available"));
}

export interface FLTask {
  id: string;
  name: string;
  modelType: string;
  globalModelVersion: number;
  aggregationStrategy: string;
  minParticipants: number;
  maxRounds: number;
  currentRound: number;
  status: string;
  privacyBudget: number;
  noiseMultiplier: number;
  clipNorm: number;
  config: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  participantsCount?: number;
  currentRoundInfo?: Record<string, unknown> | null;
}

export interface FLParticipant {
  id: string;
  taskId: string;
  agentDid: string;
  status: string;
  roundsCompleted: number;
  lastContributionAt: string | null;
  dataSize: number;
  createdAt: string;
}

export interface FLStats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  totalParticipants: number;
  totalRounds: number;
  totalAggregations: number;
  byMethod: Record<string, number>;
  avgAggregationTimeMs: number;
}

export const useFederatedLearningStore = defineStore("federatedLearning", {
  state: () => ({
    tasks: [] as FLTask[],
    stats: null as FLStats | null,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    activeTasks: (state) =>
      state.tasks.filter(
        (t) =>
          t.status === "training" ||
          t.status === "recruiting" ||
          t.status === "aggregating",
      ),
    completedTasks: (state) =>
      state.tasks.filter((t) => t.status === "completed"),
  },
  actions: {
    async loadTasks(filter: Record<string, unknown> = {}) {
      this.loading = true;
      try {
        const result = await invoke("fl:list-tasks", { filter });
        if (result.success) this.tasks = result.data;
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async createTask(options: {
      name: string;
      modelType: string;
      aggregationStrategy?: string;
      minParticipants?: number;
      maxRounds?: number;
    }) {
      try {
        const result = await invoke("fl:create-task", { options });
        if (result.success) {
          await this.loadTasks();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async joinTask(taskId: string, agentDid: string) {
      try {
        const result = await invoke("fl:join-task", {
          taskId,
          agentDid,
          options: {},
        });
        if (result.success) return result.data;
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async leaveTask(taskId: string, agentDid: string) {
      try {
        const result = await invoke("fl:leave-task", {
          taskId,
          agentDid,
        });
        if (result.success) return result.data;
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async startTraining(taskId: string) {
      try {
        const result = await invoke("fl:start-training", { taskId });
        if (result.success) {
          await this.loadTasks();
          return result.data;
        }
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async submitGradients(
      taskId: string,
      agentDid: string,
      gradients: number[],
    ) {
      try {
        const result = await invoke("fl:submit-gradients", {
          taskId,
          agentDid,
          gradients,
          options: {},
        });
        if (result.success) return result.data;
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async getTaskStatus(taskId: string) {
      try {
        const result = await invoke("fl:get-task-status", { taskId });
        if (result.success) return result.data;
        throw new Error(result.error);
      } catch (error: unknown) {
        this.error = (error as Error).message;
        throw error;
      }
    },
    async loadStats() {
      try {
        const result = await invoke("fl:get-stats", {});
        if (result.success) this.stats = result.data;
        else this.error = result.error;
      } catch (error: unknown) {
        this.error = (error as Error).message;
      }
    },
    clearError() {
      this.error = null;
    },
  },
});
