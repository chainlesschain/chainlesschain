"""
web_templates 模板注册表 + 查找 + 结构完整性测试（先前零覆盖）。

src/templates/web_templates.py 是「无代码生成」回退用的 24 套静态网页模板，被
web_engine 经 get_template/has_template 取用。此前没有测试，意味着任何一套模板若
缺文件 / 内容为空 / index.html 引用了不存在的 css·js / 漏掉 UTF-8 charset（项目编码
铁律），都不会被发现。这里钉住：查找语义（大小写无关 + 别名 + 未知返 None）以及对
每一套模板逐一校验的结构完整性不变式（含未来新增模板）。

纯数据模块，无任何 import 依赖。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.templates.web_templates import (  # noqa: E402
    TEMPLATES,
    get_template,
    has_template,
)

# 去重：别名与规范名指向同一 dict（id 相同），每套模板只校验一次
_UNIQUE = {}
for _name, _tpl in TEMPLATES.items():
    _UNIQUE.setdefault(id(_tpl), (_name, _tpl))
UNIQUE_TEMPLATES = list(_UNIQUE.values())

REQUIRED_FILES = {"index.html", "script.js", "styles.css"}


# --------------------------------------------------------------------------- #
# get_template / has_template — 查找语义
# --------------------------------------------------------------------------- #
class TestLookup:
    def test_known_name_returns_dict(self):
        tpl = get_template("todo")
        assert isinstance(tpl, dict)
        assert "index.html" in tpl

    def test_lookup_is_case_insensitive(self):
        assert get_template("TODO") is get_template("todo")
        assert has_template("ToDo") is True

    def test_alias_maps_to_same_template(self):
        # 同义别名应解析到同一模板对象
        assert get_template("calc") is get_template("calculator")
        assert get_template("notes") is get_template("note")
        assert get_template("schedule") is get_template("calendar")

    def test_unknown_name_returns_none_and_false(self):
        assert get_template("does-not-exist") is None
        assert has_template("does-not-exist") is False

    def test_has_template_true_for_every_registered_key(self):
        for name in TEMPLATES:
            assert has_template(name) is True


# --------------------------------------------------------------------------- #
# 结构完整性 — 对每套唯一模板逐一校验
# --------------------------------------------------------------------------- #
class TestTemplateIntegrity:
    def test_registry_not_empty(self):
        assert len(UNIQUE_TEMPLATES) >= 20

    @pytest.mark.parametrize(
        "name,tpl", UNIQUE_TEMPLATES, ids=[n for n, _ in UNIQUE_TEMPLATES]
    )
    def test_has_exactly_required_files(self, name, tpl):
        assert set(tpl.keys()) == REQUIRED_FILES

    @pytest.mark.parametrize(
        "name,tpl", UNIQUE_TEMPLATES, ids=[n for n, _ in UNIQUE_TEMPLATES]
    )
    def test_all_files_are_nonempty_strings(self, name, tpl):
        for fname, content in tpl.items():
            assert isinstance(content, str), f"{name}/{fname} 非字符串"
            assert content.strip(), f"{name}/{fname} 为空"

    @pytest.mark.parametrize(
        "name,tpl", UNIQUE_TEMPLATES, ids=[n for n, _ in UNIQUE_TEMPLATES]
    )
    def test_index_html_references_its_css_and_js(self, name, tpl):
        # index.html 必须引用它自带的 styles.css / script.js，否则浏览器 404
        html = tpl["index.html"]
        assert "styles.css" in html, f"{name} 未引用 styles.css"
        assert "script.js" in html, f"{name} 未引用 script.js"

    @pytest.mark.parametrize(
        "name,tpl", UNIQUE_TEMPLATES, ids=[n for n, _ in UNIQUE_TEMPLATES]
    )
    def test_index_html_declares_utf8_and_doctype(self, name, tpl):
        # 编码铁律：生成的 HTML 必须声明 UTF-8 charset
        html = tpl["index.html"].lower()
        assert 'charset="utf-8"' in html or "charset=utf-8" in html, f"{name} 缺 UTF-8"
        assert "<!doctype html>" in html, f"{name} 缺 DOCTYPE"
