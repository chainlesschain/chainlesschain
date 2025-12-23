"""
流式生成工具模块
提供SSE (Server-Sent Events) 格式化和流式生成辅助功能
"""
import json
import asyncio
from typing import AsyncGenerator, Dict, Any, Optional


def format_sse(data: Dict[str, Any], event: Optional[str] = None) -> str:
    """
    格式化为SSE格式

    Args:
        data: 要发送的数据
        event: 事件类型（可选）

    Returns:
        SSE格式的字符串
    """
    msg = ""
    if event:
        msg += f"event: {event}\n"
    msg += f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    return msg


async def stream_ollama_chat(
    model: str,
    messages: list,
    options: Optional[Dict[str, Any]] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    流式调用Ollama chat API

    Args:
        model: 模型名称
        messages: 消息列表
        options: 可选参数

    Yields:
        流式生成的数据块
    """
    import ollama

    try:
        stream = ollama.chat(
            model=model,
            messages=messages,
            stream=True,
            options=options or {}
        )

        for chunk in stream:
            content = chunk.get('message', {}).get('content', '')
            done = chunk.get('done', False)

            yield {
                "type": "content",
                "content": content,
                "done": done
            }

            if done:
                break

    except Exception as e:
        yield {
            "type": "error",
            "error": str(e)
        }


async def stream_openai_chat(
    client,
    model: str,
    messages: list,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    流式调用OpenAI chat API

    Args:
        client: AsyncOpenAI客户端
        model: 模型名称
        messages: 消息列表
        temperature: 温度参数
        max_tokens: 最大token数

    Yields:
        流式生成的数据块
    """
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True
        )

        async for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta
                content = delta.content or ""
                finish_reason = chunk.choices[0].finish_reason

                yield {
                    "type": "content",
                    "content": content,
                    "done": finish_reason is not None
                }

                if finish_reason:
                    break

    except Exception as e:
        yield {
            "type": "error",
            "error": str(e)
        }


async def stream_custom_llm_chat(
    llm_client,
    messages: list,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    流式调用自定义LLM客户端

    Args:
        llm_client: 自定义LLM客户端
        messages: 消息列表
        temperature: 温度参数
        max_tokens: 最大token数

    Yields:
        流式生成的数据块
    """
    try:
        # 检查客户端是否支持流式生成
        if hasattr(llm_client, 'chat_stream'):
            async for chunk in llm_client.chat_stream(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            ):
                yield {
                    "type": "content",
                    "content": chunk,
                    "done": False
                }

            yield {
                "type": "content",
                "content": "",
                "done": True
            }
        else:
            # 如果不支持流式，则一次性返回
            content = await llm_client.chat(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )

            # 模拟流式输出（逐字符）
            for char in content:
                yield {
                    "type": "content",
                    "content": char,
                    "done": False
                }
                await asyncio.sleep(0.01)  # 添加小延迟模拟流式

            yield {
                "type": "content",
                "content": "",
                "done": True
            }

    except Exception as e:
        yield {
            "type": "error",
            "error": str(e)
        }


async def merge_stream_content(
    stream: AsyncGenerator[Dict[str, Any], None]
) -> str:
    """
    合并流式内容为完整文本

    Args:
        stream: 流式生成器

    Returns:
        完整的文本内容
    """
    full_content = ""
    async for chunk in stream:
        if chunk.get("type") == "content":
            full_content += chunk.get("content", "")
        elif chunk.get("type") == "error":
            raise Exception(chunk.get("error", "Unknown error"))

    return full_content
