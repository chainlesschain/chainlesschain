"""
LLMClientFactory.create_client + get_llm_client 路由/回退逻辑测试（先前零覆盖）。

这两段是 AI 服务选择 LLM 后端的核心调度：provider 别名归一、缺 Key 报错、未知
provider 报错，以及"云 LLM 未配 Key → 自动回退 Ollama 本地"的智能回退。别名打错或
回退判断写反都会静默路由到错误后端，却一直没有测试。

为避免触碰各家真实 SDK（OllamaClient.__init__ 等会 `import ollama`/初始化客户端），
把所有 client 类替换成带标签的 fake（构造仅记录 kwargs）；get_llm_client 的环境/回退
逻辑则通过 spy 掉 LLMClientFactory.create_client 来纯逻辑验证。不触网络/不加载 SDK。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import src.llm.llm_client as mod  # noqa: E402


def _make_fake(tag):
    class _Fake:
        def __init__(self, **kwargs):
            self.tag = tag
            self.kwargs = kwargs

    return _Fake


# provider 名 → 该 provider 应实例化的 client 类属性名
_CLIENT_ATTRS = {
    "ollama": "OllamaClient",
    "openai": "OpenAIClient",
    "dashscope": "DashScopeClient",
    "zhipu": "ZhipuAIClient",
    "volcengine": "VolcEngineClient",
    "qianfan": "QianfanClient",
    "hunyuan": "HunyuanClient",
    "spark": "SparkClient",
    "minimax": "MiniMaxClient",
    "deepseek": "DeepSeekClient",
}


@pytest.fixture(autouse=True)
def stub_clients(monkeypatch):
    """把所有 client 类替换成带标签 fake，路由测试只看标签不碰 SDK。"""
    for tag, attr in _CLIENT_ATTRS.items():
        monkeypatch.setattr(mod, attr, _make_fake(tag))
    yield


# --------------------------------------------------------------------------- #
# create_client — 路由 + 别名
# --------------------------------------------------------------------------- #
class TestCreateClientRouting:
    def test_ollama_uses_env_host_no_key_needed(self, monkeypatch):
        monkeypatch.setenv("OLLAMA_HOST", "http://ollama.local:9999")
        c = mod.LLMClientFactory.create_client("ollama", "qwen2:7b")
        assert c.tag == "ollama"
        assert c.kwargs["host"] == "http://ollama.local:9999"
        assert c.kwargs["model"] == "qwen2:7b"

    def test_provider_is_case_insensitive(self):
        c = mod.LLMClientFactory.create_client("OpenAI", "gpt-4o", api_key="k")
        assert c.tag == "openai"

    @pytest.mark.parametrize("provider,expected", [
        ("doubao", "volcengine"),
        ("baidu", "qianfan"),
        ("tencent", "hunyuan"),
        ("xfyun", "spark"),
    ])
    def test_aliases_map_to_canonical_client(self, provider, expected):
        c = mod.LLMClientFactory.create_client(provider, "m", api_key="k")
        assert c.tag == expected

    def test_keyed_provider_passes_api_key_and_model(self):
        c = mod.LLMClientFactory.create_client("deepseek", "deepseek-chat", api_key="sk-x")
        assert c.tag == "deepseek"
        assert c.kwargs["api_key"] == "sk-x"
        assert c.kwargs["model"] == "deepseek-chat"

    def test_openai_defaults_base_url_when_absent(self):
        c = mod.LLMClientFactory.create_client("openai", "gpt-4o", api_key="k")
        assert c.kwargs["base_url"] == "https://api.openai.com/v1"

    def test_openai_keeps_explicit_base_url(self):
        c = mod.LLMClientFactory.create_client(
            "openai", "gpt-4o", api_key="k", base_url="http://proxy/v1"
        )
        assert c.kwargs["base_url"] == "http://proxy/v1"


class TestCreateClientErrors:
    @pytest.mark.parametrize("provider", [
        "openai", "dashscope", "zhipu", "volcengine", "qianfan",
        "hunyuan", "spark", "minimax", "deepseek",
    ])
    def test_missing_api_key_raises(self, provider):
        with pytest.raises(ValueError):
            mod.LLMClientFactory.create_client(provider, "m", api_key=None)

    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="不支持的LLM提供商"):
            mod.LLMClientFactory.create_client("nope-llm", "m", api_key="k")


# --------------------------------------------------------------------------- #
# get_llm_client — 环境驱动 + 智能回退（spy 掉 create_client）
# --------------------------------------------------------------------------- #
@pytest.fixture
def spy_create(monkeypatch):
    calls = {}

    def _spy(provider, model, api_key=None, base_url=None):
        calls.update(provider=provider, model=model, api_key=api_key, base_url=base_url)
        return _make_fake(provider)()

    monkeypatch.setattr(mod.LLMClientFactory, "create_client", staticmethod(_spy))
    return calls


def _clear_llm_env(monkeypatch):
    for k in [
        "LLM_PROVIDER", "LLM_MODEL", "OLLAMA_MODEL",
        "DASHSCOPE_API_KEY", "DASHSCOPE_MODEL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
        "OPENAI_API_KEY", "VOLCENGINE_API_KEY", "VOLCENGINE_MODEL",
    ]:
        monkeypatch.delenv(k, raising=False)


class TestGetLlmClient:
    def test_configured_provider_with_key_used_directly(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "deepseek")
        monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-real")
        mod.get_llm_client()
        assert spy_create["provider"] == "deepseek"
        assert spy_create["api_key"] == "sk-real"
        assert spy_create["model"] == "deepseek-chat"

    def test_model_override_env_takes_precedence(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "deepseek")
        monkeypatch.setenv("LLM_MODEL", "base-model")
        monkeypatch.setenv("DEEPSEEK_MODEL", "override-model")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk")
        mod.get_llm_client()
        assert spy_create["model"] == "override-model"

    def test_missing_cloud_key_falls_back_to_ollama(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "dashscope")  # 但不设 DASHSCOPE_API_KEY
        monkeypatch.setenv("OLLAMA_MODEL", "qwen2:7b")
        mod.get_llm_client()
        assert spy_create["provider"] == "ollama"
        assert spy_create["model"] == "qwen2:7b"
        assert spy_create["api_key"] is None

    def test_blank_whitespace_key_also_falls_back(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "volcengine")
        monkeypatch.setenv("VOLCENGINE_API_KEY", "   ")  # 纯空白视为未配
        mod.get_llm_client()
        assert spy_create["provider"] == "ollama"

    def test_ollama_provider_no_fallback_no_key(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "ollama")
        monkeypatch.setenv("LLM_MODEL", "llama3")
        mod.get_llm_client()
        assert spy_create["provider"] == "ollama"
        assert spy_create["model"] == "llama3"

    def test_default_provider_is_dashscope(self, monkeypatch, spy_create):
        _clear_llm_env(monkeypatch)
        monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-dash")  # 不设 LLM_PROVIDER → 默认 dashscope
        mod.get_llm_client()
        assert spy_create["provider"] == "dashscope"
        assert spy_create["api_key"] == "sk-dash"
