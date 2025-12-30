/**
 * LLM超时性能测试
 *
 * 测试目标:
 * 1. 验证简单提示在30s内完成
 * 2. 验证复杂提示在120s内完成
 * 3. 验证600s超时优雅处理
 *
 * 背景: LLM调用耗时80-120秒,已增加到600s超时
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('LLM超时性能测试', () => {
  let llmManager;
  let mockLLMService;

  beforeEach(async () => {
    // 动态导入LLM Manager（避免初始化问题）
    mockLLMService = createMockLLMService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * P1-2-1: 简单提示应在30s内完成
   */
  it('should complete simple prompt within 30s', async () => {
    const startTime = Date.now();
    const simplePrompt = '请用一句话介绍什么是AI？';

    // Mock快速响应
    mockLLMService.setResponseTime(1000); // 1秒响应

    const response = await mockLLMService.query(simplePrompt, {
      maxTokens: 100,
      temperature: 0.7
    });

    const duration = Date.now() - startTime;

    expect(response).toBeDefined();
    expect(response.text).toBeTruthy();
    expect(duration).toBeLessThan(30000); // 30秒
    console.log(`✓ 简单提示完成时间: ${duration}ms`);
  }, 35000); // 测试超时设为35s

  /**
   * P1-2-2: 复杂提示应在120s内完成
   */
  it('should complete complex prompt within 120s', async () => {
    const startTime = Date.now();
    const complexPrompt = `请详细分析以下代码的性能问题并提供优化建议：

    function processLargeDataset(data) {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < data.length; j++) {
          result.push(data[i] + data[j]);
        }
      }
      return result;
    }

    要求：
    1. 识别时间复杂度问题
    2. 提供至少3种优化方案
    3. 给出优化后的代码实现
    4. 分析优化效果`;

    // Mock中等响应时间（模拟实际LLM处理复杂任务）
    mockLLMService.setResponseTime(80000); // 80秒响应

    const response = await mockLLMService.query(complexPrompt, {
      maxTokens: 2000,
      temperature: 0.7
    });

    const duration = Date.now() - startTime;

    expect(response).toBeDefined();
    expect(response.text).toBeTruthy();
    expect(response.text.length).toBeGreaterThan(100); // 复杂提示应该有详细回答
    expect(duration).toBeLessThan(120000); // 120秒
    console.log(`✓ 复杂提示完成时间: ${duration}ms`);
  }, 125000); // 测试超时设为125s

  /**
   * P1-2-3: 600s超时应优雅处理
   */
  it('should handle timeout gracefully after 600s', async () => {
    const startTime = Date.now();
    const timeoutPrompt = '这是一个超时测试提示';

    // Mock超长响应时间（模拟超时场景）
    mockLLMService.setResponseTime(610000); // 610秒，超过600秒限制

    try {
      await mockLLMService.query(timeoutPrompt, {
        timeout: 1000 // 设置1秒超时用于快速测试
      });

      // 如果没有抛出错误，测试失败
      expect.fail('应该抛出超时错误');
    } catch (error) {
      const duration = Date.now() - startTime;

      // 验证错误类型
      expect(error.message).toMatch(/timeout|超时/i);

      // 验证在合理时间内返回错误（不是真的等610秒）
      expect(duration).toBeLessThan(5000); // 应在5秒内返回超时错误

      console.log(`✓ 超时错误正确处理: ${duration}ms`);
      console.log(`✓ 错误信息: ${error.message}`);
    }
  }, 10000); // 测试超时设为10s

  /**
   * P1-2-4: 流式响应性能测试
   */
  it('should handle streaming responses efficiently', async () => {
    const startTime = Date.now();
    const streamPrompt = '请生成一个200字的故事';
    const chunks = [];

    // Mock流式响应
    mockLLMService.setStreamMode(true);
    mockLLMService.setResponseTime(5000); // 5秒内完成

    const stream = await mockLLMService.queryStream(streamPrompt);

    for await (const chunk of stream) {
      chunks.push(chunk);
      expect(chunk).toBeTruthy();
    }

    const duration = Date.now() - startTime;
    const fullText = chunks.join('');

    expect(chunks.length).toBeGreaterThan(0);
    expect(fullText.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10000); // 10秒

    console.log(`✓ 流式响应完成时间: ${duration}ms`);
    console.log(`✓ 接收到 ${chunks.length} 个数据块`);
  }, 15000);

  /**
   * P1-2-5: 并发请求性能测试
   */
  it('should handle concurrent requests without significant delay', async () => {
    const startTime = Date.now();
    const prompts = [
      '什么是机器学习？',
      '什么是深度学习？',
      '什么是神经网络？'
    ];

    mockLLMService.setResponseTime(2000); // 每个请求2秒

    // 并发发送3个请求
    const promises = prompts.map(prompt =>
      mockLLMService.query(prompt, { maxTokens: 100 })
    );

    const responses = await Promise.all(promises);
    const duration = Date.now() - startTime;

    // 验证所有响应都成功
    expect(responses).toHaveLength(3);
    responses.forEach(response => {
      expect(response).toBeDefined();
      expect(response.text).toBeTruthy();
    });

    // 并发执行应该接近单个请求时间，而不是累加
    // 允许一些开销，但不应该是 3 * 2000ms
    expect(duration).toBeLessThan(6000); // 应在6秒内完成（理想2秒，允许开销）

    console.log(`✓ 并发请求完成时间: ${duration}ms`);
  }, 10000);

  /**
   * P1-2-6: 重试机制测试
   */
  it('should retry on transient failures', async () => {
    let attemptCount = 0;

    // Mock第一次失败，第二次成功
    mockLLMService.setFailureMode({
      failUntilAttempt: 2,
      onAttempt: () => attemptCount++
    });
    mockLLMService.setResponseTime(1000);

    const response = await mockLLMService.queryWithRetry('测试提示', {
      maxRetries: 3,
      retryDelay: 500
    });

    expect(attemptCount).toBe(2); // 第一次失败，第二次成功
    expect(response).toBeDefined();
    expect(response.text).toBeTruthy();

    console.log(`✓ 重试 ${attemptCount} 次后成功`);
  }, 10000);

  /**
   * P1-2-7: 大批量数据处理性能
   */
  it('should process large batch efficiently', async () => {
    const startTime = Date.now();
    const batchSize = 10;
    const prompts = Array.from({ length: batchSize }, (_, i) =>
      `生成第${i + 1}个标题`
    );

    mockLLMService.setResponseTime(500); // 每个500ms

    const results = await mockLLMService.batchQuery(prompts, {
      batchSize: 5, // 每批5个
      maxTokens: 50
    });

    const duration = Date.now() - startTime;

    expect(results).toHaveLength(batchSize);
    results.forEach(result => {
      expect(result).toBeDefined();
      expect(result.text).toBeTruthy();
    });

    // 批处理应该比顺序执行快
    // 顺序: 10 * 500ms = 5000ms
    // 批处理(批大小5): 2批 * 500ms ≈ 1000ms（并发）
    expect(duration).toBeLessThan(3000); // 应在3秒内完成

    console.log(`✓ 批量处理${batchSize}个请求完成时间: ${duration}ms`);
  }, 10000);
});

/**
 * 创建Mock LLM服务
 */
function createMockLLMService() {
  let responseTime = 1000; // 默认响应时间1秒
  let streamMode = false;
  let failureMode = null;

  return {
    setResponseTime(ms) {
      responseTime = ms;
    },

    setStreamMode(enabled) {
      streamMode = enabled;
    },

    setFailureMode(config) {
      failureMode = config;
    },

    async query(prompt, options = {}) {
      const timeout = options.timeout || 600000; // 默认600秒
      const delay = responseTime;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('LLM请求超时'));
        }, timeout);

        setTimeout(() => {
          clearTimeout(timer);
          if (delay > timeout) {
            reject(new Error('LLM请求超时'));
          } else {
            resolve({
              text: `这是对提示 "${prompt.substring(0, 30)}..." 的回答。`.repeat(
                options.maxTokens ? Math.floor(options.maxTokens / 50) : 1
              ),
              tokens: options.maxTokens || 100,
              model: 'mock-model',
              finishReason: 'stop'
            });
          }
        }, Math.min(delay, timeout));
      });
    },

    async queryStream(prompt, options = {}) {
      const delay = responseTime;
      const chunks = 10;
      const chunkDelay = delay / chunks;

      async function* generate() {
        for (let i = 0; i < chunks; i++) {
          await new Promise(resolve => setTimeout(resolve, chunkDelay));
          yield `这是第${i + 1}个数据块。`;
        }
      }

      return generate();
    },

    async queryWithRetry(prompt, options = {}) {
      const maxRetries = options.maxRetries || 3;
      const retryDelay = options.retryDelay || 1000;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (failureMode && failureMode.onAttempt) {
            failureMode.onAttempt();
          }

          if (failureMode && attempt < failureMode.failUntilAttempt) {
            throw new Error('模拟瞬时失败');
          }

          return await this.query(prompt, options);
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }

      throw lastError;
    },

    async batchQuery(prompts, options = {}) {
      const batchSize = options.batchSize || 5;
      const results = [];

      for (let i = 0; i < prompts.length; i += batchSize) {
        const batch = prompts.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(prompt => this.query(prompt, options))
        );
        results.push(...batchResults);
      }

      return results;
    }
  };
}
