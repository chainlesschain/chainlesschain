"""
CrossEncoderReranker 重排序逻辑测试（先前零覆盖）。

src/rag/crossencoder_reranker.py 顶层 `from sentence_transformers import CrossEncoder`
是重依赖（本机未安装）。被测的纯逻辑——rerank 的降序排序 / top_k 截断 / 失败回退
（保留原序、score=0.5）/ id·text 默认值 / original_index、is_ready、get_model_info、
get_reranker 单例——都不需要真实模型，用注入的 fake model 即可。

故在导入前桩掉 sentence_transformers（numpy 是真依赖，已安装，照常使用），
不改变被测代码本身。无网络/不加载模型。
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 在导入被测模块前桩掉重依赖 sentence_transformers
if "sentence_transformers" not in sys.modules:
    _st = types.ModuleType("sentence_transformers")
    _st.CrossEncoder = object  # 占位；按测试需要 monkeypatch mod.CrossEncoder
    sys.modules["sentence_transformers"] = _st

import src.rag.crossencoder_reranker as mod  # noqa: E402
from src.rag.crossencoder_reranker import CrossEncoderReranker  # noqa: E402


class _FakeModel:
    """假 CrossEncoder：predict 返回预置分数或抛异常。"""

    def __init__(self, scores=None, raise_exc=None):
        self._scores = scores
        self._raise = raise_exc

    def predict(self, sentence_pairs):
        if self._raise:
            raise self._raise
        if self._scores is not None:
            return self._scores
        return [0.0] * len(sentence_pairs)


def _ready_reranker(fake):
    r = CrossEncoderReranker()
    r.model = fake
    r._initialized = True
    return r


# --------------------------------------------------------------------------- #
# is_ready / get_model_info
# --------------------------------------------------------------------------- #
class TestReadyAndInfo:
    def test_not_ready_before_init(self):
        r = CrossEncoderReranker()
        assert r.is_ready() is False
        info = r.get_model_info()
        assert info["initialized"] is False
        assert info["available"] is False
        assert info["model_name"] == "BAAI/bge-reranker-large"

    def test_ready_after_model_set(self):
        r = _ready_reranker(_FakeModel())
        assert r.is_ready() is True
        info = r.get_model_info()
        assert info["initialized"] is True
        assert info["available"] is True

    def test_initialized_flag_without_model_is_not_ready(self):
        # _initialized True 但 model 仍为 None → 不就绪
        r = CrossEncoderReranker()
        r._initialized = True
        r.model = None
        assert r.is_ready() is False


# --------------------------------------------------------------------------- #
# rerank — 排序 / 截断 / 默认值
# --------------------------------------------------------------------------- #
class TestRerank:
    def test_empty_documents_returns_empty(self):
        r = _ready_reranker(_FakeModel())
        assert r.rerank("q", []) == []

    def test_sorts_descending_and_keeps_original_index(self):
        r = _ready_reranker(_FakeModel(scores=[0.1, 0.9, 0.5]))
        docs = [
            {"id": "a", "text": "ta"},
            {"id": "b", "text": "tb"},
            {"id": "c", "text": "tc"},
        ]
        out = r.rerank("q", docs, top_k=3)
        assert [d["id"] for d in out] == ["b", "c", "a"]
        assert [d["original_index"] for d in out] == [1, 2, 0]
        assert out[0]["score"] == pytest.approx(0.9)

    def test_truncates_to_top_k(self):
        r = _ready_reranker(_FakeModel(scores=[0.1, 0.9, 0.5]))
        docs = [{"id": x} for x in ("a", "b", "c")]
        out = r.rerank("q", docs, top_k=2)
        assert [d["id"] for d in out] == ["b", "c"]

    def test_score_coerced_to_python_float(self):
        import numpy as np
        r = _ready_reranker(_FakeModel(scores=np.array([0.42])))
        out = r.rerank("q", [{"id": "a", "text": "t"}])
        assert type(out[0]["score"]) is float
        assert out[0]["score"] == pytest.approx(0.42)

    def test_list_scores_handled_like_ndarray(self):
        # predict 返回普通 list（非 ndarray）也应正常处理
        r = _ready_reranker(_FakeModel(scores=[0.3, 0.7]))
        out = r.rerank("q", [{"id": "a"}, {"id": "b"}])
        assert [d["id"] for d in out] == ["b", "a"]

    def test_missing_id_and_text_get_defaults(self):
        r = _ready_reranker(_FakeModel(scores=[0.5]))
        out = r.rerank("q", [{}])  # 无 id / text
        assert out[0]["id"] == "doc_0"
        assert out[0]["text"] == ""

    def test_lazy_initializes_when_not_ready(self, monkeypatch):
        # is_ready False → rerank 应触发 initialize()，由桩的 CrossEncoder 提供模型
        created = {}

        def _fake_cross_encoder(model_name, max_length):
            created["called"] = True
            return _FakeModel(scores=[0.5])

        monkeypatch.setattr(mod, "CrossEncoder", _fake_cross_encoder)
        r = CrossEncoderReranker()
        assert r.is_ready() is False
        out = r.rerank("q", [{"id": "a"}])
        assert created.get("called") is True
        assert r.is_ready() is True
        assert out[0]["id"] == "a"


# --------------------------------------------------------------------------- #
# rerank — 失败回退到原始顺序
# --------------------------------------------------------------------------- #
class TestRerankFailureFallback:
    def test_predict_error_returns_original_order_with_default_score(self):
        r = _ready_reranker(_FakeModel(raise_exc=RuntimeError("predict boom")))
        docs = [{"id": "a", "text": "ta"}, {"id": "b", "text": "tb"}, {"id": "c"}]
        out = r.rerank("q", docs, top_k=2)
        # 原始顺序保留，仅取 top_k，分数统一 0.5
        assert [d["id"] for d in out] == ["a", "b"]
        assert all(d["score"] == 0.5 for d in out)
        assert [d["original_index"] for d in out] == [0, 1]

    def test_fallback_default_id_for_missing(self):
        r = _ready_reranker(_FakeModel(raise_exc=ValueError("x")))
        out = r.rerank("q", [{}], top_k=5)
        assert out[0]["id"] == "doc_0"
        assert out[0]["text"] == ""


# --------------------------------------------------------------------------- #
# rerank_async / get_reranker 单例
# --------------------------------------------------------------------------- #
class TestAsyncAndSingleton:
    @pytest.mark.asyncio
    async def test_rerank_async_delegates_to_rerank(self):
        r = _ready_reranker(_FakeModel(scores=[0.2, 0.8]))
        out = await r.rerank_async("q", [{"id": "a"}, {"id": "b"}])
        assert [d["id"] for d in out] == ["b", "a"]

    def test_get_reranker_returns_singleton(self, monkeypatch):
        monkeypatch.setattr(mod, "_reranker_instance", None)
        first = mod.get_reranker()
        second = mod.get_reranker()
        assert first is second

    def test_get_reranker_uses_provided_model_name_first_time(self, monkeypatch):
        monkeypatch.setattr(mod, "_reranker_instance", None)
        inst = mod.get_reranker("BAAI/bge-reranker-base")
        assert inst.model_name == "BAAI/bge-reranker-base"
