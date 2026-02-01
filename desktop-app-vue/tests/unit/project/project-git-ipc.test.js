/**
 * Project Git IPC 集成测试
 * Phase 2 Task #9
 *
 * 测试场景：
 * - Git 基础操作 (init, status, commit, push, pull)
 * - Git 历史与差异 (log, show-commit, diff)
 * - Git 分支管理 (branches, create-branch, checkout, merge, resolve-conflicts, generate-commit-message)
 * - 边界情况：merge conflict, 网络中断, 身份验证失败, 无效 Git URL, isomorphic-git 降级
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

// Mock electron (will be replaced with our own mock in tests)
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

// Mock isomorphic-git
const mockGit = {
  init: vi.fn(),
  statusMatrix: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  log: vi.fn(),
};

vi.mock('isomorphic-git', () => ({
  default: mockGit,
  ...mockGit,
}));

vi.mock('isomorphic-git/http/node', () => ({
  default: {},
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Project Git IPC 集成测试', () => {
  let handlers = {};
  let registerProjectGitIPC;
  let mockGetProjectConfig;
  let mockGitAPI;
  let mockGitManager;
  let mockFileSyncManager;
  let mockMainWindow;
  let mockIpcMain;
  let fs;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    handlers = {};

    // Create mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
      removeHandler: vi.fn(),
    };

    // Import fs mock
    fs = await import('fs');

    // Setup mock dependencies
    mockGetProjectConfig = vi.fn(() => ({
      resolveProjectPath: vi.fn((p) => {
        // If path starts with /data/projects/, convert to absolute
        if (p.startsWith('/data/projects/')) {
          return path.join('C:', 'projects', p.replace('/data/projects/', ''));
        }
        return p;
      }),
    }));

    mockGitAPI = {
      init: vi.fn(),
      status: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      pull: vi.fn(),
      log: vi.fn(),
      diff: vi.fn(),
      branches: vi.fn(),
      createBranch: vi.fn(),
      checkoutBranch: vi.fn(),
      merge: vi.fn(),
      resolveConflicts: vi.fn(),
      generateCommitMessage: vi.fn(),
    };

    mockGitManager = {
      author: {
        name: 'Test User',
        email: 'test@example.com',
      },
      auth: {
        username: 'testuser',
        password: 'testpass',
      },
    };

    mockFileSyncManager = {
      flushAllChanges: vi.fn(),
    };

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };

    // Import and register handlers
    const module = await import('../../../src/main/project/project-git-ipc.js');
    registerProjectGitIPC = module.registerProjectGitIPC;

    registerProjectGitIPC({
      getProjectConfig: mockGetProjectConfig,
      GitAPI: mockGitAPI,
      gitManager: mockGitManager,
      fileSyncManager: mockFileSyncManager,
      mainWindow: mockMainWindow,
      ipcMain: mockIpcMain,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Git 基础操作测试 (5 handlers)
  // ============================================================

  describe('Git 基础操作', () => {
    describe('project:git-init', () => {
      it('应该成功初始化 Git 仓库（使用后端 API）', async () => {
        const handler = handlers['project:git-init'];
        expect(handler).toBeTruthy();

        mockGitAPI.init.mockResolvedValue({
          success: true,
          status: 1,
        });

        const result = await handler({}, '/data/projects/test-repo', null);

        expect(mockGitAPI.init).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          null
        );
        expect(result.success).toBe(true);
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-init'];

        mockGitAPI.init.mockResolvedValue({
          success: false,
          status: 0,
        });

        mockGit.init.mockResolvedValue();

        const result = await handler({}, '/data/projects/test-repo', null);

        expect(mockGit.init).toHaveBeenCalledWith({
          fs: expect.any(Object),
          dir: expect.stringContaining('test-repo'),
          defaultBranch: 'main',
        });
        expect(result.success).toBe(true);
      });

      it('应该支持使用远程 URL 初始化', async () => {
        const handler = handlers['project:git-init'];

        mockGitAPI.init.mockResolvedValue({
          success: true,
          status: 1,
        });

        const remoteUrl = 'https://github.com/user/repo.git';
        await handler({}, '/data/projects/test-repo', remoteUrl);

        expect(mockGitAPI.init).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          remoteUrl
        );
      });

      it('应该处理无效的 Git URL 错误', async () => {
        const handler = handlers['project:git-init'];

        mockGitAPI.init.mockRejectedValue(new Error('Invalid Git URL'));

        await expect(
          handler({}, '/data/projects/test-repo', 'invalid-url')
        ).rejects.toThrow('Invalid Git URL');
      });

      it('应该处理网络错误', async () => {
        const handler = handlers['project:git-init'];

        mockGitAPI.init.mockRejectedValue(new Error('Network timeout'));

        await expect(
          handler({}, '/data/projects/test-repo', 'https://github.com/user/repo.git')
        ).rejects.toThrow('Network timeout');
      });
    });

    describe('project:git-status', () => {
      it('应该成功获取 Git 状态（使用后端 API）', async () => {
        const handler = handlers['project:git-status'];
        expect(handler).toBeTruthy();

        mockGitAPI.status.mockResolvedValue({
          success: true,
          status: 1,
          data: {
            'file1.txt': 'modified',
            'file2.txt': 'untracked',
          },
        });

        const result = await handler({}, '/data/projects/test-repo');

        expect(mockGitAPI.status).toHaveBeenCalledWith(
          expect.stringContaining('test-repo')
        );
        expect(result).toEqual({
          'file1.txt': 'modified',
          'file2.txt': 'untracked',
        });
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-status'];

        mockGitAPI.status.mockResolvedValue({
          success: false,
          status: 0,
        });

        // statusMatrix format: [filepath, headStatus, worktreeStatus, stageStatus]
        mockGit.statusMatrix.mockResolvedValue([
          ['file1.txt', 1, 2, 1], // modified
          ['file2.txt', 0, 2, 0], // untracked
          ['file3.txt', 1, 0, 1], // deleted
          ['file4.txt', 0, 2, 2], // added
        ]);

        const result = await handler({}, '/data/projects/test-repo');

        expect(mockGit.statusMatrix).toHaveBeenCalled();
        expect(result).toEqual({
          'file1.txt': 'modified',
          'file2.txt': 'untracked',
          'file3.txt': 'deleted',
          'file4.txt': 'added',
        });
      });

      it('应该正确处理空仓库状态', async () => {
        const handler = handlers['project:git-status'];

        mockGitAPI.status.mockResolvedValue({
          success: true,
          status: 1,
          data: {},
        });

        const result = await handler({}, '/data/projects/test-repo');

        expect(result).toEqual({});
      });
    });

    describe('project:git-commit', () => {
      it('应该成功提交变更（使用后端 API）', async () => {
        const handler = handlers['project:git-commit'];
        expect(handler).toBeTruthy();

        fs.existsSync.mockReturnValue(true); // .git exists

        mockFileSyncManager.flushAllChanges.mockResolvedValue();

        mockGitAPI.commit.mockResolvedValue({
          success: true,
          status: 1,
          data: { sha: 'abc123' },
        });

        const result = await handler(
          {},
          'project-123',
          '/data/projects/test-repo',
          'feat: add new feature'
        );

        expect(mockFileSyncManager.flushAllChanges).toHaveBeenCalledWith('project-123');
        expect(mockGitAPI.commit).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'feat: add new feature',
          expect.objectContaining({
            name: 'Test User',
            email: 'test@example.com',
          }),
          false
        );
        expect(result.success).toBe(true);
      });

      it('应该在 Git 仓库不存在时自动初始化', async () => {
        const handler = handlers['project:git-commit'];

        fs.existsSync.mockReturnValue(false); // .git doesn't exist

        mockGit.init.mockResolvedValue();
        mockGitAPI.commit.mockResolvedValue({
          success: true,
          status: 1,
          data: { sha: 'def456' },
        });

        await handler({}, 'project-123', '/data/projects/test-repo', 'Initial commit');

        expect(mockGit.init).toHaveBeenCalledWith({
          fs: expect.any(Object),
          dir: expect.stringContaining('test-repo'),
          defaultBranch: 'main',
        });
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-commit'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.commit.mockResolvedValue({
          success: false,
          status: 0,
        });

        mockGit.statusMatrix.mockResolvedValue([
          ['file1.txt', 1, 2, 1], // modified file
        ]);

        mockGit.add.mockResolvedValue();
        mockGit.commit.mockResolvedValue('sha-123');

        const result = await handler(
          {},
          'project-123',
          '/data/projects/test-repo',
          'Test commit'
        );

        expect(mockGit.add).toHaveBeenCalled();
        expect(mockGit.commit).toHaveBeenCalledWith({
          fs: expect.any(Object),
          dir: expect.stringContaining('test-repo'),
          message: 'Test commit',
          author: expect.objectContaining({
            name: 'Test User',
            email: 'test@example.com',
          }),
        });
        expect(result.success).toBe(true);
        expect(result.sha).toBe('sha-123');
      });

      it('应该处理没有变更的情况', async () => {
        const handler = handlers['project:git-commit'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.commit.mockResolvedValue({
          success: false,
          status: 0,
        });

        // No changes
        mockGit.statusMatrix.mockResolvedValue([
          ['file1.txt', 1, 1, 1], // unchanged file
        ]);

        const result = await handler(
          {},
          'project-123',
          '/data/projects/test-repo',
          'Test commit'
        );

        expect(result.success).toBe(true);
        expect(result.message).toBe('No changes to commit');
      });

      it('应该支持自动生成提交消息', async () => {
        const handler = handlers['project:git-commit'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.commit.mockResolvedValue({
          success: true,
          status: 1,
          data: { sha: 'auto-123' },
        });

        await handler(
          {},
          'project-123',
          '/data/projects/test-repo',
          'Auto-generated message',
          true
        );

        expect(mockGitAPI.commit).toHaveBeenCalledWith(
          expect.anything(),
          'Auto-generated message',
          expect.anything(),
          true // autoGenerate flag
        );
      });
    });

    describe('project:git-push', () => {
      it('应该成功推送到远程仓库（使用后端 API）', async () => {
        const handler = handlers['project:git-push'];
        expect(handler).toBeTruthy();

        mockGitAPI.push.mockResolvedValue({
          success: true,
          status: 1,
        });

        const result = await handler({}, '/data/projects/test-repo', 'origin', 'main');

        expect(mockGitAPI.push).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'origin',
          'main'
        );
        expect(result.success).toBe(true);
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-push'];

        mockGitAPI.push.mockResolvedValue({
          success: false,
          status: 0,
        });

        mockGit.push.mockResolvedValue();

        const result = await handler({}, '/data/projects/test-repo');

        expect(mockGit.push).toHaveBeenCalledWith({
          fs: expect.any(Object),
          http: expect.any(Object),
          dir: expect.stringContaining('test-repo'),
          remote: 'origin',
          ref: 'main',
          onAuth: expect.any(Function),
        });
        expect(result.success).toBe(true);
      });

      it('应该处理身份验证失败', async () => {
        const handler = handlers['project:git-push'];

        mockGitAPI.push.mockRejectedValue(new Error('Authentication failed'));

        await expect(
          handler({}, '/data/projects/test-repo', 'origin', 'main')
        ).rejects.toThrow('Authentication failed');
      });

      it('应该处理网络中断', async () => {
        const handler = handlers['project:git-push'];

        mockGitAPI.push.mockRejectedValue(new Error('Network error: ECONNRESET'));

        await expect(
          handler({}, '/data/projects/test-repo', 'origin', 'main')
        ).rejects.toThrow('Network error: ECONNRESET');
      });

      it('应该处理远程拒绝推送（non-fast-forward）', async () => {
        const handler = handlers['project:git-push'];

        mockGitAPI.push.mockRejectedValue(
          new Error('Updates were rejected because the remote contains work')
        );

        await expect(
          handler({}, '/data/projects/test-repo', 'origin', 'main')
        ).rejects.toThrow('Updates were rejected');
      });
    });

    describe('project:git-pull', () => {
      it('应该成功从远程拉取（使用后端 API）', async () => {
        const handler = handlers['project:git-pull'];
        expect(handler).toBeTruthy();

        fs.existsSync.mockReturnValue(true); // .git exists

        mockGitAPI.pull.mockResolvedValue({
          success: true,
          status: 1,
        });

        const result = await handler(
          {},
          'project-123',
          '/data/projects/test-repo',
          'origin',
          'main'
        );

        expect(mockGitAPI.pull).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'origin',
          'main'
        );
        expect(result.success).toBe(true);

        // Should notify frontend
        expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('git:pulled', {
          projectId: 'project-123',
        });
      });

      it('应该在 Git 仓库不存在时抛出错误', async () => {
        const handler = handlers['project:git-pull'];

        fs.existsSync.mockReturnValue(false); // .git doesn't exist

        await expect(
          handler({}, 'project-123', '/data/projects/test-repo')
        ).rejects.toThrow('Git 仓库未初始化');
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-pull'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.pull.mockResolvedValue({
          success: false,
          status: 0,
        });

        mockGit.pull.mockResolvedValue();

        const result = await handler({}, 'project-123', '/data/projects/test-repo');

        expect(mockGit.pull).toHaveBeenCalledWith({
          fs: expect.any(Object),
          http: expect.any(Object),
          dir: expect.stringContaining('test-repo'),
          ref: 'main',
          singleBranch: true,
          onAuth: expect.any(Function),
        });
        expect(result.success).toBe(true);
      });

      it('应该处理合并冲突', async () => {
        const handler = handlers['project:git-pull'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.pull.mockRejectedValue(new Error('Merge conflict detected'));

        await expect(
          handler({}, 'project-123', '/data/projects/test-repo')
        ).rejects.toThrow('Merge conflict detected');
      });

      it('应该处理网络中断', async () => {
        const handler = handlers['project:git-pull'];

        fs.existsSync.mockReturnValue(true);

        mockGitAPI.pull.mockRejectedValue(new Error('Network timeout'));

        await expect(
          handler({}, 'project-123', '/data/projects/test-repo')
        ).rejects.toThrow('Network timeout');
      });
    });
  });

  // ============================================================
  // Git 历史与差异测试 (3 handlers)
  // ============================================================

  describe('Git 历史与差异', () => {
    describe('project:git-log', () => {
      it('应该成功获取提交历史（使用后端 API）', async () => {
        const handler = handlers['project:git-log'];
        expect(handler).toBeTruthy();

        mockGitAPI.log.mockResolvedValue({
          success: true,
          status: 1,
          commits: [
            { sha: 'abc123', message: 'Commit 1', author: 'User1', timestamp: 1000 },
            { sha: 'def456', message: 'Commit 2', author: 'User2', timestamp: 2000 },
          ],
        });

        const result = await handler({}, '/data/projects/test-repo', 1, 20);

        expect(mockGitAPI.log).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          20
        );
        expect(result.success).toBe(true);
        expect(result.commits).toHaveLength(2);
      });

      it('应该支持分页', async () => {
        const handler = handlers['project:git-log'];

        const mockCommits = Array.from({ length: 50 }, (_, i) => ({
          sha: `commit-${i}`,
          message: `Message ${i}`,
          author: 'Test User',
          timestamp: i * 1000,
        }));

        mockGitAPI.log.mockResolvedValue({
          success: true,
          status: 1,
          commits: mockCommits,
        });

        // Get page 2 with pageSize 20
        const result = await handler({}, '/data/projects/test-repo', 2, 20);

        expect(result.commits).toHaveLength(20);
        expect(result.commits[0].sha).toBe('commit-20');
        expect(result.hasMore).toBe(true);
      });

      it('应该在后端不可用时降级使用 isomorphic-git', async () => {
        const handler = handlers['project:git-log'];

        mockGitAPI.log.mockResolvedValue({
          success: false,
          status: 0,
        });

        mockGit.log.mockResolvedValue([
          {
            oid: 'sha-1',
            commit: {
              message: 'Commit 1',
              author: {
                name: 'Author 1',
                email: 'author1@example.com',
                timestamp: 1000,
              },
              committer: {
                name: 'Committer 1',
                email: 'committer1@example.com',
                timestamp: 1000,
              },
            },
          },
        ]);

        const result = await handler({}, '/data/projects/test-repo', 1, 20);

        expect(mockGit.log).toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.commits[0].sha).toBe('sha-1');
        expect(result.commits[0].author).toBe('Author 1');
      });

      it('应该处理空仓库（没有提交）', async () => {
        const handler = handlers['project:git-log'];

        mockGitAPI.log.mockResolvedValue({
          success: true,
          status: 1,
          commits: [],
        });

        const result = await handler({}, '/data/projects/test-repo', 1, 20);

        expect(result.commits).toEqual([]);
        expect(result.hasMore).toBe(false);
      });
    });

    describe('project:git-show-commit', () => {
      it('应该成功获取提交详情', async () => {
        const handler = handlers['project:git-show-commit'];
        expect(handler).toBeTruthy();

        mockGitAPI.diff.mockResolvedValue({
          success: true,
          diff: '+++ added line\n--- removed line',
        });

        const result = await handler({}, '/data/projects/test-repo', 'abc123');

        expect(mockGitAPI.diff).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'abc123^',
          'abc123'
        );
        expect(result.success).toBe(true);
      });

      it('应该处理提交不存在的情况', async () => {
        const handler = handlers['project:git-show-commit'];

        mockGitAPI.diff.mockRejectedValue(new Error('Commit not found'));

        const result = await handler({}, '/data/projects/test-repo', 'invalid-sha');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Commit not found');
      });
    });

    describe('project:git-diff', () => {
      it('应该成功获取两个提交之间的差异', async () => {
        const handler = handlers['project:git-diff'];
        expect(handler).toBeTruthy();

        mockGitAPI.diff.mockResolvedValue({
          success: true,
          diff: 'diff content here',
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'commit1',
          'commit2'
        );

        expect(mockGitAPI.diff).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'commit1',
          'commit2'
        );
        expect(result.success).toBe(true);
      });

      it('应该支持查看工作目录差异（不指定 commit）', async () => {
        const handler = handlers['project:git-diff'];

        mockGitAPI.diff.mockResolvedValue({
          success: true,
          diff: 'working directory changes',
        });

        const result = await handler({}, '/data/projects/test-repo', null, null);

        expect(mockGitAPI.diff).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          null,
          null
        );
        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================
  // Git 分支管理测试 (6 handlers)
  // ============================================================

  describe('Git 分支管理', () => {
    describe('project:git-branches', () => {
      it('应该成功获取分支列表', async () => {
        const handler = handlers['project:git-branches'];
        expect(handler).toBeTruthy();

        mockGitAPI.branches.mockResolvedValue({
          success: true,
          branches: ['main', 'develop', 'feature/new-feature'],
        });

        const result = await handler({}, '/data/projects/test-repo');

        expect(mockGitAPI.branches).toHaveBeenCalledWith(
          expect.stringContaining('test-repo')
        );
        expect(result.branches).toHaveLength(3);
      });

      it('应该处理空仓库（没有分支）', async () => {
        const handler = handlers['project:git-branches'];

        mockGitAPI.branches.mockResolvedValue({
          success: true,
          branches: [],
        });

        const result = await handler({}, '/data/projects/test-repo');

        expect(result.branches).toEqual([]);
      });
    });

    describe('project:git-create-branch', () => {
      it('应该成功创建新分支', async () => {
        const handler = handlers['project:git-create-branch'];
        expect(handler).toBeTruthy();

        mockGitAPI.createBranch.mockResolvedValue({
          success: true,
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'feature/new-branch',
          'main'
        );

        expect(mockGitAPI.createBranch).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'feature/new-branch',
          'main'
        );
        expect(result.success).toBe(true);
      });

      it('应该处理分支已存在的错误', async () => {
        const handler = handlers['project:git-create-branch'];

        mockGitAPI.createBranch.mockRejectedValue(new Error('Branch already exists'));

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'existing-branch',
          null
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Branch already exists');
      });
    });

    describe('project:git-checkout', () => {
      it('应该成功切换分支', async () => {
        const handler = handlers['project:git-checkout'];
        expect(handler).toBeTruthy();

        mockGitAPI.checkoutBranch.mockResolvedValue({
          success: true,
        });

        const result = await handler({}, '/data/projects/test-repo', 'develop');

        expect(mockGitAPI.checkoutBranch).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'develop'
        );
        expect(result.success).toBe(true);
      });

      it('应该处理有未提交变更时切换分支', async () => {
        const handler = handlers['project:git-checkout'];

        mockGitAPI.checkoutBranch.mockRejectedValue(
          new Error('Please commit or stash your changes before switching branches')
        );

        const result = await handler({}, '/data/projects/test-repo', 'develop');

        expect(result.success).toBe(false);
        expect(result.error).toContain('commit or stash');
      });

      it('应该处理分支不存在的错误', async () => {
        const handler = handlers['project:git-checkout'];

        mockGitAPI.checkoutBranch.mockRejectedValue(new Error('Branch not found'));

        const result = await handler({}, '/data/projects/test-repo', 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Branch not found');
      });
    });

    describe('project:git-merge', () => {
      it('应该成功合并分支', async () => {
        const handler = handlers['project:git-merge'];
        expect(handler).toBeTruthy();

        mockGitAPI.merge.mockResolvedValue({
          success: true,
          message: 'Merge successful',
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'feature-branch',
          'main'
        );

        expect(mockGitAPI.merge).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'feature-branch',
          'main'
        );
        expect(result.success).toBe(true);
      });

      it('应该处理合并冲突', async () => {
        const handler = handlers['project:git-merge'];

        mockGitAPI.merge.mockRejectedValue(
          new Error('Merge conflict in file.txt')
        );

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'feature-branch',
          'main'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Merge conflict');
      });

      it('应该处理快进合并（fast-forward）', async () => {
        const handler = handlers['project:git-merge'];

        mockGitAPI.merge.mockResolvedValue({
          success: true,
          message: 'Fast-forward merge',
          fastForward: true,
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'feature-branch',
          'main'
        );

        expect(result.success).toBe(true);
        expect(result.fastForward).toBe(true);
      });
    });

    describe('project:git-resolve-conflicts', () => {
      it('应该成功解决冲突', async () => {
        const handler = handlers['project:git-resolve-conflicts'];
        expect(handler).toBeTruthy();

        mockGitAPI.resolveConflicts.mockResolvedValue({
          success: true,
          resolvedFiles: ['file1.txt', 'file2.txt'],
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          'file1.txt',
          'ours'
        );

        expect(mockGitAPI.resolveConflicts).toHaveBeenCalledWith(
          expect.stringContaining('test-repo'),
          'file1.txt',
          false,
          'ours'
        );
        expect(result.success).toBe(true);
      });

      it('应该支持使用 "ours" 策略解决冲突', async () => {
        const handler = handlers['project:git-resolve-conflicts'];

        mockGitAPI.resolveConflicts.mockResolvedValue({
          success: true,
          strategy: 'ours',
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          null,
          'ours'
        );

        expect(result.success).toBe(true);
        expect(result.strategy).toBe('ours');
      });

      it('应该支持使用 "theirs" 策略解决冲突', async () => {
        const handler = handlers['project:git-resolve-conflicts'];

        mockGitAPI.resolveConflicts.mockResolvedValue({
          success: true,
          strategy: 'theirs',
        });

        const result = await handler(
          {},
          '/data/projects/test-repo',
          null,
          'theirs'
        );

        expect(result.success).toBe(true);
        expect(result.strategy).toBe('theirs');
      });

      it('应该处理没有冲突的情况', async () => {
        const handler = handlers['project:git-resolve-conflicts'];

        mockGitAPI.resolveConflicts.mockRejectedValue(
          new Error('No conflicts to resolve')
        );

        const result = await handler({}, '/data/projects/test-repo', null, null);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No conflicts');
      });
    });

    describe('project:git-generate-commit-message', () => {
      it('应该成功生成提交消息', async () => {
        const handler = handlers['project:git-generate-commit-message'];
        expect(handler).toBeTruthy();

        mockGitAPI.generateCommitMessage.mockResolvedValue({
          success: true,
          message: 'feat: add user authentication feature',
        });

        const result = await handler({}, '/data/projects/test-repo');

        expect(mockGitAPI.generateCommitMessage).toHaveBeenCalledWith(
          expect.stringContaining('test-repo')
        );
        expect(result.success).toBe(true);
        expect(result.message).toContain('feat:');
      });

      it('应该处理没有变更时生成消息', async () => {
        const handler = handlers['project:git-generate-commit-message'];

        mockGitAPI.generateCommitMessage.mockRejectedValue(
          new Error('No changes to generate message for')
        );

        const result = await handler({}, '/data/projects/test-repo');

        expect(result.success).toBe(false);
        expect(result.error).toContain('No changes');
      });

      it('应该处理 AI 服务不可用', async () => {
        const handler = handlers['project:git-generate-commit-message'];

        mockGitAPI.generateCommitMessage.mockRejectedValue(
          new Error('AI service unavailable')
        );

        const result = await handler({}, '/data/projects/test-repo');

        expect(result.success).toBe(false);
        expect(result.error).toContain('AI service unavailable');
      });
    });
  });

  // ============================================================
  // 边界情况和集成测试
  // ============================================================

  describe('边界情况和集成测试', () => {
    it('应该验证注册了所有 14 个处理器', () => {
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

    it('应该正确解析项目路径', async () => {
      const handler = handlers['project:git-status'];

      mockGitAPI.status.mockResolvedValue({
        success: true,
        status: 1,
        data: {},
      });

      await handler({}, '/data/projects/my-project');

      const resolvedPath = mockGetProjectConfig().resolveProjectPath(
        '/data/projects/my-project'
      );

      expect(resolvedPath).toContain('my-project');
      expect(resolvedPath).not.toContain('/data/projects/');
    });

    it('应该处理大型仓库操作', async () => {
      const handler = handlers['project:git-log'];

      const largeCommitHistory = Array.from({ length: 10000 }, (_, i) => ({
        sha: `commit-${i}`,
        message: `Message ${i}`,
        author: 'Test User',
        timestamp: i * 1000,
      }));

      mockGitAPI.log.mockResolvedValue({
        success: true,
        status: 1,
        commits: largeCommitHistory,
      });

      const result = await handler({}, '/data/projects/large-repo', 1, 100);

      expect(result.commits.length).toBeLessThanOrEqual(100);
      expect(result.hasMore).toBe(true);
    });

    it('应该处理 fileSyncManager 为空的情况', async () => {
      // Re-register without fileSyncManager
      vi.clearAllMocks();
      handlers = {};

      // Recreate mockIpcMain
      const testMockIpcMain = {
        handle: (channel, handler) => {
          handlers[channel] = handler;
        },
      };

      registerProjectGitIPC({
        getProjectConfig: mockGetProjectConfig,
        GitAPI: mockGitAPI,
        gitManager: mockGitManager,
        fileSyncManager: null, // No sync manager
        mainWindow: mockMainWindow,
        ipcMain: testMockIpcMain,
      });

      const handler = handlers['project:git-commit'];

      fs.existsSync.mockReturnValue(true);

      mockGitAPI.commit.mockResolvedValue({
        success: true,
        status: 1,
        data: { sha: 'abc123' },
      });

      // Should not throw even without fileSyncManager
      const result = await handler(
        {},
        null, // No projectId
        '/data/projects/test-repo',
        'Test commit'
      );

      expect(result.success).toBe(true);
    });

    it('应该处理 mainWindow 为空的情况', async () => {
      // Re-register without mainWindow
      vi.clearAllMocks();
      handlers = {};

      // Recreate mockIpcMain
      const testMockIpcMain = {
        handle: (channel, handler) => {
          handlers[channel] = handler;
        },
      };

      registerProjectGitIPC({
        getProjectConfig: mockGetProjectConfig,
        GitAPI: mockGitAPI,
        gitManager: mockGitManager,
        fileSyncManager: mockFileSyncManager,
        mainWindow: null, // No window
        ipcMain: testMockIpcMain,
      });

      const handler = handlers['project:git-pull'];

      fs.existsSync.mockReturnValue(true);

      mockGitAPI.pull.mockResolvedValue({
        success: true,
        status: 1,
      });

      // Should not throw even without mainWindow
      const result = await handler(
        {},
        'project-123',
        '/data/projects/test-repo'
      );

      expect(result.success).toBe(true);
    });

    it('应该处理 gitManager 为空时的认证', async () => {
      // Re-register without gitManager
      vi.clearAllMocks();
      handlers = {};

      // Recreate mockIpcMain
      const testMockIpcMain = {
        handle: (channel, handler) => {
          handlers[channel] = handler;
        },
      };

      registerProjectGitIPC({
        getProjectConfig: mockGetProjectConfig,
        GitAPI: mockGitAPI,
        gitManager: null, // No git manager
        fileSyncManager: mockFileSyncManager,
        mainWindow: mockMainWindow,
        ipcMain: testMockIpcMain,
      });

      const handler = handlers['project:git-commit'];

      fs.existsSync.mockReturnValue(true);

      mockGitAPI.commit.mockResolvedValue({
        success: false,
        status: 0,
      });

      mockGit.statusMatrix.mockResolvedValue([
        ['file1.txt', 1, 2, 1],
      ]);

      mockGit.add.mockResolvedValue();
      mockGit.commit.mockResolvedValue('sha-123');

      const result = await handler(
        {},
        'project-123',
        '/data/projects/test-repo',
        'Test commit'
      );

      expect(mockGit.commit).toHaveBeenCalledWith({
        fs: expect.any(Object),
        dir: expect.anything(),
        message: 'Test commit',
        author: expect.objectContaining({
          name: 'ChainlessChain User', // Default when no gitManager
          email: 'user@chainlesschain.com',
        }),
      });
      expect(result.success).toBe(true);
    });

    it('应该处理文件同步错误但继续提交', async () => {
      const handler = handlers['project:git-commit'];

      fs.existsSync.mockReturnValue(true);

      mockFileSyncManager.flushAllChanges.mockRejectedValue(
        new Error('Sync failed')
      );

      mockGitAPI.commit.mockResolvedValue({
        success: true,
        status: 1,
        data: { sha: 'abc123' },
      });

      // Should not throw, just warn and continue
      const result = await handler(
        {},
        'project-123',
        '/data/projects/test-repo',
        'Test commit'
      );

      expect(result.success).toBe(true);
    });
  });
});
