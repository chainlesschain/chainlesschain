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

    def test_parse_conflict_markers_incomplete_skipped(self, conflict_resolver):
        """不完整冲突（缺少闭合 >>>>>>>）应被跳过，不产生缺 end_line 的冲突块。

        回归：此前会 append 一个没有 end_line/incoming_branch 的冲突块，
        导致 resolve_conflicts 在 conflict['end_line'] 处 KeyError 崩溃。
        """
        incomplete = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\nb\n"  # 无 >>>>>>>
        conflicts = conflict_resolver.parse_conflict_markers(incomplete)
        assert conflicts == []

    def test_parse_conflict_markers_all_have_end_line(
        self, conflict_resolver, conflict_content, complex_conflict_content
    ):
        """所有返回的冲突块都必须含 end_line + incoming_branch（resolve 依赖之）。"""
        for content in (conflict_content, complex_conflict_content):
            for c in conflict_resolver.parse_conflict_markers(content):
                assert "end_line" in c
                assert "incoming_branch" in c

    @pytest.mark.asyncio
    async def test_resolve_file_with_incomplete_marker_does_not_crash(
        self, conflict_resolver, tmp_path
    ):
        """对含「不完整/伪冲突标记」的文件解析+解决不应崩溃（视为无可解决冲突）。"""
        f = tmp_path / "doc.md"
        # 文档里出现 <<<<<<< 文本但没有完整冲突结构（常见于讲解 git 的文档/源码）。
        f.write_text("# About git\nUse <<<<<<< to mark conflicts.\n", encoding="utf-8")
        result = await conflict_resolver.resolve_file_conflicts(
            str(f), strategy="accept_current"
        )
        assert result.get("conflicts_count", 0) == 0

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

    # ── AI-driven analyze_conflict path (uses the LLM client's chat()) ──

    @pytest.mark.asyncio
    async def test_analyze_conflict_uses_chat_and_parses_json(self, conflict_resolver):
        """analyze_conflict 必须调用 LLM 客户端的 chat()（返回字符串）并解析其 JSON。
        此前误调用不存在的 chat_completion() → AttributeError 被吞 → 永远退回启发式。"""
        calls = {}

        class FakeLlm:
            async def chat(self, messages, temperature=0.7, max_tokens=2048):
                calls["messages"] = messages
                calls["temperature"] = temperature
                return (
                    '{"analysis": "ok", "strategy": "merge_both", '
                    '"resolved_content": "merged code", "risks": [], "confidence": 0.9}'
                )

        conflict_resolver.llm_client = FakeLlm()
        conflict = {
            "current_content": ["a = 1"],
            "incoming_content": ["a = 2"],
        }
        result = await conflict_resolver.analyze_conflict(conflict, "f.py")

        assert calls, "chat() must be called"
        assert calls["temperature"] == 0.3
        assert result["strategy"] == "merge_both"
        assert result["resolved_content"] == "merged code"

    @pytest.mark.asyncio
    async def test_analyze_conflict_parses_markdown_fenced_json(self, conflict_resolver):
        """chat() 返回 ```json 包裹的内容时也应正确解析。"""

        class FakeLlm:
            async def chat(self, messages, temperature=0.7, max_tokens=2048):
                return (
                    "分析如下:\n```json\n"
                    '{"analysis": "x", "strategy": "accept_current", '
                    '"resolved_content": "kept current", "risks": [], "confidence": 0.8}'
                    "\n```\n"
                )

        conflict_resolver.llm_client = FakeLlm()
        conflict = {"current_content": ["x"], "incoming_content": ["y"]}
        result = await conflict_resolver.analyze_conflict(conflict, "f.py")

        assert result["strategy"] == "accept_current"
        assert result["resolved_content"] == "kept current"

    @pytest.mark.asyncio
    async def test_analyze_conflict_falls_back_to_heuristic_on_client_error(self, conflict_resolver):
        """chat() 抛错时应被捕获并退回启发式（incoming 为空 → accept_current）。"""

        class BoomLlm:
            async def chat(self, messages, temperature=0.7, max_tokens=2048):
                raise RuntimeError("network down")

        conflict_resolver.llm_client = BoomLlm()
        conflict = {"current_content": ["keep me"], "incoming_content": [""]}
        result = await conflict_resolver.analyze_conflict(conflict, "f.py")

        assert result["strategy"] == "accept_current"
        assert "keep me" in result["resolved_content"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
