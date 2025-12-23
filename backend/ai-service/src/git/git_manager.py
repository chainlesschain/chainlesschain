"""
Git操作管理器
使用GitPython库进行Git操作
"""
import os
from typing import List, Optional, Dict, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

try:
    from git import Repo, GitCommandError
    GIT_AVAILABLE = True
except ImportError:
    logger.warning("GitPython未安装，Git功能将不可用")
    GIT_AVAILABLE = False


class GitManager:
    """Git操作管理器"""

    def __init__(self):
        if not GIT_AVAILABLE:
            raise RuntimeError("GitPython未安装，请运行: pip install GitPython")

    def init_repo(self, repo_path: str, remote_url: Optional[str] = None, branch_name: str = "main") -> Dict[str, Any]:
        """
        初始化Git仓库

        Args:
            repo_path: 仓库路径
            remote_url: 远程仓库URL（可选）
            branch_name: 默认分支名

        Returns:
            包含成功状态和仓库信息的字典
        """
        try:
            path = Path(repo_path)
            path.mkdir(parents=True, exist_ok=True)

            repo = Repo.init(repo_path, initial_branch=branch_name)

            if remote_url:
                try:
                    repo.create_remote('origin', remote_url)
                except Exception as e:
                    logger.warning(f"添加远程仓库失败: {e}")

            logger.info(f"Git仓库初始化成功: {repo_path}")

            return {
                "success": True,
                "repo_path": repo_path,
                "branch": branch_name,
                "remote_url": remote_url
            }

        except Exception as e:
            logger.error(f"初始化Git仓库失败: {e}")
            raise

    def get_status(self, repo_path: str) -> Dict[str, Any]:
        """
        获取Git仓库状态

        Args:
            repo_path: 仓库路径

        Returns:
            包含仓库状态的字典
        """
        try:
            repo = Repo(repo_path)

            # 获取当前分支
            current_branch = repo.active_branch.name if not repo.head.is_detached else "HEAD"

            # 获取修改的文件
            modified_files = [item.a_path for item in repo.index.diff(None)]

            # 获取暂存的文件
            staged_files = [item.a_path for item in repo.index.diff("HEAD")] if repo.head.is_valid() else []

            # 获取未跟踪的文件
            untracked_files = repo.untracked_files

            # 检查是否有远程仓库
            remotes = {remote.name: remote.url for remote in repo.remotes}

            return {
                "branch": current_branch,
                "modified": modified_files,
                "staged": staged_files,
                "untracked": untracked_files,
                "remotes": remotes,
                "is_dirty": repo.is_dirty()
            }

        except Exception as e:
            logger.error(f"获取Git状态失败: {e}")
            raise

    async def commit(
        self,
        repo_path: str,
        message: Optional[str] = None,
        files: Optional[List[str]] = None,
        auto_generate_message: bool = False
    ) -> Dict[str, Any]:
        """
        提交更改

        Args:
            repo_path: 仓库路径
            message: 提交消息
            files: 要提交的文件列表（None表示全部）
            auto_generate_message: 是否自动生成提交消息

        Returns:
            包含提交信息的字典
        """
        try:
            repo = Repo(repo_path)

            # 添加文件到暂存区
            if files:
                repo.index.add(files)
            else:
                repo.git.add(A=True)  # 添加所有文件

            # 生成提交消息（如果需要）
            if auto_generate_message and not message:
                from .commit_message_generator import generate_commit_message
                message = await generate_commit_message(repo)

            if not message:
                message = "Update files"  # 默认消息

            # 提交
            commit = repo.index.commit(message)

            logger.info(f"Git提交成功: {commit.hexsha[:8]}")

            return {
                "success": True,
                "commit_hash": commit.hexsha,
                "short_hash": commit.hexsha[:8],
                "message": message,
                "author": str(commit.author),
                "committed_date": commit.committed_datetime.isoformat()
            }

        except Exception as e:
            logger.error(f"Git提交失败: {e}")
            raise

    def push(self, repo_path: str, remote: str = "origin", branch: Optional[str] = None) -> Dict[str, Any]:
        """
        推送到远程仓库

        Args:
            repo_path: 仓库路径
            remote: 远程仓库名称
            branch: 分支名（None表示当前分支）

        Returns:
            包含推送结果的字典
        """
        try:
            repo = Repo(repo_path)

            if branch is None:
                branch = repo.active_branch.name

            # 推送
            remote_repo = repo.remote(remote)
            push_info = remote_repo.push(branch)

            logger.info(f"Git推送成功: {remote}/{branch}")

            return {
                "success": True,
                "remote": remote,
                "branch": branch,
                "summary": str(push_info[0].summary) if push_info else "No changes"
            }

        except Exception as e:
            logger.error(f"Git推送失败: {e}")
            raise

    def pull(self, repo_path: str, remote: str = "origin", branch: Optional[str] = None) -> Dict[str, Any]:
        """
        从远程仓库拉取

        Args:
            repo_path: 仓库路径
            remote: 远程仓库名称
            branch: 分支名（None表示当前分支）

        Returns:
            包含拉取结果的字典
        """
        try:
            repo = Repo(repo_path)

            if branch is None:
                branch = repo.active_branch.name

            # 拉取
            remote_repo = repo.remote(remote)
            pull_info = remote_repo.pull(branch)

            logger.info(f"Git拉取成功: {remote}/{branch}")

            return {
                "success": True,
                "remote": remote,
                "branch": branch,
                "summary": str(pull_info[0]) if pull_info else "Already up to date"
            }

        except Exception as e:
            logger.error(f"Git拉取失败: {e}")
            raise

    def get_log(self, repo_path: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        获取提交历史

        Args:
            repo_path: 仓库路径
            limit: 返回的提交数量

        Returns:
            提交历史列表
        """
        try:
            repo = Repo(repo_path)

            commits = []
            for commit in repo.iter_commits(max_count=limit):
                commits.append({
                    "hash": commit.hexsha,
                    "short_hash": commit.hexsha[:8],
                    "message": commit.message.strip(),
                    "author": str(commit.author),
                    "email": commit.author.email,
                    "date": commit.committed_datetime.isoformat(),
                    "parents": [p.hexsha for p in commit.parents]
                })

            return commits

        except Exception as e:
            logger.error(f"获取Git日志失败: {e}")
            raise

    def get_diff(self, repo_path: str, commit1: Optional[str] = None, commit2: Optional[str] = None) -> Dict[str, Any]:
        """
        获取差异

        Args:
            repo_path: 仓库路径
            commit1: 第一个提交（None表示工作区）
            commit2: 第二个提交（None表示HEAD）

        Returns:
            包含差异信息的字典
        """
        try:
            repo = Repo(repo_path)

            if commit1 and commit2:
                # 两个提交之间的差异
                diff = repo.git.diff(commit1, commit2)
            elif commit1:
                # 提交与HEAD的差异
                diff = repo.git.diff(commit1, "HEAD")
            else:
                # 工作区与HEAD的差异
                diff = repo.git.diff("HEAD")

            return {
                "diff": diff,
                "commit1": commit1,
                "commit2": commit2
            }

        except Exception as e:
            logger.error(f"获取Git差异失败: {e}")
            raise

    def list_branches(self, repo_path: str) -> Dict[str, Any]:
        """
        列出所有分支

        Args:
            repo_path: 仓库路径

        Returns:
            包含分支信息的字典
        """
        try:
            repo = Repo(repo_path)

            current_branch = repo.active_branch.name if not repo.head.is_detached else None

            branches = {
                "current": current_branch,
                "local": [branch.name for branch in repo.branches],
                "remote": [ref.name for ref in repo.remote().refs] if repo.remotes else []
            }

            return branches

        except Exception as e:
            logger.error(f"列出Git分支失败: {e}")
            raise

    def create_branch(self, repo_path: str, branch_name: str, from_branch: Optional[str] = None) -> Dict[str, Any]:
        """
        创建新分支

        Args:
            repo_path: 仓库路径
            branch_name: 新分支名称
            from_branch: 基于哪个分支创建（None表示当前分支）

        Returns:
            包含创建结果的字典
        """
        try:
            repo = Repo(repo_path)

            if from_branch:
                base = repo.branches[from_branch]
                new_branch = repo.create_head(branch_name, base)
            else:
                new_branch = repo.create_head(branch_name)

            logger.info(f"创建分支成功: {branch_name}")

            return {
                "success": True,
                "branch_name": branch_name,
                "from_branch": from_branch or repo.active_branch.name
            }

        except Exception as e:
            logger.error(f"创建Git分支失败: {e}")
            raise

    def checkout_branch(self, repo_path: str, branch_name: str) -> Dict[str, Any]:
        """
        切换分支

        Args:
            repo_path: 仓库路径
            branch_name: 要切换到的分支名称

        Returns:
            包含切换结果的字典
        """
        try:
            repo = Repo(repo_path)

            repo.git.checkout(branch_name)

            logger.info(f"切换到分支: {branch_name}")

            return {
                "success": True,
                "branch": branch_name
            }

        except Exception as e:
            logger.error(f"切换Git分支失败: {e}")
            raise

    def merge_branch(self, repo_path: str, source_branch: str, target_branch: Optional[str] = None) -> Dict[str, Any]:
        """
        合并分支

        Args:
            repo_path: 仓库路径
            source_branch: 源分支
            target_branch: 目标分支（None表示当前分支）

        Returns:
            包含合并结果的字典
        """
        try:
            repo = Repo(repo_path)

            if target_branch:
                repo.git.checkout(target_branch)

            merge_result = repo.git.merge(source_branch)

            logger.info(f"合并分支成功: {source_branch} -> {target_branch or 'current'}")

            return {
                "success": True,
                "source_branch": source_branch,
                "target_branch": target_branch or repo.active_branch.name,
                "result": merge_result
            }

        except GitCommandError as e:
            if "CONFLICT" in str(e):
                logger.warning(f"合并冲突: {e}")
                return {
                    "success": False,
                    "has_conflicts": True,
                    "message": "Merge conflict detected",
                    "error": str(e)
                }
            else:
                raise

        except Exception as e:
            logger.error(f"合并Git分支失败: {e}")
            raise
