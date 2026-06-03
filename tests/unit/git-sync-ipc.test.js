/**
 * Git Sync IPC 单元测试
 * 测试git:get-sync-status API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Git Sync IPC', () => {
  let mockGitConfig;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    mockGitConfig = {
      getAll: vi.fn(),
    };

    const getGitConfig = () => mockGitConfig;

    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const { registerGitIPC } = require('../../desktop-app-vue/src/main/git/git-ipc');
    registerGitIPC({
      gitManager: null,
      markdownExporter: null,
      getGitConfig,
      llmManager: null,
    });
  });

  describe('Get Sync Status', () => {
    it('should get sync status with full config', async () => {
      const mockConfig = {
        enabled: true,
        autoCommit: true,
        autoSync: true,
        syncInterval: 300000,
        lastSyncTime: '2025-01-03T00:00:00Z',
        repoPath: '/path/to/repo',
        remoteUrl: 'https://github.com/user/repo.git',
      };

      mockGitConfig.getAll.mockReturnValue(mockConfig);

      const result = await handlers['git:get-sync-status']();

      expect(result.enabled).toBe(true);
      expect(result.autoCommit).toBe(true);
      expect(result.autoSync).toBe(true);
      expect(result.syncInterval).toBe(300000);
      expect(result.lastSyncTime).toBe('2025-01-03T00:00:00Z');
      expect(result.repoPath).toBe('/path/to/repo');
      expect(result.remoteUrl).toBe('https://github.com/user/repo.git');
    });

    it('should get sync status with default values', async () => {
      mockGitConfig.getAll.mockReturnValue({});

      const result = await handlers['git:get-sync-status']();

      expect(result.enabled).toBe(false);
      expect(result.autoCommit).toBe(false);
      expect(result.autoSync).toBe(false);
      expect(result.syncInterval).toBe(300000);
      expect(result.lastSyncTime).toBeNull();
      expect(result.repoPath).toBeNull();
      expect(result.remoteUrl).toBeNull();
    });

    it('should get sync status when git is disabled', async () => {
      mockGitConfig.getAll.mockReturnValue({
        enabled: false,
      });

      const result = await handlers['git:get-sync-status']();

      expect(result.enabled).toBe(false);
      expect(result.autoCommit).toBe(false);
      expect(result.autoSync).toBe(false);
    });

    it('should get sync status with partial config', async () => {
      mockGitConfig.getAll.mockReturnValue({
        enabled: true,
        repoPath: '/custom/path',
        // Other fields missing
      });

      const result = await handlers['git:get-sync-status']();

      expect(result.enabled).toBe(true);
      expect(result.repoPath).toBe('/custom/path');
      expect(result.autoCommit).toBe(false); // Default
      expect(result.remoteUrl).toBeNull(); // Default
    });

    it('should handle config read errors', async () => {
      mockGitConfig.getAll.mockImplementation(() => {
        throw new Error('Config read error');
      });

      try {
        await handlers['git:get-sync-status']();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toBe('Config read error');
      }
    });
  });
});
