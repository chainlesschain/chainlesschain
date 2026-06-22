"""
Git管理器测试
"""
import os
import tempfile
import shutil
import pytest
from pathlib import Path
from git import Repo

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.git.git_manager import GitManager


class TestGitManager:
    """GitManager测试类"""

    @pytest.fixture
    def temp_repo(self):
        """创建临时Git仓库"""
        temp_dir = tempfile.mkdtemp()
        repo = Repo.init(temp_dir)

        # 创建初始文件并提交
        test_file = Path(temp_dir) / "test.txt"
        test_file.write_text("Initial content")
        repo.index.add(["test.txt"])
        repo.index.commit("Initial commit")

        yield temp_dir

        # 清理
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def git_manager(self):
        """GitManager实例"""
        return GitManager()

    def test_init_repo(self, git_manager):
        """测试初始化仓库"""
        temp_dir = tempfile.mkdtemp()
        try:
            result = git_manager.init_repo(temp_dir)

            assert result["success"] is True
            assert result["repo_path"] == temp_dir
            assert os.path.exists(os.path.join(temp_dir, ".git"))

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_get_status(self, git_manager, temp_repo):
        """测试获取状态"""
        # 修改文件
        test_file = Path(temp_repo) / "test.txt"
        test_file.write_text("Modified content")

        # 创建新文件
        new_file = Path(temp_repo) / "new.txt"
        new_file.write_text("New file")

        # get_status 返回 {branch, modified, staged, untracked, remotes, is_dirty}
        result = git_manager.get_status(temp_repo)

        assert "branch" in result
        assert "modified" in result
        assert "untracked" in result
        assert "new.txt" in result["untracked"]
        assert result["is_dirty"] is True

    @pytest.mark.asyncio
    async def test_commit_with_files(self, git_manager, temp_repo):
        """测试提交时暂存指定文件（commit 的 files 参数即为暂存机制）"""
        # 创建新文件
        new_file = Path(temp_repo) / "new.txt"
        new_file.write_text("New file content")

        # commit 接受 files 列表负责 staging（GitManager 无独立 add_files 方法）
        result = await git_manager.commit(
            temp_repo,
            message="Add new file",
            files=["new.txt"],
            auto_generate_message=False
        )

        assert result["success"] is True
        assert "commit_hash" in result

    @pytest.mark.asyncio
    async def test_commit(self, git_manager, temp_repo):
        """测试提交"""
        # 修改文件
        test_file = Path(temp_repo) / "test.txt"
        test_file.write_text("Modified content for commit")

        # 添加到暂存区
        repo = Repo(temp_repo)
        repo.index.add(["test.txt"])

        # 提交
        result = await git_manager.commit(
            temp_repo,
            message="Test commit",
            files=None,
            auto_generate_message=False
        )

        assert result["success"] is True
        assert "commit_hash" in result

    def test_get_log(self, git_manager, temp_repo):
        """测试获取日志"""
        result = git_manager.get_log(temp_repo, limit=10)

        assert isinstance(result, list)
        assert len(result) > 0
        assert "hash" in result[0]
        assert "message" in result[0]
        assert "author" in result[0]

    def test_get_diff(self, git_manager, temp_repo):
        """测试获取差异"""
        # 修改文件
        test_file = Path(temp_repo) / "test.txt"
        test_file.write_text("Modified for diff test")

        # get_diff 返回 {diff, message}
        result = git_manager.get_diff(temp_repo)

        assert "diff" in result
        assert "test.txt" in result["diff"]

    def test_list_branches(self, git_manager, temp_repo):
        """测试列出分支"""
        # list_branches 返回 {current, local, remote}
        result = git_manager.list_branches(temp_repo)

        assert "local" in result
        assert len(result["local"]) > 0
        assert "current" in result

    def test_create_branch(self, git_manager, temp_repo):
        """测试创建分支"""
        result = git_manager.create_branch(temp_repo, "test-branch")

        assert result["success"] is True
        assert result["branch_name"] == "test-branch"

    def test_checkout_branch(self, git_manager, temp_repo):
        """测试切换分支"""
        # 先创建分支
        git_manager.create_branch(temp_repo, "test-branch")

        # 切换到新分支 — checkout_branch 返回 {success, branch}
        result = git_manager.checkout_branch(temp_repo, "test-branch")

        assert result["success"] is True
        assert result["branch"] == "test-branch"

    def test_merge_branch(self, git_manager, temp_repo):
        """测试合并分支"""
        repo = Repo(temp_repo)

        # 创建新分支
        new_branch = repo.create_head("feature-branch")
        new_branch.checkout()

        # 在新分支上提交更改
        test_file = Path(temp_repo) / "feature.txt"
        test_file.write_text("Feature content")
        repo.index.add(["feature.txt"])
        repo.index.commit("Add feature")

        # 切换回主分支
        repo.heads.master.checkout()

        # 合并分支
        result = git_manager.merge_branch(temp_repo, "feature-branch")

        assert result["success"] is True
        assert Path(temp_repo).joinpath("feature.txt").exists()

    def test_merge_branch_invalid_path_raises_valueerror(self, git_manager):
        """merge_branch 对不存在的路径应抛 ValueError（与 create_branch/checkout_branch
        一致），而非 GitPython 内部的 NoSuchPathError。"""
        with pytest.raises(ValueError):
            git_manager.merge_branch("/no/such/repo/path-xyz-123", "feature")

    def test_merge_branch_non_git_dir_raises_valueerror(self, git_manager):
        """merge_branch 对非 Git 目录应抛 ValueError，而非 InvalidGitRepositoryError。"""
        temp_dir = tempfile.mkdtemp()
        try:
            with pytest.raises(ValueError):
                git_manager.merge_branch(temp_dir, "feature")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_push_no_remote(self, git_manager, temp_repo):
        """测试推送（无远程仓库）— push 捕获后重新抛出异常"""
        # 没有配置远程仓库时 push 会抛出异常（catch-log-reraise）
        with pytest.raises(Exception):
            git_manager.push(temp_repo, "origin", "master")

    def test_pull_no_remote(self, git_manager, temp_repo):
        """测试拉取（无远程仓库）— pull 捕获后重新抛出异常"""
        # 没有配置远程仓库时 pull 会抛出异常（catch-log-reraise）
        with pytest.raises(Exception):
            git_manager.pull(temp_repo, "origin", "master")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
