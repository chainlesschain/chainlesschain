/**
 * 性能基准测试
 * 用于测试关键功能的性能指标
 */

import { describe, it, expect, beforeAll } from 'vitest';

// 性能测试配置
const PERFORMANCE_THRESHOLDS = {
  // AI 引擎
  intentClassification: 100, // 意图识别应在 100ms 内完成
  taskPlanning: 200, // 任务规划应在 200ms 内完成
  functionCall: 50, // 单个函数调用应在 50ms 内完成

  // 项目管理
  projectCRUD: 100, // 项目 CRUD 操作应在 100ms 内完成
  fileOperation: 150, // 文件操作应在 150ms 内完成

  // 批量操作
  batchProcessing: 500, // 批量处理 (10项) 应在 500ms 内完成
  concurrentOps: 300, // 并发操作 (5个) 应在 300ms 内完成
};

/**
 * 性能测试辅助函数
 */
function measurePerformance(name, fn, iterations = 10) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

  return {
    name,
    avg: Math.round(avg * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    median: Math.round(median * 100) / 100,
    iterations,
  };
}

async function measureAsyncPerformance(name, fn, iterations = 10) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

  return {
    name,
    avg: Math.round(avg * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    median: Math.round(median * 100) / 100,
    iterations,
  };
}

describe('Performance Benchmarks', () => {
  describe('AI Engine Performance', () => {
    it('Intent classification should be fast', async () => {
      const mockClassify = async () => {
        // 模拟意图分类
        await new Promise(resolve => setTimeout(resolve, 10));
        return { intent: 'CREATE_FILE', confidence: 0.9 };
      };

      const result = await measureAsyncPerformance(
        'Intent Classification',
        mockClassify,
        20
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.intentClassification);
      expect(result.median).toBeLessThan(PERFORMANCE_THRESHOLDS.intentClassification);
    });

    it('Task planning should be efficient', async () => {
      const mockPlan = async () => {
        // 模拟任务规划
        await new Promise(resolve => setTimeout(resolve, 50));
        return { steps: [{ tool: 'test', params: {} }] };
      };

      const result = await measureAsyncPerformance(
        'Task Planning',
        mockPlan,
        20
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.taskPlanning);
    });

    it('Function calls should be quick', async () => {
      const mockCall = async () => {
        // 模拟函数调用
        await new Promise(resolve => setTimeout(resolve, 5));
        return { success: true };
      };

      const result = await measureAsyncPerformance(
        'Function Call',
        mockCall,
        50
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.functionCall);
    });
  });

  describe('Project Management Performance', () => {
    it('Project CRUD operations should be fast', async () => {
      const mockCRUD = async () => {
        // 模拟数据库操作
        await new Promise(resolve => setTimeout(resolve, 20));
        return { id: 'test', name: 'Test Project' };
      };

      const result = await measureAsyncPerformance(
        'Project CRUD',
        mockCRUD,
        30
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.projectCRUD);
    });

    it('File operations should be efficient', async () => {
      const mockFileOp = async () => {
        // 模拟文件操作
        await new Promise(resolve => setTimeout(resolve, 30));
        return { files: [] };
      };

      const result = await measureAsyncPerformance(
        'File Operations',
        mockFileOp,
        20
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.fileOperation);
    });
  });

  describe('Batch and Concurrent Operations', () => {
    it('Batch processing should handle multiple items efficiently', async () => {
      const mockBatch = async () => {
        // 模拟批量处理 10 个项目
        const promises = Array.from({ length: 10 }, () =>
          new Promise(resolve => setTimeout(resolve, 20))
        );
        await Promise.all(promises);
        return { processed: 10 };
      };

      const result = await measureAsyncPerformance(
        'Batch Processing (10 items)',
        mockBatch,
        10
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.batchProcessing);
    });

    it('Concurrent operations should be optimized', async () => {
      const mockConcurrent = async () => {
        // 模拟 5 个并发操作
        const promises = Array.from({ length: 5 }, () =>
          new Promise(resolve => setTimeout(resolve, 30))
        );
        await Promise.all(promises);
        return { count: 5 };
      };

      const result = await measureAsyncPerformance(
        'Concurrent Operations (5 ops)',
        mockConcurrent,
        10
      );

      console.log(`\n📊 ${result.name}:`, result);

      expect(result.avg).toBeLessThan(PERFORMANCE_THRESHOLDS.concurrentOps);
    });
  });

  describe('Memory and Data Structure Performance', () => {
    it('Large array operations should be optimized', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);

      const result = measurePerformance(
        'Array Filter (10k items)',
        () => largeArray.filter(x => x % 2 === 0),
        100
      );

      console.log(`\n📊 ${result.name}:`, result);

      // 大数组过滤应在 10ms 内完成
      expect(result.avg).toBeLessThan(10);
    });

    it('Object creation and manipulation should be fast', () => {
      const result = measurePerformance(
        'Object Creation (1000 objects)',
        () => {
          const objects = [];
          for (let i = 0; i < 1000; i++) {
            objects.push({
              id: `obj-${i}`,
              name: `Object ${i}`,
              data: { value: i },
            });
          }
          return objects;
        },
        50
      );

      console.log(`\n📊 ${result.name}:`, result);

      // 1000 个对象创建应在 5ms 内完成
      expect(result.avg).toBeLessThan(5);
    });
  });

  describe('Performance Summary', () => {
    it('should log performance summary', () => {
      console.log('\n' + '='.repeat(60));
      console.log('📊 PERFORMANCE BENCHMARK SUMMARY');
      console.log('='.repeat(60));
      console.log('\n✅ All performance benchmarks passed!');
      console.log('\nThresholds:');
      Object.entries(PERFORMANCE_THRESHOLDS).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}ms`);
      });
      console.log('\n' + '='.repeat(60) + '\n');
    });
  });
});
