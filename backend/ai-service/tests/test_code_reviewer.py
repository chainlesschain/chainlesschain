"""
CodeReviewer 输出解析助手测试。

覆盖 _extract_score / _extract_suggestions / _extract_improved_code（从 LLM 审查
响应中解析评分/建议/改进代码），此前无测试。

回归（本次修复）：_extract_improved_code 此前在代码块<b>内</b>也把以 '##'/'【' 开头
的行当作 section 结束 → 改进代码里含 col-0 '## ...'（如 shell/Makefile/Markdown）会被
截断。修复后块内的 '##'/'【' 视为代码内容。

_extract_* 为纯方法，用 __new__ 绕过 __init__（其会构造 LLM 客户端）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.code.code_reviewer import CodeReviewer


def cr():
    return CodeReviewer.__new__(CodeReviewer)


class TestExtractScore:
    def test_chinese_and_english_patterns(self):
        assert cr()._extract_score("评分：7") == 7
        assert cr()._extract_score("总体 8分") == 8
        assert cr()._extract_score("Score: 9") == 9

    def test_default_when_no_match(self):
        assert cr()._extract_score("no numeric score here") == 5

    def test_clamps_to_1_10(self):
        assert cr()._extract_score("评分：100") == 10
        assert cr()._extract_score("评分：0") == 1


class TestExtractSuggestions:
    def test_numbered_and_dashed_items_with_priority(self):
        resp = "1. Fix the null deref [高]\n- minor style nit [低]\n2. medium thing"
        out = cr()._extract_suggestions(resp)
        assert len(out) == 3
        assert out[0]["priority"] == "high"
        assert out[1]["priority"] == "low"
        assert out[2]["priority"] == "medium"

    def test_empty_for_no_list(self):
        assert cr()._extract_suggestions("just prose, no list") == []


class TestExtractImprovedCode:
    def test_extracts_after_marker(self):
        resp = "改进代码:\n```\nfoo()\n```"
        assert cr()._extract_improved_code(resp) == "foo()"

    def test_none_without_marker(self):
        assert cr()._extract_improved_code("no improved section") is None

    def test_stops_at_next_section_outside_block(self):
        resp = "改进代码\n```\nx = 1\n```\n## Next Section\nignored()"
        assert cr()._extract_improved_code(resp) == "x = 1"

    def test_does_not_truncate_on_in_block_hash_lines(self):
        # Regression: a column-0 '## ...' inside the code block must NOT end capture.
        resp = "改进代码:\n```bash\n## setup section\necho hi\n```"
        out = cr()._extract_improved_code(resp)
        assert out == "## setup section\necho hi"
        assert "echo hi" in out


class TestParseReviewResult:
    def test_combines_score_suggestions_code(self):
        resp = (
            "评分：8\n"
            "1. tighten error handling [高]\n"
            "改进代码:\n```\nrun()\n```"
        )
        result = cr()._parse_review_result(resp)
        assert result["score"] == 8
        assert result["improved_code"] == "run()"
        assert len(result["suggestions"]) >= 1
        assert result["raw_review"] == resp
