/**
 * Performance Monitor Store
 *
 * Pinia store for managing auto-tuner state, tuning rules,
 * history, and renderer-side performance metrics collection.
 *
 * Communicates with the main process via IPC channels prefixed with 'auto-tuner:'.
 *
 * @module stores/performance-monitor
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

export interface TuningRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  cooldownMs: number;
  lastTriggered: number | null;
  triggerCount: number;
  consecutiveRequired: number;
  consecutiveCount: number;
}

export interface TuningHistoryEntry {
  ruleId: string;
  ruleName: string;
  timestamp: number;
  action: string;
  result: string;
}

export interface AutoTunerStats {
  totalEvaluations: number;
  totalTriggers: number;
  lastEvaluationTime: number | null;
  isRunning: boolean;
  rulesCount: number;
  enabledRulesCount: number;
  historyCount: number;
}

export interface RendererMetrics {
  fps: number;
  domNodes: number;
  jsHeap: { used: number; total: number; limit: number };
}

interface PerformanceMonitorState {
  rules: TuningRule[];
  history: TuningHistoryEntry[];
  stats: AutoTunerStats | null;
  rendererMetrics: RendererMetrics;
  isCollecting: boolean;
  loading: boolean;
  error: string | null;
  _fpsInterval: ReturnType<typeof setInterval> | null;
  _reportInterval: ReturnType<typeof setInterval> | null;
  _fpsFrameCount: number;
  _fpsLastTime: number;
  _rafId: number | null;
}

// ==================== Store ====================

export const usePerformanceMonitorStore = defineStore('performance-monitor', {
  state: (): PerformanceMonitorState => ({
    rules: [],
    history: [],
    stats: null,
    rendererMetrics: {
      fps: 0,
      domNodes: 0,
      jsHeap: { used: 0, total: 0, limit: 0 },
    },
    isCollecting: false,
    loading: false,
    error: null,
    _fpsInterval: null,
    _reportInterval: null,
    _fpsFrameCount: 0,
    _fpsLastTime: 0,
    _rafId: null,
  }),

  getters: {
    /**
     * Rules that are currently enabled
     */
    enabledRules(): TuningRule[] {
      return this.rules.filter((r) => r.enabled);
    },

    /**
     * Rules that are currently disabled
     */
    disabledRules(): TuningRule[] {
      return this.rules.filter((r) => !r.enabled);
    },

    /**
     * Most recently triggered rules (top 5)
     */
    recentlyTriggered(): TuningRule[] {
      return [...this.rules]
        .filter((r) => r.lastTriggered !== null)
        .sort((a, b) => (b.lastTriggered || 0) - (a.lastTriggered || 0))
        .slice(0, 5);
    },

    /**
     * Whether the auto-tuner is currently running on the main process
     */
    isRunning(): boolean {
      return this.stats?.isRunning ?? false;
    },
  },

  actions: {
    // ==========================================
    // Auto-Tuner Control
    // ==========================================

    /**
     * Start the auto-tuner evaluation loop
     */
    async startAutoTuner(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:start');
        if (result && !result.success) {
          this.error = result.error || 'Failed to start auto-tuner';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Stop the auto-tuner evaluation loop
     */
    async stopAutoTuner(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:stop');
        if (result && !result.success) {
          this.error = result.error || 'Failed to stop auto-tuner';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Rules Management
    // ==========================================

    /**
     * Fetch all tuning rules from the main process
     */
    async fetchRules(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:get-rules');
        if (result?.success) {
          this.rules = result.data || [];
        } else if (result) {
          this.error = result.error || 'Failed to fetch rules';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Enable a specific tuning rule
     */
    async enableRule(ruleId: string): Promise<void> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:enable-rule', ruleId);
        if (result?.success) {
          const rule = this.rules.find((r) => r.id === ruleId);
          if (rule) {
            rule.enabled = true;
          }
        } else if (result) {
          this.error = result.error || 'Failed to enable rule';
        }
      } catch (e: any) {
        this.error = e.message;
      }
    },

    /**
     * Disable a specific tuning rule
     */
    async disableRule(ruleId: string): Promise<void> {
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:disable-rule', ruleId);
        if (result?.success) {
          const rule = this.rules.find((r) => r.id === ruleId);
          if (rule) {
            rule.enabled = false;
          }
        } else if (result) {
          this.error = result.error || 'Failed to disable rule';
        }
      } catch (e: any) {
        this.error = e.message;
      }
    },

    /**
     * Add a custom tuning rule
     */
    async addRule(rule: Partial<TuningRule>): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:add-rule', rule);
        if (result?.success) {
          await this.fetchRules();
        } else if (result) {
          this.error = result.error || 'Failed to add rule';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Remove a tuning rule
     */
    async removeRule(ruleId: string): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:remove-rule', ruleId);
        if (result?.success) {
          this.rules = this.rules.filter((r) => r.id !== ruleId);
        } else if (result) {
          this.error = result.error || 'Failed to remove rule';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Manually trigger a specific tuning rule
     */
    async manualTune(ruleId: string): Promise<TuningHistoryEntry | null> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:manual-tune', ruleId);
        if (result?.success) {
          // Prepend to local history
          if (result.data) {
            this.history.unshift(result.data);
          }
          return result.data || null;
        } else if (result) {
          this.error = result.error || 'Failed to manually trigger rule';
        }
        return null;
      } catch (e: any) {
        this.error = e.message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // History & Stats
    // ==========================================

    /**
     * Fetch tuning action history
     */
    async fetchHistory(limit: number = 50): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:get-history', limit);
        if (result?.success) {
          this.history = result.data || [];
        } else if (result) {
          this.error = result.error || 'Failed to fetch history';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch evaluation statistics
     */
    async fetchStats(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:get-stats');
        if (result?.success) {
          this.stats = result.data || null;
        } else if (result) {
          this.error = result.error || 'Failed to fetch stats';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Trigger a one-off evaluation
     */
    async evaluate(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI?.invoke('auto-tuner:evaluate');
        if (result?.success) {
          // If any rules were triggered, refresh history
          if (result.data && result.data.length > 0) {
            await this.fetchHistory();
          }
        } else if (result) {
          this.error = result.error || 'Evaluation failed';
        }
      } catch (e: any) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // Renderer Metrics Collection
    // ==========================================

    /**
     * Start collecting renderer-side metrics (FPS, DOM nodes, JS heap)
     * and periodically report them to the main process.
     */
    startRendererMetricsCollection(): void {
      if (this.isCollecting) {
        return;
      }

      this.isCollecting = true;
      this._fpsFrameCount = 0;
      this._fpsLastTime = performance.now();

      // Start FPS counting via requestAnimationFrame
      const countFrame = () => {
        this._fpsFrameCount++;
        if (this.isCollecting) {
          this._rafId = requestAnimationFrame(countFrame);
        }
      };
      this._rafId = requestAnimationFrame(countFrame);

      // Calculate FPS and collect other metrics every second
      this._fpsInterval = setInterval(() => {
        this._collectRendererMetrics();
      }, 1000);

      // Report to main process every 5 seconds
      this._reportInterval = setInterval(() => {
        this._reportToMain();
      }, 5000);
    },

    /**
     * Stop renderer-side metrics collection
     */
    stopRendererMetricsCollection(): void {
      this.isCollecting = false;

      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }

      if (this._fpsInterval !== null) {
        clearInterval(this._fpsInterval);
        this._fpsInterval = null;
      }

      if (this._reportInterval !== null) {
        clearInterval(this._reportInterval);
        this._reportInterval = null;
      }
    },

    /**
     * Collect FPS, DOM node count, and JS heap size
     * @private
     */
    _collectRendererMetrics(): void {
      const now = performance.now();
      const elapsed = now - this._fpsLastTime;

      // Calculate FPS
      if (elapsed > 0) {
        this.rendererMetrics.fps = Math.round(
          (this._fpsFrameCount / elapsed) * 1000
        );
      }
      this._fpsFrameCount = 0;
      this._fpsLastTime = now;

      // DOM node count
      if (typeof document !== 'undefined') {
        this.rendererMetrics.domNodes = document.querySelectorAll('*').length;
      }

      // JS heap size (Chrome/Electron only)
      const perfMemory = (performance as any).memory;
      if (perfMemory) {
        this.rendererMetrics.jsHeap = {
          used: perfMemory.usedJSHeapSize || 0,
          total: perfMemory.totalJSHeapSize || 0,
          limit: perfMemory.jsHeapSizeLimit || 0,
        };
      }
    },

    /**
     * Send current renderer metrics to the main process via IPC
     * @private
     */
    async _reportToMain(): Promise<void> {
      try {
        await (window as any).electronAPI?.invoke(
          'auto-tuner:report-renderer-metrics',
          {
            fps: this.rendererMetrics.fps,
            domNodes: this.rendererMetrics.domNodes,
            jsHeap: { ...this.rendererMetrics.jsHeap },
          }
        );
      } catch {
        // Silently ignore reporting errors to avoid log noise
      }
    },

    // ==========================================
    // Utility
    // ==========================================

    /**
     * Clear the error state
     */
    clearError(): void {
      this.error = null;
    },

    /**
     * Reset all state
     */
    reset(): void {
      this.stopRendererMetricsCollection();
      this.$reset();
    },
  },
});
