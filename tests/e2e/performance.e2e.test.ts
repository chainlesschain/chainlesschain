/**
 * 性能基准测试
 * 测试关键API的响应时间和性能指标
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Performance Benchmark Tests', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../desktop-app-vue/dist/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  /**
   * 辅助函数：测量API调用时间
   */
  async function measureApiPerformance(apiCall: () => Promise<any>, apiName: string) {
    const startTime = Date.now();
    const result = await apiCall();
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`[Performance] ${apiName}: ${duration}ms`);

    return { result, duration };
  }

  test.describe('System API Performance', () => {
    test('getSystemInfo should respond within 100ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.system.getSystemInfo();
          });
        },
        'system.getSystemInfo'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100);
    });

    test('getPlatform should respond within 50ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.system.getPlatform();
          });
        },
        'system.getPlatform'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(50);
    });

    test('getAppInfo should respond within 100ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.system.getAppInfo();
          });
        },
        'system.getAppInfo'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100);
    });
  });

  test.describe('Notification API Performance', () => {
    test('getUnreadCount should respond within 100ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.notification.getUnreadCount();
          });
        },
        'notification.getUnreadCount'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100);
    });

    test('getAll should respond within 200ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.notification.getAll({ limit: 50 });
          });
        },
        'notification.getAll'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(200);
    });
  });

  test.describe('Social API Performance', () => {
    test('getAllContacts should respond within 200ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.social.getAllContacts();
          });
        },
        'social.getAllContacts'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(200);
    });

    test('getContactStatistics should respond within 150ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.social.getContactStatistics();
          });
        },
        'social.getContactStatistics'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(150);
    });
  });

  test.describe('Knowledge API Performance', () => {
    test('getTags should respond within 100ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.knowledge.getTags();
          });
        },
        'knowledge.getTags'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(100);
    });

    test('listContents should respond within 200ms', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.knowledge.listContents({ limit: 50 });
          });
        },
        'knowledge.listContents'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(200);
    });
  });

  test.describe('Concurrent API Performance', () => {
    test('should handle 10 concurrent API calls', async () => {
      const startTime = Date.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        window.evaluate(async (index: number) => {
          const api = (window as any).electronAPI;
          // 交替调用不同API
          if (index % 3 === 0) {
            return await api.system.getSystemInfo();
          } else if (index % 3 === 1) {
            return await api.notification.getUnreadCount();
          } else {
            return await api.knowledge.getTags();
          }
        }, i)
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      console.log(`[Performance] 10 concurrent calls: ${duration}ms`);

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(1000); // 10个并发调用应在1秒内完成
    });
  });

  test.describe('Large Data Performance', () => {
    test('should handle large notification list', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.notification.getAll({ limit: 1000 });
          });
        },
        'notification.getAll (1000 items)'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(500); // 大数据查询应在500ms内
    });

    test('should handle large content list', async () => {
      const { result, duration } = await measureApiPerformance(
        async () => {
          return await window.evaluate(async () => {
            return await (window as any).electronAPI.knowledge.listContents({ limit: 500 });
          });
        },
        'knowledge.listContents (500 items)'
      );

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(500);
    });
  });

  test.describe('API Call Overhead', () => {
    test('should measure IPC call overhead', async () => {
      // 测试简单API的调用开销
      const iterations = 100;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await window.evaluate(async () => {
          return await (window as any).electronAPI.system.getPlatform();
        });
        const duration = Date.now() - startTime;
        durations.push(duration);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / iterations;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);

      console.log(`[Performance] IPC Call Overhead (${iterations} iterations):`);
      console.log(`  Average: ${avgDuration.toFixed(2)}ms`);
      console.log(`  Min: ${minDuration}ms`);
      console.log(`  Max: ${maxDuration}ms`);

      expect(avgDuration).toBeLessThan(100);
    });
  });
});
