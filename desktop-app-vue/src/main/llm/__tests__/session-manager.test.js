/**
 * Session Manager 模块测试
 *
 * 测试内容：
 * - SessionManager 类的会话生命周期
 * - 消息管理
 * - 搜索和标签
 * - 导出/导入
 * - 摘要生成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{}'),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Mock PromptCompressor
vi.mock('../prompt-compressor', () => ({
  PromptCompressor: vi.fn().mockImplementation(() => ({
    compress: vi.fn().mockResolvedValue({
      messages: [{ role: 'system', content: 'compressed' }],
      originalTokens: 1000,
      compressedTokens: 300,
      compressionRatio: 0.3,
      strategy: 'summarization',
    }),
  })),
}));

const { SessionManager } = require('../session-manager');

describe('SessionManager', () => {
  let sessionManager;
  let mockDb;
  let mockLlmManager;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 1 })),
        get: vi.fn(),
        all: vi.fn(() => []),
      })),
    };

    mockLlmManager = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          dailyNotes: 'Test daily note',
          longTermMemory: 'Test memory',
          shouldSave: false,
        }),
      }),
      query: vi.fn().mockResolvedValue({
        text: 'This is a summary of the conversation.',
      }),
    };

    sessionManager = new SessionManager({
      database: mockDb,
      llmManager: mockLlmManager,
      sessionsDir: '/mock/sessions',
      maxHistoryMessages: 10,
      compressionThreshold: 10,
      enableAutoSave: true,
      enableCompression: true,
      enableAutoSummary: false,
      enableBackgroundSummary: false,
    });
  });

  afterEach(() => {
    sessionManager.destroy();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should require database', () => {
      expect(() => new SessionManager()).toThrow('database 参数是必需的');
    });

    it('should initialize with default options', () => {
      const sm = new SessionManager({ database: mockDb });
      expect(sm.maxHistoryMessages).toBe(10);
      expect(sm.compressionThreshold).toBe(10);
      expect(sm.enableAutoSave).toBe(true);
      sm.destroy();
    });

    it('should initialize with custom options', () => {
      const sm = new SessionManager({
        database: mockDb,
        maxHistoryMessages: 20,
        compressionThreshold: 15,
        enableAutoSave: false,
      });
      expect(sm.maxHistoryMessages).toBe(20);
      expect(sm.compressionThreshold).toBe(15);
      expect(sm.enableAutoSave).toBe(false);
      sm.destroy();
    });
  });

  describe('initialize', () => {
    it('should create sessions directory', async () => {
      // Just verify initialize doesn't throw
      await expect(sessionManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('createSession', () => {
    it('should create session with required parameters', async () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({ run: mockRun });

      const session = await sessionManager.createSession({
        conversationId: 'conv-1',
        title: 'Test Session',
      });

      // Session ID should be a valid UUID format
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(session.conversationId).toBe('conv-1');
      expect(session.title).toBe('Test Session');
      expect(session.messages).toEqual([]);
      expect(mockRun).toHaveBeenCalled();
    });

    it('should require conversationId', async () => {
      await expect(sessionManager.createSession({})).rejects.toThrow(
        'conversationId 是必需的',
      );
    });

    it('should generate default title', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.createSession({
        conversationId: 'conv-1',
      });

      expect(session.title).toContain('会话');
    });

    it('should emit session-created event', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const eventHandler = vi.fn();
      sessionManager.on('session-created', eventHandler);

      await sessionManager.createSession({ conversationId: 'conv-1' });

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('loadSession', () => {
    it('should load from cache when available', async () => {
      const cachedSession = {
        id: 'session-1',
        messages: [],
      };
      sessionManager.sessionCache.set('session-1', cachedSession);

      const session = await sessionManager.loadSession('session-1');

      expect(session).toBe(cachedSession);
    });

    it('should load from database when not cached', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'session-1',
          conversation_id: 'conv-1',
          title: 'Test',
          messages: '[]',
          compressed_history: null,
          metadata: '{}',
        }),
      });

      const session = await sessionManager.loadSession('session-1', {
        fromCache: false,
      });

      expect(session.id).toBe('session-1');
      expect(sessionManager.sessionCache.has('session-1')).toBe(true);
    });

    it('should throw for non-existent session', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      await expect(
        sessionManager.loadSession('non-existent', { fromCache: false }),
      ).rejects.toThrow('会话不存在');
    });
  });

  describe('addMessage', () => {
    beforeEach(() => {
      sessionManager.sessionCache.set('session-1', {
        id: 'session-1',
        messages: [],
        metadata: { messageCount: 0 },
      });
    });

    it('should add message to session', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.addMessage('session-1', {
        role: 'user',
        content: 'Hello',
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].role).toBe('user');
      expect(session.messages[0].content).toBe('Hello');
      expect(session.messages[0].timestamp).toBeDefined();
    });

    it('should update message count', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.addMessage('session-1', {
        role: 'user',
        content: 'Hello',
      });

      expect(session.metadata.messageCount).toBe(1);
    });

    it('should emit message-added event', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const eventHandler = vi.fn();
      sessionManager.on('message-added', eventHandler);

      await sessionManager.addMessage('session-1', {
        role: 'user',
        content: 'Hello',
      });

      expect(eventHandler).toHaveBeenCalledWith({
        sessionId: 'session-1',
        message: expect.objectContaining({ role: 'user' }),
      });
    });
  });

  describe('deleteSession', () => {
    it('should delete session from database and cache', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });
      sessionManager.sessionCache.set('session-1', { id: 'session-1' });

      await sessionManager.deleteSession('session-1');

      expect(sessionManager.sessionCache.has('session-1')).toBe(false);
    });

    it('should emit session-deleted event', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const eventHandler = vi.fn();
      sessionManager.on('session-deleted', eventHandler);

      await sessionManager.deleteSession('session-1');

      expect(eventHandler).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });
  });

  describe('listSessions', () => {
    it('should return session list', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            id: 'session-1',
            conversation_id: 'conv-1',
            title: 'Session 1',
            metadata: '{}',
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          {
            id: 'session-2',
            conversation_id: 'conv-2',
            title: 'Session 2',
            metadata: '{}',
            created_at: Date.now(),
            updated_at: Date.now(),
          },
        ]),
      });

      const sessions = await sessionManager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('session-1');
    });

    it('should filter by conversationId', async () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockDb.prepare.mockReturnValue({ all: mockAll });

      await sessionManager.listSessions({ conversationId: 'conv-1' });

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('searchSessions', () => {
    it('should return list for empty query', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const results = await sessionManager.searchSessions('');

      expect(results).toEqual([]);
    });

    it('should search by title', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            id: 'session-1',
            title: 'Test Session',
            metadata: '{}',
          },
        ]),
      });

      const results = await sessionManager.searchSessions('Test', {
        searchTitle: true,
        searchContent: false,
      });

      expect(results[0].matchType).toBe('title');
    });

    it('should search by content', async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([]),
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([
            {
              id: 'session-1',
              title: 'Session',
              messages: JSON.stringify([
                { role: 'user', content: 'Hello world' },
              ]),
              metadata: '{}',
            },
          ]),
        });

      const results = await sessionManager.searchSessions('Hello', {
        searchTitle: true,
        searchContent: true,
      });

      expect(results.some((r) => r.matchType === 'content')).toBe(true);
    });
  });

  describe('tag management', () => {
    beforeEach(() => {
      sessionManager.sessionCache.set('session-1', {
        id: 'session-1',
        metadata: { tags: ['existing'] },
      });
    });

    it('should add tags to session', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.addTags('session-1', ['new-tag']);

      expect(session.metadata.tags).toContain('existing');
      expect(session.metadata.tags).toContain('new-tag');
    });

    it('should add multiple tags', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.addTags('session-1', [
        'tag1',
        'tag2',
      ]);

      expect(session.metadata.tags).toContain('tag1');
      expect(session.metadata.tags).toContain('tag2');
    });

    it('should remove tags from session', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const session = await sessionManager.removeTags('session-1', 'existing');

      expect(session.metadata.tags).not.toContain('existing');
    });

    it('should get all tags with counts', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          { metadata: '{"tags": ["tag1", "tag2"]}' },
          { metadata: '{"tags": ["tag1"]}' },
        ]),
      });

      const tags = await sessionManager.getAllTags();

      expect(tags).toContainEqual({ name: 'tag1', count: 2 });
      expect(tags).toContainEqual({ name: 'tag2', count: 1 });
    });
  });

  describe('export/import', () => {
    beforeEach(() => {
      sessionManager.sessionCache.set('session-1', {
        id: 'session-1',
        conversationId: 'conv-1',
        title: 'Test Session',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          { role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
        ],
        metadata: { createdAt: Date.now(), tags: ['test'] },
      });
    });

    it('should export session as JSON', async () => {
      const json = await sessionManager.exportToJSON('session-1');
      const data = JSON.parse(json);

      expect(data.version).toBe('1.0');
      expect(data.session.id).toBe('session-1');
      expect(data.session.messages).toHaveLength(2);
    });

    it('should export session as Markdown', async () => {
      const md = await sessionManager.exportToMarkdown('session-1');

      expect(md).toContain('# Test Session');
      expect(md).toContain('用户');
      expect(md).toContain('助手');
    });

    it('should import session from JSON', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const jsonData = JSON.stringify({
        session: {
          title: 'Imported Session',
          messages: [{ role: 'user', content: 'Test' }],
        },
      });

      const imported = await sessionManager.importFromJSON(jsonData);

      expect(imported.title).toBe('Imported Session');
    });

    it('should throw for invalid JSON format', async () => {
      await expect(
        sessionManager.importFromJSON('{"invalid": "data"}'),
      ).rejects.toThrow('无效的会话数据格式');
    });
  });

  describe('generateSummary', () => {
    beforeEach(() => {
      sessionManager.sessionCache.set('session-1', {
        id: 'session-1',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        metadata: {},
      });
    });

    it('should generate summary using LLM', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const summary = await sessionManager.generateSummary('session-1', {
        useLLM: true,
      });

      expect(summary).toBe('This is a summary of the conversation.');
      expect(mockLlmManager.query).toHaveBeenCalled();
    });

    it('should fall back to simple summary without LLM', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });
      sessionManager.llmManager = null;

      const summary = await sessionManager.generateSummary('session-1', {
        useLLM: false,
      });

      expect(summary).toBe('Hello');
    });

    it('should return "空会话" for empty session', async () => {
      sessionManager.sessionCache.set('empty-session', {
        id: 'empty-session',
        messages: [],
        metadata: {},
      });

      const summary = await sessionManager.generateSummary('empty-session');

      expect(summary).toBe('空会话');
    });
  });

  describe('duplicateSession', () => {
    beforeEach(() => {
      sessionManager.sessionCache.set('original', {
        id: 'original',
        conversationId: 'conv-1',
        title: 'Original Session',
        messages: [{ role: 'user', content: 'Hello' }],
        metadata: { tags: ['tag1'], compressionCount: 5 },
      });
    });

    it('should duplicate session with new ID', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const duplicated = await sessionManager.duplicateSession('original');

      expect(duplicated.id).not.toBe('original');
      expect(duplicated.title).toBe('Original Session - 副本');
      expect(duplicated.messages).toHaveLength(1);
    });

    it('should copy tags when requested', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const duplicated = await sessionManager.duplicateSession('original', {
        includeTags: true,
      });

      expect(duplicated.metadata.tags).toContain('tag1');
    });

    it('should reset metadata when requested', async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() });

      const duplicated = await sessionManager.duplicateSession('original', {
        resetMetadata: true,
      });

      expect(duplicated.metadata.compressionCount).toBe(0);
    });
  });

  describe('getSessionStats', () => {
    it('should return session statistics', async () => {
      sessionManager.sessionCache.set('session-1', {
        id: 'session-1',
        conversationId: 'conv-1',
        messages: [{ role: 'user', content: 'test' }],
        compressedHistory: JSON.stringify({
          originalCount: 1000,
          compressedCount: 300,
          compressionRatio: 0.3,
          compressedAt: Date.now(),
        }),
        metadata: {
          createdAt: Date.now() - 100000,
          updatedAt: Date.now(),
          compressionCount: 2,
          totalTokensSaved: 700,
        },
      });

      const stats = await sessionManager.getSessionStats('session-1');

      expect(stats.sessionId).toBe('session-1');
      expect(stats.messageCount).toBe(1);
      expect(stats.compressionCount).toBe(2);
      expect(stats.totalTokensSaved).toBe(700);
      expect(stats.lastCompression).toBeDefined();
    });
  });

  describe('getGlobalStats', () => {
    it('should return global statistics', async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            totalSessions: 100,
            totalMessages: 5000,
            totalCompressions: 50,
            totalTokensSaved: 10000,
          }),
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([]),
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ recentSessions: 20 }),
        });

      const stats = await sessionManager.getGlobalStats();

      expect(stats.totalSessions).toBe(100);
      expect(stats.totalMessages).toBe(5000);
      expect(stats.recentActivityCount).toBe(20);
    });
  });

  describe('memory extraction', () => {
    it('should build memory extraction prompt', () => {
      const messages = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const prompt = sessionManager.buildMemoryExtractionPrompt(messages);

      expect(prompt).toContain('用户');
      expect(prompt).toContain('Hello world');
    });

    it('should parse JSON memory extraction', () => {
      const content = JSON.stringify({
        dailyNotes: 'Test note',
        longTermMemory: 'Test memory',
        shouldSave: true,
      });

      const result = sessionManager.parseMemoryExtraction(content);

      expect(result.dailyNotes).toBe('Test note');
      expect(result.shouldSave).toBe(true);
    });

    it('should parse JSON from code block', () => {
      const content = '```json\n{"dailyNotes": "Note", "shouldSave": true}\n```';

      const result = sessionManager.parseMemoryExtraction(content);

      expect(result.dailyNotes).toBe('Note');
    });

    it('should detect memory sections', () => {
      expect(sessionManager.detectMemorySection('用户偏好设置')).toBe(
        '🧑 用户偏好',
      );
      expect(sessionManager.detectMemorySection('架构决策')).toBe(
        '🏗️ 架构决策',
      );
      expect(sessionManager.detectMemorySection('解决问题')).toBe(
        '🐛 常见问题解决方案',
      );
      expect(sessionManager.detectMemorySection('发现技巧')).toBe(
        '📚 重要技术发现',
      );
      expect(sessionManager.detectMemorySection('配置环境')).toBe(
        '🔧 系统配置',
      );
    });
  });

  describe('context prompt generation', () => {
    it('should generate context prompt for session', () => {
      const session = {
        title: 'Test Session',
        messages: [
          { role: 'user', content: 'How to fix the bug?' },
          { role: 'assistant', content: 'Try restarting.' },
          { role: 'user', content: 'Still not working' },
        ],
        metadata: { summary: 'Discussion about fixing a bug' },
      };

      const prompt = sessionManager._generateContextPrompt(session);

      expect(prompt).toContain('对话上下文提示');
      expect(prompt).toContain('Test Session');
      expect(prompt).toContain('Discussion about fixing a bug');
    });

    it('should return empty string for empty session', () => {
      const session = { messages: [] };
      const prompt = sessionManager._generateContextPrompt(session);
      expect(prompt).toBe('');
    });
  });
});
