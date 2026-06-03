/**
 * Knowledge IPC 单元测试
 * 测试17个知识管理API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Knowledge IPC', () => {
  let mockDatabase;
  let handlers = {};

  beforeEach(() => {
    // 清除所有mock
    vi.clearAllMocks();
    handlers = {};

    // 模拟数据库
    mockDatabase = {
      all: vi.fn(),
      get: vi.fn(),
      run: vi.fn(),
    };

    // 捕获IPC handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册Knowledge IPC
    const { registerKnowledgeIPC } = require('../../desktop-app-vue/src/main/knowledge/knowledge-ipc');
    registerKnowledgeIPC({ database: mockDatabase });
  });

  describe('Tag Management', () => {
    it('should get all tags', async () => {
      const mockTags = [
        { tag: 'AI', count: 5 },
        { tag: 'Programming', count: 3 },
      ];

      mockDatabase.all.mockResolvedValue(mockTags);

      const result = await handlers['knowledge:get-tags']();

      expect(result).toEqual({
        success: true,
        tags: mockTags,
      });
      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.any(Array)
      );
    });

    it('should handle tag query errors', async () => {
      mockDatabase.all.mockRejectedValue(new Error('Database error'));

      const result = await handlers['knowledge:get-tags']();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('Version Management', () => {
    it('should get version history', async () => {
      const mockVersions = [
        { id: 1, version: 1, content: 'v1', created_at: '2025-01-01' },
        { id: 2, version: 2, content: 'v2', created_at: '2025-01-02' },
      ];

      mockDatabase.all.mockResolvedValue(mockVersions);

      const result = await handlers['knowledge:get-version-history'](null, { contentId: '123' });

      expect(result).toEqual({
        success: true,
        versions: mockVersions,
      });
    });

    it('should restore version', async () => {
      const mockVersion = { content: 'restored content' };
      mockDatabase.get.mockResolvedValue(mockVersion);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['knowledge:restore-version'](null, {
        contentId: '123',
        versionId: 2,
      });

      expect(result.success).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('should compare versions', async () => {
      const mockVersions = [
        { version: 1, content: 'content v1' },
        { version: 2, content: 'content v2' },
      ];

      mockDatabase.all.mockResolvedValue(mockVersions);

      const result = await handlers['knowledge:compare-versions'](null, {
        contentId: '123',
        version1: 1,
        version2: 2,
      });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });
  });

  describe('Content Management', () => {
    it('should create content', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 123 });

      const result = await handlers['knowledge:create-content'](null, {
        title: 'Test Content',
        content: 'Test content body',
        tags: ['test'],
      });

      expect(result.success).toBe(true);
      expect(result.contentId).toBe(123);
    });

    it('should update content', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['knowledge:update-content'](null, '123', {
        title: 'Updated Title',
      });

      expect(result.success).toBe(true);
      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('should delete content', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['knowledge:delete-content'](null, '123');

      expect(result.success).toBe(true);
    });

    it('should get content by id', async () => {
      const mockContent = {
        id: '123',
        title: 'Test',
        content: 'Body',
      };

      mockDatabase.get.mockResolvedValue(mockContent);

      const result = await handlers['knowledge:get-content'](null, '123');

      expect(result.success).toBe(true);
      expect(result.content).toEqual(mockContent);
    });

    it('should list contents with filters', async () => {
      const mockContents = [
        { id: '1', title: 'Content 1' },
        { id: '2', title: 'Content 2' },
      ];

      mockDatabase.all.mockResolvedValue(mockContents);

      const result = await handlers['knowledge:list-contents'](null, {
        tag: 'AI',
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.contents).toEqual(mockContents);
    });
  });

  describe('Paid Content Management', () => {
    it('should purchase content', async () => {
      mockDatabase.get.mockResolvedValue({ price: 100 });
      mockDatabase.run.mockResolvedValue({ lastID: 456 });

      const result = await handlers['knowledge:purchase-content'](null, '123', 'asset-1');

      expect(result.success).toBe(true);
      expect(result.purchaseId).toBe(456);
    });

    it('should subscribe to plan', async () => {
      mockDatabase.run.mockResolvedValue({ lastID: 789 });

      const result = await handlers['knowledge:subscribe'](null, 'plan-1', 'asset-1');

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe(789);
    });

    it('should unsubscribe from plan', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      const result = await handlers['knowledge:unsubscribe'](null, 'plan-1');

      expect(result.success).toBe(true);
    });

    it('should get user purchases', async () => {
      const mockPurchases = [
        { id: 1, contentId: '123', price: 100 },
      ];

      mockDatabase.all.mockResolvedValue(mockPurchases);

      const result = await handlers['knowledge:get-my-purchases'](null, 'user-did');

      expect(result.success).toBe(true);
      expect(result.purchases).toEqual(mockPurchases);
    });

    it('should get user subscriptions', async () => {
      const mockSubs = [
        { id: 1, planId: 'plan-1', status: 'active' },
      ];

      mockDatabase.all.mockResolvedValue(mockSubs);

      const result = await handlers['knowledge:get-my-subscriptions'](null, 'user-did');

      expect(result.success).toBe(true);
      expect(result.subscriptions).toEqual(mockSubs);
    });

    it('should access content', async () => {
      mockDatabase.get.mockResolvedValue({ hasAccess: true });

      const result = await handlers['knowledge:access-content'](null, '123');

      expect(result.success).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it('should check access permission', async () => {
      mockDatabase.get.mockResolvedValue({ count: 1 });

      const result = await handlers['knowledge:check-access'](null, '123', 'user-did');

      expect(result.success).toBe(true);
      expect(result.hasAccess).toBe(true);
    });

    it('should get creator statistics', async () => {
      const mockStats = {
        totalSales: 1000,
        totalPurchases: 50,
        revenue: 5000,
      };

      mockDatabase.get.mockResolvedValue(mockStats);

      const result = await handlers['knowledge:get-statistics'](null, 'creator-did');

      expect(result.success).toBe(true);
      expect(result.statistics).toEqual(mockStats);
    });
  });
});
