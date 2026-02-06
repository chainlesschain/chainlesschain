/**
 * Hybrid Search Engine 模块测试
 *
 * 测试内容：
 * - HybridSearchEngine 类的混合搜索
 * - RRF 融合算法
 * - 文档管理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { HybridSearchEngine } = require('../hybrid-search-engine');

describe('HybridSearchEngine', () => {
  let hybridEngine;
  let mockRagManager;

  beforeEach(() => {
    mockRagManager = {
      search: vi.fn().mockResolvedValue([]),
    };

    hybridEngine = new HybridSearchEngine({
      ragManager: mockRagManager,
      vectorWeight: 0.6,
      textWeight: 0.4,
      rrfK: 60,
    });
  });

  afterEach(() => {
    hybridEngine.clear();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should require ragManager', () => {
      expect(() => new HybridSearchEngine()).toThrow('ragManager 参数是必需的');
    });

    it('should initialize with default options', () => {
      const engine = new HybridSearchEngine({ ragManager: mockRagManager });
      expect(engine.vectorWeight).toBe(0.6);
      expect(engine.textWeight).toBe(0.4);
      expect(engine.rrfK).toBe(60);
    });

    it('should initialize with custom options', () => {
      const engine = new HybridSearchEngine({
        ragManager: mockRagManager,
        vectorWeight: 0.7,
        textWeight: 0.3,
        rrfK: 100,
      });
      expect(engine.vectorWeight).toBe(0.7);
      expect(engine.textWeight).toBe(0.3);
      expect(engine.rrfK).toBe(100);
    });

    it('should create BM25Search instance', () => {
      expect(hybridEngine.bm25Search).toBeDefined();
    });
  });

  describe('indexDocuments', () => {
    it('should index documents', async () => {
      const documents = [
        { id: 'doc1', content: '人工智能技术' },
        { id: 'doc2', content: '机器学习算法' },
      ];

      await hybridEngine.indexDocuments(documents);

      expect(hybridEngine.documents).toHaveLength(2);
    });

    it('should cache documents', async () => {
      const documents = [{ id: 'doc1', content: 'Test content' }];

      await hybridEngine.indexDocuments(documents);

      expect(hybridEngine.documents).toEqual(documents);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await hybridEngine.indexDocuments([
        { id: 'doc1', content: '人工智能是未来的发展方向' },
        { id: 'doc2', content: '机器学习算法可以预测趋势' },
        { id: 'doc3', content: '深度学习神经网络' },
      ]);
    });

    it('should perform hybrid search', async () => {
      mockRagManager.search.mockResolvedValue([
        { id: 'doc1', content: '人工智能', score: 0.9 },
      ]);

      const results = await hybridEngine.search('人工智能');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      mockRagManager.search.mockResolvedValue([]);

      const results = await hybridEngine.search('学习', { limit: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should filter by threshold', async () => {
      mockRagManager.search.mockResolvedValue([]);

      const results = await hybridEngine.search('人工智能', { threshold: 0.5 });

      results.forEach((r) => {
        expect(r.score).toBeGreaterThan(0.5);
      });
    });

    it('should disable vector search when enableVector is false', async () => {
      await hybridEngine.search('测试', { enableVector: false });

      expect(mockRagManager.search).not.toHaveBeenCalled();
    });

    it('should disable BM25 search when enableBM25 is false', async () => {
      mockRagManager.search.mockResolvedValue([
        { id: 'doc1', content: 'Test', score: 0.8 },
      ]);

      const results = await hybridEngine.search('人工智能', { enableBM25: false });

      // Results should only come from vector search
      expect(mockRagManager.search).toHaveBeenCalled();
    });

    it('should handle vector search errors gracefully', async () => {
      mockRagManager.search.mockRejectedValue(new Error('Network error'));

      // Should not throw, fallback to BM25 only
      const results = await hybridEngine.search('测试');

      expect(results).toBeDefined();
    });
  });

  describe('vectorSearch', () => {
    it('should call ragManager.search', async () => {
      mockRagManager.search.mockResolvedValue([
        { id: 'doc1', content: 'Test', score: 0.9 },
      ]);

      const results = await hybridEngine.vectorSearch('test', 10);

      expect(mockRagManager.search).toHaveBeenCalledWith({
        query: 'test',
        limit: 10,
        threshold: 0.5,
      });
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('vector');
    });

    it('should transform results to unified format', async () => {
      mockRagManager.search.mockResolvedValue([
        { noteId: 'note1', content: 'Content', similarity: 0.85, metadata: { type: 'note' } },
      ]);

      const results = await hybridEngine.vectorSearch('query', 5);

      expect(results[0].document.id).toBe('note1');
      expect(results[0].score).toBe(0.85);
    });

    it('should return empty array on error', async () => {
      mockRagManager.search.mockRejectedValue(new Error('Error'));

      const results = await hybridEngine.vectorSearch('query', 5);

      expect(results).toEqual([]);
    });
  });

  describe('fusionRank', () => {
    it('should merge results using RRF algorithm', () => {
      const vectorResults = [
        { document: { id: 'doc1' }, score: 0.9 },
        { document: { id: 'doc2' }, score: 0.7 },
      ];

      const bm25Results = [
        { document: { id: 'doc2' }, score: 3.5 },
        { document: { id: 'doc3' }, score: 2.0 },
      ];

      const fused = hybridEngine.fusionRank(vectorResults, bm25Results, {
        k: 60,
        vectorWeight: 0.6,
        textWeight: 0.4,
      });

      // doc2 appears in both, should have higher score
      expect(fused.find((r) => r.document.id === 'doc2').score).toBeGreaterThan(
        fused.find((r) => r.document.id === 'doc1').score,
      );
    });

    it('should include documents from both sources', () => {
      const vectorResults = [{ document: { id: 'doc1' }, score: 0.9 }];
      const bm25Results = [{ document: { id: 'doc2' }, score: 3.0 }];

      const fused = hybridEngine.fusionRank(vectorResults, bm25Results, {
        k: 60,
        vectorWeight: 0.6,
        textWeight: 0.4,
      });

      expect(fused).toHaveLength(2);
      expect(fused.map((r) => r.document.id)).toContain('doc1');
      expect(fused.map((r) => r.document.id)).toContain('doc2');
    });

    it('should sort by score descending', () => {
      const vectorResults = [
        { document: { id: 'doc1' }, score: 0.9 },
        { document: { id: 'doc2' }, score: 0.5 },
      ];

      const fused = hybridEngine.fusionRank(vectorResults, [], {
        k: 60,
        vectorWeight: 0.6,
        textWeight: 0.4,
      });

      expect(fused[0].score).toBeGreaterThanOrEqual(fused[1].score);
    });

    it('should set source as hybrid', () => {
      const vectorResults = [{ document: { id: 'doc1' }, score: 0.9 }];

      const fused = hybridEngine.fusionRank(vectorResults, [], {
        k: 60,
        vectorWeight: 0.6,
        textWeight: 0.4,
      });

      expect(fused[0].source).toBe('hybrid');
    });

    it('should handle empty inputs', () => {
      const fused = hybridEngine.fusionRank([], [], {
        k: 60,
        vectorWeight: 0.6,
        textWeight: 0.4,
      });

      expect(fused).toEqual([]);
    });
  });

  describe('addDocument', () => {
    it('should add document to cache and BM25 index', () => {
      const doc = { id: 'doc1', content: 'New document' };

      hybridEngine.addDocument(doc);

      expect(hybridEngine.documents).toContainEqual(doc);
    });
  });

  describe('removeDocument', () => {
    it('should remove document from cache', async () => {
      await hybridEngine.indexDocuments([
        { id: 'doc1', content: 'Test 1' },
        { id: 'doc2', content: 'Test 2' },
      ]);

      hybridEngine.removeDocument('doc1');

      expect(hybridEngine.documents.find((d) => d.id === 'doc1')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      await hybridEngine.indexDocuments([
        { id: 'doc1', content: 'Test' },
      ]);

      hybridEngine.clear();

      expect(hybridEngine.documents).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      await hybridEngine.indexDocuments([
        { id: 'doc1', content: 'Test document' },
      ]);

      const stats = hybridEngine.getStats();

      expect(stats.documentCount).toBe(1);
      expect(stats.vectorWeight).toBe(0.6);
      expect(stats.textWeight).toBe(0.4);
      expect(stats.rrfK).toBe(60);
      expect(stats.bm25Stats).toBeDefined();
    });
  });

  describe('updateWeights', () => {
    it('should update weights', () => {
      hybridEngine.updateWeights(0.8, 0.2);

      expect(hybridEngine.vectorWeight).toBe(0.8);
      expect(hybridEngine.textWeight).toBe(0.2);
    });
  });
});
