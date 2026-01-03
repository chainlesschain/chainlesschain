/**
 * Knowledge IPC 单元测试
 * 测试17个知识管理 API 方法
 *
 * 注意：当前测试只验证 IPC handlers 是否正确注册
 * TODO: 添加实际handler调用测试（需要解决CommonJS mock问题）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock electron 模块
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Knowledge IPC', () => {
  let handlers = {};
  let mockDbManager;
  let mockVersionManager;
  let mockKnowledgePaymentManager;
  let registerKnowledgeIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Mock db manager
    mockDbManager = {
      db: {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => null),
          run: vi.fn(() => ({ changes: 1 })),
        })),
      },
    };

    // Mock version manager
    mockVersionManager = {
      getVersionHistory: vi.fn(),
      getVersionStats: vi.fn(),
      restoreVersion: vi.fn(),
      compareVersions: vi.fn(),
    };

    // Mock knowledge payment manager
    mockKnowledgePaymentManager = {
      createPaidContent: vi.fn(),
      updateContent: vi.fn(),
      deleteContent: vi.fn(),
      getContent: vi.fn(),
      listContents: vi.fn(),
      purchaseContent: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      getMyPurchases: vi.fn(),
      getMySubscriptions: vi.fn(),
      accessContent: vi.fn(),
      checkAccess: vi.fn(),
      getStatistics: vi.fn(),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/knowledge/knowledge-ipc.js');
    registerKnowledgeIPC = module.registerKnowledgeIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 Knowledge IPC
    registerKnowledgeIPC({
      dbManager: mockDbManager,
      versionManager: mockVersionManager,
      knowledgePaymentManager: mockKnowledgePaymentManager,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基本功能测试', () => {
    it('should register all 17 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(17);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        // 标签管理 (1)
        'knowledge:get-tags',

        // 版本管理 (3)
        'knowledge:get-version-history',
        'knowledge:restore-version',
        'knowledge:compare-versions',

        // 付费内容管理 (13)
        'knowledge:create-content',
        'knowledge:update-content',
        'knowledge:delete-content',
        'knowledge:get-content',
        'knowledge:list-contents',
        'knowledge:purchase-content',
        'knowledge:subscribe',
        'knowledge:unsubscribe',
        'knowledge:get-my-purchases',
        'knowledge:get-my-subscriptions',
        'knowledge:access-content',
        'knowledge:check-access',
        'knowledge:get-statistics',
      ];

      expectedChannels.forEach(channel => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  describe('标签管理 (1 handler)', () => {
    it('should have get-tags handler', () => {
      expect(handlers['knowledge:get-tags']).toBeDefined();
    });
  });

  describe('版本管理 (3 handlers)', () => {
    it('should have get-version-history handler', () => {
      expect(handlers['knowledge:get-version-history']).toBeDefined();
    });

    it('should have restore-version handler', () => {
      expect(handlers['knowledge:restore-version']).toBeDefined();
    });

    it('should have compare-versions handler', () => {
      expect(handlers['knowledge:compare-versions']).toBeDefined();
    });
  });

  describe('付费内容管理 (13 handlers)', () => {
    it('should have create-content handler', () => {
      expect(handlers['knowledge:create-content']).toBeDefined();
    });

    it('should have update-content handler', () => {
      expect(handlers['knowledge:update-content']).toBeDefined();
    });

    it('should have delete-content handler', () => {
      expect(handlers['knowledge:delete-content']).toBeDefined();
    });

    it('should have get-content handler', () => {
      expect(handlers['knowledge:get-content']).toBeDefined();
    });

    it('should have list-contents handler', () => {
      expect(handlers['knowledge:list-contents']).toBeDefined();
    });

    it('should have purchase-content handler', () => {
      expect(handlers['knowledge:purchase-content']).toBeDefined();
    });

    it('should have subscribe handler', () => {
      expect(handlers['knowledge:subscribe']).toBeDefined();
    });

    it('should have unsubscribe handler', () => {
      expect(handlers['knowledge:unsubscribe']).toBeDefined();
    });

    it('should have get-my-purchases handler', () => {
      expect(handlers['knowledge:get-my-purchases']).toBeDefined();
    });

    it('should have get-my-subscriptions handler', () => {
      expect(handlers['knowledge:get-my-subscriptions']).toBeDefined();
    });

    it('should have access-content handler', () => {
      expect(handlers['knowledge:access-content']).toBeDefined();
    });

    it('should have check-access handler', () => {
      expect(handlers['knowledge:check-access']).toBeDefined();
    });

    it('should have get-statistics handler', () => {
      expect(handlers['knowledge:get-statistics']).toBeDefined();
    });
  });
});
