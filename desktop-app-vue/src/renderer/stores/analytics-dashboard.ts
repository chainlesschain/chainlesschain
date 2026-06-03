/**
 * Analytics Dashboard Store
 *
 * Pinia store for managing the Advanced Analytics Dashboard state.
 * Communicates with the main process via IPC channels prefixed with 'analytics:'.
 *
 * @module stores/analytics-dashboard
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

export interface KPIs {
  totalAICalls: number;
  totalTokens: number;
  tokenCost: number;
  skillExecutions: number;
  skillSuccessRate: number;
  errorCount: number;
  activePeers: number;
  uptime: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface TopItem {
  name: string;
  count?: number;
  calls?: number;
  successRate?: number;
  avgDuration?: number;
  totalTokens?: number;
  totalCost?: number;
  [key: string]: any;
}

export interface DashboardSummary {
  current: any;
  period: string;
  kpis: KPIs;
  historyCount: number;
}

interface AnalyticsDashboardState {
  summary: DashboardSummary | null;
  kpis: KPIs | null;
  aiTimeSeries: TimeSeriesPoint[];
  skillTimeSeries: TimeSeriesPoint[];
  errorTimeSeries: TimeSeriesPoint[];
  topSkills: TopItem[];
  topModels: TopItem[];
  topErrors: TopItem[];
  selectedPeriod: string;
  autoRefresh: boolean;
  loading: boolean;
  error: string | null;
  _realtimeListener: any;
}

// ==================== Store ====================

export const useAnalyticsDashboardStore = defineStore('analytics-dashboard', {
  state: (): AnalyticsDashboardState => ({
    summary: null,
    kpis: null,
    aiTimeSeries: [],
    skillTimeSeries: [],
    errorTimeSeries: [],
    topSkills: [],
    topModels: [],
    topErrors: [],
    selectedPeriod: '24h',
    autoRefresh: true,
    loading: false,
    error: null,
    _realtimeListener: null,
  }),

  getters: {
    /**
     * Format uptime seconds into a human-readable string (e.g., "2d 5h 13m")
     */
    formattedUptime(): string {
      const seconds = this.kpis?.uptime || 0;
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);

      const parts: string[] = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0) parts.push(`${hours}h`);
      parts.push(`${minutes}m`);
      return parts.join(' ');
    },

    /**
     * Format token cost to a dollar string (e.g., "$1.23")
     */
    tokenCostFormatted(): string {
      const cost = this.kpis?.tokenCost || 0;
      return `$${cost.toFixed(2)}`;
    },

    /**
     * Whether data has been loaded at least once
     */
    hasData(): boolean {
      return this.summary !== null;
    },

    /**
     * Skill success rate as a formatted percentage string
     */
    skillSuccessRateFormatted(): string {
      const rate = this.kpis?.skillSuccessRate || 0;
      return `${(rate * 100).toFixed(1)}%`;
    },
  },

  actions: {
    // ==========================================
    // Dashboard Data Fetching
    // ==========================================

    /**
     * Fetch the main dashboard summary for the selected period
     */
    async fetchDashboard(period?: string): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const targetPeriod = period || this.selectedPeriod;
        const result = await (window as any).electronAPI?.invoke(
          'analytics:get-dashboard-summary',
          targetPeriod,
        );
        if (result?.success) {
          this.summary = result.data;
          this.kpis = result.data.kpis || null;
          if (period) {
            this.selectedPeriod = period;
          }
        } else if (result) {
          this.error = result.error || 'Failed to fetch dashboard summary';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch time-series data for a specific metric
     */
    async fetchTimeSeries(
      metric: string,
      granularity?: string,
    ): Promise<TimeSeriesPoint[]> {
      this.error = null;

      try {
        const from = this._periodToTimestamp(this.selectedPeriod);
        const result = await (window as any).electronAPI?.invoke(
          'analytics:get-time-series',
          { metric, from, granularity: granularity || 'hourly' },
        );
        if (result?.success) {
          const data: TimeSeriesPoint[] = result.data || [];

          // Route to the appropriate state property
          if (metric.startsWith('ai.')) {
            this.aiTimeSeries = data;
          } else if (metric.startsWith('skills.')) {
            this.skillTimeSeries = data;
          } else if (metric.startsWith('errors.')) {
            this.errorTimeSeries = data;
          }

          return data;
        } else if (result) {
          this.error = result.error || 'Failed to fetch time series';
        }
      } catch (e: any) {
        this.error = e.message;
      }
      return [];
    },

    /**
     * Fetch top skills by execution count
     */
    async fetchTopSkills(n?: number): Promise<void> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke(
          'analytics:get-top-n',
          { metric: 'skills', n: n || 10, period: this.selectedPeriod },
        );
        if (result?.success) {
          this.topSkills = result.data || [];
        } else if (result) {
          this.error = result.error || 'Failed to fetch top skills';
        }
      } catch (e: any) {
        this.error = e.message;
      }
    },

    /**
     * Fetch top models by call count
     */
    async fetchTopModels(n?: number): Promise<void> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke(
          'analytics:get-top-n',
          { metric: 'models', n: n || 10, period: this.selectedPeriod },
        );
        if (result?.success) {
          this.topModels = result.data || [];
        } else if (result) {
          this.error = result.error || 'Failed to fetch top models';
        }
      } catch (e: any) {
        this.error = e.message;
      }
    },

    /**
     * Fetch top error types
     */
    async fetchTopErrors(n?: number): Promise<void> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke(
          'analytics:get-top-n',
          { metric: 'errors', n: n || 10, period: this.selectedPeriod },
        );
        if (result?.success) {
          this.topErrors = result.data || [];
        } else if (result) {
          this.error = result.error || 'Failed to fetch top errors';
        }
      } catch (e: any) {
        this.error = e.message;
      }
    },

    // ==========================================
    // Export
    // ==========================================

    /**
     * Export analytics data as CSV
     */
    async exportCSV(): Promise<string | null> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke(
          'analytics:export-csv',
          this.selectedPeriod,
        );
        if (result?.success) {
          return result.data;
        } else if (result) {
          this.error = result.error || 'Failed to export CSV';
        }
      } catch (e: any) {
        this.error = e.message;
      }
      return null;
    },

    /**
     * Export analytics data as JSON
     */
    async exportJSON(): Promise<any> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke(
          'analytics:export-json',
          this.selectedPeriod,
        );
        if (result?.success) {
          return result.data;
        } else if (result) {
          this.error = result.error || 'Failed to export JSON';
        }
      } catch (e: any) {
        this.error = e.message;
      }
      return null;
    },

    // ==========================================
    // Real-time Updates
    // ==========================================

    /**
     * Start listening for real-time metric updates from the main process
     */
    startRealtimeUpdates(): void {
      if (this._realtimeListener) return;

      const handler = (_event: any, snapshot: any) => {
        if (!snapshot) return;

        // Update KPIs from real-time snapshot
        this.kpis = {
          totalAICalls: snapshot.ai?.totalCalls || 0,
          totalTokens: snapshot.ai?.totalTokens || 0,
          tokenCost: snapshot.ai?.costEstimate || 0,
          skillExecutions: snapshot.skills?.totalExecutions || 0,
          skillSuccessRate: snapshot.skills?.successRate || 0,
          errorCount: snapshot.errors?.totalErrors || 0,
          activePeers: snapshot.p2p?.activePeers || 0,
          uptime: snapshot.system?.uptime || 0,
          cpuUsage: snapshot.system?.cpuUsage || 0,
          memoryUsage: snapshot.system?.memoryUsage || 0,
        };

        // Update summary current data
        if (this.summary) {
          this.summary.current = snapshot;
        }
      };

      (window as any).electronAPI?.on('analytics:realtime-update', handler);
      this._realtimeListener = handler;
    },

    /**
     * Stop listening for real-time metric updates
     */
    stopRealtimeUpdates(): void {
      if (this._realtimeListener) {
        (window as any).electronAPI?.removeListener?.(
          'analytics:realtime-update',
          this._realtimeListener,
        );
        this._realtimeListener = null;
      }
    },

    // ==========================================
    // Composite Actions
    // ==========================================

    /**
     * Refresh all dashboard data at once
     */
    async refreshAll(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        await Promise.all([
          this.fetchDashboard(),
          this.fetchTimeSeries('ai.totalTokens'),
          this.fetchTimeSeries('skills.totalExecutions'),
          this.fetchTimeSeries('errors.totalErrors'),
          this.fetchTopSkills(),
          this.fetchTopModels(),
          this.fetchTopErrors(),
        ]);
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Utility
    // ==========================================

    /**
     * Convert period string to a timestamp
     * @private
     */
    _periodToTimestamp(period: string): number {
      const now = Date.now();
      const units: Record<string, number> = {
        h: 3600000,
        d: 86400000,
        w: 604800000,
        m: 2592000000,
      };
      const match = period.match(/^(\d+)([hdwm])$/);
      if (match) {
        return now - parseInt(match[1], 10) * units[match[2]];
      }
      return now - 86400000;
    },

    /**
     * Clear error state
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * Reset all state
     */
    reset(): void {
      this.stopRealtimeUpdates();
      this.$reset();
    },
  },
});
