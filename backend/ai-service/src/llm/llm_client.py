"""
Universal LLM Client - 统一LLM客户端
支持多种云LLM服务商：Ollama, OpenAI, DashScope, ZhipuAI等
"""
import os
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod


class BaseLLMClient(ABC):
    """LLM客户端基类"""

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


class ZhipuAIClient(BaseLLMClient):
    """智谱AI客户端"""

    def __init__(self, api_key: str, model: str = "glm-4"):
        try:
            from zhipuai import ZhipuAI
            self.client = ZhipuAI(api_key=api_key)
            self.model = model
        except ImportError:
            raise Exception("请先安装: pip install zhipuai")

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
            provider: 提供商 (ollama, openai, dashscope, zhipu)
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

        else:
            raise ValueError(f"不支持的LLM提供商: {provider}")


# 便捷函数
def get_llm_client() -> BaseLLMClient:
    """
    根据环境变量自动创建LLM客户端

    环境变量:
        LLM_PROVIDER: 提供商 (ollama, openai, dashscope, zhipu)
        LLM_MODEL: 模型名称
        OPENAI_API_KEY: OpenAI API密钥
        OPENAI_BASE_URL: OpenAI API基础URL
        DASHSCOPE_API_KEY: DashScope API密钥
        ZHIPU_API_KEY: 智谱AI API密钥
    """
    provider = os.getenv("LLM_PROVIDER", "ollama")
    model = os.getenv("LLM_MODEL", "qwen2:7b")

    api_key = None
    base_url = None

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    elif provider == "dashscope":
        api_key = os.getenv("DASHSCOPE_API_KEY")
    elif provider == "zhipu":
        api_key = os.getenv("ZHIPU_API_KEY")

    return LLMClientFactory.create_client(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url
    )
