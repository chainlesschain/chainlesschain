"""
commit_message_generator 纯函数测试。

覆盖 build_commit_message_prompt（diff 截断 + 空值处理）与 extract_commit_message
（去引号 + 取首行 + 长度截断 + 空回退），此前无测试。复核未发现缺陷——防回归。
generate_commit_message 走真实 git Repo，不在此测。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.git.commit_message_generator import (
    build_commit_message_prompt,
    extract_commit_message,
)


class TestBuildPrompt:
    def test_includes_staged_files_and_diff(self):
        p = build_commit_message_prompt("diff --git a/x", ["x.py", "y.js"])
        assert "x.py, y.js" in p
        assert "diff --git a/x" in p

    def test_empty_files_and_diff_use_placeholders(self):
        p = build_commit_message_prompt("", [])
        assert "无" in p          # no staged files
        assert "无明显差异" in p   # no diff

    def test_truncates_long_diff(self):
        long_diff = "x" * 5000
        p = build_commit_message_prompt(long_diff, ["a"])
        assert "(diff truncated)" in p
        # original 5000-char diff must not appear in full
        assert "x" * 5000 not in p


class TestExtractCommitMessage:
    def test_plain_message(self):
        assert extract_commit_message("feat: add login") == "feat: add login"

    def test_strips_surrounding_quotes(self):
        assert extract_commit_message('"feat: quoted"') == "feat: quoted"
        assert extract_commit_message("'fix: single'") == "fix: single"

    def test_takes_first_line_only(self):
        assert extract_commit_message("feat: x\n\nbody text") == "feat: x"

    def test_caps_length_at_100(self):
        out = extract_commit_message("a" * 150)
        assert len(out) == 100

    def test_empty_falls_back_to_default(self):
        assert extract_commit_message("") == "Update files"
        assert extract_commit_message("   ") == "Update files"
