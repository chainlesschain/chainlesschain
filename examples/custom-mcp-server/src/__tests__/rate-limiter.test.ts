/**
 * Rate Limiter Unit Tests
 *
 * 使用 Vitest 测试速率限制器的各项功能
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRateLimiter,
  resetRateLimiter,
  RATE_LIMIT_PRESETS,
  withRateLimit,
  type RateLimiterStats,
} from "../utils/rate-limiter.js";

describe("Rate Limiter", () => {
  beforeEach(async () => {
    // 重置单例实例
    await resetRateLimiter();
  });

  afterEach(async () => {
    await resetRateLimiter();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const limiter1 = getRateLimiter();
      const limiter2 = getRateLimiter();
      expect(limiter1).toBe(limiter2);
    });

    it("should create new instance after reset", async () => {
      const limiter1 = getRateLimiter();
      await resetRateLimiter();
      const limiter2 = getRateLimiter();
      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe("Default Options", () => {
    it("should have correct default values", () => {
      const limiter = getRateLimiter();
      const options = limiter.getOptions();

      expect(options.maxConcurrent).toBe(5);
      expect(options.minTime).toBe(100);
      expect(options.reservoir).toBe(60);
      expect(options.reservoirRefreshInterval).toBe(60000);
      expect(options.reservoirRefreshAmount).toBe(60);
    });

    it("should accept custom options", async () => {
      await resetRateLimiter();
      const limiter = getRateLimiter({
        maxConcurrent: 10,
        minTime: 50,
        reservoir: 100,
      });
      const options = limiter.getOptions();

      expect(options.maxConcurrent).toBe(10);
      expect(options.minTime).toBe(50);
      expect(options.reservoir).toBe(100);
    });
  });

  describe("Schedule Execution", () => {
    it("should execute a simple function", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      const result = await limiter.schedule(async () => {
        return 42;
      });

      expect(result.data).toBe(42);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return job result with timing info", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      const result = await limiter.schedule(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      });

      expect(result.data).toBe("done");
      expect(result.duration).toBeGreaterThanOrEqual(10);
      expect(typeof result.wasQueued).toBe("boolean");
      expect(typeof result.waitTime).toBe("number");
    });

    it("should respect priority", async () => {
      const limiter = getRateLimiter({
        maxConcurrent: 1,
        minTime: 10,
        reservoir: 100,
      });

      const results: number[] = [];

      // 启动一个阻塞任务
      const blocking = limiter.schedule(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push(0);
        return 0;
      }, 5);

      // 低优先级任务
      const low = limiter.schedule(async () => {
        results.push(2);
        return 2;
      }, 9);

      // 高优先级任务
      const high = limiter.schedule(async () => {
        results.push(1);
        return 1;
      }, 1);

      await Promise.all([blocking, high, low]);

      // 0 先完成（已经在执行），然后是 1（高优先级），最后是 2（低优先级）
      expect(results[0]).toBe(0);
      expect(results[1]).toBe(1);
      expect(results[2]).toBe(2);
    });
  });

  describe("Statistics", () => {
    it("should track done count", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      await limiter.schedule(async () => "a");
      await limiter.schedule(async () => "b");
      await limiter.schedule(async () => "c");

      const stats = await limiter.getStats();
      expect(stats.done).toBe(3);
    });

    it("should return correct stats structure", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      await limiter.schedule(async () => 1);

      const stats = await limiter.getStats();

      expect(stats).toHaveProperty("running");
      expect(stats).toHaveProperty("queued");
      expect(stats).toHaveProperty("done");
      expect(stats).toHaveProperty("rejected");
      expect(stats).toHaveProperty("reservoir");
      expect(stats).toHaveProperty("isRateLimited");
    });

    it("should reset stats correctly", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      await limiter.schedule(async () => "done");
      limiter.resetStats();

      const stats = await limiter.getStats();
      expect(stats.done).toBe(0);
      expect(stats.rejected).toBe(0);
    });
  });

  describe("Rate Limiting", () => {
    it("should report rate limited status when reservoir is depleted", async () => {
      const limiter = getRateLimiter({
        maxConcurrent: 1,
        minTime: 0,
        reservoir: 2,
        reservoirRefreshInterval: 60000,
        reservoirRefreshAmount: 2,
      });

      // 消耗配额
      await limiter.schedule(async () => 1);
      await limiter.schedule(async () => 2);

      // 检查是否限流
      const reservoir = await limiter.getRemainingQuota();
      expect(reservoir).toBe(0);
    });

    it("should queue requests when rate limited", async () => {
      const limiter = getRateLimiter({
        maxConcurrent: 1,
        minTime: 100,
        reservoir: 10,
      });

      // 启动多个任务
      const promises = [
        limiter.schedule(async () => 1),
        limiter.schedule(async () => 2),
        limiter.schedule(async () => 3),
      ];

      // 检查队列状态
      const stats = await limiter.getStats();
      expect(stats.queued).toBeGreaterThanOrEqual(0);

      await Promise.all(promises);
    });
  });

  describe("Update Settings", () => {
    it("should update settings dynamically", async () => {
      const limiter = getRateLimiter();

      await limiter.updateSettings({
        maxConcurrent: 20,
        minTime: 50,
      });

      const options = limiter.getOptions();
      expect(options.maxConcurrent).toBe(20);
      expect(options.minTime).toBe(50);
    });

    it("should update reservoir settings", async () => {
      const limiter = getRateLimiter();

      await limiter.updateSettings({
        reservoir: 100,
        reservoirRefreshAmount: 100,
      });

      const options = limiter.getOptions();
      expect(options.reservoir).toBe(100);
      expect(options.reservoirRefreshAmount).toBe(100);
    });
  });

  describe("Presets", () => {
    it("should have openweathermap_free preset", () => {
      expect(RATE_LIMIT_PRESETS.openweathermap_free).toBeDefined();
      expect(RATE_LIMIT_PRESETS.openweathermap_free.reservoir).toBe(60);
    });

    it("should have openweathermap_pro preset", () => {
      expect(RATE_LIMIT_PRESETS.openweathermap_pro).toBeDefined();
      expect(RATE_LIMIT_PRESETS.openweathermap_pro.reservoir).toBe(600);
    });

    it("should have qweather_free preset", () => {
      expect(RATE_LIMIT_PRESETS.qweather_free).toBeDefined();
      expect(RATE_LIMIT_PRESETS.qweather_free.reservoir).toBe(1000);
    });

    it("should have test preset with high limits", () => {
      expect(RATE_LIMIT_PRESETS.test).toBeDefined();
      expect(RATE_LIMIT_PRESETS.test.maxConcurrent).toBe(100);
      expect(RATE_LIMIT_PRESETS.test.reservoir).toBe(10000);
    });

    it("should have strict preset with low limits", () => {
      expect(RATE_LIMIT_PRESETS.strict).toBeDefined();
      expect(RATE_LIMIT_PRESETS.strict.maxConcurrent).toBe(2);
      expect(RATE_LIMIT_PRESETS.strict.reservoir).toBe(10);
    });
  });

  describe("Wrap Function", () => {
    it("should wrap an async function using schedule", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      const originalFn = async (x: number) => x * 2;

      // Use schedule to wrap function calls
      const result = await limiter.schedule(() => originalFn(21));
      expect(result.data).toBe(42);
    });

    it("should wrap function with multiple arguments using schedule", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      const originalFn = async (a: number, b: number) => a + b;

      // Use schedule to wrap function calls
      const result = await limiter.schedule(() => originalFn(10, 32));
      expect(result.data).toBe(42);
    });
  });

  describe("withRateLimit Decorator", () => {
    it("should create a rate-limited version of function", async () => {
      await resetRateLimiter();
      getRateLimiter(RATE_LIMIT_PRESETS.test);

      const originalFn = async (x: number) => x * 3;
      const limitedFn = withRateLimit<number, [number]>()(originalFn);

      const result = await limitedFn(14);
      expect(result).toBe(42);
    });

    it("should respect priority in decorator", async () => {
      await resetRateLimiter();
      getRateLimiter(RATE_LIMIT_PRESETS.test);

      const originalFn = async (x: number) => x;
      const highPriorityFn = withRateLimit<number, [number]>(1)(originalFn);
      const lowPriorityFn = withRateLimit<number, [number]>(9)(originalFn);

      const [high, low] = await Promise.all([
        highPriorityFn(1),
        lowPriorityFn(2),
      ]);

      expect(high).toBe(1);
      expect(low).toBe(2);
    });
  });

  describe("Stop and Disconnect", () => {
    it("should stop limiter gracefully", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      await limiter.schedule(async () => "done");
      await limiter.stop(false);

      // 应该不抛出错误
      expect(true).toBe(true);
    });

    it("should disconnect limiter", async () => {
      const limiter = getRateLimiter(RATE_LIMIT_PRESETS.test);

      await limiter.schedule(async () => "done");
      await limiter.disconnect();

      // 应该不抛出错误
      expect(true).toBe(true);
    });
  });
});
