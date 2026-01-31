/**
 * 命令路由器单元测试
 *
 * 测试命令路由、处理器注册、错误处理等功能
 */

const { describe, it, expect, beforeEach, vi } = require('vitest');
const CommandRouter = require('../../src/main/remote/command-router');

describe('CommandRouter', () => {
  let router;
  let mockAIHandler;
  let mockSystemHandler;

  beforeEach(() => {
    router = new CommandRouter();

    // Mock AI handler
    mockAIHandler = {
      chat: vi.fn(async (params) => ({
        conversationId: 'conv-123',
        response: 'Hello from AI',
        model: 'qwen2:7b'
      })),
      getConversations: vi.fn(async () => ({
        conversations: []
      })),
      ragSearch: vi.fn(async (params) => ({
        results: []
      }))
    };

    // Mock System handler
    mockSystemHandler = {
      getStatus: vi.fn(async () => ({
        status: 'online',
        uptime: 12345
      })),
      getInfo: vi.fn(async () => ({
        platform: 'win32',
        version: '1.0.0'
      })),
      screenshot: vi.fn(async () => ({
        data: 'base64-image-data'
      })),
      notify: vi.fn(async (params) => ({
        success: true
      }))
    };

    // Register handlers
    router.registerHandler('ai', mockAIHandler);
    router.registerHandler('system', mockSystemHandler);
  });

  describe('handler registration', () => {
    it('should register handler for namespace', () => {
      const customHandler = {
        test: vi.fn()
      };

      router.registerHandler('custom', customHandler);
      const handler = router.getHandler('custom');
      expect(handler).toBe(customHandler);
    });

    it('should throw error for duplicate namespace', () => {
      const duplicateHandler = { test: vi.fn() };

      expect(() => {
        router.registerHandler('ai', duplicateHandler);
      }).toThrow('Handler already registered for namespace: ai');
    });

    it('should unregister handler', () => {
      router.unregisterHandler('ai');
      const handler = router.getHandler('ai');
      expect(handler).toBeUndefined();
    });
  });

  describe('command routing', () => {
    it('should route ai.chat to AI handler', async () => {
      const request = {
        id: 'req-1',
        method: 'ai.chat',
        params: {
          message: 'Hello',
          conversationId: 'conv-123'
        }
      };

      const result = await router.route(request);

      expect(mockAIHandler.chat).toHaveBeenCalledWith(request.params);
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        result: {
          conversationId: 'conv-123',
          response: 'Hello from AI',
          model: 'qwen2:7b'
        }
      });
    });

    it('should route system.getStatus to System handler', async () => {
      const request = {
        id: 'req-2',
        method: 'system.getStatus',
        params: {}
      };

      const result = await router.route(request);

      expect(mockSystemHandler.getStatus).toHaveBeenCalled();
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req-2',
        result: {
          status: 'online',
          uptime: 12345
        }
      });
    });

    it('should route ai.getConversations to AI handler', async () => {
      const request = {
        id: 'req-3',
        method: 'ai.getConversations',
        params: { limit: 10 }
      };

      const result = await router.route(request);

      expect(mockAIHandler.getConversations).toHaveBeenCalledWith({ limit: 10 });
      expect(result.result.conversations).toBeDefined();
    });

    it('should route system.screenshot to System handler', async () => {
      const request = {
        id: 'req-4',
        method: 'system.screenshot',
        params: { quality: 80 }
      };

      const result = await router.route(request);

      expect(mockSystemHandler.screenshot).toHaveBeenCalledWith({ quality: 80 });
      expect(result.result.data).toBe('base64-image-data');
    });
  });

  describe('error handling', () => {
    it('should return error for unknown namespace', async () => {
      const request = {
        id: 'req-err-1',
        method: 'unknown.command',
        params: {}
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toContain('Method not found');
    });

    it('should return error for unknown method in valid namespace', async () => {
      const request = {
        id: 'req-err-2',
        method: 'ai.unknownMethod',
        params: {}
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toContain('Method not found');
    });

    it('should return error for invalid method format', async () => {
      const request = {
        id: 'req-err-3',
        method: 'invalidformat',
        params: {}
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32600);
      expect(result.error.message).toContain('Invalid method format');
    });

    it('should handle handler exceptions', async () => {
      mockAIHandler.chat.mockRejectedValue(new Error('Handler crashed'));

      const request = {
        id: 'req-err-4',
        method: 'ai.chat',
        params: { message: 'Test' }
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32603);
      expect(result.error.message).toContain('Handler crashed');
    });

    it('should include error data for detailed errors', async () => {
      const detailedError = new Error('Detailed error');
      detailedError.code = 'CUSTOM_ERROR';
      detailedError.details = { reason: 'Invalid input' };

      mockSystemHandler.notify.mockRejectedValue(detailedError);

      const request = {
        id: 'req-err-5',
        method: 'system.notify',
        params: { message: 'Test' }
      };

      const result = await router.route(request);

      expect(result.error.code).toBe(-32603);
      expect(result.error.data).toEqual({
        errorCode: 'CUSTOM_ERROR',
        details: { reason: 'Invalid input' }
      });
    });
  });

  describe('method validation', () => {
    it('should validate method format (namespace.method)', () => {
      const validMethods = [
        'ai.chat',
        'system.getStatus',
        'custom.action'
      ];

      for (const method of validMethods) {
        const isValid = router.isValidMethodFormat(method);
        expect(isValid).toBe(true);
      }
    });

    it('should reject invalid method formats', () => {
      const invalidMethods = [
        'nonamespace',
        '.nonamespace',
        'namespace.',
        'too.many.dots',
        ''
      ];

      for (const method of invalidMethods) {
        const isValid = router.isValidMethodFormat(method);
        expect(isValid).toBe(false);
      }
    });
  });

  describe('batch routing', () => {
    it('should route multiple commands in batch', async () => {
      const requests = [
        {
          id: 'batch-1',
          method: 'ai.chat',
          params: { message: 'Hello' }
        },
        {
          id: 'batch-2',
          method: 'system.getStatus',
          params: {}
        },
        {
          id: 'batch-3',
          method: 'ai.getConversations',
          params: { limit: 5 }
        }
      ];

      const results = await router.routeBatch(requests);

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('batch-1');
      expect(results[1].id).toBe('batch-2');
      expect(results[2].id).toBe('batch-3');
      expect(mockAIHandler.chat).toHaveBeenCalled();
      expect(mockSystemHandler.getStatus).toHaveBeenCalled();
      expect(mockAIHandler.getConversations).toHaveBeenCalled();
    });

    it('should handle mixed success and failure in batch', async () => {
      mockAIHandler.chat.mockRejectedValue(new Error('Chat failed'));

      const requests = [
        {
          id: 'batch-mix-1',
          method: 'ai.chat',
          params: { message: 'Hello' }
        },
        {
          id: 'batch-mix-2',
          method: 'system.getStatus',
          params: {}
        }
      ];

      const results = await router.routeBatch(requests);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBeDefined(); // Failed
      expect(results[1].result).toBeDefined(); // Success
    });
  });

  describe('handler middleware', () => {
    it('should apply pre-handler middleware', async () => {
      const preMiddleware = vi.fn(async (request, next) => {
        request.params.middlewareApplied = true;
        return next(request);
      });

      router.use('pre', preMiddleware);

      const request = {
        id: 'mid-1',
        method: 'ai.chat',
        params: { message: 'Test' }
      };

      await router.route(request);

      expect(preMiddleware).toHaveBeenCalled();
      expect(mockAIHandler.chat).toHaveBeenCalledWith(
        expect.objectContaining({ middlewareApplied: true })
      );
    });

    it('should apply post-handler middleware', async () => {
      const postMiddleware = vi.fn(async (response, next) => {
        response.result.postProcessed = true;
        return next(response);
      });

      router.use('post', postMiddleware);

      const request = {
        id: 'mid-2',
        method: 'system.getInfo',
        params: {}
      };

      const result = await router.route(request);

      expect(postMiddleware).toHaveBeenCalled();
      expect(result.result.postProcessed).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track command statistics', async () => {
      await router.route({ id: '1', method: 'ai.chat', params: {} });
      await router.route({ id: '2', method: 'system.getStatus', params: {} });
      await router.route({ id: '3', method: 'ai.chat', params: {} });

      const stats = router.getStats();

      expect(stats.totalCommands).toBe(3);
      expect(stats.commandCounts['ai.chat']).toBe(2);
      expect(stats.commandCounts['system.getStatus']).toBe(1);
    });

    it('should track error statistics', async () => {
      mockAIHandler.chat.mockRejectedValue(new Error('Failed'));

      await router.route({ id: '1', method: 'ai.chat', params: {} });
      await router.route({ id: '2', method: 'unknown.method', params: {} });

      const stats = router.getStats();

      expect(stats.totalErrors).toBe(2);
    });

    it('should reset statistics', async () => {
      await router.route({ id: '1', method: 'ai.chat', params: {} });
      router.resetStats();

      const stats = router.getStats();

      expect(stats.totalCommands).toBe(0);
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe('namespace management', () => {
    it('should list all registered namespaces', () => {
      const namespaces = router.getNamespaces();

      expect(namespaces).toContain('ai');
      expect(namespaces).toContain('system');
      expect(namespaces).toHaveLength(2);
    });

    it('should check if namespace exists', () => {
      expect(router.hasNamespace('ai')).toBe(true);
      expect(router.hasNamespace('system')).toBe(true);
      expect(router.hasNamespace('unknown')).toBe(false);
    });

    it('should get methods for namespace', () => {
      const aiMethods = router.getMethodsForNamespace('ai');

      expect(aiMethods).toContain('chat');
      expect(aiMethods).toContain('getConversations');
      expect(aiMethods).toContain('ragSearch');
    });
  });
});
