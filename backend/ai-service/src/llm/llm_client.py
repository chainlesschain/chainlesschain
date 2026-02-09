"""
Universal LLM Client - 统一LLM客户端
支持多种云LLM服务商：Ollama, OpenAI, DashScope, ZhipuAI等
"""
import os
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod


class BaseLLMClient(ABC):
    """LLM客户端基类"""

    @property
    def supports_function_calling(self) -> bool:
        """是否支持 function calling / tools"""
        return False

    @abstractmethod
    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        """
        对话接口

        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            temperature: 温度参数
            max_tokens: 最大token数

        Returns:
            LLM响应文本
        """
        pass

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        """
        带工具调用的对话接口

        Args:
            messages: 消息列表
            tools: 工具定义列表 (OpenAI function calling 格式)
            temperature: 温度参数
            max_tokens: 最大token数

        Returns:
            包含 content 和 tool_calls 的响应字典
            {
                "content": str | None,
                "tool_calls": [{"id": str, "function": {"name": str, "arguments": str}}] | None
            }
        """
        # 默认实现：不支持 function calling，直接调用 chat
        content = await self.chat(messages, temperature, max_tokens)
        return {"content": content, "tool_calls": None}

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        """
        文本生成接口（默认实现：将prompt转换为chat调用）

        Args:
            prompt: 提示词
            temperature: 温度参数
            max_tokens: 最大token数

        Returns:
            生成的文本
        """
        messages = [{"role": "user", "content": prompt}]
        return await self.chat(messages, temperature, max_tokens)


class OllamaClient(BaseLLMClient):
    """Ollama本地LLM客户端"""

    def __init__(self, model: str = "qwen2:7b", host: str = "http://localhost:11434"):
        import ollama
        self.model = model
        self.host = host
        self.client = ollama

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.chat(
                model=self.model,
                messages=messages,
                options={
                    "temperature": temperature,
                    "num_predict": max_tokens
                }
            )
            return response['message']['content']
        except Exception as e:
            raise Exception(f"Ollama调用失败: {e}")


class OpenAIClient(BaseLLMClient):
    """OpenAI API客户端（兼容所有OpenAI格式的API）"""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-3.5-turbo",
        base_url: str = "https://api.openai.com/v1"
    ):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    @property
    def supports_function_calling(self) -> bool:
        return True

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"OpenAI API调用失败: {e}")

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens
            )
            message = response.choices[0].message
            return {
                "content": message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in (message.tool_calls or [])
                ] if message.tool_calls else None
            }
        except Exception as e:
            raise Exception(f"OpenAI API调用失败: {e}")


class DashScopeClient(BaseLLMClient):
    """阿里云通义千问客户端"""

    def __init__(self, api_key: str, model: str = "qwen-turbo"):
        try:
            import dashscope
            dashscope.api_key = api_key
            self.dashscope = dashscope
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install dashscope")

    @property
    def supports_function_calling(self) -> bool:
        return True

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            from dashscope import Generation

            response = Generation.call(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                result_format='message'
            )

            if response.status_code == 200:
                return response.output.choices[0].message.content
            else:
                raise Exception(f"DashScope错误: {response.message}")

        except Exception as e:
            raise Exception(f"DashScope调用失败: {e}")

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        try:
            from dashscope import Generation

            response = Generation.call(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens,
                result_format='message'
            )

            if response.status_code == 200:
                message = response.output.choices[0].message
                tool_calls = None
                if hasattr(message, 'tool_calls') and message.tool_calls:
                    tool_calls = [
                        {
                            "id": tc.get('id', f"call_{i}"),
                            "function": {
                                "name": tc['function']['name'],
                                "arguments": tc['function']['arguments']
                            }
                        }
                        for i, tc in enumerate(message.tool_calls)
                    ]
                return {
                    "content": message.content if hasattr(message, 'content') else None,
                    "tool_calls": tool_calls
                }
            else:
                raise Exception(f"DashScope错误: {response.message}")

        except Exception as e:
            raise Exception(f"DashScope调用失败: {e}")


class ZhipuAIClient(BaseLLMClient):
    """智谱AI客户端"""

    def __init__(self, api_key: str, model: str = "glm-4"):
        try:
            from zhipuai import ZhipuAI
            self.client = ZhipuAI(api_key=api_key)
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install zhipuai")

    @property
    def supports_function_calling(self) -> bool:
        return True

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"智谱AI调用失败: {e}")

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens
            )
            message = response.choices[0].message
            tool_calls = None
            if hasattr(message, 'tool_calls') and message.tool_calls:
                tool_calls = [
                    {
                        "id": tc.id,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in message.tool_calls
                ]
            return {
                "content": message.content,
                "tool_calls": tool_calls
            }
        except Exception as e:
            raise Exception(f"智谱AI调用失败: {e}")


class VolcEngineClient(BaseLLMClient):
    """火山引擎（豆包）客户端 - 使用ARK SDK"""

    def __init__(self, api_key: str, model: str = "doubao-pro-4k"):
        try:
            from volcenginesdkarkruntime import Ark
            # api_key格式: "access_key:secret_key" (base64编码) 或直接使用API key
            self.model = model
            self.client = Ark(api_key=api_key)
        except ImportError:
            raise Exception("请先安装: pip install volcengine-python-sdk")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            # 使用Ark SDK调用豆包模型
            import asyncio
            loop = asyncio.get_event_loop()

            # 在executor中运行同步API
            def _sync_call():
                completion = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens
                )
                return completion.choices[0].message.content

            return await loop.run_in_executor(None, _sync_call)
        except Exception as e:
            raise Exception(f"火山引擎调用失败: {e}")

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ):
        """
        流式对话接口

        Yields:
            生成的文本块
        """
        try:
            import asyncio

            # 在executor中运行同步流式API
            def _sync_stream():
                stream = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True
                )
                return stream

            loop = asyncio.get_event_loop()
            stream = await loop.run_in_executor(None, _sync_stream)

            # 逐块yield
            for chunk in stream:
                if hasattr(chunk, 'choices') and chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'content') and delta.content:
                        yield delta.content
        except Exception as e:
            raise Exception(f"火山引擎流式调用失败: {e}")


class QianfanClient(BaseLLMClient):
    """百度千帆客户端"""

    def __init__(self, api_key: str, model: str = "ERNIE-Bot-turbo"):
        try:
            import qianfan
            # api_key格式: "access_key:secret_key"
            if ':' in api_key:
                ak, sk = api_key.split(':', 1)
                self.client = qianfan.ChatCompletion(ak=ak, sk=sk)
            else:
                self.client = qianfan.ChatCompletion(ak=api_key)
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install qianfan")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = self.client.do(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_output_tokens=max_tokens
            )
            return response['result']
        except Exception as e:
            raise Exception(f"百度千帆调用失败: {e}")


class HunyuanClient(BaseLLMClient):
    """腾讯混元客户端（使用OpenAI兼容接口）"""

    def __init__(self, api_key: str, model: str = "hunyuan-lite"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.hunyuan.cloud.tencent.com/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"腾讯混元调用失败: {e}")


class SparkClient(BaseLLMClient):
    """讯飞星火客户端（使用OpenAI兼容接口）"""

    def __init__(self, api_key: str, model: str = "spark-lite"):
        from openai import AsyncOpenAI
        # api_key格式: "app_id:api_key:api_secret"
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://spark-api-open.xf-yun.com/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"讯飞星火调用失败: {e}")


class MiniMaxClient(BaseLLMClient):
    """MiniMax客户端"""

    def __init__(self, api_key: str, model: str = "abab5.5-chat"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.minimax.chat/v1"
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"MiniMax调用失败: {e}")


class DeepSeekClient(BaseLLMClient):
    """DeepSeek客户端"""

    def __init__(self, api_key: str, model: str = "deepseek-chat"):
        from openai import AsyncOpenAI
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com/v1"
        )

    @property
    def supports_function_calling(self) -> bool:
        return True

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"DeepSeek调用失败: {e}")

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> Dict[str, Any]:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens
            )
            message = response.choices[0].message
            return {
                "content": message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in (message.tool_calls or [])
                ] if message.tool_calls else None
            }
        except Exception as e:
            raise Exception(f"DeepSeek调用失败: {e}")


class LLMClientFactory:
    """LLM客户端工厂"""

    @staticmethod
    def create_client(
        provider: str,
        model: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None
    ) -> BaseLLMClient:
        """
        创建LLM客户端

        Args:
            provider: 提供商 (ollama, openai, dashscope, zhipu, volcengine, qianfan,
                              hunyuan, spark, minimax, deepseek)
            model: 模型名称
            api_key: API密钥
            base_url: API基础URL

        Returns:
            LLM客户端实例
        """
        provider = provider.lower()

        if provider == "ollama":
            host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
            return OllamaClient(model=model, host=host)

        elif provider == "openai":
            if not api_key:
                raise ValueError("OpenAI需要API Key")
            base_url = base_url or "https://api.openai.com/v1"
            return OpenAIClient(api_key=api_key, model=model, base_url=base_url)

        elif provider == "dashscope":
            if not api_key:
                raise ValueError("DashScope需要API Key")
            return DashScopeClient(api_key=api_key, model=model)

        elif provider == "zhipu":
            if not api_key:
                raise ValueError("智谱AI需要API Key")
            return ZhipuAIClient(api_key=api_key, model=model)

        elif provider == "volcengine" or provider == "doubao":
            if not api_key:
                raise ValueError("火山引擎需要API Key (格式: ak:sk)")
            return VolcEngineClient(api_key=api_key, model=model)

        elif provider == "qianfan" or provider == "baidu":
            if not api_key:
                raise ValueError("百度千帆需要API Key (格式: ak:sk)")
            return QianfanClient(api_key=api_key, model=model)

        elif provider == "hunyuan" or provider == "tencent":
            if not api_key:
                raise ValueError("腾讯混元需要API Key")
            return HunyuanClient(api_key=api_key, model=model)

        elif provider == "spark" or provider == "xfyun":
            if not api_key:
                raise ValueError("讯飞星火需要API Key")
            return SparkClient(api_key=api_key, model=model)

        elif provider == "minimax":
            if not api_key:
                raise ValueError("MiniMax需要API Key")
            return MiniMaxClient(api_key=api_key, model=model)

        elif provider == "deepseek":
            if not api_key:
                raise ValueError("DeepSeek需要API Key")
            return DeepSeekClient(api_key=api_key, model=model)

        else:
            raise ValueError(f"不支持的LLM提供商: {provider}")


# 便捷函数
def get_llm_client() -> BaseLLMClient:
    """
    根据环境变量自动创建LLM客户端

    智能Fallback机制:
    1. 优先使用配置的云LLM提供商（如dashscope）
    2. 如果云LLM的API Key未配置或为空，自动回退到Ollama本地LLM
    3. 确保服务始终可用

    环境变量:
        LLM_PROVIDER: 提供商 (ollama, openai, dashscope, zhipu, volcengine, qianfan,
                               hunyuan, spark, minimax, deepseek)
        LLM_MODEL: 模型名称
        OPENAI_API_KEY: OpenAI API密钥
        OPENAI_BASE_URL: OpenAI API基础URL
        DASHSCOPE_API_KEY: 阿里云DashScope API密钥
        ZHIPU_API_KEY: 智谱AI API密钥
        VOLCENGINE_API_KEY: 火山引擎API密钥 (格式: ak:sk)
        QIANFAN_API_KEY: 百度千帆API密钥 (格式: ak:sk)
        HUNYUAN_API_KEY: 腾讯混元API密钥
        SPARK_API_KEY: 讯飞星火API密钥
        MINIMAX_API_KEY: MiniMax API密钥
        DEEPSEEK_API_KEY: DeepSeek API密钥
        OLLAMA_HOST: Ollama服务地址（fallback用）
        OLLAMA_MODEL: Ollama模型名称（fallback用）
    """
    import logging
    logger = logging.getLogger(__name__)

    provider = os.getenv("LLM_PROVIDER", "dashscope")
    model = os.getenv("LLM_MODEL", "qwen-turbo")

    api_key = None
    base_url = None

    # 根据provider获取对应的API Key
    provider_lower = provider.lower()

    model_overrides = {
        "dashscope": "DASHSCOPE_MODEL",
        "zhipu": "ZHIPU_MODEL",
        "volcengine": "VOLCENGINE_MODEL",
        "doubao": "VOLCENGINE_MODEL",
        "qianfan": "QIANFAN_MODEL",
        "baidu": "QIANFAN_MODEL",
        "hunyuan": "HUNYUAN_MODEL",
        "tencent": "HUNYUAN_MODEL",
        "spark": "SPARK_MODEL",
        "xfyun": "SPARK_MODEL",
        "minimax": "MINIMAX_MODEL",
        "deepseek": "DEEPSEEK_MODEL",
    }
    override_key = model_overrides.get(provider_lower)
    if override_key:
        model = os.getenv(override_key, model)

    if provider_lower == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    elif provider_lower == "dashscope":
        api_key = os.getenv("DASHSCOPE_API_KEY")
    elif provider_lower == "zhipu":
        api_key = os.getenv("ZHIPU_API_KEY")
    elif provider_lower in ["volcengine", "doubao"]:
        api_key = os.getenv("VOLCENGINE_API_KEY")
    elif provider_lower in ["qianfan", "baidu"]:
        api_key = os.getenv("QIANFAN_API_KEY")
    elif provider_lower in ["hunyuan", "tencent"]:
        api_key = os.getenv("HUNYUAN_API_KEY")
    elif provider_lower in ["spark", "xfyun"]:
        api_key = os.getenv("SPARK_API_KEY")
    elif provider_lower == "minimax":
        api_key = os.getenv("MINIMAX_API_KEY")
    elif provider_lower == "deepseek":
        api_key = os.getenv("DEEPSEEK_API_KEY")

    # 智能Fallback: 如果云LLM的API Key未配置，自动回退到Ollama
    if provider_lower != "ollama" and (not api_key or api_key.strip() == ""):
        logger.warning(
            f"LLM_PROVIDER设置为'{provider}'，但未配置API Key，"
            f"自动回退到Ollama本地LLM"
        )
        provider = "ollama"
        provider_lower = "ollama"
        model = os.getenv("OLLAMA_MODEL", "qwen2:7b")
        api_key = None

    return LLMClientFactory.create_client(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url
    )
