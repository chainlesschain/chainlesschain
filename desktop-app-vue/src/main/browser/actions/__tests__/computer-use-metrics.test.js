/**
 * ComputerUseMetrics 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { ComputerUseMetrics, TimeRange, MetricType, getComputerUseMetrics } = require('../computer-use-metrics');

describe('ComputerUseMetrics', () => {
  let metrics;

  beforeEach(() => {
    vi.clearAllMocks();
    metrics = new ComputerUseMetrics({ enabled: true });
  });

  afterEach(() => {
    metrics.stop();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(metrics.config.enabled).toBe(true);
      expect(metrics.counters).toBeDefined();
      expect(metrics.gauges).toBeDefined();
      expect(metrics.histograms).toBeDefined();
    });

    it('should accept custom config', () => {
      const m = new ComputerUseMetrics({
        retentionDays: 14
      });

      expect(m.config.retentionDays).toBe(14);
      m.stop();
    });
  });

  describe('recordOperation', () => {
    it('should record successful operation', () => {
      metrics.recordOperation({
        type: 'click',
        action: 'single',
        success: true,
        duration: 50
      });

      const stats = metrics.getSessionStats();
      expect(stats.operations).toBe(1);
      expect(stats.successes).toBe(1);
    });

    it('should record failed operation', () => {
      metrics.recordOperation({
        type: 'click',
        action: 'single',
        success: false,
        error: 'Element not found'
      });

      const stats = metrics.getSessionStats();
      expect(stats.failures).toBe(1);
    });

    it('should track type statistics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'type', action: 'text', success: true });

      const typeStats = metrics.getTypeStats();
      const clickStat = typeStats.find(s => s.type === 'click');
      expect(clickStat.count).toBe(2);
    });

    it('should track errors', () => {
      metrics.recordOperation({
        type: 'click',
        action: 'single',
        success: false,
        error: 'Element not found'
      });

      const errorStats = metrics.getErrorStats();
      expect(errorStats.length).toBeGreaterThan(0);
    });
  });

  describe('getSessionStats', () => {
    it('should return session statistics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true, duration: 50 });
      metrics.recordOperation({ type: 'type', action: 'text', success: true, duration: 100 });
      metrics.recordOperation({ type: 'click', action: 'single', success: false, duration: 30 });

      const stats = metrics.getSessionStats();

      expect(stats.operations).toBe(3);
      expect(stats.successes).toBe(2);
      expect(stats.failures).toBe(1);
      expect(stats.avgDuration).toBeCloseTo(60, 0);
    });

    it('should include uptime', () => {
      const stats = metrics.getSessionStats();

      expect(stats.uptime).toBeGreaterThanOrEqual(0);
      expect(stats.uptimeFormatted).toBeDefined();
    });
  });

  describe('getTypeStats', () => {
    it('should get operation type statistics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'type', action: 'text', success: true });

      const stats = metrics.getTypeStats();

      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBe(2);
    });

    it('should calculate success rate per type', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'click', action: 'single', success: false });

      const stats = metrics.getTypeStats();
      const clickStat = stats.find(s => s.type === 'click');

      expect(clickStat.successRate).toBe(50);
    });
  });

  describe('getErrorStats', () => {
    it('should get error statistics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: false, error: 'Not found' });
      metrics.recordOperation({ type: 'click', action: 'single', success: false, error: 'Timeout' });

      const stats = metrics.getErrorStats();

      expect(stats.length).toBe(2);
    });

    it('should group similar errors', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: false, error: 'Element 123 not found' });
      metrics.recordOperation({ type: 'click', action: 'single', success: false, error: 'Element 456 not found' });

      const stats = metrics.getErrorStats();

      // Errors are normalized, so similar errors are grouped
      expect(stats.length).toBe(1);
      expect(stats[0].count).toBe(2);
    });
  });

  describe('setGauge and incrementGauge', () => {
    it('should set gauge value', () => {
      metrics.setGauge('active_recordings', 5);

      const allMetrics = metrics.getAllMetrics();
      expect(allMetrics.gauges.active_recordings).toBe(5);
    });

    it('should increment gauge', () => {
      metrics.setGauge('active_recordings', 2);
      metrics.incrementGauge('active_recordings', 3);

      const allMetrics = metrics.getAllMetrics();
      expect(allMetrics.gauges.active_recordings).toBe(5);
    });

    it('should decrement gauge', () => {
      metrics.setGauge('active_recordings', 5);
      metrics.decrementGauge('active_recordings', 2);

      const allMetrics = metrics.getAllMetrics();
      expect(allMetrics.gauges.active_recordings).toBe(3);
    });
  });

  describe('getTimeSeries', () => {
    it('should return time series data', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'click', action: 'single', success: true });

      const series = metrics.getTimeSeries(TimeRange.HOUR);

      expect(Array.isArray(series)).toBe(true);
    });

    it('should support different time ranges', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });

      const hourly = metrics.getTimeSeries(TimeRange.HOUR);
      const daily = metrics.getTimeSeries(TimeRange.DAY);

      // Time series includes buckets that cover the time range (may include partial buckets)
      expect(hourly.length).toBeLessThanOrEqual(65); // ~60 minutes + some buffer
      expect(daily.length).toBeLessThanOrEqual(30); // ~24 hours + some buffer
    });
  });

  describe('getAllMetrics', () => {
    it('should return all metrics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });

      const all = metrics.getAllMetrics();

      expect(all.counters).toBeDefined();
      expect(all.gauges).toBeDefined();
      expect(all.histograms).toBeDefined();
      expect(all.session).toBeDefined();
      expect(all.typeStats).toBeDefined();
      expect(all.errorStats).toBeDefined();
    });
  });

  describe('getSummary', () => {
    it('should return summary report', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true, duration: 50 });
      metrics.recordOperation({ type: 'type', action: 'text', success: true, duration: 100 });
      metrics.recordOperation({ type: 'click', action: 'single', success: false, duration: 30, error: 'Failed' });

      const summary = metrics.getSummary();

      expect(summary.overview).toBeDefined();
      expect(summary.overview.totalOperations).toBe(3);
      expect(summary.topOperations).toBeDefined();
      expect(summary.slowestOperations).toBeDefined();
      expect(summary.mostFailedOperations).toBeDefined();
      expect(summary.topErrors).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      metrics.recordOperation({ type: 'click', action: 'single', success: true });
      metrics.recordOperation({ type: 'type', action: 'text', success: true });

      metrics.reset();

      const stats = metrics.getSessionStats();
      expect(stats.operations).toBe(0);
    });

    it('should emit reset event', () => {
      const handler = vi.fn();
      metrics.on('reset', handler);

      metrics.reset();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('TimeRange constants', () => {
    it('should have all ranges defined', () => {
      expect(TimeRange.HOUR).toBe('hour');
      expect(TimeRange.DAY).toBe('day');
      expect(TimeRange.WEEK).toBe('week');
      expect(TimeRange.MONTH).toBe('month');
      expect(TimeRange.ALL).toBe('all');
    });
  });

  describe('MetricType constants', () => {
    it('should have all types defined', () => {
      expect(MetricType.COUNTER).toBe('counter');
      expect(MetricType.GAUGE).toBe('gauge');
      expect(MetricType.HISTOGRAM).toBe('histogram');
      expect(MetricType.SUMMARY).toBe('summary');
    });
  });

  describe('getComputerUseMetrics singleton', () => {
    it('should return singleton instance', () => {
      const m1 = getComputerUseMetrics();
      const m2 = getComputerUseMetrics();

      expect(m1).toBe(m2);
    });

    it('should create instance of ComputerUseMetrics', () => {
      const m = getComputerUseMetrics();
      expect(m).toBeInstanceOf(ComputerUseMetrics);
    });
  });

  describe('disabled metrics', () => {
    it('should not record when disabled', () => {
      const m = new ComputerUseMetrics({ enabled: false });

      m.recordOperation({ type: 'click', action: 'single', success: true });

      const stats = m.getSessionStats();
      expect(stats.operations).toBe(0);

      m.stop();
    });
  });
});
