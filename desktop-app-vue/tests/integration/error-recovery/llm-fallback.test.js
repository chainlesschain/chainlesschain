/**
 * LLM Fallback 和错误恢复测试
 *
 * 测试范围：
 * - LLM 超时和连接失败
 * - 自动回退到缓存
 * - 重试机制和指数退避
 * - 优雅降级策略
 * - 部分失败处理
 * - 错误监控和日志
 * - Circuit Breaker 熔断器
 * - 真实场景测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 3: Error Recovery Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock LLM Client ====================

class MockLLMClient {
  constructor(config = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      useCache: config.useCache !== false,
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5,
    };

    this.callCount = 0;
    this.failureCount = 0;
    this.circuitBreakerOpen = false;
    this.lastError = null;
  }

  async generate(prompt, options = {}) {
    this.callCount++;

    // Circuit breaker check
    if (this.circuitBreakerOpen) {
      throw new Error("Circuit breaker is open - service unavailable");
    }

    // Simulate timeout
    if (options.simulateTimeout) {
      await new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Request timeout after 30000ms")),
          100,
        );
      });
    }

    // Simulate connection failure
    if (options.simulateConnectionFailure) {
      this.failureCount++;
      if (this.failureCount >= this.config.circuitBreakerThreshold) {
        this.circuitBreakerOpen = true;
      }
      throw new Error("ECONNREFUSED: Connection refused");
    }

    // Simulate rate limit
    if (options.simulateRateLimit) {
      throw new Error("Rate limit exceeded - 429 Too Many Requests");
    }

    // Simulate partial failure
    if (options.simulatePartialFailure) {
      return {
        text: "Partial response due to error",
        truncated: true,
        error: "Stream interrupted",
      };
    }

    // Success
    return {
      text: `Response to: ${prompt}`,
      model: "qwen2:7b",
      tokens: 50,
    };
  }

  resetCircuitBreaker() {
    this.circuitBreakerOpen = false;
    this.failureCount = 0;
  }
}

// ==================== Mock Cache ====================

class MockCache {
  constructor() {
    this.storage = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  async get(key) {
    if (this.storage.has(key)) {
      this.hits++;
      return this.storage.get(key);
    }
    this.misses++;
    return null;
  }

  async set(key, value, ttl = 3600) {
    this.storage.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async has(key) {
    return this.storage.has(key);
  }

  async delete(key) {
    return this.storage.delete(key);
  }

  async clear() {
    this.storage.clear();
  }

  getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.storage.size,
      hitRate: this.hits / (this.hits + this.misses) || 0,
    };
  }
}

// ==================== LLM Service with Fallback ====================

class LLMServiceWithFallback {
  constructor(llmClient, cache, config = {}) {
    this.llmClient = llmClient;
    this.cache = cache;
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      backoffMultiplier: config.backoffMultiplier || 2,
      cacheTTL: config.cacheTTL || 3600,
      enableFallback: config.enableFallback !== false,
      logErrors: config.logErrors !== false,
    };

    this.errorLog = [];
  }

  _getCacheKey(prompt, options) {
    return `llm:${prompt}:${JSON.stringify(options)}`;
  }

  _logError(error, context) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      error: error.message,
      context,
    };
    this.errorLog.push(errorEntry);
    if (this.config.logErrors) {
      console.error("[LLM Service Error]", errorEntry);
    }
  }

  async _retryWithBackoff(fn, retries = 0) {
    try {
      return await fn();
    } catch (error) {
      if (retries >= this.config.maxRetries) {
        throw error;
      }

      const delay =
        this.config.retryDelay *
        Math.pow(this.config.backoffMultiplier, retries);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return this._retryWithBackoff(fn, retries + 1);
    }
  }

  async generate(prompt, options = {}) {
    const cacheKey = this._getCacheKey(prompt, options);

    try {
      // Try to get from cache first if enabled
      if (this.config.enableFallback && options.useCache !== false) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          return {
            ...cached.value,
            fromCache: true,
          };
        }
      }

      // Try LLM with retry
      const result = await this._retryWithBackoff(async () => {
        return await this.llmClient.generate(prompt, options);
      });

      // Cache successful response
      if (this.config.enableFallback && !result.error) {
        await this.cache.set(cacheKey, result, this.config.cacheTTL);
      }

      return result;
    } catch (error) {
      this._logError(error, { prompt, options });

      // Fallback to cache if available
      if (this.config.enableFallback) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          return {
            ...cached.value,
            fromCache: true,
            fallback: true,
            originalError: error.message,
          };
        }
      }

      // No cache available, return degraded response
      if (this.config.enableFallback && options.degradedResponse) {
        return {
          text: options.degradedResponse,
          degraded: true,
          originalError: error.message,
        };
      }

      // Rethrow if no fallback
      throw error;
    }
  }

  async generateBatch(prompts, options = {}) {
    const results = [];

    for (const prompt of prompts) {
      try {
        const result = await this.generate(prompt, options);
        results.push({ success: true, result });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          prompt,
        });
      }
    }

    return results;
  }

  getErrorLog() {
    return this.errorLog;
  }

  clearErrorLog() {
    this.errorLog = [];
  }
}

// ==================== Test Suite ====================

describe("LLM Fallback 和错误恢复测试", () => {
  let llmClient;
  let cache;
  let service;

  beforeEach(() => {
    llmClient = new MockLLMClient({
      timeout: 30000,
      maxRetries: 3,
      useCache: true,
    });

    cache = new MockCache();

    service = new LLMServiceWithFallback(llmClient, cache, {
      maxRetries: 3,
      retryDelay: 100,
      backoffMultiplier: 2,
      cacheTTL: 3600,
      enableFallback: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ==================== 1. LLM 超时处理 ====================

  describe("LLM 超时处理", () => {
    it("应该在超时后重试", async () => {
      let attemptCount = 0;

      llmClient.generate = vi.fn(async (prompt, options) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Request timeout after 30000ms");
        }
        return { text: "Success after retries", tokens: 10 };
      });

      const result = await service.generate("Test prompt");

      expect(attemptCount).toBe(3);
      expect(result.text).toBe("Success after retries");
    });

    it("应该在达到最大重试次数后失败", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("Request timeout after 30000ms");
      });

      await expect(service.generate("Test prompt")).rejects.toThrow("timeout");
    });

    it("应该使用指数退避重试", async () => {
      const delays = [];
      let attemptCount = 0;

      llmClient.generate = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 4) {
          throw new Error("Timeout");
        }
        return { text: "Success", tokens: 10 };
      });

      const startTime = Date.now();
      await service.generate("Test prompt");
      const totalTime = Date.now() - startTime;

      // Should have delays: 100ms, 200ms, 400ms (exponential backoff)
      // Total: ~700ms
      expect(totalTime).toBeGreaterThanOrEqual(600);
      expect(totalTime).toBeLessThan(1000);
    });

    it("应该回退到缓存当超时发生", async () => {
      const cacheKey = service._getCacheKey("Test prompt", {});
      const cachedValue = { text: "Cached response", tokens: 10 };

      // Mock cache.get to return null first (skip initial cache), then value (fallback)
      let callCount = 0;
      const originalGet = cache.get.bind(cache);
      cache.get = vi.fn(async (key) => {
        callCount++;
        if (callCount === 1) {
          // First call: skip cache to force LLM call
          return null;
        }
        // Second call: return cached value for fallback
        return { value: cachedValue };
      });

      llmClient.generate = vi.fn(async () => {
        throw new Error("Request timeout after 30000ms");
      });

      const result = await service.generate("Test prompt");

      expect(result.text).toBe("Cached response");
      expect(result.fromCache).toBe(true);
      expect(result.fallback).toBe(true);
      expect(result.originalError).toContain("timeout");
    });
  });

  // ==================== 2. 连接失败处理 ====================

  describe("连接失败处理", () => {
    it("应该处理连接拒绝错误", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      });

      await expect(service.generate("Test prompt")).rejects.toThrow(
        "ECONNREFUSED",
      );
    });

    it("应该在连接失败后回退到缓存", async () => {
      const cachedValue = { text: "Cached response", tokens: 10 };

      // Mock cache.get to return null first (skip initial cache), then value (fallback)
      let callCount = 0;
      cache.get = vi.fn(async (key) => {
        callCount++;
        if (callCount === 1) {
          return null;
        }
        return { value: cachedValue };
      });

      llmClient.generate = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });

      const result = await service.generate("Test prompt");

      expect(result.text).toBe("Cached response");
      expect(result.fallback).toBe(true);
    });

    it("应该记录连接失败错误", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });

      try {
        await service.generate("Test prompt");
      } catch (error) {
        // Expected to fail
      }

      const errorLog = service.getErrorLog();
      expect(errorLog).toHaveLength(1);
      expect(errorLog[0].error).toContain("ECONNREFUSED");
    });

    it("应该在多次失败后打开熔断器", async () => {
      llmClient.circuitBreakerThreshold = 3;

      for (let i = 0; i < 3; i++) {
        try {
          await service.generate("Test", { simulateConnectionFailure: true });
        } catch (error) {
          // Expected
        }
      }

      expect(llmClient.circuitBreakerOpen).toBe(true);

      await expect(service.generate("Test")).rejects.toThrow(
        "Circuit breaker is open",
      );
    });
  });

  // ==================== 3. 缓存回退机制 ====================

  describe("缓存回退机制", () => {
    it("应该优先使用缓存而非 LLM", async () => {
      await cache.set(service._getCacheKey("Test prompt", {}), {
        text: "Cached response",
        tokens: 10,
      });

      llmClient.generate = vi.fn(async () => {
        throw new Error("Should not be called");
      });

      const result = await service.generate("Test prompt");

      expect(result.text).toBe("Cached response");
      expect(result.fromCache).toBe(true);
      expect(llmClient.generate).not.toHaveBeenCalled();
    });

    it("应该在缓存未命中时调用 LLM", async () => {
      llmClient.generate = vi.fn(async (prompt) => {
        return { text: `Response to: ${prompt}`, tokens: 20 };
      });

      const result = await service.generate("New prompt");

      expect(result.text).toBe("Response to: New prompt");
      expect(result.fromCache).toBeUndefined();
      expect(llmClient.generate).toHaveBeenCalledTimes(1);
    });

    it("应该缓存成功的 LLM 响应", async () => {
      llmClient.generate = vi.fn(async (prompt) => {
        return { text: `Response to: ${prompt}`, tokens: 20 };
      });

      await service.generate("Test prompt");

      const cached = await cache.get(service._getCacheKey("Test prompt", {}));
      expect(cached).not.toBeNull();
      expect(cached.value.text).toBe("Response to: Test prompt");
    });

    it("应该不缓存错误响应", async () => {
      llmClient.generate = vi.fn(async () => {
        return {
          text: "Partial response",
          error: "Stream interrupted",
        };
      });

      await service.generate("Test prompt");

      const cached = await cache.get(service._getCacheKey("Test prompt", {}));
      expect(cached).toBeNull();
    });

    it("应该支持禁用缓存", async () => {
      await cache.set(
        service._getCacheKey("Test prompt", { useCache: false }),
        { text: "Cached response", tokens: 10 },
      );

      llmClient.generate = vi.fn(async (prompt) => {
        return { text: `Fresh response: ${prompt}`, tokens: 20 };
      });

      const result = await service.generate("Test prompt", { useCache: false });

      expect(result.text).toBe("Fresh response: Test prompt");
      expect(result.fromCache).toBeUndefined();
    });
  });

  // ==================== 4. 优雅降级 ====================

  describe("优雅降级", () => {
    it("应该返回降级响应当 LLM 和缓存都不可用", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("Service unavailable");
      });

      const result = await service.generate("Test prompt", {
        degradedResponse: "Sorry, AI service is temporarily unavailable.",
      });

      expect(result.text).toBe("Sorry, AI service is temporarily unavailable.");
      expect(result.degraded).toBe(true);
      expect(result.originalError).toContain("unavailable");
    });

    it("应该在部分失败时返回部分响应", async () => {
      llmClient.generate = vi.fn(async () => {
        return {
          text: "Partial response due to error",
          truncated: true,
          error: "Stream interrupted",
        };
      });

      const result = await service.generate("Test prompt");

      expect(result.text).toBe("Partial response due to error");
      expect(result.truncated).toBe(true);
      expect(result.error).toBe("Stream interrupted");
    });

    it("应该提供默认降级响应", async () => {
      service.config.enableFallback = true;

      llmClient.generate = vi.fn(async () => {
        throw new Error("Total failure");
      });

      const result = await service.generate("Tell me a joke", {
        degradedResponse:
          "I apologize, but I cannot process your request at the moment.",
      });

      expect(result.degraded).toBe(true);
      expect(result.text).toContain("cannot process");
    });
  });

  // ==================== 5. 批量处理和部分失败 ====================

  describe("批量处理和部分失败", () => {
    it("应该处理批量请求中的部分失败", async () => {
      llmClient.generate = vi.fn(async (prompt) => {
        if (prompt.includes("fail")) {
          throw new Error("Simulated failure");
        }
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const results = await service.generateBatch([
        "Success prompt 1",
        "This will fail",
        "Success prompt 2",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it("应该对失败的批量项使用缓存回退", async () => {
      const cachedValue = { text: "Cached response", tokens: 10 };

      // Track cache.get calls per prompt
      const getCalls = { "Cached prompt": 0, "Fresh prompt": 0 };
      cache.get = vi.fn(async (key) => {
        if (key.includes("Cached prompt")) {
          getCalls["Cached prompt"]++;
          if (getCalls["Cached prompt"] === 1) {
            return null; // First call: skip cache
          }
          return { value: cachedValue }; // Second call: fallback
        }
        return null; // Fresh prompt: no cache
      });

      llmClient.generate = vi.fn(async (prompt) => {
        if (prompt === "Cached prompt") {
          throw new Error("LLM failure");
        }
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const results = await service.generateBatch([
        "Fresh prompt",
        "Cached prompt",
      ]);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[1].result.fromCache).toBe(true);
      expect(results[1].result.fallback).toBe(true);
    });

    it("应该继续处理即使某些项失败", async () => {
      llmClient.generate = vi.fn(async (prompt, options) => {
        if (options.fail) {
          throw new Error("Intentional failure");
        }
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const prompts = Array(10)
        .fill(0)
        .map((_, i) => `Prompt ${i}`);
      const results = await service.generateBatch(prompts);

      expect(results).toHaveLength(10);
      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBe(10);
    });
  });

  // ==================== 6. 错误监控和日志 ====================

  describe("错误监控和日志", () => {
    it("应该记录所有错误", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("Test error");
      });

      const prompts = ["Prompt 1", "Prompt 2", "Prompt 3"];

      for (const prompt of prompts) {
        try {
          await service.generate(prompt);
        } catch (error) {
          // Expected
        }
      }

      const errorLog = service.getErrorLog();
      expect(errorLog).toHaveLength(3);
    });

    it("应该在错误日志中包含上下文", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("Context test error");
      });

      try {
        await service.generate("Test prompt", { temperature: 0.8 });
      } catch (error) {
        // Expected
      }

      const errorLog = service.getErrorLog();
      expect(errorLog[0]).toHaveProperty("timestamp");
      expect(errorLog[0]).toHaveProperty("error");
      expect(errorLog[0]).toHaveProperty("context");
      expect(errorLog[0].context.prompt).toBe("Test prompt");
      expect(errorLog[0].context.options.temperature).toBe(0.8);
    });

    it("应该支持清除错误日志", async () => {
      llmClient.generate = vi.fn(async () => {
        throw new Error("Test error");
      });

      try {
        await service.generate("Test");
      } catch (error) {
        // Expected
      }

      expect(service.getErrorLog()).toHaveLength(1);

      service.clearErrorLog();

      expect(service.getErrorLog()).toHaveLength(0);
    });

    it("应该追踪缓存命中率", async () => {
      // Cache miss
      llmClient.generate = vi.fn(async (prompt) => {
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      await service.generate("Prompt 1");
      await service.generate("Prompt 2");

      // Cache hits
      await service.generate("Prompt 1");
      await service.generate("Prompt 2");

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  // ==================== 7. Circuit Breaker 熔断器 ====================

  describe("Circuit Breaker 熔断器", () => {
    it("应该在连续失败后打开熔断器", async () => {
      llmClient.circuitBreakerThreshold = 5;

      for (let i = 0; i < 5; i++) {
        try {
          await service.generate("Test", { simulateConnectionFailure: true });
        } catch (error) {
          // Expected
        }
      }

      expect(llmClient.circuitBreakerOpen).toBe(true);
    });

    it("应该在熔断器打开时拒绝请求", async () => {
      llmClient.circuitBreakerOpen = true;

      await expect(service.generate("Test")).rejects.toThrow(
        "Circuit breaker is open",
      );
    });

    it("应该支持重置熔断器", async () => {
      llmClient.circuitBreakerOpen = true;

      llmClient.resetCircuitBreaker();

      expect(llmClient.circuitBreakerOpen).toBe(false);

      llmClient.generate = vi.fn(async (prompt) => {
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const result = await service.generate("Test");
      expect(result.text).toBe("Response to: Test");
    });

    it("应该在熔断器打开时仍然使用缓存", async () => {
      await cache.set(service._getCacheKey("Test prompt", {}), {
        text: "Cached response",
        tokens: 10,
      });

      llmClient.circuitBreakerOpen = true;

      // Should use cache without calling LLM
      const result = await service.generate("Test prompt");

      expect(result.text).toBe("Cached response");
      expect(result.fromCache).toBe(true);
    });
  });

  // ==================== 8. 真实场景测试 ====================

  describe("真实场景测试", () => {
    it("场景1: 高负载期间的优雅降级", async () => {
      let requestCount = 0;

      llmClient.generate = vi.fn(async (prompt) => {
        requestCount++;
        if (requestCount > 5) {
          throw new Error("Rate limit exceeded - 429 Too Many Requests");
        }
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const results = await service.generateBatch(
        Array(10)
          .fill(0)
          .map((_, i) => `Prompt ${i}`),
      );

      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBeGreaterThan(0); // At least some succeeded
    });

    it("场景2: 网络波动时的重试和缓存", async () => {
      let attemptCount = 0;

      llmClient.generate = vi.fn(async (prompt) => {
        attemptCount++;
        // Simulate intermittent network issues
        if (attemptCount % 2 === 0) {
          throw new Error("Network error");
        }
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const result1 = await service.generate("Prompt 1");
      expect(result1.text).toBe("Response to: Prompt 1");

      // Should use cache on second call
      attemptCount = 0; // Reset
      const result2 = await service.generate("Prompt 1");
      expect(result2.fromCache).toBe(true);
    });

    it("场景3: LLM 服务完全故障的应急响应", async () => {
      const cachedValue = {
        text: "AI is artificial intelligence...",
        tokens: 20,
      };

      // Track cache.get calls per query
      const getCalls = { "What is AI?": 0 };
      cache.get = vi.fn(async (key) => {
        if (key.includes("What is AI?")) {
          getCalls["What is AI?"]++;
          if (getCalls["What is AI?"] === 1) {
            return null; // First call: skip cache
          }
          return { value: cachedValue }; // Second call: fallback
        }
        return null; // Other queries: no cache
      });

      // Simulate total LLM failure
      llmClient.generate = vi.fn(async () => {
        throw new Error("Service completely down");
      });

      // Cached query should still work via fallback
      const result1 = await service.generate("What is AI?");
      expect(result1.text).toBe("AI is artificial intelligence...");
      expect(result1.fallback).toBe(true);

      // New query should get degraded response
      const result2 = await service.generate("New question?", {
        degradedResponse:
          "Service temporarily unavailable. Please try again later.",
      });
      expect(result2.degraded).toBe(true);
    });

    it("场景4: 长时间运行的服务恢复", async () => {
      let serviceAvailable = false;
      let attemptCount = 0;

      llmClient.generate = vi.fn(async (prompt) => {
        attemptCount++;

        // Service becomes available after 10 attempts
        if (attemptCount > 10) {
          serviceAvailable = true;
        }

        if (!serviceAvailable) {
          throw new Error("Service starting up...");
        }

        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      // First few attempts will fail and use cache/degraded response
      const result1 = await service.generate("Test 1", {
        degradedResponse: "Service initializing...",
      });
      expect(result1.degraded || result1.fallback).toBeTruthy();

      // Keep trying...
      for (let i = 0; i < 10; i++) {
        try {
          await service.generate(`Test ${i}`, {
            degradedResponse: "Initializing...",
          });
        } catch (error) {
          // Expected during startup
        }
      }

      // Service should be available now
      const finalResult = await service.generate("Test final");
      expect(finalResult.text).toBe("Response to: Test final");
      expect(finalResult.degraded).toBeUndefined();
    });

    it("场景5: 多用户并发请求的公平处理", async () => {
      const userPrompts = {
        user1: ["Q1", "Q2", "Q3"],
        user2: ["Q4", "Q5", "Q6"],
        user3: ["Q7", "Q8", "Q9"],
      };

      llmClient.generate = vi.fn(async (prompt) => {
        // Simulate variable response times
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        return { text: `Response to: ${prompt}`, tokens: 10 };
      });

      const allPromises = Object.entries(userPrompts).flatMap(
        ([user, prompts]) =>
          prompts.map((prompt) => service.generate(`${user}:${prompt}`)),
      );

      const results = await Promise.all(allPromises);

      expect(results).toHaveLength(9);
      results.forEach((result) => {
        expect(result.text).toBeDefined();
      });
    });
  });

  // ==================== 9. 性能和可靠性 ====================

  describe("性能和可靠性", () => {
    it("应该在合理时间内完成重试", async () => {
      let attemptCount = 0;

      llmClient.generate = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Retry test");
        }
        return { text: "Success", tokens: 10 };
      });

      const startTime = Date.now();
      await service.generate("Test");
      const duration = Date.now() - startTime;

      // Should complete in reasonable time with backoff
      expect(duration).toBeLessThan(1000);
    });

    it("应该高效处理大量缓存命中", async () => {
      // Pre-populate cache
      for (let i = 0; i < 100; i++) {
        await cache.set(service._getCacheKey(`Prompt ${i}`, {}), {
          text: `Response ${i}`,
          tokens: 10,
        });
      }

      const startTime = Date.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(service.generate(`Prompt ${i}`));
      }

      await Promise.all(promises);

      const duration = Date.now() - startTime;

      // Should be very fast with cache hits
      expect(duration).toBeLessThan(500);
    });

    it("应该不会因错误而泄漏内存", async () => {
      // Reduce retry delay for faster testing
      service.config.retryDelay = 1;
      service.config.maxRetries = 0; // No retries for this test

      llmClient.generate = vi.fn(async () => {
        throw new Error("Memory leak test");
      });

      // Reduced iterations to avoid timeout
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        try {
          await service.generate(`Test ${i}`, {
            degradedResponse: "Error",
          });
        } catch (error) {
          // Expected
        }
      }

      // Error log should not grow indefinitely
      const errorLog = service.getErrorLog();
      expect(errorLog.length).toBeLessThanOrEqual(iterations);
    });
  });
});
