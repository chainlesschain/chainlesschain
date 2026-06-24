"""Tests for strip_code_fences (used by WebEngine to clean LLM HTML/CSS output).

Regression: the old inline cleanup ``text.replace("```html", "").replace("```", "")``
only matched the lowercase literal ```html / ```css, so any other tag
(```HTML, ```xml, bare ```, single-line) leaked the tag text into the rendered
page, and it also stripped legitimate inner ``` fences inside the content.
"""

from src.utils.text_utils import strip_code_fences


def test_strips_lowercase_html_fence():
    assert strip_code_fences("```html\n<h1>Hi</h1>\n```") == "<h1>Hi</h1>"


def test_strips_uppercase_tag_without_leaking_it():
    # 旧实现 .replace("```html","") 不匹配 ```HTML → "HTML" 泄漏进输出
    assert strip_code_fences("```HTML\n<h1>Hi</h1>\n```") == "<h1>Hi</h1>"


def test_strips_other_language_tag():
    assert strip_code_fences("```xml\n<root/>\n```") == "<root/>"


def test_strips_bare_fence():
    assert strip_code_fences("```\n<h1>Hi</h1>\n```") == "<h1>Hi</h1>"


def test_handles_single_line_fence():
    # 无换行的单行围栏：旧 replace 能处理，正则必须也能（且不吞内容）
    assert strip_code_fences("```html<h1>Hi</h1>```") == "<h1>Hi</h1>"


def test_preserves_inner_fences():
    # 内容内部的 ``` 必须保留（旧实现的 .replace("```","") 会破坏它们）
    src = "<pre>\n```js\ncode\n```\n</pre>"
    assert strip_code_fences(src) == "<pre>\n```js\ncode\n```\n</pre>"


def test_noop_when_no_fences():
    assert strip_code_fences("<h1>Hi</h1>") == "<h1>Hi</h1>"


def test_handles_missing_closing_fence():
    assert strip_code_fences("```html\n<h1>Hi</h1>") == "<h1>Hi</h1>"


def test_empty_and_none_safe():
    assert strip_code_fences("") == ""
    assert strip_code_fences(None) is None
