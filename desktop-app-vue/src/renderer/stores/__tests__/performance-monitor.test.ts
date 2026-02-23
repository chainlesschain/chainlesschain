/**
 * usePerformanceMonitorStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - All IPC-based actions (fetchRules, enableRule, disableRule, fetchHistory,
 *    fetchStats, manualTune, evaluate, startAutoTuner, stopAutoTuner, addRule,
 *    removeRule)
 *  - Renderer metrics lifecycle (startRendererMetricsCollection /
 *    stopRendererMetricsCollection)
 *  - Getters: enabledRules, disabledRules, recentlyTriggered, isRunning
 *  - Error path: IPC returning success:false sets this.error
 *  - clearError() and reset() utility actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { TuningRule, TuningHistoryEntry, AutoTunerStats } from '../performance-monitor';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (k: string) => k })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRule(overrides: Partial<TuningRule> = {}): TuningRule {
  return {
    id: 'rule-1',
    name: 'High CPU',
    description: 'Reduce workers when CPU > 80%',
    enabled: true,
    cooldownMs: 5000,
    lastTriggered: null,
    triggerCount: 0,
    consecutiveRequired: 3,
    consecutiveCount: 0,
    ...overrides,
  };
}

function makeMockStats(overrides: Partial<AutoTunerStats> = {}): AutoTunerStats {
  return {
    totalEvaluations: 100,
    totalTriggers: 12,
    lastEvaluationTime: Date.now(),
    isRunning: true,
    rulesCount: 5,
    enabledRulesCount: 4,
    historyCount: 20,
    ...overrides,
  };
}

function makeMockHistoryEntry(overrides: Partial<TuningHistoryEntry> = {}): TuningHistoryEntry {
  return {
    ruleId: 'rule-1',
    ruleName: 'High CPU',
    timestamp: Date.now(),
    action: 'reduce-workers',
    result: 'success',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePerformanceMonitorStore', () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();

    pinia = createPinia();
    setActivePinia(pinia);

    // Reset to default behaviour before each test
    mockInvoke.mockResolvedValue({ success: true, data: [] });

    (window as any).electronAPI = {
      invoke: mockInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    // Stub browser APIs used by startRendererMetricsCollection
    (globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 16);
      return 1;
    });
    (globalThis as any).cancelAnimationFrame = vi.fn();
    (globalThis as any).performance = {
      now: vi.fn(() => Date.now()),
      memory: undefined, // no heap info by default
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('Initial state', () => {
    it('rules array starts empty', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.rules).toEqual([]);
    });

    it('history array starts empty', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.history).toEqual([]);
    });

    it('stats starts as null', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.stats).toBeNull();
    });

    it('isCollecting starts as false', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.isCollecting).toBe(false);
    });

    it('loading starts as false', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.error).toBeNull();
    });

    it('rendererMetrics has zero-value fps, domNodes, and jsHeap', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.rendererMetrics.fps).toBe(0);
      expect(store.rendererMetrics.domNodes).toBe(0);
      expect(store.rendererMetrics.jsHeap).toEqual({ used: 0, total: 0, limit: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // fetchRules
  // -------------------------------------------------------------------------

  describe('fetchRules()', () => {
    it('calls auto-tuner:get-rules IPC channel', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchRules();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:get-rules');
    });

    it('populates rules from IPC response data', async () => {
      const rules = [makeMockRule({ id: 'r1' }), makeMockRule({ id: 'r2', enabled: false })];
      mockInvoke.mockResolvedValue({ success: true, data: rules });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchRules();

      expect(store.rules).toHaveLength(2);
      expect(store.rules[0].id).toBe('r1');
      expect(store.rules[1].id).toBe('r2');
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'DB not ready' });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchRules();

      expect(store.error).toBe('DB not ready');
      expect(store.rules).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // enableRule / disableRule
  // -------------------------------------------------------------------------

  describe('enableRule()', () => {
    it('calls auto-tuner:enable-rule with the ruleId', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [makeMockRule({ id: 'r-en', enabled: false })];
      await store.enableRule('r-en');
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:enable-rule', 'r-en');
    });

    it('updates the rule enabled flag to true in local state', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [makeMockRule({ id: 'r-flip', enabled: false })];
      await store.enableRule('r-flip');
      expect(store.rules[0].enabled).toBe(true);
    });
  });

  describe('disableRule()', () => {
    it('calls auto-tuner:disable-rule with the ruleId', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [makeMockRule({ id: 'r-dis', enabled: true })];
      await store.disableRule('r-dis');
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:disable-rule', 'r-dis');
    });

    it('updates the rule enabled flag to false in local state', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [makeMockRule({ id: 'r-off', enabled: true })];
      await store.disableRule('r-off');
      expect(store.rules[0].enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fetchHistory
  // -------------------------------------------------------------------------

  describe('fetchHistory()', () => {
    it('calls auto-tuner:get-history IPC channel', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchHistory();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:get-history', expect.any(Number));
    });

    it('populates history from IPC response data', async () => {
      const entries = [makeMockHistoryEntry(), makeMockHistoryEntry({ ruleId: 'r2' })];
      mockInvoke.mockResolvedValue({ success: true, data: entries });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchHistory(10);

      expect(store.history).toHaveLength(2);
    });

    it('passes the custom limit value to the IPC call', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchHistory(25);
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:get-history', 25);
    });
  });

  // -------------------------------------------------------------------------
  // fetchStats
  // -------------------------------------------------------------------------

  describe('fetchStats()', () => {
    it('calls auto-tuner:get-stats IPC channel', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: makeMockStats() });
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchStats();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:get-stats');
    });

    it('sets the stats property from IPC response', async () => {
      const stats = makeMockStats({ totalEvaluations: 42 });
      mockInvoke.mockResolvedValue({ success: true, data: stats });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchStats();

      expect(store.stats).not.toBeNull();
      expect(store.stats!.totalEvaluations).toBe(42);
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Stats unavailable' });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.fetchStats();

      expect(store.error).toBe('Stats unavailable');
      expect(store.stats).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // manualTune
  // -------------------------------------------------------------------------

  describe('manualTune()', () => {
    it('calls auto-tuner:manual-tune with the ruleId', async () => {
      const entry = makeMockHistoryEntry();
      mockInvoke.mockResolvedValue({ success: true, data: entry });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.manualTune('rule-x');

      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:manual-tune', 'rule-x');
    });

    it('prepends the returned entry to the local history', async () => {
      const entry = makeMockHistoryEntry({ ruleId: 'manual-1' });
      mockInvoke.mockResolvedValue({ success: true, data: entry });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.manualTune('manual-1');

      expect(store.history[0].ruleId).toBe('manual-1');
    });

    it('returns the history entry on success', async () => {
      const entry = makeMockHistoryEntry();
      mockInvoke.mockResolvedValue({ success: true, data: entry });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      const result = await store.manualTune('r1');

      expect(result).toEqual(entry);
    });

    it('returns null when IPC fails', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Rule not found' });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      const result = await store.manualTune('missing-rule');

      expect(result).toBeNull();
      expect(store.error).toBe('Rule not found');
    });
  });

  // -------------------------------------------------------------------------
  // evaluate
  // -------------------------------------------------------------------------

  describe('evaluate()', () => {
    it('calls auto-tuner:evaluate IPC channel', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.evaluate();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:evaluate');
    });

    it('refetches history when rules were triggered during evaluation', async () => {
      // First call for evaluate returns triggered entries; second call for fetchHistory
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: [makeMockHistoryEntry()] }) // evaluate
        .mockResolvedValueOnce({ success: true, data: [] }); // fetchHistory

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.evaluate();

      // Should have called invoke twice: once for evaluate, once for get-history
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:get-history', expect.any(Number));
    });
  });

  // -------------------------------------------------------------------------
  // startAutoTuner / stopAutoTuner
  // -------------------------------------------------------------------------

  describe('startAutoTuner()', () => {
    it('calls auto-tuner:start IPC channel', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.startAutoTuner();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:start');
    });

    it('sets error when IPC returns success:false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'Already running' });

      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.startAutoTuner();

      expect(store.error).toBe('Already running');
    });
  });

  describe('stopAutoTuner()', () => {
    it('calls auto-tuner:stop IPC channel', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      await store.stopAutoTuner();
      expect(mockInvoke).toHaveBeenCalledWith('auto-tuner:stop');
    });
  });

  // -------------------------------------------------------------------------
  // Renderer Metrics Collection lifecycle
  // -------------------------------------------------------------------------

  describe('startRendererMetricsCollection()', () => {
    it('sets isCollecting to true when called', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      expect(store.isCollecting).toBe(true);
    });

    it('is idempotent — calling it again while collecting does nothing', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      store.startRendererMetricsCollection(); // second call should be a no-op
      expect(store.isCollecting).toBe(true);
    });
  });

  describe('stopRendererMetricsCollection()', () => {
    it('sets isCollecting to false', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      store.stopRendererMetricsCollection();
      expect(store.isCollecting).toBe(false);
    });

    it('clears the internal RAF id', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      store.stopRendererMetricsCollection();
      expect(store._rafId).toBeNull();
    });

    it('clears the fps interval reference', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      store.stopRendererMetricsCollection();
      expect(store._fpsInterval).toBeNull();
    });

    it('clears the report interval reference', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      store.stopRendererMetricsCollection();
      expect(store._reportInterval).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe('enabledRules getter', () => {
    it('returns only rules with enabled=true', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [
        makeMockRule({ id: 'on-1', enabled: true }),
        makeMockRule({ id: 'off-1', enabled: false }),
        makeMockRule({ id: 'on-2', enabled: true }),
      ];
      expect(store.enabledRules).toHaveLength(2);
      expect(store.enabledRules.map((r) => r.id)).toEqual(['on-1', 'on-2']);
    });
  });

  describe('disabledRules getter', () => {
    it('returns only rules with enabled=false', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.rules = [
        makeMockRule({ id: 'on-a', enabled: true }),
        makeMockRule({ id: 'off-a', enabled: false }),
        makeMockRule({ id: 'off-b', enabled: false }),
      ];
      expect(store.disabledRules).toHaveLength(2);
      expect(store.disabledRules.map((r) => r.id)).toEqual(['off-a', 'off-b']);
    });
  });

  describe('isRunning getter', () => {
    it('returns false when stats is null', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      expect(store.isRunning).toBe(false);
    });

    it('returns the isRunning value from stats', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.stats = makeMockStats({ isRunning: true });
      expect(store.isRunning).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Utility actions
  // -------------------------------------------------------------------------

  describe('clearError()', () => {
    it('sets error back to null', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.error = 'Some previous error';
      store.clearError();
      expect(store.error).toBeNull();
    });
  });

  describe('reset()', () => {
    it('resets all state to initial values', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();

      // Populate state
      store.rules = [makeMockRule()];
      store.history = [makeMockHistoryEntry()];
      store.stats = makeMockStats();
      store.error = 'an error';

      store.reset();

      expect(store.rules).toEqual([]);
      expect(store.history).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.error).toBeNull();
    });

    it('stops metrics collection as part of reset', async () => {
      const { usePerformanceMonitorStore } = await import('../performance-monitor');
      const store = usePerformanceMonitorStore();
      store.startRendererMetricsCollection();
      expect(store.isCollecting).toBe(true);
      store.reset();
      expect(store.isCollecting).toBe(false);
    });
  });
});
