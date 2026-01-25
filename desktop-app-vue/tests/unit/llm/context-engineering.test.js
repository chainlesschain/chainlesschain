/**
 * Context Engineering 单元测试
 * 测试目标: src/main/llm/context-engineering.js
 * 覆盖场景: KV-Cache优化、Prompt构建、任务重述、可恢复压缩
 *
 * 注意: 精简版以避免OOM，聚焦核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock crypto
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => 'mocked-hash')
    }))
  }
}));

describe('ContextEngineering', () => {
  let ContextEngineering;
  let RecoverableCompressor;
  let contextEngineering;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/llm/context-engineering.js');
    ContextEngineering = module.ContextEngineering;
    RecoverableCompressor = module.RecoverableCompressor;
  });

  describe('构造函数', () => {
    it('应该创建实例', () => {
      contextEngineering = new ContextEngineering();

      expect(contextEngineering).toBeDefined();
    });

    it('应该使用默认配置', () => {
      contextEngineering = new ContextEngineering();

      expect(contextEngineering.config.enableKVCacheOptimization).toBe(true);
      expect(contextEngineering.config.enableTodoMechanism).toBe(true);
      expect(contextEngineering.config.maxHistoryMessages).toBe(50);
      expect(contextEngineering.config.preserveErrors).toBe(true);
      expect(contextEngineering.config.maxPreservedErrors).toBe(5);
    });

    it('应该接受自定义配置', () => {
      contextEngineering = new ContextEngineering({
        enableKVCacheOptimization: false,
        maxHistoryMessages: 100,
        maxPreservedErrors: 10
      });

      expect(contextEngineering.config.enableKVCacheOptimization).toBe(false);
      expect(contextEngineering.config.maxHistoryMessages).toBe(100);
      expect(contextEngineering.config.maxPreservedErrors).toBe(10);
    });

    it('应该初始化统计', () => {
      contextEngineering = new ContextEngineering();

      expect(contextEngineering.stats).toEqual({
        cacheHits: 0,
        cacheMisses: 0,
        totalCalls: 0,
        compressionSavings: 0
      });
    });

    it('应该初始化errorHistory为空数组', () => {
      contextEngineering = new ContextEngineering();

      expect(contextEngineering.errorHistory).toEqual([]);
    });

    it('应该初始化currentTask为null', () => {
      contextEngineering = new ContextEngineering();

      expect(contextEngineering.currentTask).toBeNull();
    });
  });

  describe('buildOptimizedPrompt', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
    });

    it('应该构建基本prompt', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'You are a helpful assistant',
        messages: []
      });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('system');
    });

    it('应该包含metadata', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: []
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.cacheBreakpoints).toBeDefined();
      expect(result.metadata.staticPartLength).toBeDefined();
      expect(result.metadata.dynamicPartLength).toBeDefined();
    });

    it('应该添加工具定义', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: [],
        tools: [{ name: 'tool1', description: 'Tool 1' }]
      });

      expect(result.messages.length).toBeGreaterThan(1);
      expect(result.messages.some(m => m.content?.includes('Available Tools'))).toBe(true);
    });

    it('应该包含对话历史', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' }
        ]
      });

      expect(result.messages.length).toBeGreaterThan(2);
    });

    it('应该添加任务重述（如果有taskContext）', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: [],
        taskContext: {
          goal: 'Complete task',
          currentStep: 1,
          totalSteps: 3
        }
      });

      expect(result.messages.some(m => m.content?.includes('Task') || m.content?.includes('goal'))).toBe(true);
    });

    it('应该增加totalCalls统计', () => {
      const initialCalls = contextEngineering.stats.totalCalls;

      contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: []
      });

      expect(contextEngineering.stats.totalCalls).toBe(initialCalls + 1);
    });

    it('应该标记缓存断点', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: []
      });

      expect(result.metadata.cacheBreakpoints.length).toBeGreaterThan(0);
    });

    it('应该处理空messages', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test'
      });

      expect(result.messages).toBeDefined();
    });

    it('应该处理空tools', () => {
      const result = contextEngineering.buildOptimizedPrompt({
        systemPrompt: 'Test',
        tools: []
      });

      expect(result.messages).toBeDefined();
    });
  });

  describe('recordError', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
    });

    it('应该记录错误', () => {
      const error = { message: 'Test error', stack: 'Stack trace' };

      contextEngineering.recordError(error);

      expect(contextEngineering.errorHistory.length).toBe(1);
      expect(contextEngineering.errorHistory[0]).toMatchObject({
        error,
        resolved: false
      });
    });

    it('应该限制errorHistory大小', () => {
      contextEngineering.config.maxPreservedErrors = 3;

      for (let i = 0; i < 5; i++) {
        contextEngineering.recordError({ message: `Error ${i}` });
      }

      expect(contextEngineering.errorHistory.length).toBe(3);
    });

    it('应该保留最新的错误', () => {
      contextEngineering.config.maxPreservedErrors = 2;

      contextEngineering.recordError({ message: 'Error 1' });
      contextEngineering.recordError({ message: 'Error 2' });
      contextEngineering.recordError({ message: 'Error 3' });

      expect(contextEngineering.errorHistory[0].error.message).toBe('Error 2');
      expect(contextEngineering.errorHistory[1].error.message).toBe('Error 3');
    });

    it('应该添加timestamp', () => {
      contextEngineering.recordError({ message: 'Test' });

      expect(contextEngineering.errorHistory[0].timestamp).toBeDefined();
    });
  });

  describe('resolveError', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
      contextEngineering.recordError({ message: 'Error 1' });
      contextEngineering.recordError({ message: 'Error 2' });
    });

    it('应该标记错误为已解决', () => {
      contextEngineering.resolveError(0, 'Fixed by doing X');

      expect(contextEngineering.errorHistory[0].resolved).toBe(true);
      expect(contextEngineering.errorHistory[0].resolution).toBe('Fixed by doing X');
    });

    it('应该不影响其他错误', () => {
      contextEngineering.resolveError(0, 'Fixed');

      expect(contextEngineering.errorHistory[1].resolved).toBe(false);
    });
  });

  describe('setCurrentTask', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
    });

    it('应该设置当前任务', () => {
      const task = { goal: 'Complete task', steps: ['step1', 'step2'] };

      contextEngineering.setCurrentTask(task);

      expect(contextEngineering.currentTask).toEqual(task);
    });
  });

  describe('updateTaskProgress', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
      contextEngineering.setCurrentTask({ goal: 'Test', steps: [] });
    });

    it('应该更新任务进度', () => {
      contextEngineering.updateTaskProgress(2, 'in_progress');

      expect(contextEngineering.currentTask.currentStep).toBe(2);
      expect(contextEngineering.currentTask.status).toBe('in_progress');
    });
  });

  describe('getCurrentTask', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
    });

    it('应该返回当前任务', () => {
      const task = { goal: 'Test' };
      contextEngineering.setCurrentTask(task);

      const result = contextEngineering.getCurrentTask();

      expect(result).toEqual(task);
    });

    it('应该在无任务时返回null', () => {
      const result = contextEngineering.getCurrentTask();

      expect(result).toBeNull();
    });
  });

  describe('clearTask', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
      contextEngineering.setCurrentTask({ goal: 'Test' });
    });

    it('应该清除当前任务', () => {
      contextEngineering.clearTask();

      expect(contextEngineering.currentTask).toBeNull();
    });
  });

  describe('clearErrors', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
      contextEngineering.recordError({ message: 'Error 1' });
      contextEngineering.recordError({ message: 'Error 2' });
    });

    it('应该清除所有错误', () => {
      contextEngineering.clearErrors();

      expect(contextEngineering.errorHistory).toEqual([]);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
    });

    it('应该返回统计信息', () => {
      const stats = contextEngineering.getStats();

      expect(stats).toBeDefined();
      expect(stats.cacheHits).toBeDefined();
      expect(stats.cacheMisses).toBeDefined();
      expect(stats.totalCalls).toBeDefined();
    });

    it('应该包含缓存命中率', () => {
      contextEngineering.stats.totalCalls = 10;
      contextEngineering.stats.cacheHits = 7;

      const stats = contextEngineering.getStats();

      expect(stats.cacheHitRate).toBeDefined();
    });

    it('应该在没有调用时返回0命中率', () => {
      const stats = contextEngineering.getStats();

      expect(stats.cacheHitRate).toBe(0);
    });
  });

  describe('resetStats', () => {
    beforeEach(() => {
      contextEngineering = new ContextEngineering();
      contextEngineering.stats.cacheHits = 10;
      contextEngineering.stats.totalCalls = 20;
    });

    it('应该重置所有统计', () => {
      contextEngineering.resetStats();

      expect(contextEngineering.stats.cacheHits).toBe(0);
      expect(contextEngineering.stats.cacheMisses).toBe(0);
      expect(contextEngineering.stats.totalCalls).toBe(0);
      expect(contextEngineering.stats.compressionSavings).toBe(0);
    });
  });
});

describe('RecoverableCompressor', () => {
  let RecoverableCompressor;
  let compressor;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await import('../../../src/main/llm/context-engineering.js');
    RecoverableCompressor = module.RecoverableCompressor;
  });

  describe('构造函数', () => {
    it('应该创建实例', () => {
      compressor = new RecoverableCompressor();

      expect(compressor).toBeDefined();
    });
  });

  describe('compress', () => {
    beforeEach(() => {
      compressor = new RecoverableCompressor();
    });

    it('应该压缩webpage类型', () => {
      const result = compressor.compress({
        url: 'https://example.com',
        title: 'Example',
        content: 'Long content...'
      }, 'webpage');

      expect(result.refType).toBe('webpage');
      expect(result.url).toBe('https://example.com');
      expect(result.recoverable).toBe(true);
    });

    it('应该压缩file类型', () => {
      const result = compressor.compress({
        path: '/path/to/file.txt',
        content: 'File content'
      }, 'file');

      expect(result.refType).toBe('file');
      expect(result.path).toBe('/path/to/file.txt');
      expect(result.recoverable).toBe(true);
    });

    it('应该压缩dbResult类型', () => {
      const result = compressor.compress({
        query: 'SELECT * FROM users',
        rowCount: 100
      }, 'dbResult');

      expect(result.refType).toBe('dbResult');
      expect(result.recoverable).toBe(true);
    });

    it('应该压缩default类型', () => {
      const result = compressor.compress('Long text content', 'default');

      expect(result.refType).toBe('compressed');
      expect(result.recoverable).toBe(false);
      expect(result.preview).toBeDefined();
    });

    it('应该包含metadata', () => {
      const result = compressor.compress({ url: 'test' }, 'webpage');

      expect(result.metadata).toBeDefined();
      expect(result.metadata.compressedAt).toBeDefined();
    });
  });

  describe('isCompressedRef', () => {
    beforeEach(() => {
      compressor = new RecoverableCompressor();
    });

    it('应该识别压缩引用', () => {
      const ref = compressor.compress({ url: 'test' }, 'webpage');

      expect(compressor.isCompressedRef(ref)).toBe(true);
    });

    it('应该拒绝普通对象', () => {
      expect(compressor.isCompressedRef({ foo: 'bar' })).toBe(false);
    });

    it('应该拒绝null', () => {
      expect(compressor.isCompressedRef(null)).toBe(false);
    });

    it('应该拒绝字符串', () => {
      expect(compressor.isCompressedRef('test')).toBe(false);
    });
  });

  describe('recover', () => {
    beforeEach(() => {
      compressor = new RecoverableCompressor();
    });

    it('应该返回非压缩内容原样', async () => {
      const content = { foo: 'bar' };

      const result = await compressor.recover(content);

      expect(result).toBe(content);
    });

    it('应该恢复webpage类型', async () => {
      const ref = compressor.compress({ url: 'https://example.com' }, 'webpage');
      const fetchWebpage = vi.fn(async () => 'Page content');

      const result = await compressor.recover(ref, { fetchWebpage });

      expect(fetchWebpage).toHaveBeenCalledWith('https://example.com');
      expect(result).toBe('Page content');
    });

    it('应该恢复file类型', async () => {
      const ref = compressor.compress({ path: '/test.txt' }, 'file');
      const readFile = vi.fn(async () => 'File content');

      const result = await compressor.recover(ref, { readFile });

      expect(readFile).toHaveBeenCalledWith('/test.txt');
      expect(result).toBe('File content');
    });

    it('应该恢复dbResult类型', async () => {
      const ref = compressor.compress({ query: 'SELECT *' }, 'dbResult');
      const runQuery = vi.fn(async () => [{ id: 1 }]);

      const result = await compressor.recover(ref, { runQuery });

      expect(runQuery).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('应该在不可恢复时抛出错误', async () => {
      const ref = compressor.compress('text', 'default');

      await expect(compressor.recover(ref)).rejects.toThrow('not recoverable');
    });

    it('应该在缺少恢复函数时抛出错误', async () => {
      const ref = compressor.compress({ url: 'test' }, 'webpage');

      await expect(compressor.recover(ref, {})).rejects.toThrow('No recovery function');
    });
  });
});
