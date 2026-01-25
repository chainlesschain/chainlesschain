/**
 * 重排序器单元测试
 * 测试目标: src/main/rag/reranker.js
 * 覆盖场景: LLM重排序、CrossEncoder、混合重排序、关键词匹配
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger)
}));

// Mock fetch for CrossEncoder API
global.fetch = vi.fn();

describe('Reranker', () => {
  let Reranker;
  let reranker;
  let mockLLMManager;
  let sampleDocuments;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock LLM Manager
    mockLLMManager = {
      query: vi.fn(async () => '0.9, 0.7, 0.5, 0.3, 0.2')
    };

    // Sample documents
    sampleDocuments = [
      { id: '1', title: 'Doc 1', content: 'AI machine learning', score: 0.8 },
      { id: '2', title: 'Doc 2', content: 'Data science', score: 0.7 },
      { id: '3', title: 'Doc 3', content: 'Programming', score: 0.6 }
    ];

    const module = await import('../../../src/main/rag/reranker.js');
    Reranker = module.default;
  });

  afterEach(() => {
    if (reranker) {
      reranker = null;
    }
    global.fetch.mockReset();
  });

  describe('构造函数', () => {
    it('应该创建实例并存储llmManager', () => {
      reranker = new Reranker(mockLLMManager);
      expect(reranker.llmManager).toBe(mockLLMManager);
    });

    it('应该初始化默认配置', () => {
      reranker = new Reranker(mockLLMManager);
      expect(reranker.config.enabled).toBe(true);
      expect(reranker.config.method).toBe('llm');
      expect(reranker.config.topK).toBe(5);
    });

    it('应该继承EventEmitter', () => {
      reranker = new Reranker(mockLLMManager);
      expect(typeof reranker.on).toBe('function');
      expect(typeof reranker.emit).toBe('function');
    });
  });

  describe('rerank', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该在禁用时返回原始文档', async () => {
      reranker.config.enabled = false;
      const result = await reranker.rerank('query', sampleDocuments);
      expect(result).toBe(sampleDocuments);
    });

    it('应该在文档为空时返回空数组', async () => {
      const result = await reranker.rerank('query', []);
      expect(result).toEqual([]);
    });

    it('应该使用LLM方法重排序', async () => {
      const result = await reranker.rerank('query', sampleDocuments);
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('应该应用scoreThreshold过滤', async () => {
      reranker.config.scoreThreshold = 0.6;
      const result = await reranker.rerank('query', sampleDocuments);
      expect(result.every(doc => doc.score >= 0.6)).toBe(true);
    });

    it('应该发出rerank-start事件', async () => {
      const handler = vi.fn();
      reranker.on('rerank-start', handler);
      await reranker.rerank('query', sampleDocuments);
      expect(handler).toHaveBeenCalled();
    });

    it('应该发出rerank-complete事件', async () => {
      const handler = vi.fn();
      reranker.on('rerank-complete', handler);
      await reranker.rerank('query', sampleDocuments);
      expect(handler).toHaveBeenCalled();
    });

    it('应该在错误时返回原始文档前topK个', async () => {
      mockLLMManager.query.mockRejectedValueOnce(new Error('Error'));
      const result = await reranker.rerank('query', sampleDocuments);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('rerankWithLLM', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该调用LLM query方法', async () => {
      await reranker.rerankWithLLM('query', sampleDocuments, 5);
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('应该使用低温度参数', async () => {
      await reranker.rerankWithLLM('query', sampleDocuments, 5);
      const args = mockLLMManager.query.mock.calls[0];
      expect(args[1].temperature).toBe(0.1);
    });

    it('应该在llmManager为null时返回前topK个', async () => {
      reranker.llmManager = null;
      const result = await reranker.rerankWithLLM('query', sampleDocuments, 2);
      expect(result.length).toBe(2);
    });

    it('应该添加rerankScore字段', async () => {
      const result = await reranker.rerankWithLLM('query', sampleDocuments, 5);
      expect(result[0]).toHaveProperty('rerankScore');
    });

    it('应该按rerankScore降序排序', async () => {
      const result = await reranker.rerankWithLLM('query', sampleDocuments, 5);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].rerankScore).toBeGreaterThanOrEqual(result[i + 1].rerankScore);
      }
    });
  });

  describe('parseLLMScores', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该解析逗号分隔的分数', () => {
      const scores = reranker.parseLLMScores('0.9, 0.7, 0.5', 3);
      expect(scores).toEqual([0.9, 0.7, 0.5]);
    });

    it('应该在分数少于expectedCount时补齐', () => {
      const scores = reranker.parseLLMScores('0.9', 3);
      expect(scores.length).toBe(3);
    });

    it('应该在分数多于expectedCount时截断', () => {
      const scores = reranker.parseLLMScores('0.9, 0.8, 0.7', 2);
      expect(scores.length).toBe(2);
    });

    it('应该在无法解析时返回默认值', () => {
      const scores = reranker.parseLLMScores('invalid', 3);
      expect(scores).toEqual([0.5, 0.5, 0.5]);
    });
  });

  describe('rerankWithKeywordMatch', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该根据关键词匹配重排序', () => {
      const result = reranker.rerankWithKeywordMatch('AI', sampleDocuments, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('应该给标题匹配更高权重', () => {
      const docs = [
        { id: '1', title: 'AI tutorial', content: 'Content' },
        { id: '2', title: 'Other', content: 'AI content' }
      ];
      const result = reranker.rerankWithKeywordMatch('AI', docs, 2);
      expect(result[0].id).toBe('1');
    });

    it('应该按分数降序排序', () => {
      const result = reranker.rerankWithKeywordMatch('test', sampleDocuments, 3);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
      }
    });

    it('应该归一化分数到0-1', () => {
      const result = reranker.rerankWithKeywordMatch('AI', sampleDocuments, 3);
      result.forEach(doc => {
        expect(doc.score).toBeGreaterThanOrEqual(0);
        expect(doc.score).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('tokenize', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该按空格分词', () => {
      const tokens = reranker.tokenize('hello world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('应该过滤空字符串', () => {
      const tokens = reranker.tokenize('hello  world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('应该按标点分词', () => {
      const tokens = reranker.tokenize('hello,world');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('应该支持中文标点', () => {
      const tokens = reranker.tokenize('你好，世界');
      expect(tokens).toEqual(['你好', '世界']);
    });
  });

  describe('updateConfig / getConfig', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该更新配置', () => {
      reranker.updateConfig({ topK: 10 });
      expect(reranker.config.topK).toBe(10);
    });

    it('应该合并配置', () => {
      const originalMethod = reranker.config.method;
      reranker.updateConfig({ topK: 10 });
      expect(reranker.config.method).toBe(originalMethod);
    });

    it('应该返回配置副本', () => {
      const config = reranker.getConfig();
      expect(config).not.toBe(reranker.config);
    });
  });

  describe('setEnabled', () => {
    beforeEach(() => {
      reranker = new Reranker(mockLLMManager);
    });

    it('应该启用重排序', () => {
      reranker.setEnabled(true);
      expect(reranker.config.enabled).toBe(true);
    });

    it('应该禁用重排序', () => {
      reranker.setEnabled(false);
      expect(reranker.config.enabled).toBe(false);
    });
  });
});
