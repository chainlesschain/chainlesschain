import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

describe('TopicAnalyzer', () => {
  let TopicAnalyzer, getTopicAnalyzer, SENTIMENT, TOPIC_CATEGORIES;
  let analyzer;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../../../src/main/social/topic-analyzer.js');
    TopicAnalyzer = mod.TopicAnalyzer;
    getTopicAnalyzer = mod.getTopicAnalyzer;
    SENTIMENT = mod.SENTIMENT;
    TOPIC_CATEGORIES = mod.TOPIC_CATEGORIES;

    mockDatabase = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn(() => [])
        }))
      },
      saveToFile: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constants ---

  describe('Constants', () => {
    it('should export SENTIMENT constants', () => {
      expect(SENTIMENT.POSITIVE).toBe('positive');
      expect(SENTIMENT.NEGATIVE).toBe('negative');
      expect(SENTIMENT.NEUTRAL).toBe('neutral');
      expect(SENTIMENT.MIXED).toBe('mixed');
    });

    it('should export TOPIC_CATEGORIES constants', () => {
      expect(TOPIC_CATEGORIES.TECHNOLOGY).toBe('technology');
      expect(TOPIC_CATEGORIES.SOCIAL).toBe('social');
      expect(TOPIC_CATEGORIES.BUSINESS).toBe('business');
      expect(TOPIC_CATEGORIES.SCIENCE).toBe('science');
      expect(TOPIC_CATEGORIES.CULTURE).toBe('culture');
      expect(TOPIC_CATEGORIES.GENERAL).toBe('general');
    });
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should create instance with database and llmManager', () => {
      const mockLlm = { chat: vi.fn(), isInitialized: true };
      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      expect(analyzer.database).toBe(mockDatabase);
      expect(analyzer.llmManager).toBe(mockLlm);
      expect(analyzer.initialized).toBe(false);
    });

    it('should create instance without arguments', () => {
      analyzer = new TopicAnalyzer();
      expect(analyzer.database).toBeUndefined();
      expect(analyzer.llmManager).toBeUndefined();
      expect(analyzer.initialized).toBe(false);
    });
  });

  // --- initialize ---

  describe('initialize()', () => {
    it('should call _ensureTables and set initialized = true', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      await analyzer.initialize();
      expect(analyzer.initialized).toBe(true);
      expect(mockDatabase.db.exec).toHaveBeenCalledTimes(1);
    });
  });

  // --- _ensureTables ---

  describe('_ensureTables()', () => {
    it('should skip table creation if no database', () => {
      analyzer = new TopicAnalyzer(null);
      analyzer._ensureTables();
      // No error thrown, logger.warn called
    });

    it('should skip table creation if database.db is null', () => {
      analyzer = new TopicAnalyzer({ db: null });
      analyzer._ensureTables();
    });

    it('should call db.exec with CREATE TABLE statement', () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      analyzer._ensureTables();
      expect(mockDatabase.db.exec).toHaveBeenCalledTimes(1);
      const sql = mockDatabase.db.exec.mock.calls[0][0];
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS topic_analyses');
      expect(sql).toContain('idx_topic_analyses_content');
    });
  });

  // --- analyzeTopics ---

  describe('analyzeTopics()', () => {
    it('should throw on empty content', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      await expect(analyzer.analyzeTopics('')).rejects.toThrow('Content is required');
    });

    it('should throw on null content', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      await expect(analyzer.analyzeTopics(null)).rejects.toThrow('Content is required');
    });

    it('should throw on whitespace-only content', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      await expect(analyzer.analyzeTopics('   ')).rejects.toThrow('Content is required');
    });

    it('should return parsed LLM JSON when LLM is available', async () => {
      const llmResponse = JSON.stringify({
        topics: ['ai', 'machine learning'],
        sentiment: 'positive',
        sentimentScore: 0.8,
        category: 'technology',
        keywords: ['artificial', 'intelligence', 'deep'],
        summary: 'An article about AI.'
      });

      const mockLlm = {
        isInitialized: true,
        chat: vi.fn().mockResolvedValue({ content: llmResponse })
      };

      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      const result = await analyzer.analyzeTopics('Artificial intelligence is transforming the world.');

      expect(result.topics).toEqual(['ai', 'machine learning']);
      expect(result.sentiment).toBe('positive');
      expect(result.sentimentScore).toBe(0.8);
      expect(result.category).toBe('technology');
      expect(result.source).toBe('llm');
      expect(mockLlm.chat).toHaveBeenCalledTimes(1);
    });

    it('should handle LLM returning markdown-wrapped JSON', async () => {
      const llmResponse = '```json\n{"topics":["test"],"sentiment":"neutral","sentimentScore":0,"category":"general","keywords":["test"],"summary":"test"}\n```';

      const mockLlm = {
        isInitialized: true,
        chat: vi.fn().mockResolvedValue({ content: llmResponse })
      };

      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      const result = await analyzer.analyzeTopics('Test content here.');
      expect(result.source).toBe('llm');
      expect(result.topics).toEqual(['test']);
    });

    it('should use fallback keyword extraction when LLM is unavailable', async () => {
      analyzer = new TopicAnalyzer(mockDatabase, null);
      const result = await analyzer.analyzeTopics('The quick brown foxes jumped over lazy dogs repeatedly');

      expect(result.source).toBe('template');
      expect(result.sentiment).toBe('neutral');
      expect(result.sentimentScore).toBe(0);
      expect(result.category).toBe('general');
      expect(Array.isArray(result.topics)).toBe(true);
      expect(Array.isArray(result.keywords)).toBe(true);
    });

    it('should fallback extract keywords from content words longer than 3 chars', async () => {
      analyzer = new TopicAnalyzer(mockDatabase, null);
      const result = await analyzer.analyzeTopics('technology technology technology science science business');

      // "technology" appears 3 times, so it should be first keyword
      expect(result.keywords[0]).toBe('technology');
      expect(result.keywords.length).toBeLessThanOrEqual(5);
      expect(result.topics.length).toBeLessThanOrEqual(3);
    });

    it('should fallback when LLM chat returns null', async () => {
      const mockLlm = {
        isInitialized: true,
        chat: vi.fn().mockResolvedValue(null)
      };

      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      const result = await analyzer.analyzeTopics('Some content about programming');
      expect(result.source).toBe('template');
    });

    it('should fallback when LLM returns unparseable JSON', async () => {
      const mockLlm = {
        isInitialized: true,
        chat: vi.fn().mockResolvedValue({ content: 'not valid json at all' })
      };

      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      const result = await analyzer.analyzeTopics('Some content about coding');
      expect(result.source).toBe('template');
    });

    it('should save analysis when contentId is provided', async () => {
      analyzer = new TopicAnalyzer(mockDatabase, null);
      const runFn = vi.fn();
      mockDatabase.db.prepare.mockReturnValue({ run: runFn, get: vi.fn(), all: vi.fn(() => []) });

      await analyzer.analyzeTopics('Hello world testing content here', { contentId: 'post-123', contentType: 'post' });

      expect(mockDatabase.db.prepare).toHaveBeenCalled();
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });

    it('should truncate summary to 100 chars with ellipsis in fallback', async () => {
      analyzer = new TopicAnalyzer(mockDatabase, null);
      const longContent = 'abcde '.repeat(30); // > 100 chars
      const result = await analyzer.analyzeTopics(longContent);
      expect(result.summary.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(result.summary.endsWith('...')).toBe(true);
    });
  });

  // --- getTrendingTopics ---

  describe('getTrendingTopics()', () => {
    it('should return empty array if no DB', async () => {
      analyzer = new TopicAnalyzer(null);
      const result = await analyzer.getTrendingTopics();
      expect(result).toEqual([]);
    });

    it('should return empty array if database.db is null', async () => {
      analyzer = new TopicAnalyzer({ db: null });
      const result = await analyzer.getTrendingTopics();
      expect(result).toEqual([]);
    });

    it('should query DB and aggregate topic counts', async () => {
      const allFn = vi.fn(() => [
        { topics: JSON.stringify(['ai', 'machine learning']) },
        { topics: JSON.stringify(['ai', 'robotics']) },
        { topics: JSON.stringify(['ai']) }
      ]);
      mockDatabase.db.prepare.mockReturnValue({ run: vi.fn(), get: vi.fn(), all: allFn });

      analyzer = new TopicAnalyzer(mockDatabase);
      const result = await analyzer.getTrendingTopics({ limit: 5 });

      expect(result[0].topic).toBe('ai');
      expect(result[0].count).toBe(3);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should skip malformed JSON in topics', async () => {
      const allFn = vi.fn(() => [
        { topics: 'not-json' },
        { topics: JSON.stringify(['valid']) }
      ]);
      mockDatabase.db.prepare.mockReturnValue({ run: vi.fn(), get: vi.fn(), all: allFn });

      analyzer = new TopicAnalyzer(mockDatabase);
      const result = await analyzer.getTrendingTopics();

      expect(result.length).toBe(1);
      expect(result[0].topic).toBe('valid');
    });
  });

  // --- batchSentiment ---

  describe('batchSentiment()', () => {
    it('should return default for empty array', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      const result = await analyzer.batchSentiment([]);
      expect(result.average).toBe(0);
      expect(result.distribution.positive).toBe(0);
      expect(result.distribution.negative).toBe(0);
      expect(result.distribution.neutral).toBe(0);
      expect(result.distribution.mixed).toBe(0);
    });

    it('should return default for non-array input', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      const result = await analyzer.batchSentiment(null);
      expect(result.average).toBe(0);
    });

    it('should process up to 20 items', async () => {
      analyzer = new TopicAnalyzer(mockDatabase, null);
      const contents = Array.from({ length: 25 }, (_, i) => `content item number ${i} with enough words`);

      const result = await analyzer.batchSentiment(contents);

      // Fallback always returns neutral with score 0
      expect(result.count).toBe(20);
      expect(result.distribution.neutral).toBe(20);
      expect(result.average).toBe(0);
    });

    it('should calculate correct average sentiment score', async () => {
      const llmResponses = [
        JSON.stringify({ topics: [], sentiment: 'positive', sentimentScore: 0.8, category: 'general', keywords: [], summary: '' }),
        JSON.stringify({ topics: [], sentiment: 'negative', sentimentScore: -0.6, category: 'general', keywords: [], summary: '' })
      ];
      let callIdx = 0;
      const mockLlm = {
        isInitialized: true,
        chat: vi.fn(() => Promise.resolve({ content: llmResponses[callIdx++] || llmResponses[0] }))
      };

      analyzer = new TopicAnalyzer(mockDatabase, mockLlm);
      const result = await analyzer.batchSentiment(['Happy content', 'Sad content']);

      expect(result.count).toBe(2);
      expect(result.average).toBeCloseTo(0.1, 1);
      expect(result.distribution.positive).toBe(1);
      expect(result.distribution.negative).toBe(1);
    });
  });

  // --- close ---

  describe('close()', () => {
    it('should reset initialized state', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      await analyzer.initialize();
      expect(analyzer.initialized).toBe(true);

      await analyzer.close();
      expect(analyzer.initialized).toBe(false);
    });

    it('should remove all event listeners', async () => {
      analyzer = new TopicAnalyzer(mockDatabase);
      analyzer.on('test', () => {});
      expect(analyzer.listenerCount('test')).toBe(1);

      await analyzer.close();
      expect(analyzer.listenerCount('test')).toBe(0);
    });
  });

  // --- singleton ---

  describe('getTopicAnalyzer()', () => {
    it('should return same instance on repeated calls', () => {
      const a = getTopicAnalyzer();
      const b = getTopicAnalyzer();
      expect(a).toBe(b);
    });
  });
});
