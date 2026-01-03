/**
 * RAG IPC 单元测试
 * 测试7个 RAG检索增强 API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { createMockRAGManager, captureIPCHandlers } from '../../utils/test-helpers.js';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('RAG IPC', () => {
  let handlers = {};
  let mockRAGManager;
  let registerRAGIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock RAG Manager
    mockRAGManager = {
      ...createMockRAGManager(),

      enhanceQuery: vi.fn(async (query, options = {}) => ({
        success: true,
        enhancedQuery: `Enhanced: ${query}`,
        docs: [
          {
            content: `Relevant doc 1 for ${query}`,
            score: 0.95,
            metadata: { source: 'doc1.md' },
          },
          {
            content: `Relevant doc 2 for ${query}`,
            score: 0.88,
            metadata: { source: 'doc2.md' },
          },
        ],
        retrievedCount: 2,
      })),

      retrieve: vi.fn(async (query, options = {}) => ({
        success: true,
        results: [
          {
            id: 'doc-1',
            content: 'Document 1 content',
            score: 0.92,
            metadata: { title: 'Doc 1' },
          },
        ],
        totalResults: 1,
      })),

      updateConfig: vi.fn(async (config) => ({
        success: true,
        config,
      })),

      getStats: vi.fn(async () => ({
        success: true,
        stats: {
          totalDocuments: 1000,
          totalChunks: 5000,
          collectionsCount: 3,
          avgRetrievalTime: 150,
        },
      })),

      rebuildIndex: vi.fn(async (options = {}) => ({
        success: true,
        rebuiltDocuments: 1000,
        duration: 5000,
      })),

      setReranking: vi.fn(async (enabled) => ({
        success: true,
        rerankingEnabled: enabled,
      })),

      getRerankConfig: vi.fn(() => ({
        enabled: true,
        provider: 'cohere',
        topK: 5,
      })),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../desktop-app-vue/src/main/rag/rag-ipc.js');
    registerRAGIPC = module.registerRAGIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 RAG IPC
    registerRAGIPC({ ragManager: mockRAGManager });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('查询增强', () => {
    it('should enhance query with RAG', async () => {
      const result = await handlers['rag:enhance-query'](null, 'What is machine learning?');

      expect(result.success).toBe(true);
      expect(result.enhancedQuery).toContain('Enhanced');
      expect(result.docs).toHaveLength(2);
      expect(result.docs[0].score).toBeGreaterThan(0.8);
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledWith(
        'What is machine learning?',
        {}
      );
    });

    it('should enhance query with options', async () => {
      const options = {
        topK: 5,
        threshold: 0.7,
        includeMetadata: true,
      };

      const result = await handlers['rag:enhance-query'](null, 'Test query', options);

      expect(result.success).toBe(true);
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledWith('Test query', options);
    });

    it('should handle enhance query with no results', async () => {
      mockRAGManager.enhanceQuery.mockResolvedValue({
        success: true,
        enhancedQuery: 'Enhanced: Test',
        docs: [],
        retrievedCount: 0,
      });

      const result = await handlers['rag:enhance-query'](null, 'Obscure query');

      expect(result.success).toBe(true);
      expect(result.docs).toHaveLength(0);
      expect(result.retrievedCount).toBe(0);
    });
  });

  describe('检索功能', () => {
    it('should retrieve relevant documents', async () => {
      const result = await handlers['rag:retrieve'](null, {
        query: 'Test query',
        topK: 3,
      });

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
      expect(result.totalResults).toBeGreaterThanOrEqual(0);
      expect(mockRAGManager.retrieve).toHaveBeenCalledWith('Test query', { topK: 3 });
    });

    it('should retrieve with filters', async () => {
      const filters = {
        project: 'project-1',
        tags: ['important'],
      };

      const result = await handlers['rag:retrieve'](null, {
        query: 'Filtered query',
        filters,
      });

      expect(result.success).toBe(true);
      expect(mockRAGManager.retrieve).toHaveBeenCalledWith('Filtered query', {
        filters,
      });
    });

    it('should retrieve with score threshold', async () => {
      mockRAGManager.retrieve.mockResolvedValue({
        success: true,
        results: [
          { id: 'doc-1', content: 'High relevance', score: 0.95 },
        ],
        totalResults: 1,
      });

      const result = await handlers['rag:retrieve'](null, {
        query: 'High threshold query',
        scoreThreshold: 0.9,
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].score).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('配置管理', () => {
    it('should update RAG config', async () => {
      const newConfig = {
        chunkSize: 512,
        chunkOverlap: 50,
        embeddingModel: 'text-embedding-3-small',
      };

      const result = await handlers['rag:update-config'](null, newConfig);

      expect(result.success).toBe(true);
      expect(result.config).toEqual(newConfig);
      expect(mockRAGManager.updateConfig).toHaveBeenCalledWith(newConfig);
    });

    it('should handle partial config update', async () => {
      const partialConfig = {
        chunkSize: 256,
      };

      const result = await handlers['rag:update-config'](null, partialConfig);

      expect(result.success).toBe(true);
      expect(mockRAGManager.updateConfig).toHaveBeenCalledWith(partialConfig);
    });

    it('should get rerank config', async () => {
      const result = await handlers['rag:get-rerank-config']();

      expect(result.enabled).toBe(true);
      expect(result.provider).toBe('cohere');
      expect(result.topK).toBe(5);
      expect(mockRAGManager.getRerankConfig).toHaveBeenCalled();
    });

    it('should set reranking enabled', async () => {
      const result = await handlers['rag:set-reranking-enabled'](null, true);

      expect(result.success).toBe(true);
      expect(result.rerankingEnabled).toBe(true);
      expect(mockRAGManager.setReranking).toHaveBeenCalledWith(true);
    });

    it('should disable reranking', async () => {
      const result = await handlers['rag:set-reranking-enabled'](null, false);

      expect(result.success).toBe(true);
      expect(result.rerankingEnabled).toBe(false);
      expect(mockRAGManager.setReranking).toHaveBeenCalledWith(false);
    });
  });

  describe('统计与维护', () => {
    it('should get RAG statistics', async () => {
      const result = await handlers['rag:get-stats']();

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.totalDocuments).toBe(1000);
      expect(result.stats.totalChunks).toBe(5000);
      expect(result.stats.collectionsCount).toBe(3);
      expect(result.stats.avgRetrievalTime).toBeGreaterThan(0);
      expect(mockRAGManager.getStats).toHaveBeenCalled();
    });

    it('should rebuild index', async () => {
      const result = await handlers['rag:rebuild-index'](null, {
        collection: 'default',
      });

      expect(result.success).toBe(true);
      expect(result.rebuiltDocuments).toBe(1000);
      expect(result.duration).toBeGreaterThan(0);
      expect(mockRAGManager.rebuildIndex).toHaveBeenCalledWith({
        collection: 'default',
      });
    });

    it('should rebuild index for all collections', async () => {
      mockRAGManager.rebuildIndex.mockResolvedValue({
        success: true,
        rebuiltDocuments: 5000,
        duration: 15000,
      });

      const result = await handlers['rag:rebuild-index'](null, { all: true });

      expect(result.success).toBe(true);
      expect(result.rebuiltDocuments).toBe(5000);
      expect(mockRAGManager.rebuildIndex).toHaveBeenCalledWith({ all: true });
    });
  });

  describe('错误处理', () => {
    it('should handle enhance query error', async () => {
      mockRAGManager.enhanceQuery.mockRejectedValue(new Error('RAG service unavailable'));

      await expect(
        handlers['rag:enhance-query'](null, 'Test query')
      ).rejects.toThrow('RAG service unavailable');
    });

    it('should handle retrieve error', async () => {
      mockRAGManager.retrieve.mockRejectedValue(new Error('Vector database error'));

      await expect(
        handlers['rag:retrieve'](null, { query: 'Test' })
      ).rejects.toThrow('Vector database error');
    });

    it('should handle update config error', async () => {
      mockRAGManager.updateConfig.mockRejectedValue(new Error('Invalid config'));

      await expect(
        handlers['rag:update-config'](null, { invalid: 'config' })
      ).rejects.toThrow('Invalid config');
    });

    it('should handle rebuild index error', async () => {
      mockRAGManager.rebuildIndex.mockRejectedValue(new Error('Index rebuild failed'));

      await expect(
        handlers['rag:rebuild-index'](null, {})
      ).rejects.toThrow('Index rebuild failed');
    });

    it('should handle get stats error', async () => {
      mockRAGManager.getStats.mockRejectedValue(new Error('Stats collection failed'));

      await expect(
        handlers['rag:get-stats']()
      ).rejects.toThrow('Stats collection failed');
    });
  });

  describe('边界情况', () => {
    it('should handle empty query string', async () => {
      const result = await handlers['rag:enhance-query'](null, '');

      expect(result.success).toBe(true);
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledWith('', {});
    });

    it('should handle very long query', async () => {
      const longQuery = 'a'.repeat(10000);

      const result = await handlers['rag:enhance-query'](null, longQuery);

      expect(result.success).toBe(true);
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledWith(longQuery, {});
    });

    it('should handle retrieve with no query', async () => {
      await expect(
        handlers['rag:retrieve'](null, {})
      ).rejects.toThrow();
    });

    it('should handle rebuild with null options', async () => {
      const result = await handlers['rag:rebuild-index'](null, null);

      expect(result.success).toBe(true);
      expect(mockRAGManager.rebuildIndex).toHaveBeenCalled();
    });

    it('should handle topK=0', async () => {
      mockRAGManager.retrieve.mockResolvedValue({
        success: true,
        results: [],
        totalResults: 0,
      });

      const result = await handlers['rag:retrieve'](null, {
        query: 'Test',
        topK: 0,
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it('should handle negative topK', async () => {
      await expect(
        handlers['rag:retrieve'](null, {
          query: 'Test',
          topK: -1,
        })
      ).rejects.toThrow();
    });
  });

  describe('性能测试', () => {
    it('should handle concurrent queries', async () => {
      const queries = Array.from({ length: 10 }, (_, i) => `Query ${i}`);

      const promises = queries.map(query =>
        handlers['rag:enhance-query'](null, query)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.enhancedQuery).toContain(`Query ${i}`);
      });
      expect(mockRAGManager.enhanceQuery).toHaveBeenCalledTimes(10);
    });

    it('should retrieve large result set', async () => {
      const largeResults = Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        content: `Document ${i} content`,
        score: 0.9 - (i * 0.001),
        metadata: {},
      }));

      mockRAGManager.retrieve.mockResolvedValue({
        success: true,
        results: largeResults,
        totalResults: 100,
      });

      const result = await handlers['rag:retrieve'](null, {
        query: 'Test',
        topK: 100,
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(100);
      expect(result.totalResults).toBe(100);
    });
  });
});
