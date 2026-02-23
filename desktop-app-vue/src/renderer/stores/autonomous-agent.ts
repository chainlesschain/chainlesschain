/**
 * Autonomous Agent Store - Pinia State Management
 *
 * Manages the autonomous agent execution system including goals,
 * steps, queue status, configuration, and real-time progress
 * updates from the main process.
 *
 * @module autonomous-agent-store
 * @version 1.0.0
 * @since 2026-02-23
 */

import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';

const autonomousLogger = createLogger('autonomous-agent-store');

// ==================== Type Definitions ====================

/**
 * Goal status
 */
export type GoalStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Tool permission category
 */
export type ToolPermission = 'skills' | 'file-ops' | 'browser' | 'network';

/**
 * Goal specification for submission
 */
export interface GoalSpec {
  description: string;
  priority: number;
  toolPermissions: ToolPermission[];
  context?: string;
  createdBy?: string;
}

/**
 * Plan step from goal decomposition
 */
export interface PlanStep {
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high' | 'unknown';
}

/**
 * Goal plan
 */
export interface GoalPlan {
  steps: PlanStep[];
  strategy: string;
}

/**
 * Autonomous goal
 */
export interface AutonomousGoal {
  id: string;
  description: string;
  priority: number;
  status: GoalStatus;
  toolPermissions: ToolPermission[];
  context: Record<string, any>;
  plan: GoalPlan;
  result: string | null;
  stepCount: number;
  tokensUsed: number;
  errorMessage?: string;
  paused?: boolean;
  waitingForInput?: boolean;
  inputRequest?: InputRequest | null;
  replanAttempts?: number;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

/**
 * Goal execution step
 */
export interface GoalStep {
  id: string;
  goalId: string;
  stepNumber: number;
  phase: string;
  thought: string | null;
  actionType: string;
  actionParams: Record<string, any>;
  result: string | null;
  success: boolean;
  tokensUsed: number;
  durationMs: number;
  createdAt: string;
}

/**
 * Goal log entry
 */
export interface GoalLog {
  id: number;
  goalId: string;
  level: string;
  type: string;
  content: string;
  createdAt: string;
}

/**
 * Input request from agent
 */
export interface InputRequest {
  question: string;
  options: string[];
  requestedAt: number;
}

/**
 * Queue status
 */
export interface QueueStatus {
  pending: number;
  active: number;
  total: number;
  maxConcurrent: number;
  canAcceptMore: boolean;
  byPriority: Record<string, number>;
  items: QueueItem[];
  historical: {
    totalProcessed: number;
    totalCompleted: number;
    totalFailed: number;
  };
}

/**
 * Queue item
 */
export interface QueueItem {
  id: string;
  goalId: string;
  priority: number;
  description: string;
  status: string;
  createdAt: string;
}

/**
 * Runner configuration
 */
export interface RunnerConfig {
  maxStepsPerGoal: number;
  stepTimeoutMs: number;
  maxConcurrentGoals: number;
  tokenBudgetPerGoal: number;
  evaluationIntervalMs: number;
  maxRetriesPerStep: number;
  maxReplanAttempts: number;
}

/**
 * Aggregate statistics
 */
export interface AgentStats {
  activeGoals: number;
  runningGoals: number;
  pausedGoals: number;
  totalGoals: number;
  completedGoals: number;
  failedGoals: number;
  cancelledGoals: number;
  totalSteps: number;
  totalTokensUsed: number;
  avgStepsPerGoal: number;
  successRate: number;
}

/**
 * Goal progress event from main process
 */
export interface GoalProgressEvent {
  goalId: string;
  step: number;
  reasoning: string;
  action: { type: string; name?: string; params?: Record<string, any> };
  result: string;
}

/**
 * Goal history result
 */
export interface GoalHistoryResult {
  goals: AutonomousGoal[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * IPC response
 */
interface IPCResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Store state
 */
export interface AutonomousAgentState {
  activeGoals: AutonomousGoal[];
  goalHistory: AutonomousGoal[];
  goalHistoryTotal: number;
  currentGoalSteps: GoalStep[];
  currentGoalLogs: GoalLog[];
  selectedGoalId: string | null;
  queueStatus: QueueStatus | null;
  config: RunnerConfig | null;
  stats: AgentStats | null;
  inputRequests: Map<string, InputRequest>;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useAutonomousAgentStore = defineStore('autonomous-agent', {
  state: (): AutonomousAgentState => ({
    activeGoals: [],
    goalHistory: [],
    goalHistoryTotal: 0,
    currentGoalSteps: [],
    currentGoalLogs: [],
    selectedGoalId: null,
    queueStatus: null,
    config: null,
    stats: null,
    inputRequests: new Map(),
    loading: false,
    error: null,
  }),

  getters: {
    /**
     * Goals currently running
     */
    runningGoals(): AutonomousGoal[] {
      return this.activeGoals.filter((g) => g.status === 'running');
    },

    /**
     * Goals currently paused
     */
    pausedGoals(): AutonomousGoal[] {
      return this.activeGoals.filter((g) => g.status === 'paused');
    },

    /**
     * Goals waiting for user input
     */
    waitingGoals(): AutonomousGoal[] {
      return this.activeGoals.filter((g) => g.status === 'waiting_input');
    },

    /**
     * Active goal count
     */
    activeGoalCount(): number {
      return this.activeGoals.length;
    },

    /**
     * Whether there are any pending input requests
     */
    hasInputRequests(): boolean {
      return this.inputRequests.size > 0;
    },

    /**
     * The currently selected goal
     */
    selectedGoal(): AutonomousGoal | null {
      if (!this.selectedGoalId) return null;
      return (
        this.activeGoals.find((g) => g.id === this.selectedGoalId) ||
        this.goalHistory.find((g) => g.id === this.selectedGoalId) ||
        null
      );
    },

    /**
     * Overall success rate from stats
     */
    successRate(): number {
      return this.stats?.successRate || 0;
    },
  },

  actions: {
    // ==========================================
    // Goal Management
    // ==========================================

    /**
     * Submit a new goal for autonomous execution
     */
    async submitGoal(goalSpec: GoalSpec): Promise<AutonomousGoal | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:submit-goal',
          goalSpec
        );

        if (result.success && result.data) {
          const goal: AutonomousGoal = {
            id: result.data.goalId,
            description: goalSpec.description,
            priority: goalSpec.priority,
            status: 'running',
            toolPermissions: goalSpec.toolPermissions,
            context: goalSpec.context ? { text: goalSpec.context } : {},
            plan: result.data.plan || { steps: [], strategy: '' },
            result: null,
            stepCount: 0,
            tokensUsed: 0,
            createdAt: new Date().toISOString(),
          };

          this.activeGoals.unshift(goal);
          autonomousLogger.info(`Goal submitted: ${goal.id}`);
          return goal;
        } else {
          this.error = result.error || 'Failed to submit goal';
          autonomousLogger.error('[AutonomousStore] Submit goal failed:', result.error);
          return null;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Submit goal error:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Pause a running goal
     */
    async pauseGoal(goalId: string): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:pause-goal',
          goalId
        );

        if (result.success) {
          const goal = this.activeGoals.find((g) => g.id === goalId);
          if (goal) {
            goal.status = 'paused';
            goal.paused = true;
          }
          autonomousLogger.info(`Goal paused: ${goalId}`);
          return true;
        } else {
          this.error = result.error || 'Failed to pause goal';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Pause goal error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    /**
     * Resume a paused goal
     */
    async resumeGoal(goalId: string): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:resume-goal',
          goalId
        );

        if (result.success) {
          const goal = this.activeGoals.find((g) => g.id === goalId);
          if (goal) {
            goal.status = 'running';
            goal.paused = false;
          }
          autonomousLogger.info(`Goal resumed: ${goalId}`);
          return true;
        } else {
          this.error = result.error || 'Failed to resume goal';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Resume goal error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    /**
     * Cancel a goal
     */
    async cancelGoal(goalId: string): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:cancel-goal',
          goalId
        );

        if (result.success) {
          const index = this.activeGoals.findIndex((g) => g.id === goalId);
          if (index !== -1) {
            this.activeGoals.splice(index, 1);
          }
          this.inputRequests.delete(goalId);
          autonomousLogger.info(`Goal cancelled: ${goalId}`);
          return true;
        } else {
          this.error = result.error || 'Failed to cancel goal';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Cancel goal error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    /**
     * Provide user input to a waiting goal
     */
    async provideInput(goalId: string, input: string): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:provide-input',
          { goalId, input }
        );

        if (result.success) {
          const goal = this.activeGoals.find((g) => g.id === goalId);
          if (goal) {
            goal.status = 'running';
            goal.waitingForInput = false;
            goal.inputRequest = null;
          }
          this.inputRequests.delete(goalId);
          autonomousLogger.info(`Input provided for goal: ${goalId}`);
          return true;
        } else {
          this.error = result.error || 'Failed to provide input';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Provide input error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    /**
     * Batch cancel multiple goals
     */
    async batchCancel(goalIds: string[]): Promise<number> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:batch-cancel',
          goalIds
        );

        if (result.success && result.data) {
          // Remove cancelled goals from active list
          for (const goalId of goalIds) {
            const index = this.activeGoals.findIndex((g) => g.id === goalId);
            if (index !== -1) {
              this.activeGoals.splice(index, 1);
            }
            this.inputRequests.delete(goalId);
          }
          autonomousLogger.info(
            `Batch cancel: ${result.data.totalCancelled}/${goalIds.length}`
          );
          return result.data.totalCancelled;
        } else {
          this.error = result.error || 'Batch cancel failed';
          return 0;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Batch cancel error:', error as any);
        this.error = (error as Error).message;
        return 0;
      }
    },

    /**
     * Retry a failed goal
     */
    async retryGoal(goalId: string): Promise<AutonomousGoal | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:retry-goal',
          goalId
        );

        if (result.success && result.data) {
          const newGoal: AutonomousGoal = {
            id: result.data.goalId,
            description: result.data.description || '',
            priority: result.data.priority || 5,
            status: 'running',
            toolPermissions: [],
            context: {},
            plan: result.data.plan || { steps: [], strategy: '' },
            result: null,
            stepCount: 0,
            tokensUsed: 0,
            createdAt: new Date().toISOString(),
          };
          this.activeGoals.unshift(newGoal);
          autonomousLogger.info(`Goal retried: ${goalId} -> ${newGoal.id}`);
          return newGoal;
        } else {
          this.error = result.error || 'Failed to retry goal';
          return null;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Retry goal error:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Data Fetching
    // ==========================================

    /**
     * Fetch all active goals
     */
    async fetchActiveGoals(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AutonomousGoal[]> = await (window as any).electronAPI.invoke(
          'agent:get-active-goals'
        );

        if (result.success) {
          this.activeGoals = result.data || [];
          autonomousLogger.info(`Loaded ${this.activeGoals.length} active goals`);
        } else {
          this.error = result.error || 'Failed to fetch active goals';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch active goals error:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch goal history
     */
    async fetchGoalHistory(limit = 50, offset = 0): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<GoalHistoryResult> = await (window as any).electronAPI.invoke(
          'agent:get-goal-history',
          { limit, offset }
        );

        if (result.success && result.data) {
          this.goalHistory = result.data.goals || [];
          this.goalHistoryTotal = result.data.total || 0;
          autonomousLogger.info(`Loaded ${this.goalHistory.length} history goals`);
        } else {
          this.error = result.error || 'Failed to fetch goal history';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch history error:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch steps for a specific goal
     */
    async fetchGoalSteps(goalId: string): Promise<void> {
      this.error = null;

      try {
        const result: IPCResult<GoalStep[]> = await (window as any).electronAPI.invoke(
          'agent:get-goal-steps',
          goalId
        );

        if (result.success) {
          this.currentGoalSteps = result.data || [];
        } else {
          this.error = result.error || 'Failed to fetch goal steps';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch steps error:', error as any);
        this.error = (error as Error).message;
      }
    },

    /**
     * Fetch logs for a specific goal
     */
    async fetchGoalLogs(goalId: string, limit = 100): Promise<void> {
      this.error = null;

      try {
        const result: IPCResult<GoalLog[]> = await (window as any).electronAPI.invoke(
          'agent:get-goal-logs',
          { goalId, limit }
        );

        if (result.success) {
          this.currentGoalLogs = result.data || [];
        } else {
          this.error = result.error || 'Failed to fetch goal logs';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch logs error:', error as any);
        this.error = (error as Error).message;
      }
    },

    /**
     * Fetch queue status
     */
    async fetchQueueStatus(): Promise<void> {
      this.error = null;

      try {
        const result: IPCResult<QueueStatus> = await (window as any).electronAPI.invoke(
          'agent:get-queue-status'
        );

        if (result.success) {
          this.queueStatus = result.data || null;
        } else {
          this.error = result.error || 'Failed to fetch queue status';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch queue error:', error as any);
        this.error = (error as Error).message;
      }
    },

    /**
     * Fetch aggregate statistics
     */
    async fetchStats(): Promise<void> {
      this.error = null;

      try {
        const result: IPCResult<AgentStats> = await (window as any).electronAPI.invoke(
          'agent:get-stats'
        );

        if (result.success) {
          this.stats = result.data || null;
        } else {
          this.error = result.error || 'Failed to fetch stats';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch stats error:', error as any);
        this.error = (error as Error).message;
      }
    },

    // ==========================================
    // Configuration
    // ==========================================

    /**
     * Fetch current configuration
     */
    async fetchConfig(): Promise<void> {
      this.error = null;

      try {
        const result: IPCResult<RunnerConfig> = await (window as any).electronAPI.invoke(
          'agent:get-config'
        );

        if (result.success) {
          this.config = result.data || null;
        } else {
          this.error = result.error || 'Failed to fetch config';
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Fetch config error:', error as any);
        this.error = (error as Error).message;
      }
    },

    /**
     * Update runner configuration
     */
    async updateConfig(config: Partial<RunnerConfig>): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult<RunnerConfig> = await (window as any).electronAPI.invoke(
          'agent:update-config',
          config
        );

        if (result.success) {
          this.config = result.data || this.config;
          autonomousLogger.info('Config updated');
          return true;
        } else {
          this.error = result.error || 'Failed to update config';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Update config error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    // ==========================================
    // Export & History Management
    // ==========================================

    /**
     * Export a goal with all steps and logs
     */
    async exportGoal(goalId: string): Promise<any> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:export-goal',
          goalId
        );

        if (result.success) {
          return result.data;
        } else {
          this.error = result.error || 'Failed to export goal';
          return null;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Export goal error:', error as any);
        this.error = (error as Error).message;
        return null;
      }
    },

    /**
     * Clear old history records
     */
    async clearHistory(before?: string): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agent:clear-history',
          { before }
        );

        if (result.success) {
          await this.fetchGoalHistory();
          autonomousLogger.info('History cleared');
          return true;
        } else {
          this.error = result.error || 'Failed to clear history';
          return false;
        }
      } catch (error) {
        autonomousLogger.error('[AutonomousStore] Clear history error:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    // ==========================================
    // UI Helpers
    // ==========================================

    /**
     * Select a goal for detailed view
     */
    selectGoal(goalId: string | null): void {
      this.selectedGoalId = goalId;
      if (goalId) {
        this.fetchGoalSteps(goalId);
        this.fetchGoalLogs(goalId);
      } else {
        this.currentGoalSteps = [];
        this.currentGoalLogs = [];
      }
    },

    /**
     * Refresh all data
     */
    async refreshAll(): Promise<void> {
      await Promise.all([
        this.fetchActiveGoals(),
        this.fetchGoalHistory(),
        this.fetchQueueStatus(),
        this.fetchStats(),
        this.fetchConfig(),
      ]);
    },

    /**
     * Reset store state
     */
    reset(): void {
      this.$reset();
      autonomousLogger.info('Store reset');
    },

    // ==========================================
    // Event Listener Setup
    // ==========================================

    /**
     * Initialize event listeners for real-time updates from main process
     */
    initEventListeners(): void {
      if (!(window as any).electronAPI || !(window as any).electronAPI.on) {
        autonomousLogger.warn('electronAPI.on not available, skipping event listeners');
        return;
      }

      const api = (window as any).electronAPI;

      // Goal progress updates
      api.on('agent:goal-progress', (data: GoalProgressEvent) => {
        const goal = this.activeGoals.find((g) => g.id === data.goalId);
        if (goal) {
          goal.stepCount = data.step;
        }
        autonomousLogger.info(`Goal progress: ${data.goalId} step ${data.step}`);
      });

      // Goal completed
      api.on('agent:goal-completed', (data: { goalId: string; result: any; stepCount: number; tokensUsed: number }) => {
        const index = this.activeGoals.findIndex((g) => g.id === data.goalId);
        if (index !== -1) {
          const goal = this.activeGoals[index];
          goal.status = 'completed';
          goal.result = data.result;
          goal.stepCount = data.stepCount;
          goal.tokensUsed = data.tokensUsed;
          goal.completedAt = new Date().toISOString();

          // Move to history
          this.goalHistory.unshift({ ...goal });
          this.activeGoals.splice(index, 1);
        }
        this.inputRequests.delete(data.goalId);
        autonomousLogger.info(`Goal completed: ${data.goalId}`);
      });

      // Goal failed
      api.on('agent:goal-failed', (data: { goalId: string; error: string; stepCount: number }) => {
        const index = this.activeGoals.findIndex((g) => g.id === data.goalId);
        if (index !== -1) {
          const goal = this.activeGoals[index];
          goal.status = 'failed';
          goal.errorMessage = data.error;
          goal.stepCount = data.stepCount;
          goal.completedAt = new Date().toISOString();

          this.goalHistory.unshift({ ...goal });
          this.activeGoals.splice(index, 1);
        }
        this.inputRequests.delete(data.goalId);
        autonomousLogger.error(`Goal failed: ${data.goalId} - ${data.error}`);
      });

      // Goal paused
      api.on('agent:goal-paused', (data: { goalId: string }) => {
        const goal = this.activeGoals.find((g) => g.id === data.goalId);
        if (goal) {
          goal.status = 'paused';
          goal.paused = true;
        }
      });

      // Goal resumed
      api.on('agent:goal-resumed', (data: { goalId: string }) => {
        const goal = this.activeGoals.find((g) => g.id === data.goalId);
        if (goal) {
          goal.status = 'running';
          goal.paused = false;
        }
      });

      // Goal cancelled
      api.on('agent:goal-cancelled', (data: { goalId: string }) => {
        const index = this.activeGoals.findIndex((g) => g.id === data.goalId);
        if (index !== -1) {
          this.activeGoals.splice(index, 1);
        }
        this.inputRequests.delete(data.goalId);
      });

      // Input requested
      api.on('agent:input-requested', (data: { goalId: string; question: string; options: string[] }) => {
        const goal = this.activeGoals.find((g) => g.id === data.goalId);
        if (goal) {
          goal.status = 'waiting_input';
          goal.waitingForInput = true;
          goal.inputRequest = {
            question: data.question,
            options: data.options || [],
            requestedAt: Date.now(),
          };
        }
        this.inputRequests.set(data.goalId, {
          question: data.question,
          options: data.options || [],
          requestedAt: Date.now(),
        });
      });

      // Input provided
      api.on('agent:input-provided', (data: { goalId: string }) => {
        const goal = this.activeGoals.find((g) => g.id === data.goalId);
        if (goal) {
          goal.status = 'running';
          goal.waitingForInput = false;
          goal.inputRequest = null;
        }
        this.inputRequests.delete(data.goalId);
      });

      // Goal submitted
      api.on('agent:goal-submitted', (data: { goalId: string; description: string; priority: number }) => {
        autonomousLogger.info(`New goal submitted event: ${data.goalId}`);
      });

      autonomousLogger.info('Event listeners initialized');
    },
  },
});
