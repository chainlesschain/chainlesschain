/**
 * RAG IPC 单元测试
 * 测试7个 RAG 相关 IPC 处理器的正确注册
 *
 * @module rag-ipc.test
 * @description
 * 本测试文件验证 RAG IPC 处理器的注册，采用依赖注入模式。
 * 通过创建 mock ipcMain 对象并验证所有 handler 是否被正确注册，
 * 确保所有 7 个 handler 都被正确定义和注册。
 *
 * 测试策略：
 * - 验证 registerRAGIPC 函数的导出
 * - 创建 mock ipcMain 对象来捕获 handler 注册
 * - 验证所有 handler 的类型和回调特性
 * - 测试实际的 handler 调用逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('RAG IPC 处理器注册', () => {
  let handlers;
  let mockIpcMain;
  let mockRagManager;
  let mockLlmManager;
  let registerRAGIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = new Map();

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      getHandler: (channel) => handlers.get(channel),
      invoke: async (channel, ...args) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`No handler for ${channel}`);
        return handler({}, ...args);
      },
    };

    // 创建 mock ragManager
    mockRagManager = {
      retrieve: vi.fn().mockResolvedValue([
        {
          id: 'doc-1',
          content: 'Test content',
          score: 0.95,
        },
      ]),
      enhanceQuery: vi.fn().mockResolvedValue({
        query: 'test query',
        context: 'Enhanced context',
        retrievedDocs: [{ id: 'doc-1', content: 'Test content' }],
      }),
      rebuildIndex: vi.fn().mockResolvedValue({ success: true }),
      getIndexStats: vi.fn().mockReturnValue({
        totalItems: 100,
        cacheStats: { size: 5, maxSize: 10 },
        config: { k: 5 },
      }),
      updateConfig: vi.fn(),
      getRerankConfig: vi.fn().mockReturnValue({
        enabled: true,
        model: 'bge-reranker-base',
      }),
      setRerankingEnabled: vi.fn(),
    };

    // 创建 mock llmManager
    mockLlmManager = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    // 动态导入
    const module = await import('../../../src/main/rag/rag-ipc.js');
    registerRAGIPC = module.registerRAGIPC;

    // 注册 RAG IPC 并注入 mock 对象
    registerRAGIPC({
      ragManager: mockRagManager,
      llmManager: mockLlmManager,
      ipcMain: mockIpcMain,
    });
  });

  // ============================================================
  // 基本功能测试
  // ============================================================

  describe('基本功能测试', () => {
    it('should register all 7 IPC handlers', () => {
      expect(handlers.size).toBe(7);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        'rag:retrieve',
        'rag:enhance-query',
        'rag:rebuild-index',
        'rag:get-stats',
        'rag:update-config',
        'rag:get-rerank-config',
        'rag:set-reranking-enabled',
      ];

      expectedChannels.forEach((channel) => {
        expect(handlers.has(channel)).toBe(true);
        expect(typeof handlers.get(channel)).toBe('function');
      });
    });

    it('should export registerRAGIPC function', () => {
      expect(typeof registerRAGIPC).toBe('function');
    });
  });

  // ============================================================
  // rag:retrieve 处理器测试
  // ============================================================

  describe('rag:retrieve handler', () => {
    it('should have retrieve handler registered', () => {
      expect(handlers.has('rag:retrieve')).toBe(true);
    });

    it('should call ragManager.retrieve with query', async () => {
      const query = 'test query';
      const options = { topK: 5 };

      await mockIpcMain.invoke('rag:retrieve', query, options);

      expect(mockRagManager.retrieve).toHaveBeenCalledWith(query, options);
    });

    it('should return retrieval results', async () => {
      const result = await mockIpcMain.invoke('rag:retrieve', 'test query');

      expect(result).toEqual([
        {
          id: 'doc-1',
          content: 'Test content',
          score: 0.95,
        },
      ]);
    });

    it('should return empty array when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      const result = await mockIpcMainNoMgr.invoke('rag:retrieve', 'query');
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // rag:enhance-query 处理器测试
  // ============================================================

  describe('rag:enhance-query handler', () => {
    it('should have enhance-query handler registered', () => {
      expect(handlers.has('rag:enhance-query')).toBe(true);
    });

    it('should call ragManager.enhanceQuery with query', async () => {
      const query = 'test query';
      const options = { retrieveTopK: 10 };

      await mockIpcMain.invoke('rag:enhance-query', query, options);

      expect(mockRagManager.enhanceQuery).toHaveBeenCalledWith(query, options);
    });

    it('should return enhanced query result', async () => {
      const result = await mockIpcMain.invoke('rag:enhance-query', 'test query');

      expect(result).toEqual({
        query: 'test query',
        context: 'Enhanced context',
        retrievedDocs: [{ id: 'doc-1', content: 'Test content' }],
      });
    });

    it('should return empty result when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      const result = await mockIpcMainNoMgr.invoke('rag:enhance-query', 'query');
      expect(result.query).toBe('query');
      expect(result.context).toBe('');
      expect(result.retrievedDocs).toEqual([]);
    });
  });

  // ============================================================
  // rag:rebuild-index 处理器测试
  // ============================================================

  describe('rag:rebuild-index handler', () => {
    it('should have rebuild-index handler registered', () => {
      expect(handlers.has('rag:rebuild-index')).toBe(true);
    });

    it('should call ragManager.rebuildIndex', async () => {
      await mockIpcMain.invoke('rag:rebuild-index');

      expect(mockRagManager.rebuildIndex).toHaveBeenCalled();
    });

    it('should return success result', async () => {
      const result = await mockIpcMain.invoke('rag:rebuild-index');

      expect(result).toEqual({ success: true });
    });

    it('should throw error when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      await expect(mockIpcMainNoMgr.invoke('rag:rebuild-index')).rejects.toThrow(
        'RAG服务未初始化'
      );
    });
  });

  // ============================================================
  // rag:get-stats 处理器测试
  // ============================================================

  describe('rag:get-stats handler', () => {
    it('should have get-stats handler registered', () => {
      expect(handlers.has('rag:get-stats')).toBe(true);
    });

    it('should call ragManager.getIndexStats', async () => {
      await mockIpcMain.invoke('rag:get-stats');

      expect(mockRagManager.getIndexStats).toHaveBeenCalled();
    });

    it('should return stats result', async () => {
      const result = await mockIpcMain.invoke('rag:get-stats');

      expect(result).toEqual({
        totalItems: 100,
        cacheStats: { size: 5, maxSize: 10 },
        config: { k: 5 },
      });
    });

    it('should return default stats when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      const result = await mockIpcMainNoMgr.invoke('rag:get-stats');
      expect(result).toEqual({
        totalItems: 0,
        cacheStats: { size: 0, maxSize: 0 },
        config: {},
      });
    });
  });

  // ============================================================
  // rag:update-config 处理器测试
  // ============================================================

  describe('rag:update-config handler', () => {
    it('should have update-config handler registered', () => {
      expect(handlers.has('rag:update-config')).toBe(true);
    });

    it('should call ragManager.updateConfig with config', async () => {
      const config = { topK: 10, similarityThreshold: 0.5 };

      await mockIpcMain.invoke('rag:update-config', config);

      expect(mockRagManager.updateConfig).toHaveBeenCalledWith(config);
    });

    it('should return success result', async () => {
      const result = await mockIpcMain.invoke('rag:update-config', {});

      expect(result).toEqual({ success: true });
    });

    it('should throw error when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      await expect(mockIpcMainNoMgr.invoke('rag:update-config', {})).rejects.toThrow(
        'RAG服务未初始化'
      );
    });
  });

  // ============================================================
  // rag:get-rerank-config 处理器测试
  // ============================================================

  describe('rag:get-rerank-config handler', () => {
    it('should have get-rerank-config handler registered', () => {
      expect(handlers.has('rag:get-rerank-config')).toBe(true);
    });

    it('should call ragManager.getRerankConfig', async () => {
      await mockIpcMain.invoke('rag:get-rerank-config');

      expect(mockRagManager.getRerankConfig).toHaveBeenCalled();
    });

    it('should return rerank config result', async () => {
      const result = await mockIpcMain.invoke('rag:get-rerank-config');

      expect(result).toEqual({
        enabled: true,
        model: 'bge-reranker-base',
      });
    });

    it('should return null when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      const result = await mockIpcMainNoMgr.invoke('rag:get-rerank-config');
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // rag:set-reranking-enabled 处理器测试
  // ============================================================

  describe('rag:set-reranking-enabled handler', () => {
    it('should have set-reranking-enabled handler registered', () => {
      expect(handlers.has('rag:set-reranking-enabled')).toBe(true);
    });

    it('should call ragManager.setRerankingEnabled with enabled', async () => {
      await mockIpcMain.invoke('rag:set-reranking-enabled', true);

      expect(mockRagManager.setRerankingEnabled).toHaveBeenCalledWith(true);
    });

    it('should return success result', async () => {
      const result = await mockIpcMain.invoke('rag:set-reranking-enabled', true);

      expect(result).toEqual({ success: true });
    });

    it('should throw error when ragManager is not initialized', async () => {
      const handlersNoMgr = new Map();
      const mockIpcMainNoMgr = {
        handle: (channel, handler) => handlersNoMgr.set(channel, handler),
        invoke: async (channel, ...args) => {
          const handler = handlersNoMgr.get(channel);
          if (!handler) throw new Error(`No handler for ${channel}`);
          return handler({}, ...args);
        },
      };

      registerRAGIPC({
        ragManager: null,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainNoMgr,
      });

      await expect(mockIpcMainNoMgr.invoke('rag:set-reranking-enabled', true)).rejects.toThrow(
        'RAG服务未初始化'
      );
    });
  });

  // ============================================================
  // 综合测试
  // ============================================================

  describe('综合测试', () => {
    it('should handle multiple handler invocations', async () => {
      await mockIpcMain.invoke('rag:retrieve', 'query1');
      await mockIpcMain.invoke('rag:enhance-query', 'query2');
      await mockIpcMain.invoke('rag:get-stats');

      expect(mockRagManager.retrieve).toHaveBeenCalledTimes(1);
      expect(mockRagManager.enhanceQuery).toHaveBeenCalledTimes(1);
      expect(mockRagManager.getIndexStats).toHaveBeenCalledTimes(1);
    });

    it('should handle handler registration with dependency injection', async () => {
      const handlersTest = new Map();
      const mockIpcMainTest = {
        handle: (channel, handler) => handlersTest.set(channel, handler),
      };

      registerRAGIPC({
        ragManager: mockRagManager,
        llmManager: mockLlmManager,
        ipcMain: mockIpcMainTest,
      });

      expect(handlersTest.size).toBe(7);
    });
  });
});
