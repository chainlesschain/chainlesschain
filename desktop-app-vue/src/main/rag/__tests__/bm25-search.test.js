/**
 * BM25 Search 模块测试
 *
 * 测试内容：
 * - BM25Search 类的分词和索引
 * - BM25 分数计算
 * - 搜索功能
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

const { BM25Search } = require('../bm25-search');

describe('BM25Search', () => {
  let bm25;

  beforeEach(() => {
    bm25 = new BM25Search({
      k1: 1.5,
      b: 0.75,
      language: 'zh',
    });
  });

  afterEach(() => {
    bm25.clear();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const search = new BM25Search();
      expect(search.k1).toBe(1.5);
      expect(search.b).toBe(0.75);
      expect(search.language).toBe('zh');
    });

    it('should initialize with custom options', () => {
      const search = new BM25Search({
        k1: 2.0,
        b: 0.5,
        language: 'en',
      });
      expect(search.k1).toBe(2.0);
      expect(search.b).toBe(0.5);
      expect(search.language).toBe('en');
    });

    it('should create Chinese tokenizer for zh language', () => {
      const search = new BM25Search({ language: 'zh' });
      const tokens = search.tokenizer('你好世界');
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should create English tokenizer for en language', () => {
      const search = new BM25Search({ language: 'en' });
      const tokens = search.tokenizer('Hello World');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });
  });

  describe('indexDocuments', () => {
    it('should index documents', () => {
      const documents = [
        { id: 'doc1', content: '这是第一个测试文档' },
        { id: 'doc2', content: '这是第二个测试文档' },
      ];

      bm25.indexDocuments(documents);

      expect(bm25.documents).toHaveLength(2);
      expect(bm25.docLengths).toHaveLength(2);
      expect(bm25.avgDocLength).toBeGreaterThan(0);
    });

    it('should calculate average document length', () => {
      const documents = [
        { id: 'doc1', content: '短文档' },
        { id: 'doc2', content: '这是一个比较长的文档，包含更多的词语' },
      ];

      bm25.indexDocuments(documents);

      expect(bm25.avgDocLength).toBeGreaterThan(0);
      expect(bm25.docLengths[0]).toBeLessThan(bm25.docLengths[1]);
    });

    it('should store document metadata', () => {
      const documents = [
        { id: 'doc1', content: 'Test', metadata: { category: 'test' } },
      ];

      bm25.indexDocuments(documents);

      const meta = bm25.docMetadata.get('doc1');
      expect(meta).toBeDefined();
      expect(meta.metadata.category).toBe('test');
    });

    it('should clear previous index when re-indexing', () => {
      bm25.indexDocuments([{ id: 'doc1', content: 'First' }]);
      bm25.indexDocuments([{ id: 'doc2', content: 'Second' }]);

      expect(bm25.documents).toHaveLength(1);
      expect(bm25.documents[0].id).toBe('doc2');
    });
  });

  describe('search', () => {
    beforeEach(() => {
      bm25.indexDocuments([
        { id: 'doc1', content: '人工智能是计算机科学的一个分支' },
        { id: 'doc2', content: '机器学习是人工智能的重要组成部分' },
        { id: 'doc3', content: '深度学习是机器学习的一种方法' },
        { id: 'doc4', content: '自然语言处理用于文本分析' },
      ]);
    });

    it('should return empty array for empty index', () => {
      const emptySearch = new BM25Search();
      const results = emptySearch.search('测试');
      expect(results).toEqual([]);
    });

    it('should return matching documents', () => {
      const results = bm25.search('人工智能');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('bm25');
    });

    it('should rank documents by relevance', () => {
      const results = bm25.search('机器学习');

      // doc2 and doc3 should have higher scores
      const ids = results.map((r) => r.document.id);
      expect(ids).toContain('doc2');
      expect(ids).toContain('doc3');
    });

    it('should respect limit parameter', () => {
      const results = bm25.search('学习', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should filter by threshold', () => {
      const results = bm25.search('人工智能', { threshold: 1.0 });

      results.forEach((r) => {
        expect(r.score).toBeGreaterThan(1.0);
      });
    });

    it('should return empty for empty query', () => {
      const results = bm25.search('');
      expect(results).toEqual([]);
    });

    it('should include document and score in results', () => {
      const results = bm25.search('人工智能');

      expect(results[0]).toHaveProperty('document');
      expect(results[0]).toHaveProperty('score');
      expect(results[0].document).toHaveProperty('id');
      expect(results[0].document).toHaveProperty('content');
    });
  });

  describe('calculateBM25Score', () => {
    beforeEach(() => {
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana cherry' },
        { id: 'doc2', content: 'apple apple apple' },
      ]);
    });

    it('should calculate positive score for matching terms', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana cherry' },
        { id: 'doc2', content: 'apple apple apple' },
      ]);

      const score = bm25.calculateBM25Score(['apple'], 0);
      expect(score).toBeGreaterThan(0);
    });

    it('should give higher score for more frequent terms', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana cherry' },
        { id: 'doc2', content: 'apple apple apple' },
      ]);

      const score1 = bm25.calculateBM25Score(['apple'], 0);
      const score2 = bm25.calculateBM25Score(['apple'], 1);

      expect(score2).toBeGreaterThan(score1);
    });

    it('should return zero for non-matching terms', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana cherry' },
      ]);

      const score = bm25.calculateBM25Score(['xyz'], 0);
      expect(score).toBe(0);
    });
  });

  describe('getTermFrequency', () => {
    it('should count term occurrences', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple apple banana' },
      ]);

      const tf = bm25.getTermFrequency('apple', 0);
      expect(tf).toBe(2);
    });

    it('should return zero for missing terms', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana' },
      ]);

      const tf = bm25.getTermFrequency('cherry', 0);
      expect(tf).toBe(0);
    });
  });

  describe('getDocumentFrequency', () => {
    it('should count documents containing term', () => {
      bm25 = new BM25Search({ language: 'en' });
      bm25.indexDocuments([
        { id: 'doc1', content: 'apple banana' },
        { id: 'doc2', content: 'apple cherry' },
        { id: 'doc3', content: 'banana cherry' },
      ]);

      const df = bm25.getDocumentFrequency('apple');
      expect(df).toBe(2);
    });
  });

  describe('addDocument', () => {
    it('should add document to index', () => {
      bm25.indexDocuments([{ id: 'doc1', content: 'First document' }]);
      bm25.addDocument({ id: 'doc2', content: 'Second document' });

      expect(bm25.documents).toHaveLength(2);
      expect(bm25.docMetadata.has('doc2')).toBe(true);
    });

    it('should update average document length', () => {
      bm25.indexDocuments([{ id: 'doc1', content: '短' }]);
      const avgBefore = bm25.avgDocLength;

      bm25.addDocument({ id: 'doc2', content: '这是一个很长的文档包含很多字符' });
      const avgAfter = bm25.avgDocLength;

      expect(avgAfter).toBeGreaterThan(avgBefore);
    });
  });

  describe('removeDocument', () => {
    it('should remove document from index', () => {
      bm25.indexDocuments([
        { id: 'doc1', content: 'First' },
        { id: 'doc2', content: 'Second' },
      ]);

      bm25.removeDocument('doc1');

      expect(bm25.documents).toHaveLength(1);
      expect(bm25.docMetadata.has('doc1')).toBe(false);
    });

    it('should handle removal of non-existent document', () => {
      bm25.indexDocuments([{ id: 'doc1', content: 'First' }]);

      // Should not throw
      expect(() => bm25.removeDocument('non-existent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all indexed data', () => {
      bm25.indexDocuments([
        { id: 'doc1', content: 'Test' },
        { id: 'doc2', content: 'Test' },
      ]);

      bm25.clear();

      expect(bm25.documents).toHaveLength(0);
      expect(bm25.docLengths).toHaveLength(0);
      expect(bm25.docMetadata.size).toBe(0);
      expect(bm25.avgDocLength).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      bm25.indexDocuments([
        { id: 'doc1', content: '第一个文档' },
        { id: 'doc2', content: '第二个文档' },
      ]);

      const stats = bm25.getStats();

      expect(stats.documentCount).toBe(2);
      expect(stats.avgDocLength).toBeGreaterThan(0);
      expect(stats.k1).toBe(1.5);
      expect(stats.b).toBe(0.75);
      expect(stats.language).toBe('zh');
    });
  });
});
