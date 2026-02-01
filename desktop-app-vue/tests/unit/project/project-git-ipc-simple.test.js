/**
 * Project Git IPC 简化集成测试
 * Phase 2 Task #9
 *
 * 简化版测试 - 专注于核心逻辑验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Project Git IPC 简化测试', () => {
  let handlers;
  let mockIpcMain;
  let mockGetProjectConfig;
  let mockGitAPI;
  let mockGitManager;
  let registerProjectGitIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock dependencies
    mockGetProjectConfig = vi.fn(() => ({
      resolveProjectPath: vi.fn((p) => p.replace('/data/projects/', 'C:/projects/')),
    }));

    mockGitAPI = {
      init: vi.fn().mockResolvedValue({ success: true, status: 1 }),
      status: vi.fn().mockResolvedValue({ success: true, status: 1, data: {} }),
      commit: vi.fn().mockResolvedValue({ success: true, status: 1, data: { sha: 'abc123' } }),
      push: vi.fn().mockResolvedValue({ success: true, status: 1 }),
      pull: vi.fn().mockResolvedValue({ success: true, status: 1 }),
      log: vi.fn().mockResolvedValue({ success: true, status: 1, commits: [] }),
      diff: vi.fn().mockResolvedValue({ success: true, diff: '' }),
      branches: vi.fn().mockResolvedValue({ success: true, branches: [] }),
      createBranch: vi.fn().mockResolvedValue({ success: true }),
      checkoutBranch: vi.fn().mockResolvedValue({ success: true }),
      merge: vi.fn().mockResolvedValue({ success: true }),
      resolveConflicts: vi.fn().mockResolvedValue({ success: true }),
      generateCommitMessage: vi.fn().mockResolvedValue({ success: true, message: 'feat: test' }),
    };

    mockGitManager = {
      author: {
        name: 'Test User',
        email: 'test@test.com',
      },
    };

    // Dynamically import the module
    const module = await import('../../../src/main/project/project-git-ipc.js');
    registerProjectGitIPC = module.registerProjectGitIPC;

    // Register handlers
    registerProjectGitIPC({
      getProjectConfig: mockGetProjectConfig,
      GitAPI: mockGitAPI,
      gitManager: mockGitManager,
      fileSyncManager: null,
      mainWindow: null,
      ipcMain: mockIpcMain,
    });
  });

  describe('Handler 注册验证', () => {
    it('应该注册所有 14 个 Git 处理器', () => {
      const handlerNames = Object.keys(handlers);

      expect(handlerNames).toContain('project:git-init');
      expect(handlerNames).toContain('project:git-status');
      expect(handlerNames).toContain('project:git-commit');
      expect(handlerNames).toContain('project:git-push');
      expect(handlerNames).toContain('project:git-pull');
      expect(handlerNames).toContain('project:git-log');
      expect(handlerNames).toContain('project:git-show-commit');
      expect(handlerNames).toContain('project:git-diff');
      expect(handlerNames).toContain('project:git-branches');
      expect(handlerNames).toContain('project:git-create-branch');
      expect(handlerNames).toContain('project:git-checkout');
      expect(handlerNames).toContain('project:git-merge');
      expect(handlerNames).toContain('project:git-resolve-conflicts');
      expect(handlerNames).toContain('project:git-generate-commit-message');

      expect(handlerNames.length).toBe(14);
    });

    it('所有处理器都应该是函数', () => {
      Object.values(handlers).forEach((handler) => {
        expect(typeof handler).toBe('function');
      });
    });
  });

  describe('基础操作测试', () => {
    it('git-init 应该调用 GitAPI.init', async () => {
      const handler = handlers['project:git-init'];
      const result = await handler({}, '/data/projects/test-repo', null);

      expect(mockGitAPI.init).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-status 应该调用 GitAPI.status', async () => {
      const handler = handlers['project:git-status'];
      const result = await handler({}, '/data/projects/test-repo');

      expect(mockGitAPI.status).toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('git-push 应该调用 GitAPI.push', async () => {
      const handler = handlers['project:git-push'];
      const result = await handler({}, '/data/projects/test-repo', 'origin', 'main');

      expect(mockGitAPI.push).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-log 应该调用 GitAPI.log', async () => {
      const handler = handlers['project:git-log'];
      const result = await handler({}, '/data/projects/test-repo', 1, 20);

      expect(mockGitAPI.log).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-diff 应该调用 GitAPI.diff', async () => {
      const handler = handlers['project:git-diff'];
      const result = await handler({}, '/data/projects/test-repo', 'commit1', 'commit2');

      expect(mockGitAPI.diff).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-branches 应该调用 GitAPI.branches', async () => {
      const handler = handlers['project:git-branches'];
      const result = await handler({}, '/data/projects/test-repo');

      expect(mockGitAPI.branches).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-create-branch 应该调用 GitAPI.createBranch', async () => {
      const handler = handlers['project:git-create-branch'];
      const result = await handler({}, '/data/projects/test-repo', 'new-branch', 'main');

      expect(mockGitAPI.createBranch).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-checkout 应该调用 GitAPI.checkoutBranch', async () => {
      const handler = handlers['project:git-checkout'];
      const result = await handler({}, '/data/projects/test-repo', 'develop');

      expect(mockGitAPI.checkoutBranch).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-merge 应该调用 GitAPI.merge', async () => {
      const handler = handlers['project:git-merge'];
      const result = await handler({}, '/data/projects/test-repo', 'feature', 'main');

      expect(mockGitAPI.merge).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-resolve-conflicts 应该调用 GitAPI.resolveConflicts', async () => {
      const handler = handlers['project:git-resolve-conflicts'];
      const result = await handler({}, '/data/projects/test-repo', 'file.txt', 'ours');

      expect(mockGitAPI.resolveConflicts).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('git-generate-commit-message 应该调用 GitAPI.generateCommitMessage', async () => {
      const handler = handlers['project:git-generate-commit-message'];
      const result = await handler({}, '/data/projects/test-repo');

      expect(mockGitAPI.generateCommitMessage).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('路径解析测试', () => {
    it('应该正确解析项目路径', async () => {
      const handler = handlers['project:git-init'];
      await handler({}, '/data/projects/my-project', null);

      expect(mockGetProjectConfig).toHaveBeenCalled();
      const config = mockGetProjectConfig();
      expect(config.resolveProjectPath('/data/projects/my-project')).toBe('C:/projects/my-project');
    });
  });

  describe('错误处理测试', () => {
    it('git-init 应该传播错误', async () => {
      mockGitAPI.init.mockRejectedValue(new Error('Init failed'));

      const handler = handlers['project:git-init'];

      await expect(handler({}, '/data/projects/test-repo', null)).rejects.toThrow('Init failed');
    });

    it('git-push 应该传播网络错误', async () => {
      mockGitAPI.push.mockRejectedValue(new Error('Network error'));

      const handler = handlers['project:git-push'];

      await expect(handler({}, '/data/projects/test-repo', 'origin', 'main')).rejects.toThrow('Network error');
    });
  });

  describe('参数传递测试', () => {
    it('git-init 应该传递远程 URL', async () => {
      const handler = handlers['project:git-init'];
      const remoteUrl = 'https://github.com/user/repo.git';

      await handler({}, '/data/projects/test-repo', remoteUrl);

      expect(mockGitAPI.init).toHaveBeenCalledWith(
        expect.any(String),
        remoteUrl
      );
    });

    it('git-push 应该传递分支名', async () => {
      const handler = handlers['project:git-push'];

      await handler({}, '/data/projects/test-repo', 'origin', 'develop');

      expect(mockGitAPI.push).toHaveBeenCalledWith(
        expect.any(String),
        'origin',
        'develop'
      );
    });

    it('git-log 应该传递分页参数', async () => {
      const handler = handlers['project:git-log'];

      await handler({}, '/data/projects/test-repo', 2, 50);

      expect(mockGitAPI.log).toHaveBeenCalledWith(
        expect.any(String),
        100 // page * pageSize
      );
    });
  });
});
