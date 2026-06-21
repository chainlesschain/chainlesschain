"""
IntentClassifier rule-based / quick-classify tests (live no-LLM path).

classify() calls _rule_based_classify() before any LLM, so these heuristics
decide many classifications. Previously untested. No code change made.

DOCUMENTED CONTRACT (surfaced by these tests, not a fix): _rule_based_classify
returns on the FIRST matching keyword pattern and does NOT use the per-pattern
confidence scores — and _quick_classify hardcodes confidence 0.95 — so the
pattern confidences are currently unused and selection is order-biased (the
first project_type in the dict, "web", wins on overlapping keywords). If that's
ever intended to be confidence-ranked instead, update both the code and the
`test_overlap_is_first_match_web_biased` expectation deliberately.

Pure methods; __new__ bypasses __init__ (which builds an LLM client).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.nlu.intent_classifier import IntentClassifier


def ic():
    return IntentClassifier.__new__(IntentClassifier)


class TestQuickClassify:
    def test_web_theme_and_template_extraction(self):
        r = ic()._quick_classify("做一个深色的计算器", "web")
        assert r["project_type"] == "web"
        assert r["intent"] == "create_project"
        assert r["action"] == "generate_file"
        assert r["fast_path"] is True
        assert r["entities"].get("theme") == "dark"
        assert r["entities"].get("template") == "calculator"

    def test_returns_complete_result_with_no_entities(self):
        r = ic()._quick_classify("随便写点东西", "web")
        assert set(["intent", "project_type", "entities", "confidence", "action"]) <= set(r)
        assert isinstance(r["entities"], dict)
        assert r["confidence"] == 0.95


class TestRuleBasedClassify:
    def test_matches_clear_web_keyword(self):
        r = ic()._rule_based_classify("帮我做一个网站")
        assert r is not None
        assert r["project_type"] == "web"

    def test_matches_clear_document_keyword(self):
        r = ic()._rule_based_classify("写一份工作报告")
        assert r is not None
        assert r["project_type"] == "document"

    def test_returns_none_when_no_pattern_matches(self):
        assert ic()._rule_based_classify("zzz completely unrelated 文本") is None

    def test_overlap_is_first_match_web_biased(self):
        # "游戏" (web, 0.80) is checked before "月报" (document, 0.95). The current
        # implementation returns the first match and ignores confidence, so this
        # classifies as web. Pinning the contract: if confidence-ranking is later
        # adopted, this expectation must change consciously.
        r = ic()._rule_based_classify("游戏月报")
        assert r["project_type"] == "web"
