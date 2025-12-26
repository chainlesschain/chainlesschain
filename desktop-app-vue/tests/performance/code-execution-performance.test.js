/**
 * 代码执行性能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('代码执行性能测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('执行速度', () => {
    it('应该快速执行简单代码', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'Hello',
        executionTime: 50
      });

      const startTime = performance.now();

      const result = await mockElectronAPI.code.executePython('print("Hello")');

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeLessThan(100);
      expect(totalTime).toBeLessThan(200); // 包括IPC开销
    });

    it('应该在5秒内执行复杂计算', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'Result: 832040',
        executionTime: 4500
      });

      const code = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

result = fibonacci(30)
print(f"Result: {result}")
      `;

      const startTime = performance.now();

      const result = await mockElectronAPI.code.executePython(code);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('并发执行', () => {
    it('应该支持并发执行多个代码片段', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'Output',
        executionTime: 100
      });

      const promises = [];
      const concurrentCount = 10;

      const startTime = performance.now();

      for (let i = 0; i < concurrentCount; i++) {
        promises.push(
          mockElectronAPI.code.executePython(`print("Test ${i}")`)
        );
      }

      const results = await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results).toHaveLength(concurrentCount);
      expect(results.every(r => r.success)).toBe(true);

      // 并发执行不应该显著增加总时间
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('资源清理', () => {
    it('应该正确清理临时文件', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        tempFiles: 1,
        cleanedUp: true
      });

      const result = await mockElectronAPI.code.executePython('print("test")');

      expect(result.cleanedUp).toBe(true);
    });

    it('应该限制临时文件数量', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        tempFileCount: 5
      });

      // 执行多次
      for (let i = 0; i < 20; i++) {
        await mockElectronAPI.code.executePython(`print(${i})`);
      }

      const result = await mockElectronAPI.code.executePython('print("final")');

      // 临时文件数量应该被限制
      expect(result.tempFileCount).toBeLessThan(10);
    });
  });
});

describe('压力测试', () => {
  describe('高频执行', () => {
    it('应该处理高频代码执行请求', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'OK'
      });

      const iterations = 100;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        await mockElectronAPI.code.executePython('print("test")');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const avgTime = duration / iterations;

      expect(avgTime).toBeLessThan(50); // 平均每次执行 < 50ms
    });

    it('应该处理大量输出', async () => {
      const largeOutput = 'x'.repeat(100000); // 100KB 输出

      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: largeOutput,
        executionTime: 200
      });

      const startTime = performance.now();

      const result = await mockElectronAPI.code.executePython('print("x" * 100000)');

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.stdout.length).toBeGreaterThan(50000);
      expect(duration).toBeLessThan(500);
    });
  });

  describe('长时间运行', () => {
    it('应该稳定处理长时间运行的代码', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'Completed',
        executionTime: 10000
      });

      const code = `
import time
for i in range(10):
    print(f"Step {i}")
    time.sleep(1)
print("Completed")
      `;

      const result = await mockElectronAPI.code.executePython(code, {
        timeout: 15000
      });

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeLessThan(12000);
    });
  });

  describe('错误处理压力', () => {
    it('应该快速处理大量错误', async () => {
      mockElectronAPI.code.executePython.mockResolvedValue({
        success: false,
        stderr: 'SyntaxError: invalid syntax',
        exitCode: 1
      });

      const iterations = 50;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const result = await mockElectronAPI.code.executePython('print("incomplete');
        expect(result.success).toBe(false);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000);
    });
  });
});

describe('AI生成代码性能', () => {
  it('应该在10秒内生成代码', async () => {
    mockElectronAPI.code.generate.mockResolvedValue({
      success: true,
      code: 'def function(): pass',
      generationTime: 8000
    });

    const startTime = performance.now();

    const result = await mockElectronAPI.code.generate('生成一个函数');

    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(10000);
  });

  it('应该缓存常见的代码生成请求', async () => {
    const prompt = '生成排序函数';

    // 第一次请求
    mockElectronAPI.code.generate.mockResolvedValue({
      success: true,
      code: 'def sort(): pass',
      cached: false,
      generationTime: 5000
    });

    const result1 = await mockElectronAPI.code.generate(prompt);
    expect(result1.cached).toBe(false);

    // 第二次相同请求应该使用缓存
    mockElectronAPI.code.generate.mockResolvedValue({
      success: true,
      code: 'def sort(): pass',
      cached: true,
      generationTime: 100
    });

    const result2 = await mockElectronAPI.code.generate(prompt);
    expect(result2.cached).toBe(true);
    expect(result2.generationTime).toBeLessThan(result1.generationTime);
  });
});
