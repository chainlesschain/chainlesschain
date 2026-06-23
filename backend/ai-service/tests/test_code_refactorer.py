"""
CodeRefactorer 输出解析助手测试。

覆盖从 LLM 响应中提取代码/说明/分析的纯字符串解析逻辑，此前无测试。复核未发现
缺陷——本套件为防回归（与已验证的 code_generator._extract_code 同款围栏切换模式）。

_extract_* 为纯方法、不用 self，用 __new__ 绕过 __init__（其会构造 LLM 客户端）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.code.code_refactorer import CodeRefactorer


def r():
    return CodeRefactorer.__new__(CodeRefactorer)


class TestExtractAnyCode:
    def test_extracts_fenced_block(self):
        assert r()._extract_any_code("```py\nx = 1\n```") == "x = 1"

    def test_concatenates_multiple_blocks(self):
        out = r()._extract_any_code("```\na\n```\ntext\n```\nb\n```")
        assert out == "a\nb"

    def test_falls_back_to_stripped_response_when_no_fence(self):
        assert r()._extract_any_code("  no code here  ") == "no code here"


class TestExtractCode:
    def test_extracts_after_refactored_marker(self):
        resp = "重构后:\n```\nfoo()\n```"
        assert r()._extract_code(resp) == "foo()"

    def test_english_marker(self):
        resp = "Refactored version:\n```\nbar()\n```"
        assert r()._extract_code(resp) == "bar()"

    def test_falls_back_to_any_code_without_marker(self):
        assert r()._extract_code("```\nbaz()\n```") == "baz()"

    def test_falls_back_to_response_when_no_code(self):
        assert r()._extract_code("just prose") == "just prose"


class TestExtractExplanation:
    def test_extracts_after_marker_until_fence(self):
        resp = "变更说明:\nimproved naming\nmore detail\n```\ncode"
        assert r()._extract_explanation(resp) == "improved naming\nmore detail"

    def test_stops_at_section_bracket(self):
        resp = "Explanation\nshort note\n【next section】"
        assert r()._extract_explanation(resp) == "short note"

    def test_stops_at_indented_section_bracket(self):
        # 缩进的 section 头也应终止说明提取（旧实现只 strip 了 ``` 分支、
        # 用裸 line 判 【 → 缩进标记漏判、被并入说明）
        resp = "Explanation\nshort note\n  【next section】"
        assert r()._extract_explanation(resp) == "short note"

    def test_default_when_no_marker(self):
        assert r()._extract_explanation("no marker here") == "代码已重构"


class TestExtractBugAnalysis:
    def test_extracts_after_marker(self):
        resp = "问题分析\nnull dereference\n【修复】"
        assert r()._extract_bug_analysis(resp) == "null dereference"

    def test_english_marker(self):
        resp = "Analysis\nrace condition\n```\nfix"
        assert r()._extract_bug_analysis(resp) == "race condition"

    def test_stops_at_indented_section_bracket(self):
        # 同 explanation：缩进的 section 头也应终止提取（旧实现裸 line 判 【 漏判）
        resp = "问题分析\nnull dereference\n  【修复】"
        assert r()._extract_bug_analysis(resp) == "null dereference"

    def test_default_when_no_marker(self):
        assert r()._extract_bug_analysis("nothing relevant") == "已分析问题"
