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

        result = git_manager.get_status(temp_repo)

        assert result["success"] is True
        assert "modified" in result or "untracked" in result

    def test_add_files(self, git_manager, temp_repo):
        """测试添加文件到暂存区"""
        # 创建新文件
        new_file = Path(temp_repo) / "new.txt"
        new_file.write_text("New file content")

        result = git_manager.add_files(temp_repo, ["new.txt"])

        assert result["success"] is True
        assert result["files_added"] == 1

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
        assert "commit_sha" in result

    def test_get_log(self, git_manager, temp_repo):
        """测试获取日志"""
        result = git_manager.get_log(temp_repo, limit=10)

        assert isinstance(result, list)
        assert len(result) > 0
        assert "sha" in result[0]
        assert "message" in result[0]
        assert "author" in result[0]

    def test_get_diff(self, git_manager, temp_repo):
        """测试获取差异"""
        # 修改文件
        test_file = Path(temp_repo) / "test.txt"
        test_file.write_text("Modified for diff test")

        result = git_manager.get_diff(temp_repo)

        assert result["success"] is True
        assert "diff" in result
        assert "test.txt" in result["diff"]

    def test_list_branches(self, git_manager, temp_repo):
        """测试列出分支"""
        result = git_manager.list_branches(temp_repo)

        assert result["success"] is True
        assert "branches" in result
        assert len(result["branches"]) > 0
        assert "current_branch" in result

    def test_create_branch(self, git_manager, temp_repo):
        """测试创建分支"""
        result = git_manager.create_branch(temp_repo, "test-branch")

        assert result["success"] is True
        assert result["branch_name"] == "test-branch"

    def test_checkout_branch(self, git_manager, temp_repo):
        """测试切换分支"""
        # 先创建分支
        git_manager.create_branch(temp_repo, "test-branch")

        # 切换到新分支
        result = git_manager.checkout_branch(temp_repo, "test-branch")

        assert result["success"] is True
        assert result["branch_name"] == "test-branch"

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

    def test_push_no_remote(self, git_manager, temp_repo):
        """测试推送（无远程仓库）"""
        # 没有配置远程仓库时应该失败
        result = git_manager.push(temp_repo, "origin", "master")

        assert result["success"] is False
        assert "error" in result

    def test_pull_no_remote(self, git_manager, temp_repo):
        """测试拉取（无远程仓库）"""
        # 没有配置远程仓库时应该失败
        result = git_manager.pull(temp_repo, "origin", "master")

        assert result["success"] is False
        assert "error" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
