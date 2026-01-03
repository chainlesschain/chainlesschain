/**
 * Git Manager 单元测试
 * 测试 ahead/behind commits 计算逻辑
 */

const GitManager = require('../../../src/main/git/git-manager');
const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock dependencies
vitest.mock('isomorphic-git');
vitest.mock('fs');
vitest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/user/data'),
  },
}));

describe('GitManager - calculateAheadBehind', () => {
  let gitManager;
  let mockRepoPath;

  beforeEach(() => {
    // 重置所有 mocks
    vitest.clearAllMocks();

    mockRepoPath = path.join(os.tmpdir(), 'test-git-repo');

    // 创建 GitManager 实例
    gitManager = new GitManager({
      repoPath: mockRepoPath,
      remoteUrl: 'https://github.com/test/repo.git',
      authorName: 'Test User',
      authorEmail: 'test@example.com',
    });

    gitManager.isInitialized = true;
  });

  describe('没有配置远程仓库', () => {
    it('应该返回 ahead=0, behind=0', async () => {
      gitManager.remote.url = null;

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });
  });

  describe('本地分支不存在', () => {
    it('应该返回 ahead=0, behind=0', async () => {
      git.resolveRef.mockRejectedValueOnce(new Error('Reference not found'));

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 0, behind: 0 });
      expect(git.resolveRef).toHaveBeenCalledWith({
        fs,
        dir: mockRepoPath,
        ref: 'main',
      });
    });
  });

  describe('远程分支不存在', () => {
    it('应该返回 ahead=本地commits数量, behind=0', async () => {
      const localOid = 'abc123';
      const localCommits = [
        { oid: 'abc123', commit: { message: 'commit 3' } },
        { oid: 'def456', commit: { message: 'commit 2' } },
        { oid: 'ghi789', commit: { message: 'commit 1' } },
      ];

      // 本地分支存在
      git.resolveRef
        .mockResolvedValueOnce(localOid) // 第一次调用：获取本地 oid
        .mockRejectedValueOnce(new Error('Reference not found')); // 第二次调用：远程不存在

      // 获取本地 commits
      git.log.mockResolvedValueOnce(localCommits);

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 3, behind: 0 });
      expect(git.log).toHaveBeenCalledWith({
        fs,
        dir: mockRepoPath,
        ref: 'main',
      });
    });
  });

  describe('本地和远程完全同步', () => {
    it('应该返回 ahead=0, behind=0', async () => {
      const sameOid = 'abc123';

      // 本地和远程 oid 相同
      git.resolveRef
        .mockResolvedValueOnce(sameOid) // 本地
        .mockResolvedValueOnce(sameOid); // 远程

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });
  });

  describe('本地领先远程（ahead commits）', () => {
    it('应该正确计算本地独有的 commits', async () => {
      const localOid = 'local-latest';
      const remoteOid = 'remote-latest';

      // 模拟本地和远程 commits
      const localCommits = [
        { oid: 'local-latest', commit: { message: 'local commit 2' } },
        { oid: 'local-2', commit: { message: 'local commit 1' } },
        { oid: 'shared-1', commit: { message: 'shared commit 1' } }, // 共同祖先
        { oid: 'shared-0', commit: { message: 'shared commit 0' } },
      ];

      const remoteCommits = [
        { oid: 'remote-latest', commit: { message: 'remote commit 1' } },
        { oid: 'shared-1', commit: { message: 'shared commit 1' } }, // 共同祖先
        { oid: 'shared-0', commit: { message: 'shared commit 0' } },
      ];

      git.resolveRef
        .mockResolvedValueOnce(localOid)
        .mockResolvedValueOnce(remoteOid);

      git.log
        .mockResolvedValueOnce(localCommits) // 本地
        .mockResolvedValueOnce(remoteCommits); // 远程

      const result = await gitManager.calculateAheadBehind('main');

      // 本地有 2 个独有 commits
      expect(result.ahead).toBe(2);
      // 远程有 0 个独有 commits（local-2 之后找到共同祖先）
      expect(result.behind).toBe(0);
    });
  });

  describe('远程领先本地（behind commits）', () => {
    it('应该正确计算远程独有的 commits', async () => {
      const localOid = 'local-latest';
      const remoteOid = 'remote-latest';

      const localCommits = [
        { oid: 'local-latest', commit: { message: 'local commit 1' } },
        { oid: 'shared-1', commit: { message: 'shared commit 1' } }, // 共同祖先
        { oid: 'shared-0', commit: { message: 'shared commit 0' } },
      ];

      const remoteCommits = [
        { oid: 'remote-latest', commit: { message: 'remote commit 3' } },
        { oid: 'remote-2', commit: { message: 'remote commit 2' } },
        { oid: 'remote-1', commit: { message: 'remote commit 1' } },
        { oid: 'shared-1', commit: { message: 'shared commit 1' } }, // 共同祖先
        { oid: 'shared-0', commit: { message: 'shared commit 0' } },
      ];

      git.resolveRef
        .mockResolvedValueOnce(localOid)
        .mockResolvedValueOnce(remoteOid);

      git.log
        .mockResolvedValueOnce(localCommits)
        .mockResolvedValueOnce(remoteCommits);

      const result = await gitManager.calculateAheadBehind('main');

      // 本地有 0 个独有 commits
      expect(result.ahead).toBe(0);
      // 远程有 3 个独有 commits
      expect(result.behind).toBe(3);
    });
  });

  describe('本地和远程都有独有的 commits（分叉）', () => {
    it('应该同时计算 ahead 和 behind commits', async () => {
      const localOid = 'local-latest';
      const remoteOid = 'remote-latest';

      const localCommits = [
        { oid: 'local-latest', commit: { message: 'local commit 3' } },
        { oid: 'local-2', commit: { message: 'local commit 2' } },
        { oid: 'local-1', commit: { message: 'local commit 1' } },
        { oid: 'shared-base', commit: { message: 'shared base' } }, // 共同祖先
      ];

      const remoteCommits = [
        { oid: 'remote-latest', commit: { message: 'remote commit 2' } },
        { oid: 'remote-1', commit: { message: 'remote commit 1' } },
        { oid: 'shared-base', commit: { message: 'shared base' } }, // 共同祖先
      ];

      git.resolveRef
        .mockResolvedValueOnce(localOid)
        .mockResolvedValueOnce(remoteOid);

      git.log
        .mockResolvedValueOnce(localCommits)
        .mockResolvedValueOnce(remoteCommits);

      const result = await gitManager.calculateAheadBehind('main');

      // 本地有 3 个独有 commits
      expect(result.ahead).toBe(3);
      // 远程有 2 个独有 commits
      expect(result.behind).toBe(2);
    });
  });

  describe('错误处理', () => {
    it('出错时应该返回 ahead=0, behind=0', async () => {
      git.resolveRef.mockRejectedValueOnce(new Error('Network error'));

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });
  });

  describe('边界情况', () => {
    it('空仓库（没有任何 commits）应该返回 0', async () => {
      git.resolveRef
        .mockResolvedValueOnce('abc123')
        .mockResolvedValueOnce('def456');

      git.log
        .mockResolvedValueOnce([]) // 本地无 commits
        .mockResolvedValueOnce([]); // 远程无 commits

      const result = await gitManager.calculateAheadBehind('main');

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });

    it('所有 commits 都不同（完全分叉）', async () => {
      const localCommits = [
        { oid: 'local-1', commit: { message: 'local 1' } },
        { oid: 'local-2', commit: { message: 'local 2' } },
      ];

      const remoteCommits = [
        { oid: 'remote-1', commit: { message: 'remote 1' } },
        { oid: 'remote-2', commit: { message: 'remote 2' } },
        { oid: 'remote-3', commit: { message: 'remote 3' } },
      ];

      git.resolveRef
        .mockResolvedValueOnce('local-1')
        .mockResolvedValueOnce('remote-1');

      git.log
        .mockResolvedValueOnce(localCommits)
        .mockResolvedValueOnce(remoteCommits);

      const result = await gitManager.calculateAheadBehind('main');

      // 没有共同祖先，计算所有 commits
      expect(result.ahead).toBe(2);
      expect(result.behind).toBe(3);
    });
  });
});
