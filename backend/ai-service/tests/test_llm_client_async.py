"""
LLM 客户端「同步 SDK 调用不得阻塞 asyncio 事件循环」回归测试。

Ollama / DashScope / ZhipuAI / Qianfan 的官方 SDK 是同步的；早先实现直接在 async def
里调用它们，会在 FastAPI 事件循环线程上原地阻塞，使并发请求与健康检查全部串行化。
修复后统一经 `_run_blocking`（run_in_executor）下放到线程池。这里用一个会 sleep 的
假 SDK 验证多个并发 chat() 真正并行执行（~1×），而非串行（~N×）。

只依赖 ollama 可导入（本仓测试环境已装），其余厂商 SDK 走同一 `_run_blocking`，
模式一致，无需各自联网/装 SDK。
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import src.llm.llm_client as mod  # noqa: E402


def test_run_blocking_returns_value_off_the_loop():
    def slow():
        time.sleep(0.05)
        return "ok"

    async def go():
        return await mod._run_blocking(slow)

    assert asyncio.run(go()) == "ok"


class _BlockingOllama:
    """假 ollama 模块：.chat() 先 sleep（模拟同步阻塞网络调用）再返回固定响应。"""

    def __init__(self, delay):
        self.delay = delay
        self.calls = 0

    def chat(self, model, messages, options=None):
        self.calls += 1
        time.sleep(self.delay)
        return {"message": {"content": f"reply-{model}"}}


def test_ollama_chat_runs_concurrently_not_blocking_event_loop():
    client = mod.OllamaClient(model="m")  # __init__ 仅 import ollama（本环境已装）
    fake = _BlockingOllama(delay=0.3)
    client.client = fake  # 把真实同步 SDK 换成会阻塞的假实现

    async def go():
        return await asyncio.gather(
            client.chat([{"role": "user", "content": "a"}]),
            client.chat([{"role": "user", "content": "b"}]),
            client.chat([{"role": "user", "content": "c"}]),
        )

    start = time.monotonic()
    results = asyncio.run(go())
    elapsed = time.monotonic() - start

    assert results == ["reply-m", "reply-m", "reply-m"]
    assert fake.calls == 3
    # 3 个各 0.3s 的阻塞调用下放到线程池后并行（~0.3s）；若仍在事件循环里原地阻塞，
    # 会串行成 ~0.9s。阈值 0.7s 给足线程池预热余量，又能稳定区分两种行为。
    assert elapsed < 0.7, f"chat() 似乎串行了（elapsed={elapsed:.2f}s）"
