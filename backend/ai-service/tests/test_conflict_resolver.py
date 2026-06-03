"""
冲突解决器测试
"""
import os
import tempfile
import pytest
from pathlib import Path

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.git.conflict_resolver import ConflictResolver


class TestConflictResolver:
    """ConflictResolver测试类"""

    @pytest.fixture
    def conflict_resolver(self):
        """ConflictResolver实例"""
        return ConflictResolver()

    @pytest.fixture
    def conflict_content(self):
        """包含冲突标记的内容"""
        return """def hello():
<<<<<<< HEAD
    print("Hello from current branch")
    return "current"
=======
    print("Hello from incoming branch")
    return "incoming"
>>>>>>> feature-branch
    print("End of function")
"""

    @pytest.fixture
    def complex_conflict_content(self):
        """复杂冲突（带base版本）"""
        return """class Example:
<<<<<<< HEAD
    def method1(self):
        return "current version"
||||||| base
    def method1(self):
        return "original"
=======
    def method1(self):
        return "incoming version"
>>>>>>> feature
    def method2(self):
        return "unchanged"
"""

    def test_parse_conflict_markers_simple(self, conflict_resolver, conflict_content):
        """测试解析简单冲突标记"""
        conflicts = conflict_resolver.parse_conflict_markers(conflict_content)

        assert len(conflicts) == 1
        conflict = conflicts[0]

        assert "current_branch" in conflict
        assert "incoming_branch" in conflict
        assert len(conflict["current_content"]) == 2
        assert len(conflict["incoming_content"]) == 2

    def test_parse_conflict_markers_with_base(self, conflict_resolver, complex_conflict_content):
        """测试解析带base版本的冲突"""
        conflicts = conflict_resolver.parse_conflict_markers(complex_conflict_content)

        assert len(conflicts) == 1
        conflict = conflicts[0]

        assert len(conflict["base_content"]) == 2
        assert "original" in '\n'.join(conflict["base_content"])

    def test_heuristic_resolve_empty_current(self, conflict_resolver):
        """测试启发式解决（当前分支为空）"""
        conflict = {
            "current_content": [],
            "incoming_content": ["some code"],
            "base_content": []
        }

        result = conflict_resolver._heuristic_resolve(conflict, "test.py")

        assert result["strategy"] == "accept_incoming"
        assert result["confidence"] == 0.95
        assert "some code" in result["resolved_content"]

    def test_heuristic_resolve_empty_incoming(self, conflict_resolver):
        """测试启发式解决（incoming分支为空）"""
        conflict = {
            "current_content": ["some code"],
            "incoming_content": [],
            "base_content": []
        }

        result = conflict_resolver._heuristic_resolve(conflict, "test.py")

        assert result["strategy"] == "accept_current"
        assert result["confidence"] == 0.95

    def test_heuristic_resolve_identical(self, conflict_resolver):
        """测试启发式解决（内容相同）"""
        conflict = {
            "current_content": ["identical code"],
            "incoming_content": ["identical code"],
            "base_content": []
        }

        result = conflict_resolver._heuristic_resolve(conflict, "test.py")

        assert result["strategy"] == "accept_current"
        assert result["confidence"] == 1.0

    def test_heuristic_resolve_both(self, conflict_resolver):
        """测试启发式解决（保留both）"""
        conflict = {
            "current_content": ["current code"],
            "incoming_content": ["incoming code"],
            "base_content": []
        }

        result = conflict_resolver._heuristic_resolve(conflict, "test.py")

        assert result["strategy"] == "merge_both"
        assert "current code" in result["resolved_content"]
        assert "incoming code" in result["resolved_content"]

    @pytest.mark.asyncio
    async def test_resolve_file_conflicts_with_strategy(self, conflict_resolver, conflict_content):
        """测试解决文件冲突（使用策略）"""
        # 创建临时文件
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write(conflict_content)
            temp_file = f.name

        try:
            # 使用accept_current策略
            result = await conflict_resolver.resolve_file_conflicts(
                temp_file,
                auto_resolve=False,
                strategy="accept_current"
            )

            assert result["success"] is True
            assert result["conflicts_count"] == 1
            assert len(result["resolutions"]) == 1
            assert result["resolutions"][0]["strategy"] == "accept_current"
            assert "current branch" in result["resolved_content"].lower()

        finally:
            os.unlink(temp_file)

    @pytest.mark.asyncio
    async def test_resolve_file_conflicts_accept_incoming(self, conflict_resolver, conflict_content):
        """测试解决文件冲突（接受incoming）"""
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write(conflict_content)
            temp_file = f.name

        try:
            result = await conflict_resolver.resolve_file_conflicts(
                temp_file,
                auto_resolve=False,
                strategy="accept_incoming"
            )

            assert result["success"] is True
            assert "incoming branch" in result["resolved_content"].lower()

        finally:
            os.unlink(temp_file)

    @pytest.mark.asyncio
    async def test_resolve_file_conflicts_merge_both(self, conflict_resolver, conflict_content):
        """测试解决文件冲突（合并both）"""
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write(conflict_content)
            temp_file = f.name

        try:
            result = await conflict_resolver.resolve_file_conflicts(
                temp_file,
                auto_resolve=False,
                strategy="merge_both"
            )

            assert result["success"] is True
            resolved = result["resolved_content"]
            assert "current branch" in resolved.lower()
            assert "incoming branch" in resolved.lower()

        finally:
            os.unlink(temp_file)

    @pytest.mark.asyncio
    async def test_resolve_file_no_conflicts(self, conflict_resolver):
        """测试解决无冲突文件"""
        content = "def hello():\n    print('Hello')\n"

        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write(content)
            temp_file = f.name

        try:
            result = await conflict_resolver.resolve_file_conflicts(temp_file)

            assert result["success"] is True
            assert result["message"] == "文件无冲突"
            assert result["conflicts_count"] == 0

        finally:
            os.unlink(temp_file)

    @pytest.mark.asyncio
    async def test_resolve_file_auto_resolve(self, conflict_resolver, conflict_content):
        """测试自动应用解决方案"""
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.py') as f:
            f.write(conflict_content)
            temp_file = f.name

        try:
            result = await conflict_resolver.resolve_file_conflicts(
                temp_file,
                auto_resolve=True,
                strategy="accept_current"
            )

            assert result["success"] is True
            assert result["auto_applied"] is True

            # 验证文件已被修改
            with open(temp_file, 'r') as f:
                new_content = f.read()
                assert '<<<<<<<' not in new_content  # 冲突标记应被移除
                assert "current branch" in new_content.lower()

        finally:
            os.unlink(temp_file)

    def test_apply_strategy_accept_current(self, conflict_resolver):
        """测试应用策略：accept_current"""
        conflict = {
            "current_content": ["line1", "line2"],
            "incoming_content": ["line3", "line4"]
        }

        result = conflict_resolver._apply_strategy(conflict, "accept_current")

        assert result["strategy"] == "accept_current"
        assert result["resolved_content"] == "line1\nline2"

    def test_apply_strategy_accept_incoming(self, conflict_resolver):
        """测试应用策略：accept_incoming"""
        conflict = {
            "current_content": ["line1", "line2"],
            "incoming_content": ["line3", "line4"]
        }

        result = conflict_resolver._apply_strategy(conflict, "accept_incoming")

        assert result["strategy"] == "accept_incoming"
        assert result["resolved_content"] == "line3\nline4"

    def test_apply_strategy_merge_both(self, conflict_resolver):
        """测试应用策略：merge_both"""
        conflict = {
            "current_content": ["current_line"],
            "incoming_content": ["incoming_line"]
        }

        result = conflict_resolver._apply_strategy(conflict, "merge_both")

        assert result["strategy"] == "merge_both"
        assert "current_line" in result["resolved_content"]
        assert "incoming_line" in result["resolved_content"]

    def test_apply_strategy_invalid(self, conflict_resolver):
        """测试应用无效策略"""
        conflict = {
            "current_content": ["line1"],
            "incoming_content": ["line2"]
        }

        with pytest.raises(ValueError, match="未知策略"):
            conflict_resolver._apply_strategy(conflict, "invalid_strategy")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
