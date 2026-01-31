/**
 * Conversation Store 单元测试
 * 测试对话管理状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConversationStore } from '@renderer/stores/conversation';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    db: {
      getConversations: vi.fn(),
      getConversation: vi.fn(),
      saveConversation: vi.fn()
    }
  }
};

describe('Conversation Store', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useConversationStore();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('初始状态', () => {
    it('should have empty conversations initially', () => {
      expect(store.conversations).toEqual([]);
      expect(store.currentConversation).toBeNull();
    });

    it('should have correct loading state', () => {
      expect(store.loading).toBe(false);
    });

    it('should have default pagination', () => {
      expect(store.pagination).toEqual({
        offset: 0,
        limit: 50,
        total: 0
      });
    });

    it('should have batch save configuration', () => {
      expect(store.pendingMessages).toEqual([]);
      expect(store.batchSaveTimer).toBeNull();
      expect(store.batchSaveThreshold).toBe(5);
      expect(store.batchSaveInterval).toBe(10000);
    });
  });

  describe('Getters', () => {
    it('currentMessages should return empty array when no conversation', () => {
      expect(store.currentMessages).toEqual([]);
    });

    it('currentMessages should return conversation messages', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'assistant', content: 'Hi' }
      ];
      store.currentConversation = { id: 'conv1', messages };
      expect(store.currentMessages).toEqual(messages);
    });

    it('currentConversationId should return null when no conversation', () => {
      expect(store.currentConversationId).toBeUndefined();
    });

    it('currentConversationId should return conversation id', () => {
      store.currentConversation = { id: 'conv123' };
      expect(store.currentConversationId).toBe('conv123');
    });

    it('currentConversationTitle should return default when no conversation', () => {
      expect(store.currentConversationTitle).toBe('新对话');
    });

    it('currentConversationTitle should return conversation title', () => {
      store.currentConversation = { id: 'conv1', title: 'My Conversation' };
      expect(store.currentConversationTitle).toBe('My Conversation');
    });

    it('hasCurrentConversation should return false initially', () => {
      expect(store.hasCurrentConversation).toBe(false);
    });

    it('hasCurrentConversation should return true when conversation exists', () => {
      store.currentConversation = { id: 'conv1' };
      expect(store.hasCurrentConversation).toBe(true);
    });

    it('conversationCount should return number of conversations', () => {
      expect(store.conversationCount).toBe(0);
      store.conversations = [{ id: '1' }, { id: '2' }];
      expect(store.conversationCount).toBe(2);
    });
  });

  describe('createNewConversation', () => {
    it('should create new conversation with generated ID', () => {
      const conversation = store.createNewConversation();

      expect(conversation.id).toMatch(/^conv_\d+$/);
      expect(conversation.messages).toEqual([]);
      expect(conversation.created_at).toBeDefined();
      expect(conversation.updated_at).toBeDefined();
    });

    it('should set as current conversation', () => {
      const conversation = store.createNewConversation();
      expect(store.currentConversation).toEqual(conversation);
    });

    it('should add to conversations list', () => {
      const conversation = store.createNewConversation();
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0]).toEqual(conversation);
    });

    it('should add new conversation to front of list', () => {
      const conv1 = store.createNewConversation();
      const conv2 = store.createNewConversation();

      expect(store.conversations[0]).toEqual(conv2);
      expect(store.conversations[1]).toEqual(conv1);
    });

    it('should have metadata', () => {
      const conversation = store.createNewConversation();

      expect(conversation.metadata).toEqual({
        model: '',
        provider: '',
        totalTokens: 0
      });
    });
  });

  describe('loadConversations', () => {
    it('should load conversations from database', async () => {
      const mockConversations = [
        { id: 'conv1', title: 'Conversation 1' },
        { id: 'conv2', title: 'Conversation 2' }
      ];

      global.window.electronAPI.db.getConversations.mockResolvedValue({
        conversations: mockConversations,
        total: 2
      });

      await store.loadConversations();

      expect(store.conversations).toEqual(mockConversations);
      expect(store.pagination.total).toBe(2);
    });

    it('should set loading state during load', async () => {
      global.window.electronAPI.db.getConversations.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      const loadPromise = store.loadConversations();
      expect(store.loading).toBe(true);

      await loadPromise;
      expect(store.loading).toBe(false);
    });

    it('should replace conversations on offset 0', async () => {
      store.conversations = [{ id: 'old' }];

      global.window.electronAPI.db.getConversations.mockResolvedValue({
        conversations: [{ id: 'new' }],
        total: 1
      });

      await store.loadConversations(0);

      expect(store.conversations).toEqual([{ id: 'new' }]);
    });

    it('should append conversations on offset > 0', async () => {
      store.conversations = [{ id: 'conv1' }];

      global.window.electronAPI.db.getConversations.mockResolvedValue({
        conversations: [{ id: 'conv2' }],
        total: 2
      });

      await store.loadConversations(1);

      expect(store.conversations).toHaveLength(2);
      expect(store.conversations[1].id).toBe('conv2');
    });

    it('should handle null result', async () => {
      global.window.electronAPI.db.getConversations.mockResolvedValue(null);

      await store.loadConversations();

      expect(store.conversations).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      global.window.electronAPI.db.getConversations.mockRejectedValue(
        new Error('Database error')
      );

      await store.loadConversations();

      expect(store.conversations).toEqual([]);
      expect(store.loading).toBe(false);
    });

    it('should silent handle IPC not ready errors', async () => {
      const { logger } = await import('@/utils/logger');
      global.window.electronAPI.db.getConversations.mockRejectedValue(
        new Error('No handler registered')
      );

      await store.loadConversations();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('loadConversation', () => {
    it('should load from memory if exists', async () => {
      const conv = { id: 'conv1', title: 'Test' };
      store.conversations = [conv];

      const result = await store.loadConversation('conv1');

      expect(result).toEqual(conv);
      expect(store.currentConversation).toEqual(conv);
      expect(global.window.electronAPI.db.getConversation).not.toHaveBeenCalled();
    });

    it('should load from database if not in memory', async () => {
      const conv = { id: 'conv1', title: 'Test' };
      global.window.electronAPI.db.getConversation.mockResolvedValue(conv);

      const result = await store.loadConversation('conv1');

      expect(result).toEqual(conv);
      expect(store.currentConversation).toEqual(conv);
    });

    it('should handle missing conversation', async () => {
      global.window.electronAPI.db.getConversation.mockResolvedValue(null);

      const result = await store.loadConversation('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('should create new conversation if none exists', () => {
      store.addMessage({ role: 'user', content: 'Hello' });

      expect(store.currentConversation).not.toBeNull();
      expect(store.currentConversation.messages).toHaveLength(1);
    });

    it('should add message with generated ID', () => {
      store.createNewConversation();
      const message = store.addMessage({ role: 'user', content: 'Test' });

      expect(message.id).toMatch(/^msg_\d+_/);
    });

    it('should add timestamp if not provided', () => {
      store.createNewConversation();
      const message = store.addMessage({ role: 'user', content: 'Test' });

      expect(message.timestamp).toBeDefined();
    });

    it('should use provided timestamp', () => {
      store.createNewConversation();
      const timestamp = Date.now() - 1000;
      const message = store.addMessage({
        role: 'user',
        content: 'Test',
        timestamp
      });

      expect(message.timestamp).toBe(timestamp);
    });

    it('should update conversation updated_at', () => {
      store.createNewConversation();
      const before = store.currentConversation.updated_at;

      vi.advanceTimersByTime(1000);
      store.addMessage({ role: 'user', content: 'Test' });

      expect(store.currentConversation.updated_at).toBeGreaterThan(before);
    });

    it('should update metadata tokens', () => {
      store.createNewConversation();
      store.addMessage({ role: 'user', content: 'Test', tokens: 10 });
      store.addMessage({ role: 'assistant', content: 'Response', tokens: 20 });

      expect(store.currentConversation.metadata.totalTokens).toBe(30);
    });

    it('should update metadata model', () => {
      store.createNewConversation();
      store.addMessage({ role: 'user', content: 'Test', model: 'gpt-4' });

      expect(store.currentConversation.metadata.model).toBe('gpt-4');
    });

    it('should auto-generate title from first user message', () => {
      store.createNewConversation();
      store.addMessage({ role: 'user', content: 'Hello, how are you?' });

      expect(store.currentConversation.title).toBe('Hello, how are you?');
    });

    it('should truncate long titles', () => {
      store.createNewConversation();
      store.addMessage({
        role: 'user',
        content: 'This is a very long message that should be truncated when used as title'
      });

      expect(store.currentConversation.title).toBe('This is a very long message...');
    });

    it('should not update title from non-first user message', () => {
      store.createNewConversation();
      store.addMessage({ role: 'user', content: 'First message' });
      const titleAfterFirst = store.currentConversation.title;

      store.addMessage({ role: 'user', content: 'Second message' });

      expect(store.currentConversation.title).toBe(titleAfterFirst);
    });
  });

  describe('Batch Save', () => {
    it('should add conversation to pending queue', async () => {
      store.createNewConversation();
      await store.saveCurrentConversation();

      expect(store.pendingMessages).toHaveLength(1);
    });

    it('should schedule batch save below threshold', async () => {
      store.createNewConversation();
      await store.saveCurrentConversation();

      expect(store.batchSaveTimer).not.toBeNull();
    });

    it('should immediately flush at threshold', async () => {
      global.window.electronAPI.db.saveConversation.mockResolvedValue(true);
      store.createNewConversation();

      // Add messages up to threshold
      for (let i = 0; i < store.batchSaveThreshold; i++) {
        await store.saveCurrentConversation();
      }

      expect(store.pendingMessages).toEqual([]);
      expect(global.window.electronAPI.db.saveConversation).toHaveBeenCalled();
    });

    it('should flush pending messages on timer', async () => {
      global.window.electronAPI.db.saveConversation.mockResolvedValue(true);
      store.createNewConversation();

      await store.saveCurrentConversation();
      expect(store.pendingMessages).toHaveLength(1);

      vi.advanceTimersByTime(store.batchSaveInterval);
      await vi.runAllTimersAsync();

      expect(store.pendingMessages).toEqual([]);
    });

    it('should deduplicate pending messages', async () => {
      global.window.electronAPI.db.saveConversation.mockResolvedValue(true);
      store.createNewConversation();
      const convId = store.currentConversation.id;

      // Save same conversation multiple times
      await store.saveCurrentConversation();
      await store.saveCurrentConversation();
      await store.saveCurrentConversation();

      await store.flushPendingMessages();

      // Should only save once per conversation ID
      expect(global.window.electronAPI.db.saveConversation).toHaveBeenCalledTimes(1);
    });

    it('should clear timer after flush', async () => {
      global.window.electronAPI.db.saveConversation.mockResolvedValue(true);
      store.createNewConversation();

      await store.saveCurrentConversation();
      expect(store.batchSaveTimer).not.toBeNull();

      await store.flushPendingMessages();
      expect(store.batchSaveTimer).toBeNull();
    });

    it('should update conversations list', async () => {
      store.createNewConversation();
      const convId = store.currentConversation.id;

      store.currentConversation.title = 'Updated Title';
      await store.saveCurrentConversation();

      const updated = store.conversations.find(c => c.id === convId);
      expect(updated.title).toBe('Updated Title');
    });

    it('should add to list if not exists', async () => {
      store.createNewConversation();
      const conversation = store.currentConversation;
      store.conversations = [];  // Clear list

      await store.saveCurrentConversation();

      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe(conversation.id);
    });
  });

  describe('deleteConversation', () => {
    it('should remove conversation from list', () => {
      store.conversations = [
        { id: 'conv1' },
        { id: 'conv2' },
        { id: 'conv3' }
      ];

      store.deleteConversation('conv2');

      expect(store.conversations).toHaveLength(2);
      expect(store.conversations.find(c => c.id === 'conv2')).toBeUndefined();
    });

    it('should clear current conversation if deleted', () => {
      const conv = { id: 'conv1' };
      store.currentConversation = conv;
      store.conversations = [conv];

      store.deleteConversation('conv1');

      expect(store.currentConversation).toBeNull();
    });

    it('should not clear current conversation if different deleted', () => {
      const conv1 = { id: 'conv1' };
      const conv2 = { id: 'conv2' };
      store.currentConversation = conv1;
      store.conversations = [conv1, conv2];

      store.deleteConversation('conv2');

      expect(store.currentConversation).toEqual(conv1);
    });
  });

  describe('clearCurrentConversation', () => {
    it('should clear current conversation', () => {
      store.currentConversation = { id: 'conv1' };
      store.clearCurrentConversation();

      expect(store.currentConversation).toBeNull();
    });
  });
});
