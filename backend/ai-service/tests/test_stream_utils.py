"""
stream_utils SSE 格式化 + 流式生成辅助函数测试（先前零覆盖）。

src/utils/stream_utils.py 被 main.py 与 web_engine.py 用于所有 SSE 流式响应，
但此前没有任何测试钉住其契约。本文件覆盖：

  - format_sse: event 头可选、ensure_ascii=False（CJK 不转义）、SSE 终止符 "\n\n"
  - merge_stream_content: 拼接 content、遇 error 类型抛异常、跳过未知类型
  - stream_ollama_chat: 注入 fake ollama 模块（函数内 `import ollama`，可经 sys.modules 桩入）
  - stream_openai_chat: fake AsyncOpenAI 客户端，验证 done=finish_reason is not None
  - stream_custom_llm_chat: 两分支（有 chat_stream / 回退到 chat 逐字符）+ 错误路径

被测代码无重依赖顶层 import（仅 json/asyncio/typing；ollama 在函数内惰性 import），
故可直接导入，无需桩掉第三方库。纯函数 + 注入 fake，不触网络/不起服务。
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.utils.stream_utils import (  # noqa: E402
    format_sse,
    merge_stream_content,
    stream_ollama_chat,
    stream_openai_chat,
    stream_custom_llm_chat,
)


# --------------------------------------------------------------------------- #
# format_sse — 纯同步函数
# --------------------------------------------------------------------------- #
class TestFormatSse:
    def test_without_event_has_data_line_and_double_newline(self):
        out = format_sse({"a": 1})
        assert out == 'data: {"a": 1}\n\n'

    def test_with_event_prepends_event_line(self):
        out = format_sse({"a": 1}, event="message")
        assert out == 'event: message\ndata: {"a": 1}\n\n'

    def test_terminates_with_blank_line(self):
        # SSE 协议要求每条消息以空行（\n\n）结尾
        assert format_sse({"x": "y"}).endswith("\n\n")

    def test_cjk_not_escaped(self):
        # ensure_ascii=False —— 中文应原样保留，不被转成 \uXXXX
        out = format_sse({"msg": "你好"})
        assert "你好" in out
        assert "\\u" not in out

    def test_empty_event_string_is_falsy_no_event_line(self):
        # event="" 为 falsy，不应产生 event 头
        out = format_sse({"a": 1}, event="")
        assert not out.startswith("event:")


# --------------------------------------------------------------------------- #
# merge_stream_content — 聚合异步流
# --------------------------------------------------------------------------- #
async def _agen(items):
    for it in items:
        yield it


class TestMergeStreamContent:
    @pytest.mark.asyncio
    async def test_concatenates_content_chunks(self):
        stream = _agen([
            {"type": "content", "content": "Hello, "},
            {"type": "content", "content": "world"},
            {"type": "content", "content": "", "done": True},
        ])
        assert await merge_stream_content(stream) == "Hello, world"

    @pytest.mark.asyncio
    async def test_skips_non_content_types(self):
        stream = _agen([
            {"type": "content", "content": "a"},
            {"type": "meta", "content": "IGNORED"},
            {"type": "content", "content": "b"},
        ])
        assert await merge_stream_content(stream) == "ab"

    @pytest.mark.asyncio
    async def test_missing_content_key_treated_as_empty(self):
        stream = _agen([
            {"type": "content"},  # 无 content 键
            {"type": "content", "content": "x"},
        ])
        assert await merge_stream_content(stream) == "x"

    @pytest.mark.asyncio
    async def test_error_type_raises_with_message(self):
        stream = _agen([
            {"type": "content", "content": "partial"},
            {"type": "error", "error": "boom"},
        ])
        with pytest.raises(Exception) as ei:
            await merge_stream_content(stream)
        assert "boom" in str(ei.value)

    @pytest.mark.asyncio
    async def test_error_without_message_uses_default(self):
        stream = _agen([{"type": "error"}])
        with pytest.raises(Exception) as ei:
            await merge_stream_content(stream)
        assert "Unknown error" in str(ei.value)


# --------------------------------------------------------------------------- #
# stream_ollama_chat — 函数内 `import ollama`，桩 sys.modules
# --------------------------------------------------------------------------- #
class _FakeOllama:
    # Mocks ollama.AsyncClient: the source now does `client = ollama.AsyncClient()`
    # then `stream = await client.chat(...)` + `async for chunk in stream`
    # (commit 47f642708a — true async, non-blocking event loop). So chat() is a
    # coroutine returning an async iterator over the chunks; raise_exc surfaces on
    # the `await client.chat(...)`.
    def __init__(self, chunks=None, raise_exc=None):
        self._chunks = chunks or []
        self._raise = raise_exc

    async def chat(self, model, messages, stream, options):
        if self._raise:
            raise self._raise

        async def _aiter():
            for chunk in self._chunks:
                yield chunk

        return _aiter()


@pytest.fixture
def stub_ollama(monkeypatch):
    def _install(fake):
        mod = types.ModuleType("ollama")
        mod.AsyncClient = lambda *args, **kwargs: fake
        monkeypatch.setitem(sys.modules, "ollama", mod)
        return fake
    return _install


class TestStreamOllamaChat:
    @pytest.mark.asyncio
    async def test_yields_content_then_breaks_on_done(self, stub_ollama):
        stub_ollama(_FakeOllama(chunks=[
            {"message": {"content": "Hi"}, "done": False},
            {"message": {"content": "!"}, "done": True},
            {"message": {"content": "AFTER"}, "done": False},  # 不应被发出
        ]))
        out = [c async for c in stream_ollama_chat("m", [])]
        assert out == [
            {"type": "content", "content": "Hi", "done": False},
            {"type": "content", "content": "!", "done": True},
        ]

    @pytest.mark.asyncio
    async def test_missing_message_key_yields_empty_content(self, stub_ollama):
        stub_ollama(_FakeOllama(chunks=[{"done": True}]))
        out = [c async for c in stream_ollama_chat("m", [])]
        assert out == [{"type": "content", "content": "", "done": True}]

    @pytest.mark.asyncio
    async def test_exception_yields_error_chunk(self, stub_ollama):
        stub_ollama(_FakeOllama(raise_exc=RuntimeError("ollama down")))
        out = [c async for c in stream_ollama_chat("m", [])]
        assert out == [{"type": "error", "error": "ollama down"}]


# --------------------------------------------------------------------------- #
# stream_openai_chat — fake AsyncOpenAI 客户端
# --------------------------------------------------------------------------- #
class _Delta:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content, finish_reason):
        self.delta = _Delta(content)
        self.finish_reason = finish_reason


class _Chunk:
    def __init__(self, choices):
        self.choices = choices


class _FakeCompletions:
    def __init__(self, chunks, raise_exc=None):
        self._chunks = chunks
        self._raise = raise_exc

    async def create(self, **kwargs):
        if self._raise:
            raise self._raise

        async def _it():
            for c in self._chunks:
                yield c
        return _it()


class _FakeOpenAIClient:
    def __init__(self, chunks=None, raise_exc=None):
        self.chat = types.SimpleNamespace(
            completions=_FakeCompletions(chunks or [], raise_exc)
        )


class TestStreamOpenAIChat:
    @pytest.mark.asyncio
    async def test_done_flag_tracks_finish_reason_and_breaks(self):
        client = _FakeOpenAIClient(chunks=[
            _Chunk([_Choice("Hel", None)]),
            _Chunk([_Choice("lo", "stop")]),
            _Chunk([_Choice("EXTRA", None)]),  # break 后不应发出
        ])
        out = [c async for c in stream_openai_chat(client, "gpt", [])]
        assert out == [
            {"type": "content", "content": "Hel", "done": False},
            {"type": "content", "content": "lo", "done": True},
        ]

    @pytest.mark.asyncio
    async def test_none_delta_content_becomes_empty_string(self):
        client = _FakeOpenAIClient(chunks=[_Chunk([_Choice(None, "stop")])])
        out = [c async for c in stream_openai_chat(client, "gpt", [])]
        assert out == [{"type": "content", "content": "", "done": True}]

    @pytest.mark.asyncio
    async def test_empty_choices_chunk_is_skipped(self):
        client = _FakeOpenAIClient(chunks=[
            _Chunk([]),  # 空 choices —— 跳过
            _Chunk([_Choice("ok", "stop")]),
        ])
        out = [c async for c in stream_openai_chat(client, "gpt", [])]
        assert out == [{"type": "content", "content": "ok", "done": True}]

    @pytest.mark.asyncio
    async def test_exception_yields_error_chunk(self):
        client = _FakeOpenAIClient(raise_exc=RuntimeError("api 500"))
        out = [c async for c in stream_openai_chat(client, "gpt", [])]
        assert out == [{"type": "error", "error": "api 500"}]


# --------------------------------------------------------------------------- #
# stream_custom_llm_chat — chat_stream 分支 / 回退分支 / 错误
# --------------------------------------------------------------------------- #
class _StreamingClient:
    async def chat_stream(self, messages, temperature, max_tokens):
        for tok in ["foo", "bar"]:
            yield tok


class _NonStreamingClient:
    def __init__(self, reply="hi"):
        self._reply = reply

    async def chat(self, messages, temperature, max_tokens):
        return self._reply


class _RaisingStreamClient:
    async def chat_stream(self, messages, temperature, max_tokens):
        raise RuntimeError("stream boom")
        yield  # pragma: no cover — 使其成为异步生成器


class TestStreamCustomLlmChat:
    @pytest.mark.asyncio
    async def test_streaming_branch_yields_tokens_then_final_done(self):
        out = [c async for c in stream_custom_llm_chat(_StreamingClient(), [])]
        assert out == [
            {"type": "content", "content": "foo", "done": False},
            {"type": "content", "content": "bar", "done": False},
            {"type": "content", "content": "", "done": True},
        ]

    @pytest.mark.asyncio
    async def test_fallback_branch_emits_char_by_char(self):
        out = [c async for c in stream_custom_llm_chat(_NonStreamingClient("ab"), [])]
        assert out == [
            {"type": "content", "content": "a", "done": False},
            {"type": "content", "content": "b", "done": False},
            {"type": "content", "content": "", "done": True},
        ]

    @pytest.mark.asyncio
    async def test_fallback_merges_back_to_original_text(self):
        # 逐字符发出后，merge 应还原原始回复
        gen = stream_custom_llm_chat(_NonStreamingClient("héllo"), [])
        assert await merge_stream_content(gen) == "héllo"

    @pytest.mark.asyncio
    async def test_exception_in_stream_yields_error_chunk(self):
        out = [c async for c in stream_custom_llm_chat(_RaisingStreamClient(), [])]
        assert out == [{"type": "error", "error": "stream boom"}]
