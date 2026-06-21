"""
意图分类器 _parse_response 健壮性测试。

回归 #5：LLM 可能返回「合法 JSON 但非对象」（字符串/数字/布尔/null，或数组里非
dict 的元素）。此前字段校验直接 `field not in result` / `result[field]=...` 会抛
TypeError（且在 except json.JSONDecodeError 之外，崩溃不可恢复）。现统一回退默认意图。
同时校验内嵌 JSON 提取路径只采用 dict 并补齐字段。

_parse_response 为纯函数，用 __new__ 绕过 __init__（其会构造 LLM client）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.nlu.intent_classifier import IntentClassifier

REQUIRED = ["intent", "project_type", "entities", "confidence", "action"]


def make_classifier():
    # _parse_response 只用 self._get_default_intent / _get_default_value（纯方法），
    # 跳过 __init__ 以免触发 LLM 客户端/网络。
    return IntentClassifier.__new__(IntentClassifier)


class TestParseResponseRobustness:
    def test_valid_object(self):
        ic = make_classifier()
        r = ic._parse_response(
            '{"intent":"create_project","project_type":"web",'
            '"entities":{},"confidence":0.9,"action":"generate_file"}'
        )
        assert isinstance(r, dict)
        assert r["intent"] == "create_project"

    def test_object_missing_fields_gets_defaults(self):
        ic = make_classifier()
        r = ic._parse_response('{"intent":"x"}')
        assert isinstance(r, dict)
        for f in REQUIRED:
            assert f in r

    def test_bare_string_does_not_crash(self):
        ic = make_classifier()
        r = ic._parse_response('"hello"')
        assert isinstance(r, dict)
        assert "intent" in r

    def test_bare_number_bool_null_do_not_crash(self):
        ic = make_classifier()
        for bad in ["42", "true", "null"]:
            r = ic._parse_response(bad)
            assert isinstance(r, dict), f"input {bad!r} should yield a dict"
            assert "intent" in r

    def test_list_of_non_dict_does_not_crash(self):
        ic = make_classifier()
        r = ic._parse_response("[1, 2, 3]")
        assert isinstance(r, dict)
        assert "intent" in r

    def test_list_with_object_takes_first(self):
        ic = make_classifier()
        r = ic._parse_response(
            '[{"intent":"a","project_type":"web","entities":{},'
            '"confidence":0.5,"action":"generate_file"}]'
        )
        assert isinstance(r, dict)
        assert r["intent"] == "a"

    def test_empty_list_returns_default(self):
        ic = make_classifier()
        r = ic._parse_response("[]")
        assert isinstance(r, dict)
        assert "intent" in r

    def test_embedded_json_extracted_and_defaulted(self):
        ic = make_classifier()
        r = ic._parse_response(
            'Sure! {"intent":"chat"} done'  # missing fields → defaults filled
        )
        assert isinstance(r, dict)
        assert r["intent"] == "chat"
        for f in REQUIRED:
            assert f in r

    def test_unparseable_falls_back_to_default(self):
        ic = make_classifier()
        r = ic._parse_response("not json at all")
        assert isinstance(r, dict)
        assert r["intent"] == "create_project"  # final hard-coded default
