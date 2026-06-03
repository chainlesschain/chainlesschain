/**
 * RAG Metrics 单元测试
 * 测试目标: src/main/rag/metrics.js
 *
 * 覆盖场景:
 * - 性能指标记录 (检索、重排序、嵌入、查询重写)
 * - 统计计算 (平均值、最小值、最大值、百分位数)
 * - 缓存命中率统计
 * - 性能告警机制
 * - 实时性能概览
 * - 性能报告生成
 * - 指标导出和重置
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(),
}));

describe('RAGMetrics', () => {
  let RAGMetrics;
  let MetricTypes;
  let ragMetrics;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // 动态导入 RAGMetrics
    const module = await import('../../../src/main/rag/metrics.js');
    RAGMetrics = module.RAGMetrics;
    MetricTypes = module.MetricTypes;

    ragMetrics = new RAGMetrics();

    // 添加默认错误监听器以防止未处理错误
    ragMetrics.on('error', () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    ragMetrics = null;
  });

  // =====================================================================
  // 构造函数测试
  // =====================================================================

  describe('构造函数', () => {
    it('应该正确初始化 RAGMetrics', () => {
      expect(ragMetrics.metrics).toBeDefined();
      expect(ragMetrics.metrics.retrieval).toEqual([]);
      expect(ragMetrics.metrics.rerank).toEqual([]);
      expect(ragMetrics.metrics.embedding).toEqual([]);
      expect(ragMetrics.metrics.queryRewrite).toEqual([]);
      expect(ragMetrics.metrics.total).toEqual([]);
    });

    it('应该初始化统计数据', () => {
      expect(ragMetrics.stats).toEqual({
        totalQueries: 0,
        totalRetrievals: 0,
        totalReranks: 0,
        totalEmbeddings: 0,
        totalQueryRewrites: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: 0,
      });
    });

    it('应该设置滑动窗口大小', () => {
      expect(ragMetrics.windowSize).toBe(1000);
    });

    it('应该记录开始时间', () => {
      expect(ragMetrics.startTime).toBeDefined();
      expect(ragMetrics.startTime).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // 指标记录测试
  // =====================================================================

  describe('record - 指标记录', () => {
    it('应该记录检索指标', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 150);

      expect(ragMetrics.metrics.retrieval).toHaveLength(1);
      expect(ragMetrics.metrics.retrieval[0].value).toBe(150);
      expect(ragMetrics.stats.totalRetrievals).toBe(1);
    });

    it('应该记录重排序指标', () => {
      ragMetrics.record(MetricTypes.RERANK, 2000);

      expect(ragMetrics.metrics.rerank).toHaveLength(1);
      expect(ragMetrics.metrics.rerank[0].value).toBe(2000);
      expect(ragMetrics.stats.totalReranks).toBe(1);
    });

    it('应该记录嵌入指标', () => {
      ragMetrics.record(MetricTypes.EMBEDDING, 100);

      expect(ragMetrics.metrics.embedding).toHaveLength(1);
      expect(ragMetrics.stats.totalEmbeddings).toBe(1);
    });

    it('应该记录查询重写指标', () => {
      ragMetrics.record(MetricTypes.QUERY_REWRITE, 1500);

      expect(ragMetrics.metrics.queryRewrite).toHaveLength(1);
      expect(ragMetrics.stats.totalQueryRewrites).toBe(1);
    });

    it('应该记录总延迟指标', () => {
      ragMetrics.record(MetricTypes.TOTAL, 3000);

      expect(ragMetrics.metrics.total).toHaveLength(1);
      expect(ragMetrics.stats.totalQueries).toBe(1);
    });

    it('应该添加时间戳', () => {
      const before = Date.now();
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      const after = Date.now();

      const record = ragMetrics.metrics.retrieval[0];
      expect(record.timestamp).toBeGreaterThanOrEqual(before);
      expect(record.timestamp).toBeLessThanOrEqual(after);
    });

    it('应该支持额外元数据', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100, { query: 'test', hitCount: 5 });

      const record = ragMetrics.metrics.retrieval[0];
      expect(record.query).toBe('test');
      expect(record.hitCount).toBe(5);
    });

    it('应该触发 metric-recorded 事件', () => {
      const recordedSpy = vi.fn();
      ragMetrics.on('metric-recorded', recordedSpy);

      ragMetrics.record(MetricTypes.RETRIEVAL, 100);

      expect(recordedSpy).toHaveBeenCalled();
      expect(recordedSpy.mock.calls[0][0]).toMatchObject({
        type: MetricTypes.RETRIEVAL,
        value: 100,
      });
    });

    it('应该限制滑动窗口大小', () => {
      ragMetrics.windowSize = 5;

      // 添加 10 条记录
      for (let i = 0; i < 10; i++) {
        ragMetrics.record(MetricTypes.RETRIEVAL, i * 10);
      }

      expect(ragMetrics.metrics.retrieval.length).toBe(5);
    });

    it('滑动窗口应该保留最新记录', () => {
      ragMetrics.windowSize = 3;

      ragMetrics.record(MetricTypes.RETRIEVAL, 10);
      ragMetrics.record(MetricTypes.RETRIEVAL, 20);
      ragMetrics.record(MetricTypes.RETRIEVAL, 30);
      ragMetrics.record(MetricTypes.RETRIEVAL, 40); // 应该淘汰 10

      const values = ragMetrics.metrics.retrieval.map(r => r.value);
      expect(values).toEqual([20, 30, 40]);
    });
  });

  // =====================================================================
  // 计时器测试
  // =====================================================================

  describe('startTimer - 计时器', () => {
    it('应该创建计时器', () => {
      const stopTimer = ragMetrics.startTimer(MetricTypes.RETRIEVAL);

      expect(stopTimer).toBeInstanceOf(Function);
    });

    it('应该测量经过的时间', () => {
      const stopTimer = ragMetrics.startTimer(MetricTypes.RETRIEVAL);

      vi.advanceTimersByTime(150);
      const duration = stopTimer();

      expect(duration).toBeGreaterThanOrEqual(150);
    });

    it('应该自动记录指标', () => {
      const stopTimer = ragMetrics.startTimer(MetricTypes.RETRIEVAL);

      vi.advanceTimersByTime(100);
      stopTimer();

      expect(ragMetrics.metrics.retrieval).toHaveLength(1);
      expect(ragMetrics.metrics.retrieval[0].value).toBeGreaterThanOrEqual(100);
    });

    it('应该支持传递元数据', () => {
      const stopTimer = ragMetrics.startTimer(MetricTypes.RETRIEVAL);

      stopTimer({ query: 'test query', count: 5 });

      const record = ragMetrics.metrics.retrieval[0];
      expect(record.query).toBe('test query');
      expect(record.count).toBe(5);
    });
  });

  // =====================================================================
  // 缓存统计测试
  // =====================================================================

  describe('缓存统计', () => {
    it('应该记录缓存命中', () => {
      ragMetrics.recordCacheHit();

      expect(ragMetrics.stats.cacheHits).toBe(1);
    });

    it('应该触发 cache-hit 事件', () => {
      const hitSpy = vi.fn();
      ragMetrics.on('cache-hit', hitSpy);

      ragMetrics.recordCacheHit();

      expect(hitSpy).toHaveBeenCalled();
    });

    it('应该记录缓存未命中', () => {
      ragMetrics.recordCacheMiss();

      expect(ragMetrics.stats.cacheMisses).toBe(1);
    });

    it('应该触发 cache-miss 事件', () => {
      const missSpy = vi.fn();
      ragMetrics.on('cache-miss', missSpy);

      ragMetrics.recordCacheMiss();

      expect(missSpy).toHaveBeenCalled();
    });

    it('应该累积缓存统计', () => {
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheMiss();

      expect(ragMetrics.stats.cacheHits).toBe(2);
      expect(ragMetrics.stats.cacheMisses).toBe(1);
    });
  });

  // =====================================================================
  // 错误记录测试
  // =====================================================================

  describe('recordError - 错误记录', () => {
    it('应该记录错误', () => {
      const error = new Error('Test error');

      ragMetrics.recordError('retrieval', error);

      expect(ragMetrics.stats.errors).toBe(1);
    });

    it('应该触发 error 事件', () => {
      const errorSpy = vi.fn();
      ragMetrics.on('error', errorSpy);

      const error = new Error('Test error');
      ragMetrics.recordError('retrieval', error);

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toMatchObject({
        type: 'retrieval',
        error: 'Test error',
      });
    });

    it('应该累积错误计数', () => {
      ragMetrics.recordError('retrieval', new Error('Error 1'));
      ragMetrics.recordError('rerank', new Error('Error 2'));

      expect(ragMetrics.stats.errors).toBe(2);
    });
  });

  // =====================================================================
  // 统计计算测试
  // =====================================================================

  describe('getStats - 统计计算', () => {
    it('应该返回所有类型的统计', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.RERANK, 200);

      const stats = ragMetrics.getStats();

      expect(stats.overall).toBeDefined();
      expect(stats.retrieval).toBeDefined();
      expect(stats.rerank).toBeDefined();
    });

    it('应该计算平均值', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.RETRIEVAL, 200);
      ragMetrics.record(MetricTypes.RETRIEVAL, 300);

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.avg).toBe(200);
    });

    it('应该计算最小值和最大值', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 50);
      ragMetrics.record(MetricTypes.RETRIEVAL, 150);
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.min).toBe(50);
      expect(stats.max).toBe(150);
    });

    it('应该计算百分位数', () => {
      // 添加 100 条记录
      for (let i = 1; i <= 100; i++) {
        ragMetrics.record(MetricTypes.RETRIEVAL, i);
      }

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.p50).toBeGreaterThanOrEqual(48);
      expect(stats.p50).toBeLessThanOrEqual(52);
      expect(stats.p95).toBeGreaterThanOrEqual(93);
      expect(stats.p99).toBeGreaterThanOrEqual(97);
    });

    it('应该计算缓存命中率', () => {
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheMiss();

      const stats = ragMetrics.getStats();

      expect(stats.cacheHitRate).toBe(0.75);
    });

    it('无数据时应该返回零值统计', () => {
      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats).toEqual({
        count: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      });
    });

    it('应该包含运行时间', () => {
      vi.advanceTimersByTime(5000);

      const stats = ragMetrics.getStats();

      expect(stats.uptime).toBeGreaterThanOrEqual(5000);
    });
  });

  // =====================================================================
  // 性能告警测试
  // =====================================================================

  describe('性能告警', () => {
    it('检索超过阈值时应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.RETRIEVAL, 600); // 阈值 500ms

      expect(alertSpy).toHaveBeenCalled();
      expect(alertSpy.mock.calls[0][0]).toMatchObject({
        type: MetricTypes.RETRIEVAL,
        value: 600,
        threshold: 500,
      });
    });

    it('重排序超过阈值时应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.RERANK, 3500); // 阈值 3000ms

      expect(alertSpy).toHaveBeenCalled();
    });

    it('嵌入超过阈值时应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.EMBEDDING, 250); // 阈值 200ms

      expect(alertSpy).toHaveBeenCalled();
    });

    it('查询重写超过阈值时应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.QUERY_REWRITE, 2500); // 阈值 2000ms

      expect(alertSpy).toHaveBeenCalled();
    });

    it('总延迟超过阈值时应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.TOTAL, 5500); // 阈值 5000ms

      expect(alertSpy).toHaveBeenCalled();
    });

    it('未超过阈值时不应该触发告警', () => {
      const alertSpy = vi.fn();
      ragMetrics.on('alert', alertSpy);

      ragMetrics.record(MetricTypes.RETRIEVAL, 100); // < 500ms

      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // 实时性能概览测试
  // =====================================================================

  describe('getRealTimeOverview - 实时概览', () => {
    it('应该返回实时性能概览', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.TOTAL, 500);
      ragMetrics.recordCacheHit();

      const overview = ragMetrics.getRealTimeOverview();

      expect(overview).toHaveProperty('timestamp');
      expect(overview).toHaveProperty('uptime');
      expect(overview).toHaveProperty('queries');
      expect(overview).toHaveProperty('cache');
      expect(overview).toHaveProperty('retrieval');
      expect(overview).toHaveProperty('errors');
    });

    it('应该计算最近1分钟的平均延迟', () => {
      const now = Date.now();

      // 旧数据（超过1分钟）
      ragMetrics.record(MetricTypes.RETRIEVAL, 1000);
      ragMetrics.metrics.retrieval[0].timestamp = now - 70000;

      // 最近数据
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.RETRIEVAL, 200);

      const overview = ragMetrics.getRealTimeOverview();

      // 应该只计算最近的两条
      expect(overview.retrieval.recentAvgLatency).toBe(150);
    });

    it('应该包含缓存命中率', () => {
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheMiss();

      const overview = ragMetrics.getRealTimeOverview();

      expect(overview.cache.hitRate).toBeCloseTo(0.667, 2);
    });
  });

  // =====================================================================
  // 性能报告测试
  // =====================================================================

  describe('getPerformanceReport - 性能报告', () => {
    it('应该生成性能报告', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.RERANK, 200);

      const report = ragMetrics.getPerformanceReport(3600000);

      expect(report).toHaveProperty('timeRange', 3600000);
      expect(report).toHaveProperty('startTime');
      expect(report).toHaveProperty('endTime');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('cache');
      expect(report).toHaveProperty('errors');
    });

    it('应该只包含时间范围内的数据', () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;

      // 旧数据（超过1小时）
      ragMetrics.record(MetricTypes.RETRIEVAL, 1000);
      ragMetrics.metrics.retrieval[0].timestamp = oneHourAgo - 1000;

      // 最近数据
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.record(MetricTypes.RETRIEVAL, 200);

      const report = ragMetrics.getPerformanceReport(3600000);

      expect(report.summary.retrieval.count).toBe(2);
    });

    it('应该包含缓存统计', () => {
      ragMetrics.recordCacheHit();
      ragMetrics.recordCacheMiss();

      const report = ragMetrics.getPerformanceReport();

      expect(report.cache.hits).toBe(1);
      expect(report.cache.misses).toBe(1);
    });

    it('应该包含错误统计', () => {
      ragMetrics.recordError('test', new Error('error'));

      const report = ragMetrics.getPerformanceReport();

      expect(report.errors).toBe(1);
    });
  });

  // =====================================================================
  // 指标导出和重置测试
  // =====================================================================

  describe('导出和重置', () => {
    it('应该导出所有指标', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.recordCacheHit();

      const exported = ragMetrics.exportMetrics();

      expect(exported).toHaveProperty('metrics');
      expect(exported).toHaveProperty('stats');
      expect(exported).toHaveProperty('startTime');
      expect(exported).toHaveProperty('exportTime');
    });

    it('导出的数据应该包含所有指标', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);

      const exported = ragMetrics.exportMetrics();

      expect(exported.metrics.retrieval).toHaveLength(1);
      expect(exported.stats.totalRetrievals).toBe(1);
    });

    it('应该重置所有指标', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.recordCacheHit();
      ragMetrics.recordError('test', new Error('error'));

      ragMetrics.reset();

      expect(ragMetrics.metrics.retrieval).toEqual([]);
      expect(ragMetrics.stats.cacheHits).toBe(0);
      expect(ragMetrics.stats.errors).toBe(0);
    });

    it('重置时应该触发 reset 事件', () => {
      const resetSpy = vi.fn();
      ragMetrics.on('reset', resetSpy);

      ragMetrics.reset();

      expect(resetSpy).toHaveBeenCalled();
    });

    it('重置后应该更新开始时间', () => {
      const oldStartTime = ragMetrics.startTime;

      vi.advanceTimersByTime(1000);
      ragMetrics.reset();

      expect(ragMetrics.startTime).toBeGreaterThan(oldStartTime);
    });
  });

  // =====================================================================
  // 数据清理测试
  // =====================================================================

  describe('cleanOldMetrics - 数据清理', () => {
    it('应该清理旧数据', () => {
      const now = Date.now();
      const twoHoursAgo = now - 7200000;

      // 添加旧数据
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.metrics.retrieval[0].timestamp = twoHoursAgo;

      // 添加新数据
      ragMetrics.record(MetricTypes.RETRIEVAL, 200);

      ragMetrics.cleanOldMetrics(3600000); // 清理1小时前的数据

      expect(ragMetrics.metrics.retrieval).toHaveLength(1);
      expect(ragMetrics.metrics.retrieval[0].value).toBe(200);
    });

    it('应该触发 cleaned 事件', () => {
      const cleanedSpy = vi.fn();
      ragMetrics.on('cleaned', cleanedSpy);

      ragMetrics.record(MetricTypes.RETRIEVAL, 100);
      ragMetrics.cleanOldMetrics(0); // 清理所有数据

      expect(cleanedSpy).toHaveBeenCalled();
      expect(cleanedSpy.mock.calls[0][0]).toHaveProperty('remaining');
    });
  });

  // =====================================================================
  // 全局单例测试
  // =====================================================================

  describe('getGlobalMetrics - 全局单例', () => {
    it('应该返回全局指标实例', async () => {
      const { getGlobalMetrics } = await import('../../../src/main/rag/metrics.js');

      const global1 = getGlobalMetrics();
      const global2 = getGlobalMetrics();

      expect(global1).toBe(global2);
    });

    it('全局实例应该是 RAGMetrics 实例', async () => {
      const { getGlobalMetrics } = await import('../../../src/main/rag/metrics.js');

      const global = getGlobalMetrics();

      expect(global).toBeInstanceOf(RAGMetrics);
    });
  });

  // =====================================================================
  // 边界情况测试
  // =====================================================================

  describe('边界情况', () => {
    it('应该处理空指标列表', () => {
      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.count).toBe(0);
      expect(stats.avg).toBe(0);
    });

    it('应该处理单个数据点', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, 100);

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.count).toBe(1);
      expect(stats.avg).toBe(100);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(100);
      expect(stats.p50).toBe(100);
    });

    it('应该处理零缓存命中/未命中', () => {
      const stats = ragMetrics.getStats();

      expect(stats.cacheHitRate).toBe(0);
    });

    it('应该处理负数延迟', () => {
      // 虽然不应该出现，但测试健壮性
      ragMetrics.record(MetricTypes.RETRIEVAL, -10);

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.min).toBe(-10);
    });

    it('应该处理非常大的延迟值', () => {
      ragMetrics.record(MetricTypes.RETRIEVAL, Number.MAX_SAFE_INTEGER);

      const stats = ragMetrics.getStats(MetricTypes.RETRIEVAL);

      expect(stats.max).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('应该处理未知的指标类型', () => {
      ragMetrics.record('unknown-type', 100);

      // 不应该抛出错误，但也不会记录到已知的指标中
      expect(ragMetrics.stats.totalQueries).toBe(0);
    });
  });
});
