/**
 * Context Engineering 模块测试
 *
 * 测试内容：
 * - ContextEngineering 类的 KV-Cache 优化
 * - RecoverableCompressor 类的内容压缩
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  ContextEngineering,
  RecoverableCompressor,
  getContextEngineering,
} = require('../context-engineering');

describe('ContextEngineering', () => {
  let contextEngine;

  beforeEach(() => {
    contextEngine = new ContextEngineering({
      enableKVCacheOptimization: true,
      enableTodoMechanism: true,
      maxHistoryMessages: 50,
      preserveErrors: true,
      maxPreservedErrors: 5,
    });
  });

  afterEach(() => {
    contextEngine.resetStats();
    contextEngine.clearErrors();
    contextEngine.clearTask();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const engine = new ContextEngineering();
      expect(engine.config.enableKVCacheOptimization).toBe(true);
      expect(engine.config.enableTodoMechanism).toBe(true);
      expect(engine.config.maxHistoryMessages).toBe(50);
      expect(engine.config.preserveErrors).toBe(true);
    });

    it('should initialize with custom config', () => {
      const engine = new ContextEngineering({
        enableKVCacheOptimization: false,
        maxHistoryMessages: 100,
        maxPreservedErrors: 10,
      });
      expect(engine.config.enableKVCacheOptimization).toBe(false);
      expect(engine.config.maxHistoryMessages).toBe(100);
      expect(engine.config.maxPreservedErrors).toBe(10);
    });
  });

  describe('buildOptimizedPrompt', () => {
    it('should build prompt with system message', () => {
      const result = contextEngine.buildOptimizedPrompt({
        systemPrompt: 'You are a helpful assistant.',
        messages: [],
        tools: [],
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('You are a helpful assistant.');
      expect(result.metadata.staticPartLength).toBe(1);
    });

    it('should include tool definitions', () => {
      const result = contextEngine.buildOptimizedPrompt({
        systemPrompt: 'You are a helpful assistant.',
        messages: [],
        tools: [
          { name: 'search', description: 'Search the web', parameters: {} },
          { name: 'calculate', description: 'Do math', parameters: {} },
        ],
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].content).toContain('Available Tools');
      expect(result.messages[1].content).toContain('calculate');
      expect(result.messages[1].content).toContain('search');
    });

    it('should sort tools by name for deterministic serialization', () => {
      const result = contextEngine.buildOptimizedPrompt({
        systemPrompt: 'Test',
        messages: [],
        tools: [
          { name: 'zebra', description: 'Z tool' },
          { name: 'apple', description: 'A tool' },
        ],
      });

      const toolContent = result.messages[1].content;
      const appleIndex = toolContent.indexOf('apple');
      const zebraIndex = toolContent.indexOf('zebra');
      expect(appleIndex).toBeLessThan(zebraIndex);
    });

    it('should include conversation history', () => {
      const result = contextEngine.buildOptimizedPrompt({
        systemPrompt: 'You are helpful.',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          { role: 'assistant', content: 'Hi there!' },
        ],
        tools: [],
      });

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.metadata.dynamicPartLength).toBe(2);
    });

    it('should include task reminder when task context provided', () => {
      const result = contextEngine.buildOptimizedPrompt({
        systemPrompt: 'You are helpful.',
        messages: [],
        tools: [],
        taskContext: {
          objective: 'Write a function',
          steps: ['Plan', 'Implement', 'Test'],
          currentStep: 1,
        },
      });

      const lastMessage = result.messages[result.messages.length - 1];
      expect(lastMessage.content).toContain('Current Task Status');
      expect(lastMessage.content).toContain('Write a function');
      expect(lastMessage.content).toContain('[x] Step 1: Plan');
      expect(lastMessage.content).toContain('[>] Step 2: Implement');
      expect(lastMessage.content).toContain('[ ] Step 3: Test');
    });

    it('should track cache hits for identical static content', () => {
      const options = {
        systemPrompt: 'Test prompt',
        messages: [],
        tools: [{ name: 'test', description: 'Test tool' }],
      };

      // First call - cache miss
      contextEngine.buildOptimizedPrompt(options);
      expect(contextEngine.stats.cacheMisses).toBe(1);
      expect(contextEngine.stats.cacheHits).toBe(0);

      // Second call with same static content - cache hit
      contextEngine.buildOptimizedPrompt(options);
      expect(contextEngine.stats.cacheMisses).toBe(1);
      expect(contextEngine.stats.cacheHits).toBe(1);
    });
  });

  describe('_cleanSystemPrompt', () => {
    it('should remove timestamps from prompt', () => {
      const cleaned = contextEngine._cleanSystemPrompt(
        'Current time: 2026-02-06T10:30:00Z',
      );
      // The regex removes dates and times separately
      expect(cleaned).toContain('[DATE]');
    });

    it('should remove UUIDs from prompt', () => {
      const cleaned = contextEngine._cleanSystemPrompt(
        'Session: 550e8400-e29b-41d4-a716-446655440000',
      );
      expect(cleaned).toBe('Session: [UUID]');
    });

    it('should remove session IDs', () => {
      const cleaned = contextEngine._cleanSystemPrompt(
        'session_id: abc123xyz',
      );
      expect(cleaned).toBe('session_id: [SESSION]');
    });

    it('should handle empty or null input', () => {
      expect(contextEngine._cleanSystemPrompt('')).toBe('');
      expect(contextEngine._cleanSystemPrompt(null)).toBe('');
      expect(contextEngine._cleanSystemPrompt(undefined)).toBe('');
    });
  });

  describe('_cleanMessages', () => {
    it('should remove timestamps and IDs from messages', () => {
      const messages = [
        {
          role: 'user',
          content: 'Hello',
          timestamp: 1234567890,
          id: 'msg-123',
          messageId: 'uuid-456',
        },
      ];

      const cleaned = contextEngine._cleanMessages(messages);

      expect(cleaned[0]).toEqual({
        role: 'user',
        content: 'Hello',
      });
      expect(cleaned[0].timestamp).toBeUndefined();
      expect(cleaned[0].id).toBeUndefined();
    });

    it('should preserve function calls', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          function_call: { name: 'search', arguments: '{}' },
        },
      ];

      const cleaned = contextEngine._cleanMessages(messages);
      expect(cleaned[0].function_call).toEqual({
        name: 'search',
        arguments: '{}',
      });
    });

    it('should preserve tool calls', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 't1', function: { name: 'test' } }],
        },
      ];

      const cleaned = contextEngine._cleanMessages(messages);
      expect(cleaned[0].tool_calls).toBeDefined();
    });
  });

  describe('error tracking', () => {
    it('should record errors', () => {
      contextEngine.recordError({
        step: 1,
        message: 'Test error',
      });

      expect(contextEngine.errorHistory).toHaveLength(1);
      expect(contextEngine.errorHistory[0].step).toBe(1);
      expect(contextEngine.errorHistory[0].message).toBe('Test error');
    });

    it('should resolve errors', () => {
      contextEngine.recordError({ step: 1, message: 'Error 1' });
      contextEngine.resolveError(0, 'Fixed by retrying');

      expect(contextEngine.errorHistory[0].resolution).toBe('Fixed by retrying');
    });

    it('should limit error history size', () => {
      for (let i = 0; i < 15; i++) {
        contextEngine.recordError({ step: i, message: `Error ${i}` });
      }

      // maxPreservedErrors * 2 = 10, should be trimmed to 5
      expect(contextEngine.errorHistory.length).toBeLessThanOrEqual(10);
    });

    it('should build error context for prompt', () => {
      contextEngine.recordError({ step: 1, message: 'Error 1' });
      contextEngine.resolveError(0, 'Fixed');

      const context = contextEngine._buildErrorContext();
      expect(context).toContain('Recent Errors');
      expect(context).toContain('Error 1');
      expect(context).toContain('Fixed');
    });

    it('should return empty string when no errors', () => {
      const context = contextEngine._buildErrorContext();
      expect(context).toBe('');
    });
  });

  describe('task management', () => {
    it('should set current task', () => {
      const task = { objective: 'Test', steps: ['Step 1'] };
      contextEngine.setCurrentTask(task);

      expect(contextEngine.getCurrentTask()).toEqual(task);
    });

    it('should update task progress', () => {
      contextEngine.setCurrentTask({
        objective: 'Test',
        steps: ['Step 1', 'Step 2'],
        currentStep: 0,
      });

      contextEngine.updateTaskProgress(1, 'in_progress');

      expect(contextEngine.currentTask.currentStep).toBe(1);
      expect(contextEngine.currentTask.status).toBe('in_progress');
    });

    it('should clear task', () => {
      contextEngine.setCurrentTask({ objective: 'Test' });
      contextEngine.clearTask();

      expect(contextEngine.getCurrentTask()).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should track call statistics', () => {
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Different' });

      const stats = contextEngine.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(2);
    });

    it('should calculate cache hit rate', () => {
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });

      const stats = contextEngine.getStats();
      expect(stats.cacheHitRate).toBe(0.75);
      expect(stats.cacheHitRatePercent).toBe('75.00%');
    });

    it('should reset statistics', () => {
      contextEngine.buildOptimizedPrompt({ systemPrompt: 'Test' });
      contextEngine.resetStats();

      const stats = contextEngine.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.cacheHits).toBe(0);
    });
  });
});

describe('RecoverableCompressor', () => {
  let compressor;

  beforeEach(() => {
    compressor = new RecoverableCompressor();
  });

  describe('compress', () => {
    it('should not compress short content', () => {
      const shortText = 'Hello world';
      const result = compressor.compress(shortText, 'default');
      expect(result).toBe(shortText);
    });

    it('should compress long text content', () => {
      const longText = 'a'.repeat(5000);
      const result = compressor.compress(longText, 'default');

      expect(result._type).toBe('compressed_ref');
      expect(result.refType).toBe('text');
      expect(result.preview).toContain('...');
      expect(result.originalLength).toBe(5000);
    });

    it('should compress webpage data', () => {
      const webpage = {
        url: 'https://example.com',
        title: 'Example Page',
        content: 'a'.repeat(5000),
        summary: 'A test page',
      };

      const result = compressor.compress(webpage, 'webpage');

      expect(result._type).toBe('compressed_ref');
      expect(result.refType).toBe('webpage');
      expect(result.url).toBe('https://example.com');
      expect(result.recoverable).toBe(true);
    });

    it('should compress file data', () => {
      const fileData = {
        path: '/home/user/document.txt',
        content: 'a'.repeat(10000),
        size: 10000,
      };

      const result = compressor.compress(fileData, 'file');

      expect(result._type).toBe('compressed_ref');
      expect(result.refType).toBe('file');
      expect(result.path).toBe('/home/user/document.txt');
      expect(result.recoverable).toBe(true);
    });

    it('should compress database results', () => {
      const dbResult = {
        query: 'SELECT * FROM users',
        rows: Array(100).fill({ id: 1, name: 'test' }),
        columns: ['id', 'name'],
      };

      const result = compressor.compress(dbResult, 'dbResult');

      expect(result._type).toBe('compressed_ref');
      expect(result.refType).toBe('dbResult');
      expect(result.query).toBe('SELECT * FROM users');
      expect(result.preview.length).toBeLessThanOrEqual(10);
      expect(result.recoverable).toBe(true);
    });

    it('should handle null/undefined content', () => {
      expect(compressor.compress(null)).toBeNull();
      expect(compressor.compress(undefined)).toBeUndefined();
    });
  });

  describe('isCompressedRef', () => {
    it('should identify compressed references', () => {
      const ref = { _type: 'compressed_ref', refType: 'text' };
      expect(compressor.isCompressedRef(ref)).toBe(true);
    });

    it('should reject non-compressed data', () => {
      expect(compressor.isCompressedRef({ type: 'other' })).toBe(false);
      expect(compressor.isCompressedRef('string')).toBe(false);
      expect(compressor.isCompressedRef(null)).toBeFalsy();
    });
  });

  describe('recover', () => {
    it('should throw error for non-recoverable content', async () => {
      const ref = {
        _type: 'compressed_ref',
        refType: 'text',
        recoverable: false,
      };

      await expect(compressor.recover(ref, {})).rejects.toThrow(
        'Content is not recoverable',
      );
    });

    it('should recover webpage content', async () => {
      const ref = {
        _type: 'compressed_ref',
        refType: 'webpage',
        url: 'https://example.com',
        recoverable: true,
      };

      const mockFetch = vi.fn().mockResolvedValue('<html>content</html>');

      const result = await compressor.recover(ref, {
        fetchWebpage: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://example.com');
      expect(result).toBe('<html>content</html>');
    });

    it('should recover file content', async () => {
      const ref = {
        _type: 'compressed_ref',
        refType: 'file',
        path: '/path/to/file.txt',
        recoverable: true,
      };

      const mockRead = vi.fn().mockResolvedValue('file content');

      const result = await compressor.recover(ref, {
        readFile: mockRead,
      });

      expect(mockRead).toHaveBeenCalledWith('/path/to/file.txt');
      expect(result).toBe('file content');
    });

    it('should throw error when recovery function missing', async () => {
      const ref = {
        _type: 'compressed_ref',
        refType: 'webpage',
        recoverable: true,
      };

      await expect(compressor.recover(ref, {})).rejects.toThrow(
        'No recovery function',
      );
    });

    it('should pass through non-compressed data', async () => {
      const data = { regular: 'data' };
      const result = await compressor.recover(data, {});
      expect(result).toEqual(data);
    });
  });
});

describe('getContextEngineering singleton', () => {
  it('should return the same instance', () => {
    const instance1 = getContextEngineering();
    const instance2 = getContextEngineering();
    expect(instance1).toBe(instance2);
  });
});
